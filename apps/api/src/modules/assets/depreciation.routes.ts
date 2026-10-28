import { Router } from 'express';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { runTransaction } from '../../db/transaction.js';
import { conflict, notFound, validationError } from '../../http/errors.js';
import { parseInput } from '../../http/validate.js';
import { canAccessBranch } from '../../tenancy/scope.js';
import { parseObjectId, requirePermission, tenantOf } from '../../tenancy/tenant-context.js';
import { ledgerToday, monthEnd, postEntry, prepareLedger, type Lean } from '../accounting/accounting.posting.js';
import { auditLedger, requireOrgWide, requireSettings } from '../accounting/accounting.routes.js';
import { ensureTemplateAccount } from '../accounting/accounting.setup.js';
import { MAX_AMOUNT } from '../finance/finance.model.js';
import { AssetModel, type Asset } from './assets.model.js';

// Straight-line depreciation of capitalized equipment (docs/architecture/ASSETS.md, milestone H4).
// The method inputs — useful life, residual value, first month — are entered by the clinic's
// accountant per asset; nothing is assumed. A monthly run posts each month once:
//   Dr depreciation expense (branch)   Cr accumulated depreciation (branch)

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const nextMonth = (m: string) => {
  const [y, mm] = [Number(m.slice(0, 4)), Number(m.slice(5, 7))];
  return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
};
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/** Amount of the i-th month (0-based): equal months, the last one takes the rounding so the total is exact. */
export function monthlyAmount(depreciable: number, lifeMonths: number, i: number) {
  const each = Math.floor(depreciable / lifeMonths);
  return i === lifeMonths - 1 ? depreciable - each * (lifeMonths - 1) : each;
}

export const depreciationDto = (a: Lean<Asset>) => {
  const d = a.depreciation;
  if (!d) return null;
  const depreciable = a.purchase.cost - d.residualValue;
  const posted = d.lastMonth ? monthsBetween(d.startMonth, d.lastMonth) + 1 : 0;
  return {
    method: d.method,
    usefulLifeMonths: d.usefulLifeMonths,
    residualValue: d.residualValue,
    startMonth: d.startMonth,
    monthly: Math.floor(depreciable / d.usefulLifeMonths),
    accumulated: d.accumulated,
    bookValue: a.purchase.cost - d.accumulated,
    lastMonth: d.lastMonth,
    monthsPosted: posted,
    fullyDepreciated: posted >= d.usefulLifeMonths,
  };
};

async function accounts(organizationId: Types.ObjectId) {
  return runTransaction(async (session) => ({
    expense: await ensureTemplateAccount(organizationId, 'depreciationExpense', session),
    accumulated: await ensureTemplateAccount(organizationId, 'accumulatedDepreciation', session),
  }));
}

const setupSchema = z.object({
  usefulLifeMonths: z.number().int().min(1).max(600),
  residualValue: z.number().int().min(0).max(MAX_AMOUNT),
  startMonth: monthSchema,
  version: z.number().int().min(0),
});

