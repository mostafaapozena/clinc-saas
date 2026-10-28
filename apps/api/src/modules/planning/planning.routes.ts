import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { runTransaction } from '../../db/transaction.js';
import { conflict, isDuplicateKeyError, notFound, validationError } from '../../http/errors.js';
import { objectIdSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { requirePermission, parseObjectId, tenantOf, type TenantContext } from '../../tenancy/tenant-context.js';
import { DATE_PATTERN, addDays, isValidDate } from '../../time/local-time.js';
import { CashAccountModel, CashVoucherModel, JournalEntryModel, LedgerAccountModel, type LedgerAccount } from '../accounting/accounting.model.js';
import { ledgerToday, monthEnd, type Lean } from '../accounting/accounting.posting.js';
import { requireOrgWide, requireSettings } from '../accounting/accounting.routes.js';
import { recordAudit, type AuditAction } from '../audit/audit-event.model.js';
import { BranchModel } from '../branches/branch.model.js';
import { MAX_AMOUNT } from '../finance/finance.model.js';
import { SupplierBillModel, SupplierModel } from '../purchasing/purchasing.model.js';
import {
  BudgetModel,
  CommitmentModel,
  CommitmentPaymentModel,
  FREQUENCIES,
  FREQUENCY_MONTHS,
  type Budget,
  type Commitment,
  type CommitmentPayment,
} from './planning.model.js';

// Budgets, budget against actual, cash flow and recurring commitments
// (docs/architecture/PLANNING.md). Everything here reads the posted ledger; nothing posts.
// Ledger-wide views need organization-wide scope, like the statements.

const dateSchema = z.string().regex(DATE_PATTERN).refine(isValidDate, 'invalid_date');
const money = z.number().int().min(0).max(MAX_AMOUNT);
const yearSchema = z.coerce.number().int().min(2000).max(2100);
const id = (v: Types.ObjectId | null | undefined) => (v ? String(v) : null);
const audit = (
  tenant: TenantContext,
  action: AuditAction,
  type: 'budget' | 'commitment',
  targetId: Types.ObjectId,
  changes: Record<string, unknown>,
) => recordAudit({ organizationId: tenant.organizationId, actorUserId: tenant.userId, action, target: { type, id: targetId }, changes });

/** Same day of month `n` months later; short months use their last day. */
export function addMonths(date: string, n: number, dayOfMonth: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + n;
  const month = `${y + Math.floor(m / 12)}-${String((((m % 12) + 12) % 12) + 1).padStart(2, '0')}`;
  const last = monthEnd(month);
  return `${month}-${String(Math.min(dayOfMonth, Number(last.slice(8, 10)))).padStart(2, '0')}`;
}

async function branchOr404(tenant: TenantContext, raw: string | null | undefined) {
  if (!raw) return null;
  const branchId = new Types.ObjectId(raw);
  if (!(await BranchModel.exists({ organizationId: tenant.organizationId, _id: branchId }))) throw notFound();
  return branchId;
}

/** Net posted movement per account and month (1–12) of a year, optionally for one branch. */
async function actualsByMonth(organizationId: Types.ObjectId, year: number, branchId: Types.ObjectId | null) {
  const rows = await JournalEntryModel.aggregate<{ _id: { a: Types.ObjectId; m: string }; debit: number; credit: number }>([
    { $match: { organizationId, date: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } } },
    { $unwind: '$lines' },
    ...(branchId ? [{ $match: { 'lines.branchId': branchId } }] : []),
    {
      $group: {
        _id: { a: '$lines.accountId', m: { $substrBytes: ['$date', 5, 2] } },
        debit: { $sum: '$lines.debit' },
        credit: { $sum: '$lines.credit' },
      },
    },
  ]);
  const out = new Map<string, { debit: number[]; credit: number[] }>();
  for (const r of rows) {
    const key = String(r._id.a);
    const cur = out.get(key) ?? { debit: Array<number>(12).fill(0), credit: Array<number>(12).fill(0) };
    const i = Number(r._id.m) - 1;
    cur.debit[i] = r.debit;
    cur.credit[i] = r.credit;
    out.set(key, cur);
  }
  return out;
}

const plannable = (organizationId: Types.ObjectId) =>
  LedgerAccountModel.find({ organizationId, isGroup: false, type: { $in: ['income', 'expense'] } })
    .sort({ code: 1 })
    .lean<Lean<LedgerAccount>[]>();
const accountRef = (a: Lean<LedgerAccount>) => ({
  id: String(a._id),
  code: a.code,
  name: a.name,
  templateKey: a.templateKey,
  type: a.type,
  status: a.status,
});

const budgetDto = (b: Lean<Budget>) => ({
  id: String(b._id),
  year: b.year,
  branchId: id(b.branchId),
  status: b.status,
  lines: b.lines.map((l) => ({ accountId: String(l.accountId), months: l.months, total: l.months.reduce((s, v) => s + v, 0) })),
  approvedAt: b.approvedAt ? b.approvedAt.toISOString() : null,
  version: b.version,
});

const commitmentDto = (c: Lean<Commitment>, today: string, payments: Lean<CommitmentPayment>[] = []) => ({
  id: String(c._id),
  name: c.name,
  accountId: String(c.accountId),
  branchId: id(c.branchId),
  supplierId: id(c.supplierId),
  amount: c.amount,
  frequency: c.frequency,
  /** The amount per month, for comparing commitments of different frequencies. */
  monthlyEquivalent: Math.round(c.amount / FREQUENCY_MONTHS[c.frequency]),
  dayOfMonth: c.dayOfMonth,
  nextDue: c.nextDue,
  endDate: c.endDate,
  status: c.status,
  due: c.status === 'active' && c.nextDue ? (c.nextDue < today ? 'overdue' : c.nextDue <= addDays(today, 7) ? 'soon' : null) : null,
  payments: payments.map((p) => ({
    dueDate: p.dueDate,
    amount: p.amount,
    voucherId: id(p.voucherId),
    billId: id(p.billId),
    createdAt: p.createdAt.toISOString(),
  })),
  version: c.version,
});

async function commitmentOr404(tenant: TenantContext, raw: unknown) {
  const cid = parseObjectId(raw);
  if (!cid) throw notFound();
  const c = await CommitmentModel.findOne({ organizationId: tenant.organizationId, _id: cid }).lean<Lean<Commitment>>();
  if (!c) throw notFound();
  return c;
}

async function expenseAccount(tenant: TenantContext, raw: string) {
  const a = await LedgerAccountModel.findOne({
    organizationId: tenant.organizationId,
    _id: new Types.ObjectId(raw),
    type: 'expense',
    isGroup: false,
    status: 'active',
  }).lean();
  if (!a) throw validationError({ accountId: 'not_expense_account' });
  return a._id;
}

const budgetSaveSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  branchId: objectIdSchema.nullable().default(null),
  lines: z
    .array(z.object({ accountId: objectIdSchema, months: z.array(money).length(12) }))
    .max(300)
    .refine((l) => new Set(l.map((x) => x.accountId)).size === l.length, 'duplicate_account'),
  version: z.number().int().min(0).nullable(),
});
const budgetKeySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  branchId: objectIdSchema.nullable().default(null),
  version: z.number().int().min(0),
});

const commitmentCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  accountId: objectIdSchema,
  branchId: objectIdSchema.nullable().default(null),
  supplierId: objectIdSchema.nullable().default(null),
  amount: money.min(1),
  frequency: z.enum(FREQUENCIES),
  firstDue: dateSchema,
  endDate: dateSchema.nullable().default(null),
});
const commitmentUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  amount: money.min(1).optional(),
  nextDue: dateSchema.optional(),
  endDate: dateSchema.nullable().optional(),
  status: z.enum(['active', 'ended']).optional(),
  version: z.number().int().min(0),
});
const recordSchema = z
  .object({ voucherId: objectIdSchema.nullable().default(null), billId: objectIdSchema.nullable().default(null), version: z.number().int().min(0) })
  .refine((v) => Boolean(v.voucherId) !== Boolean(v.billId), { message: 'voucher_or_bill', path: ['voucherId'] });