export function createDepreciationRouter() {
  const router = Router({ mergeParams: true });

  // What each configured asset has posted and what a run through `month` would post.
  router.get('/assets/depreciation/schedule', requirePermission('accounting.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const settings = await requireSettings(tenant);
    const today = await ledgerToday(tenant.organizationId);
    const { month } = parseInput(z.object({ month: monthSchema.optional() }), req.query);
    const through = month ?? lastEndedMonth(today);
    const rows = await AssetModel.find({ organizationId: tenant.organizationId, depreciation: { $ne: null } })
      .sort({ code: 1 })
      .lean<Lean<Asset>[]>();
    res.json({
      through,
      currency: settings.currency,
      assets: rows.map((a) => ({
        id: String(a._id),
        code: a.code,
        name: a.name,
        status: a.status,
        cost: a.purchase.cost,
        depreciation: depreciationDto(a),
        due: pending(a, through),
      })),
    });
  });

  router.put('/assets/:assetId/depreciation', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const settings = await requireSettings(tenant);
    const aid = parseObjectId(req.params.assetId);
    const a = aid ? await AssetModel.findOne({ organizationId: tenant.organizationId, _id: aid }).lean<Lean<Asset>>() : null;
    if (!a || !canAccessBranch(tenant, a.branchId)) throw notFound();
    const input = parseInput(setupSchema, req.body);
    if (!a.ledgerAccountId) throw conflict('ASSET_NOT_CAPITALIZED', 'Only equipment capitalized through a supplier bill is depreciated');
    if (a.status === 'retired' || a.status === 'disposed') throw conflict('ASSET_RETIRED', 'Retired equipment is not depreciated');
    if (a.depreciation?.lastMonth) throw conflict('DEPRECIATION_STARTED', 'Depreciation was already posted for this asset');
    if (input.residualValue >= a.purchase.cost) throw validationError({ residualValue: 'not_below_cost' });
    if (`${input.startMonth}-01` < settings.cutoverDate.slice(0, 7) + '-01') throw validationError({ startMonth: 'before_ledger' });
    const updated = await AssetModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, _id: a._id, version: input.version },
      {
        $set: {
          depreciation: {
            method: 'straight_line',
            usefulLifeMonths: input.usefulLifeMonths,
            residualValue: input.residualValue,
            startMonth: input.startMonth,
            accumulated: 0,
            lastMonth: null,
          },
        },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    ).lean<Lean<Asset>>();
    if (!updated) throw conflict('VERSION_CONFLICT', 'This asset was changed meanwhile');
    await auditLedger(
      tenant,
      'asset.updated',
      { type: 'asset', id: a._id },
      { depreciation: { usefulLifeMonths: input.usefulLifeMonths, residualValue: input.residualValue, startMonth: input.startMonth } },
    );
    res.json({ depreciation: depreciationDto(updated), version: updated.version });
  });

  // Posts every month not yet posted, from each asset's next month through `month` (ended months
  // only), one entry per asset and month. Rerunning posts nothing twice.
  router.post('/assets/depreciation/run', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const settings = await requireSettings(tenant);
    const { month } = parseInput(z.object({ month: monthSchema }), req.body);
    const today = await ledgerToday(tenant.organizationId);
    if (monthEnd(month) > today) throw validationError({ month: 'not_ended' });
    if (settings.lockedThrough && monthEnd(month) <= settings.lockedThrough) throw conflict('PERIOD_CLOSED', 'This month is closed');
    const { expense, accumulated } = await accounts(tenant.organizationId);
    const rows = await AssetModel.find({
      organizationId: tenant.organizationId,
      depreciation: { $ne: null },
      status: { $in: ['active', 'out_of_service'] },
    }).lean<Lean<Asset>[]>();
    await prepareLedger(tenant.organizationId, [`${month}-01`]);
    const results: { assetId: string; code: string; months: number; amount: number; skipped?: string }[] = [];
    for (const a of rows) {
      const months = pending(a, month);
      if (months.length === 0) continue;
      if (settings.lockedThrough && monthEnd(months[0]!.month) <= settings.lockedThrough) {
        results.push({ assetId: String(a._id), code: a.code, months: 0, amount: 0, skipped: 'period_closed' });
        continue;
      }
      const total = await runTransaction(async (session) => {
        let sum = 0;
        for (const m of months) {
          await postEntry(
            {
              organizationId: tenant.organizationId,
              userId: tenant.userId,
              date: monthEnd(m.month),
              journal: 'general',
              memo: `${a.code} depreciation ${m.month}`,
              lines: [
                { accountId: expense._id, debit: m.amount, branchId: a.branchId },
                { accountId: accumulated._id, credit: m.amount, branchId: a.branchId },
              ],
              source: { type: 'asset', id: a._id, event: `depreciation-${m.month}` },
            },
            session,
            settings,
          );
          sum += m.amount;
        }
        const last = months.at(-1)!.month;
        const done = await AssetModel.updateOne(
          { organizationId: tenant.organizationId, _id: a._id, 'depreciation.lastMonth': a.depreciation!.lastMonth },
          { $set: { 'depreciation.lastMonth': last }, $inc: { 'depreciation.accumulated': sum, version: 1 } },
          { session },
        );
        if (done.modifiedCount !== 1) throw conflict('VERSION_CONFLICT', 'Depreciation is being posted by another request');
        return sum;
      });
      results.push({ assetId: String(a._id), code: a.code, months: months.length, amount: total });
    }
    await auditLedger(
      tenant,
      'asset.depreciated',
      { type: 'organization', id: tenant.organizationId },
      { month, assets: results.filter((r) => r.months > 0).length },
    );
    res.json({ month, results, total: results.reduce((s, r) => s + r.amount, 0) });
  });

  return router;
}

/** The latest month that has ended by `today`. */
function lastEndedMonth(today: string) {
  const m = today.slice(0, 7);
  if (monthEnd(m) <= today) return m;
  const [y, mm] = [Number(m.slice(0, 4)), Number(m.slice(5, 7))];
  return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`;
}

/** Months still to post through `through`, with their amounts. */
function pending(a: Lean<Asset>, through: string) {
  const d = a.depreciation;
  if (!d) return [];
  const depreciable = a.purchase.cost - d.residualValue;
  const out: { month: string; amount: number }[] = [];
  for (let m = d.lastMonth ? nextMonth(d.lastMonth) : d.startMonth; m <= through; m = nextMonth(m)) {
    const i = monthsBetween(d.startMonth, m);
    if (i >= d.usefulLifeMonths) break;
    out.push({ month: m, amount: monthlyAmount(depreciable, d.usefulLifeMonths, i) });
  }
  return out;
}