export function createPlanningRouter() {
  const router = Router({ mergeParams: true });

  // ---- budgets ----------------------------------------------------------------------------
  router.get('/accounting/budgets', requirePermission('accounting.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const settings = await requireSettings(tenant);
    const input = parseInput(z.object({ year: yearSchema, branchId: objectIdSchema.optional() }), req.query);
    const branchId = await branchOr404(tenant, input.branchId);
    const [budget, accounts] = await Promise.all([
      BudgetModel.findOne({ organizationId: tenant.organizationId, year: input.year, branchId }).lean<Lean<Budget>>(),
      plannable(tenant.organizationId),
    ]);
    res.json({
      year: input.year,
      branchId: id(branchId),
      currency: settings.currency,
      budget: budget ? budgetDto(budget) : null,
      accounts: accounts.filter((a) => a.status === 'active' || budget?.lines.some((l) => l.accountId.equals(a._id))).map(accountRef),
    });
  });

  // Save a draft (create with version null). An approved budget is reopened by the owner first.
  router.put('/accounting/budgets', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    await requireSettings(tenant);
    const input = parseInput(budgetSaveSchema, req.body);
    const branchId = await branchOr404(tenant, input.branchId);
    const accountIds = input.lines.map((l) => new Types.ObjectId(l.accountId));
    const valid = await LedgerAccountModel.countDocuments({
      organizationId: tenant.organizationId,
      _id: { $in: accountIds },
      isGroup: false,
      type: { $in: ['income', 'expense'] },
    });
    if (valid !== accountIds.length) throw validationError({ lines: 'not_income_or_expense_account' });
    const lines = input.lines
      .filter((l) => l.months.some((v) => v > 0))
      .map((l) => ({ accountId: new Types.ObjectId(l.accountId), months: l.months }));
    let saved: Lean<Budget> | null;
    if (input.version === null) {
      try {
        const created = await BudgetModel.create({
          organizationId: tenant.organizationId,
          year: input.year,
          branchId,
          lines,
          createdBy: tenant.userId,
        });
        saved = created.toObject() as Lean<Budget>;
      } catch (err) {
        if (isDuplicateKeyError(err)) throw conflict('VERSION_CONFLICT', 'A budget for this year was saved meanwhile');
        throw err;
      }
    } else {
      const current = await BudgetModel.findOne({ organizationId: tenant.organizationId, year: input.year, branchId }).lean<Lean<Budget>>();
      if (!current) throw notFound();
      if (current.status === 'approved') throw conflict('BUDGET_APPROVED', 'An approved budget is reopened before it changes');
      saved = await BudgetModel.findOneAndUpdate(
        { organizationId: tenant.organizationId, _id: current._id, version: input.version, status: 'draft' },
        { $set: { lines }, $inc: { version: 1 } },
        { returnDocument: 'after' },
      ).lean<Lean<Budget>>();
      if (!saved) throw conflict('VERSION_CONFLICT', 'This budget was changed meanwhile');
    }
    await audit(tenant, 'budget.saved', 'budget', saved._id, { year: input.year, branchId: id(branchId), lines: lines.length });
    res.json({ budget: budgetDto(saved) });
  });

  // The owner approves a budget (it then stays as approved) or reopens it for changes.
  for (const [path, from, to, action] of [
    ['/accounting/budgets/approve', 'draft', 'approved', 'budget.approved'],
    ['/accounting/budgets/reopen', 'approved', 'draft', 'budget.reopened'],
  ] as const) {
    router.post(path, requirePermission('accounting.settings.manage'), async (req, res) => {
      const tenant = tenantOf(req);
      requireOrgWide(tenant);
      const input = parseInput(budgetKeySchema, req.body);
      const branchId = await branchOr404(tenant, input.branchId);
      const doc = await BudgetModel.findOneAndUpdate(
        { organizationId: tenant.organizationId, year: input.year, branchId, version: input.version, status: from },
        {
          $set:
            to === 'approved'
              ? { status: to, approvedBy: tenant.userId, approvedAt: new Date() }
              : { status: to, approvedBy: null, approvedAt: null },
          $inc: { version: 1 },
        },
        { returnDocument: 'after' },
      ).lean<Lean<Budget>>();
      if (!doc) {
        const exists = await BudgetModel.exists({ organizationId: tenant.organizationId, year: input.year, branchId });
        if (!exists) throw notFound();
        throw conflict('VERSION_CONFLICT', 'This budget was changed meanwhile');
      }
      await audit(tenant, action, 'budget', doc._id, { year: input.year, branchId: id(branchId) });
      res.json({ budget: budgetDto(doc) });
    });
  }

  // Budget against posted actuals, January through a month. Variance = actual − budget; for
  // income above budget is favourable, for expenses below budget is.
  router.get('/accounting/reports/budget-vs-actual', requirePermission('accounting.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const settings = await requireSettings(tenant);
    const input = parseInput(
      z.object({ year: yearSchema, through: z.coerce.number().int().min(1).max(12).optional(), branchId: objectIdSchema.optional() }),
      req.query,
    );
    const branchId = await branchOr404(tenant, input.branchId);
    const today = await ledgerToday(tenant.organizationId);
    const currentYear = Number(today.slice(0, 4));
    const through = input.through ?? (input.year === currentYear ? Number(today.slice(5, 7)) : 12);
    const [budget, accounts, actuals] = await Promise.all([
      BudgetModel.findOne({ organizationId: tenant.organizationId, year: input.year, branchId }).lean<Lean<Budget>>(),
      plannable(tenant.organizationId),
      actualsByMonth(tenant.organizationId, input.year, branchId),
    ]);
    const planned = new Map((budget?.lines ?? []).map((l) => [String(l.accountId), l.months]));
    const sum = (v: number[]) => v.slice(0, through).reduce((s, x) => s + x, 0);
    const rows = accounts
      .map((a) => {
        const months = planned.get(String(a._id));
        const act = actuals.get(String(a._id));
        const actual = act ? (a.type === 'income' ? sum(act.credit) - sum(act.debit) : sum(act.debit) - sum(act.credit)) : 0;
        const budgeted = months ? sum(months) : 0;
        const variance = actual - budgeted;
        return {
          account: accountRef(a),
          annualBudget: months ? months.reduce((s, x) => s + x, 0) : 0,
          budget: budgeted,
          actual,
          variance,
          usedPercent: budgeted > 0 ? Math.round((actual / budgeted) * 100) : null,
          favourable: a.type === 'income' ? variance >= 0 : variance <= 0,
          unbudgeted: !months && actual !== 0,
        };
      })
      .filter((r) => r.budget !== 0 || r.actual !== 0 || r.annualBudget !== 0);
    const total = (type: 'income' | 'expense', k: 'budget' | 'actual') => rows.filter((r) => r.account.type === type).reduce((s, r) => s + r[k], 0);
    res.json({
      year: input.year,
      through,
      branchId: id(branchId),
      currency: settings.currency,
      budget: budget ? { status: budget.status, version: budget.version } : null,
      rows,
      totals: {
        income: { budget: total('income', 'budget'), actual: total('income', 'actual') },
        expense: { budget: total('expense', 'budget'), actual: total('expense', 'actual') },
        result: {
          budget: total('income', 'budget') - total('expense', 'budget'),
          actual: total('income', 'actual') - total('expense', 'actual'),
        },
      },
    });
  });

  // ---- cash flow (direct method) ----------------------------------------------------------
  // Every posted movement of a cashbox or bank account, classified by the account on the other
  // side: fixed assets → investing; equity → financing; everything else → operating. Transfers
  // between the organization's own cash accounts cancel out.
  router.get('/accounting/reports/cash-flow', requirePermission('accounting.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const settings = await requireSettings(tenant);
    const { from, to } = parseInput(z.object({ from: dateSchema, to: dateSchema }), req.query);
    if (to < from) throw validationError({ to: 'before_from' });
    if (addDays(from, 400) < to) throw validationError({ to: 'range_too_long' });
    const [cashAccounts, ledger] = await Promise.all([
      CashAccountModel.find({ organizationId: tenant.organizationId }).lean(),
      LedgerAccountModel.find({ organizationId: tenant.organizationId }).lean<Lean<LedgerAccount>[]>(),
    ]);
    const cashIds = cashAccounts.map((c) => c.accountId);
    const cashSet = new Set(cashIds.map(String));
    const byId = new Map(ledger.map((a) => [String(a._id), a]));
    const fixedRoot = ledger.find((a) => a.templateKey === 'fixedAssets');
    const underFixed = (a: Lean<LedgerAccount>) => {
      for (let cur: Lean<LedgerAccount> | undefined = a; cur; cur = cur.parentId ? byId.get(String(cur.parentId)) : undefined)
        if (fixedRoot && cur._id.equals(fixedRoot._id)) return true;
      return false;
    };
    const activityOf = (a: Lean<LedgerAccount> | undefined) =>
      !a ? 'operating' : a.type === 'equity' ? 'financing' : a.type === 'asset' && underFixed(a) ? 'investing' : 'operating';

    const balanceBefore = async (date: string) => {
      const rows = await JournalEntryModel.aggregate<{ net: number }>([
        { $match: { organizationId: tenant.organizationId, date: { $lt: date }, 'lines.accountId': { $in: cashIds } } },
        { $unwind: '$lines' },
        { $match: { 'lines.accountId': { $in: cashIds } } },
        { $group: { _id: null, net: { $sum: { $subtract: ['$lines.debit', '$lines.credit'] } } } },
      ]);
      return rows[0]?.net ?? 0;
    };
    const [opening, entries] = await Promise.all([
      balanceBefore(from),
      JournalEntryModel.find({ organizationId: tenant.organizationId, date: { $gte: from, $lte: to }, 'lines.accountId': { $in: cashIds } })
        .select('lines')
        .lean(),
    ]);
    // For a balanced entry the non-cash lines' (credit − debit) add up to the cash movement, so
    // each counter line carries its own exact share.
    const flows = new Map<string, { inflow: number; outflow: number }>();
    for (const e of entries) {
      for (const l of e.lines) {
        if (cashSet.has(String(l.accountId))) continue;
        const amount = l.credit - l.debit;
        if (amount === 0) continue;
        const cur = flows.get(String(l.accountId)) ?? { inflow: 0, outflow: 0 };
        if (amount > 0) cur.inflow += amount;
        else cur.outflow -= amount;
        flows.set(String(l.accountId), cur);
      }
    }
    const sections = (['operating', 'investing', 'financing'] as const).map((activity) => {
      const rows = [...flows.entries()]
        .filter(([aid]) => activityOf(byId.get(aid)) === activity)
        .map(([aid, f]) => {
          const a = byId.get(aid)!;
          return { account: accountRef(a), inflow: f.inflow, outflow: f.outflow, net: f.inflow - f.outflow };
        })
        .sort((x, y) => x.account.code.localeCompare(y.account.code));
      return { activity, rows, net: rows.reduce((s, r) => s + r.net, 0) };
    });
    const net = sections.reduce((s, x) => s + x.net, 0);
    const closing = await balanceBefore(addDays(to, 1));
    res.json({ from, to, currency: settings.currency, opening, sections, net, closing, reconciled: opening + net === closing });
  });

  // ---- recurring commitments --------------------------------------------------------------
  router.get('/accounting/commitments', requirePermission('accounting.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const settings = await requireSettings(tenant);
    const today = await ledgerToday(tenant.organizationId);
    const rows = await CommitmentModel.find({ organizationId: tenant.organizationId })
      .sort({ status: 1, nextDue: 1, name: 1 })
      .limit(500)
      .lean<Lean<Commitment>[]>();
    const active = rows.filter((c) => c.status === 'active');
    res.json({
      today,
      currency: settings.currency,
      commitments: rows.map((c) => commitmentDto(c, today)),
      monthlyTotal: active.reduce((s, c) => s + Math.round(c.amount / FREQUENCY_MONTHS[c.frequency]), 0),
    });
  });

  router.get('/accounting/commitments/:commitmentId', requirePermission('accounting.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const c = await commitmentOr404(tenant, req.params.commitmentId);
    const payments = await CommitmentPaymentModel.find({ organizationId: tenant.organizationId, commitmentId: c._id })
      .sort({ dueDate: -1 })
      .limit(120)
      .lean<Lean<CommitmentPayment>[]>();
    res.json({ commitment: commitmentDto(c, await ledgerToday(tenant.organizationId), payments) });
  });

  router.post('/accounting/commitments', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    await requireSettings(tenant);
    const input = parseInput(commitmentCreateSchema, req.body);
    if (input.endDate && input.endDate < input.firstDue) throw validationError({ endDate: 'before_first_due' });
    const accountId = await expenseAccount(tenant, input.accountId);
    const branchId = await branchOr404(tenant, input.branchId);
    if (input.supplierId && !(await SupplierModel.exists({ organizationId: tenant.organizationId, _id: new Types.ObjectId(input.supplierId) })))
      throw validationError({ supplierId: 'not_found' });
    const c = await CommitmentModel.create({
      organizationId: tenant.organizationId,
      name: input.name,
      accountId,
      branchId,
      supplierId: input.supplierId ? new Types.ObjectId(input.supplierId) : null,
      amount: input.amount,
      frequency: input.frequency,
      dayOfMonth: Number(input.firstDue.slice(8, 10)),
      nextDue: input.firstDue,
      endDate: input.endDate,
      createdBy: tenant.userId,
    });
    await audit(tenant, 'commitment.created', 'commitment', c._id, { name: input.name, frequency: input.frequency, amount: input.amount });
    res.status(201).json({ commitment: commitmentDto(c.toObject() as Lean<Commitment>, await ledgerToday(tenant.organizationId)) });
  });

  router.patch('/accounting/commitments/:commitmentId', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const c = await commitmentOr404(tenant, req.params.commitmentId);
    const input = parseInput(commitmentUpdateSchema, req.body);
    const { version, ...rest } = input;
    const updated = await CommitmentModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, _id: c._id, version },
      {
        $set: {
          ...rest,
          ...(rest.nextDue ? { dayOfMonth: Number(rest.nextDue.slice(8, 10)) } : {}),
          ...(rest.status === 'ended' ? { nextDue: null } : {}),
          ...(rest.status === 'active' && !c.nextDue && !rest.nextDue ? { nextDue: await ledgerToday(tenant.organizationId) } : {}),
        },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    ).lean<Lean<Commitment>>();
    if (!updated) throw conflict('VERSION_CONFLICT', 'This commitment was changed meanwhile');
    await audit(tenant, 'commitment.updated', 'commitment', c._id, { fields: Object.keys(rest) });
    res.json({ commitment: commitmentDto(updated, await ledgerToday(tenant.organizationId)) });
  });

  // Mark the installment due as paid by the voucher or bill that already posted it. The voucher
  // must be a cash-out to the commitment's account (the bill a posted bill with a line on it),
  // and each voucher or bill pays one installment once.
  router.post('/accounting/commitments/:commitmentId/record', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const c = await commitmentOr404(tenant, req.params.commitmentId);
    const input = parseInput(recordSchema, req.body);
    if (c.status !== 'active' || !c.nextDue) throw conflict('COMMITMENT_ENDED', 'This commitment has ended');
    let amount = 0;
    if (input.voucherId) {
      const v = await CashVoucherModel.findOne({ organizationId: tenant.organizationId, _id: new Types.ObjectId(input.voucherId) }).lean();
      if (!v) throw validationError({ voucherId: 'not_found' });
      if (v.type !== 'out' || !v.counterAccountId?.equals(c.accountId)) throw validationError({ voucherId: 'other_account' });
      amount = v.amount;
    } else {
      const b = await SupplierBillModel.findOne({
        organizationId: tenant.organizationId,
        _id: new Types.ObjectId(input.billId!),
        status: 'posted',
      }).lean();
      if (!b) throw validationError({ billId: 'not_found' });
      const lines = b.lines.filter((l) => l.expenseAccountId?.equals(c.accountId));
      if (lines.length === 0) throw validationError({ billId: 'other_account' });
      amount = lines.reduce((s, l) => s + l.amount, 0);
    }
    const dueDate = c.nextDue;
    const next = addMonths(dueDate, FREQUENCY_MONTHS[c.frequency], c.dayOfMonth);
    const ended = Boolean(c.endDate && next > c.endDate);
    const updated = await runTransaction(async (session) => {
      try {
        await CommitmentPaymentModel.create(
          [
            {
              organizationId: tenant.organizationId,
              commitmentId: c._id,
              dueDate,
              voucherId: input.voucherId ? new Types.ObjectId(input.voucherId) : null,
              billId: input.billId ? new Types.ObjectId(input.billId) : null,
              amount,
              createdBy: tenant.userId,
            },
          ],
          { session },
        );
      } catch (err) {
        if (isDuplicateKeyError(err)) throw conflict('ALREADY_LINKED', 'This voucher or bill is already linked to a commitment');
        throw err;
      }
      const doc = await CommitmentModel.findOneAndUpdate(
        { organizationId: tenant.organizationId, _id: c._id, version: input.version, nextDue: dueDate },
        { $set: { nextDue: ended ? null : next, status: ended ? 'ended' : 'active' }, $inc: { version: 1 } },
        { session, returnDocument: 'after' },
      ).lean<Lean<Commitment>>();
      if (!doc) throw conflict('VERSION_CONFLICT', 'This commitment was changed meanwhile');
      return doc;
    });
    await audit(tenant, 'commitment.recorded', 'commitment', c._id, { dueDate, amount, differsFromPlan: amount !== c.amount });
    res.json({ commitment: commitmentDto(updated, await ledgerToday(tenant.organizationId)), recorded: { dueDate, amount } });
  });

  return router;
}
