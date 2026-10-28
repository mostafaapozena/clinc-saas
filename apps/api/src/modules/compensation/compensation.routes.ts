import { Router, type Request } from 'express';
import { Types, type ClientSession } from 'mongoose';
import { z } from 'zod';
import { runTransaction } from '../../db/transaction.js';
import { HttpError, conflict, forbidden, isDuplicateKeyError, notFound, validationError } from '../../http/errors.js';
import { objectIdSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { parseObjectId, requirePermission, tenantOf, type TenantContext } from '../../tenancy/tenant-context.js';
import { clock } from '../../time/clock.js';
import { DATE_PATTERN, addDays, isValidDate } from '../../time/local-time.js';
import { CashAccountModel, CashSessionModel } from '../accounting/accounting.model.js';
import {
  accountBalance,
  ledgerToday,
  mapped,
  organizationZone,
  postEntry,
  prepareLedger,
  settingsOf,
  type Lean,
  type LineInput,
} from '../accounting/accounting.posting.js';
import { recordAudit, type AuditAction } from '../audit/audit-event.model.js';
import { MAX_AMOUNT, ensureCounter, nextNumber } from '../finance/finance.model.js';
import { PractitionerModel } from '../practitioners/practitioner.model.js';
import { computeLines } from './compensation.compute.js';
import { AgreementModel, BASES, SettledItemModel, SettlementModel, type Agreement, type Settlement } from './compensation.model.js';

// Practitioner compensation (docs/architecture/COMPENSATION.md). Financial documents: they need
// organization-wide scope. A practitioner (doctor) sees their own approved settlements only.

const dateSchema = z.string().regex(DATE_PATTERN).refine(isValidDate, 'invalid_date');
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

function requireOrgWide(tenant: TenantContext) {
  if (tenant.branchScope.type !== 'all') throw forbidden('ORG_WIDE_SCOPE_REQUIRED', 'Practitioner settlements need access to all branches');
}
function requireKey(req: Request): string {
  const key = req.get('idempotency-key') ?? '';
  if (!IDEMPOTENCY_KEY.test(key)) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header');
  return key;
}
const audit = (tenant: TenantContext, action: AuditAction, id: Types.ObjectId, changes: Record<string, unknown>, session?: ClientSession) =>
  recordAudit({ organizationId: tenant.organizationId, actorUserId: tenant.userId, action, target: { type: 'settlement', id }, changes }, session);

const id = (v: Types.ObjectId | null | undefined) => (v ? String(v) : null);
const agreementDto = (a: Lean<Agreement>) => ({
  id: String(a._id),
  practitionerId: String(a.practitionerId),
  effectiveFrom: a.effectiveFrom,
  effectiveTo: a.effectiveTo,
  basis: a.basis,
  percentBp: a.percentBp,
  fixedPerUnit: a.fixedPerUnit,
  serviceIds: a.serviceIds.map(String),
  branchIds: a.branchIds.map(String),
  discountsReduceBase: a.discountsReduceBase,
  creditsReduceBase: a.creditsReduceBase,
  note: a.note,
  createdAt: a.createdAt.toISOString(),
});
const settlementDto = (s: Lean<Settlement>) => ({
  id: String(s._id),
  number: s.number,
  practitionerId: String(s.practitionerId),
  periodFrom: s.periodFrom,
  periodTo: s.periodTo,
  status: s.status,
  lines: s.lines.map((l) => ({ ...l, branchId: String(l.branchId), serviceId: id(l.serviceId), agreementId: String(l.agreementId) })),
  adjustments: s.adjustments.map((a) => ({ amount: a.amount, reason: a.reason, at: a.at.toISOString() })),
  computed: s.computed,
  total: s.total,
  paid: s.paid,
  remaining: s.status === 'approved' || s.status === 'paid' ? s.total - s.paid : 0,
  computedAt: s.computedAt.toISOString(),
  approvedAt: s.approval ? s.approval.at.toISOString() : null,
  payments: s.payments.map((p) => ({ amount: p.amount, cashAccountId: String(p.cashAccountId), entryId: String(p.entryId), at: p.at.toISOString() })),
  version: s.version,
  createdAt: s.createdAt.toISOString(),
});

const agreementSchema = z.object({
  practitionerId: objectIdSchema,
  effectiveFrom: dateSchema,
  basis: z.enum(BASES),
  percentBp: z.number().int().min(0).max(10_000).default(0),
  fixedPerUnit: z.number().int().min(0).max(MAX_AMOUNT).default(0),
  serviceIds: z.array(objectIdSchema).max(100).default([]),
  branchIds: z.array(objectIdSchema).max(50).default([]),
  discountsReduceBase: z.boolean().default(true),
  creditsReduceBase: z.boolean().default(true),
  note: z.string().trim().max(300).default(''),
});

async function practitionerOr404(tenant: TenantContext, practitionerId: string | Types.ObjectId) {
  const p = await PractitionerModel.findOne({
    organizationId: tenant.organizationId,
    _id: typeof practitionerId === 'string' ? new Types.ObjectId(practitionerId) : practitionerId,
  })
    .select('displayName userId')
    .lean();
  if (!p) throw notFound();
  return p;
}

export function createCompensationRouter() {
  const router = Router({ mergeParams: true });

  // Names of the organization's practitioners, for those who settle their fees (no schedules or patients).
  router.get('/compensation/practitioners', requirePermission('compensation.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const rows = await PractitionerModel.find({ organizationId: tenant.organizationId }).select('displayName status').sort({ displayName: 1 }).lean();
    res.json({ practitioners: rows.map((p) => ({ id: String(p._id), displayName: p.displayName, status: p.status })) });
  });

  // ---- agreements -----------------------------------------------------------------------------
  router.get('/compensation/agreements', requirePermission('compensation.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const { practitionerId } = parseInput(z.object({ practitionerId: objectIdSchema.optional() }), req.query);
    const rows = await AgreementModel.find({
      organizationId: tenant.organizationId,
      ...(practitionerId ? { practitionerId: new Types.ObjectId(practitionerId) } : {}),
    })
      .sort({ practitionerId: 1, effectiveFrom: -1 })
      .lean<Lean<Agreement>[]>();
    res.json({ agreements: rows.map(agreementDto) });
  });

  // A new agreement ends the open one the day before; it can never start inside a settled period.
  router.post('/compensation/agreements', requirePermission('compensation.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const input = parseInput(agreementSchema, req.body);
    if (input.percentBp === 0 && input.fixedPerUnit === 0) throw validationError({ percentBp: 'required' });
    if (input.basis === 'collected' && input.fixedPerUnit > 0) throw validationError({ fixedPerUnit: 'not_with_collected' });
    const practitioner = await practitionerOr404(tenant, input.practitionerId);
    const lastSettled = await SettlementModel.findOne({
      organizationId: tenant.organizationId,
      practitionerId: practitioner._id,
      status: { $in: ['approved', 'paid'] },
    })
      .sort({ periodTo: -1 })
      .lean();
    if (lastSettled && input.effectiveFrom <= lastSettled.periodTo)
      throw conflict('PERIOD_SETTLED', 'Settled periods cannot be re-priced', { settledThrough: lastSettled.periodTo });
    try {
      const created = await runTransaction(async (session) => {
        const later = await AgreementModel.exists({
          organizationId: tenant.organizationId,
          practitionerId: practitioner._id,
          effectiveFrom: { $gte: input.effectiveFrom },
        }).session(session);
        if (later) throw conflict('AGREEMENT_OVERLAP', 'Another agreement starts on or after this date');
        await AgreementModel.updateMany(
          {
            organizationId: tenant.organizationId,
            practitionerId: practitioner._id,
            $or: [{ effectiveTo: null }, { effectiveTo: { $gte: input.effectiveFrom } }],
          },
          { $set: { effectiveTo: addDays(input.effectiveFrom, -1) } },
          { session },
        );
        const [doc] = await AgreementModel.create(
          [
            {
              ...input,
              organizationId: tenant.organizationId,
              practitionerId: practitioner._id,
              serviceIds: input.serviceIds.map((s) => new Types.ObjectId(s)),
              branchIds: input.branchIds.map((b) => new Types.ObjectId(b)),
              createdBy: tenant.userId,
            },
          ],
          { session },
        );
        await audit(
          tenant,
          'compensation.agreement_created',
          doc!._id,
          { practitioner: practitioner.displayName, basis: input.basis, percentBp: input.percentBp, fixedPerUnit: input.fixedPerUnit },
          session,
        );
        return doc!.toObject() as Lean<Agreement>;
      });
      res.status(201).json({ agreement: agreementDto(created) });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw conflict('AGREEMENT_OVERLAP', 'Another agreement starts on this date');
      throw err;
    }
  });

  // ---- settlements ----------------------------------------------------------------------------
  router.get('/compensation/settlements', requirePermission('compensation.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const rows = await SettlementModel.find({ organizationId: tenant.organizationId }).sort({ createdAt: -1 }).limit(200).lean<Lean<Settlement>[]>();
    res.json({ settlements: rows.map(settlementDto) });
  });

  // A practitioner's own approved settlements (statement), no other practitioner's.
  router.get('/compensation/my-settlements', requirePermission('compensation.own.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const practitioner = await PractitionerModel.findOne({ organizationId: tenant.organizationId, membershipId: tenant.membershipId })
      .select('_id')
      .lean();
    if (!practitioner) return void res.json({ settlements: [] });
    const rows = await SettlementModel.find({
      organizationId: tenant.organizationId,
      practitionerId: practitioner._id,
      status: { $in: ['approved', 'paid'] },
    })
      .sort({ periodTo: -1 })
      .limit(50)
      .lean<Lean<Settlement>[]>();
    res.json({ settlements: rows.map(settlementDto) });
  });

  router.get('/compensation/settlements/:settlementId', requirePermission('compensation.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const sid = parseObjectId(req.params.settlementId);
    if (!sid) throw notFound();
    const s = await SettlementModel.findOne({ organizationId: tenant.organizationId, _id: sid }).lean<Lean<Settlement>>();
    if (!s) throw notFound();
    res.json({ settlement: settlementDto(s) });
  });

  const compute = async (tenant: TenantContext, practitionerId: Types.ObjectId, from: string, to: string) =>
    computeLines({ organizationId: tenant.organizationId, practitionerId, from, to, zone: await organizationZone(tenant.organizationId) });

  router.post('/compensation/settlements', requirePermission('compensation.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const input = parseInput(z.object({ practitionerId: objectIdSchema, from: dateSchema, to: dateSchema }), req.body);
    if (input.to < input.from || addDays(input.from, 92) < input.to) throw validationError({ to: 'range_too_long' });
    const today = await ledgerToday(tenant.organizationId);
    if (input.to >= today) throw validationError({ to: 'period_not_ended' });
    const practitioner = await practitionerOr404(tenant, input.practitionerId);
    const lines = await compute(tenant, practitioner._id, input.from, input.to);
    const computed = lines.reduce((s, l) => s + l.amount, 0);
    await ensureCounter(tenant.organizationId, `STL:${today.slice(0, 4)}`);
    const created = await runTransaction(async (session) => {
      const seq = await nextNumber(tenant.organizationId, `STL:${today.slice(0, 4)}`, session);
      const [doc] = await SettlementModel.create(
        [
          {
            organizationId: tenant.organizationId,
            number: `STL-${today.slice(0, 4)}-${String(seq).padStart(6, '0')}`,
            practitionerId: practitioner._id,
            periodFrom: input.from,
            periodTo: input.to,
            lines,
            computed,
            total: computed,
            computedAt: clock.now(),
            createdBy: tenant.userId,
          },
        ],
        { session },
      );
      await audit(
        tenant,
        'compensation.settlement_drafted',
        doc!._id,
        { practitioner: practitioner.displayName, lines: lines.length, computed },
        session,
      );
      return doc!.toObject() as Lean<Settlement>;
    });
    res.status(201).json({ settlement: settlementDto(created) });
  });

  const draftOr409 = async (tenant: TenantContext, req: Request) => {
    const sid = parseObjectId(req.params.settlementId);
    if (!sid) throw notFound();
    const s = await SettlementModel.findOne({ organizationId: tenant.organizationId, _id: sid }).lean<Lean<Settlement>>();
    if (!s) throw notFound();
    if (s.status !== 'draft') throw conflict('SETTLEMENT_NOT_DRAFT', 'Approved settlements are never recomputed or changed');
    return s;
  };

  router.post('/compensation/settlements/:settlementId/recompute', requirePermission('compensation.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const s = await draftOr409(tenant, req);
    const lines = await compute(tenant, s.practitionerId, s.periodFrom, s.periodTo);
    const computed = lines.reduce((sum, l) => sum + l.amount, 0);
    const updated = await SettlementModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, _id: s._id, status: 'draft', version: s.version },
      {
        $set: { lines, computed, total: computed + s.adjustments.reduce((sum, a) => sum + a.amount, 0), computedAt: clock.now() },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    ).lean<Lean<Settlement>>();
    if (!updated) throw conflict('VERSION_CONFLICT', 'This settlement was changed meanwhile');
    res.json({ settlement: settlementDto(updated) });
  });

  router.post('/compensation/settlements/:settlementId/adjustments', requirePermission('compensation.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const input = parseInput(
      z.object({
        amount: z
          .number()
          .int()
          .min(-MAX_AMOUNT)
          .max(MAX_AMOUNT)
          .refine((v) => v !== 0, 'zero'),
        reason: z.string().trim().min(3).max(300),
        version: z.number().int().min(0),
      }),
      req.body,
    );
    const s = await draftOr409(tenant, req);
    const updated = await SettlementModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, _id: s._id, status: 'draft', version: input.version },
      {
        $push: { adjustments: { amount: input.amount, reason: input.reason, by: tenant.userId, at: clock.now() } },
        $inc: { total: input.amount, version: 1 },
      },
      { returnDocument: 'after' },
    ).lean<Lean<Settlement>>();
    if (!updated) throw conflict('VERSION_CONFLICT', 'This settlement was changed meanwhile');
    await audit(tenant, 'compensation.settlement_adjusted', s._id, { amount: input.amount });
    res.json({ settlement: settlementDto(updated) });
  });

  router.post('/compensation/settlements/:settlementId/cancel', requirePermission('compensation.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const s = await draftOr409(tenant, req);
    const updated = await SettlementModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, _id: s._id, status: 'draft' },
      { $set: { status: 'cancelled' }, $inc: { version: 1 } },
      { returnDocument: 'after' },
    ).lean<Lean<Settlement>>();
    if (!updated) throw conflict('SETTLEMENT_NOT_DRAFT', 'This settlement is no longer a draft');
    res.json({ settlement: settlementDto(updated) });
  });

  // Approval freezes the settlement: its items are claimed (never settled twice) and the fees post.
  router.post('/compensation/settlements/:settlementId/approve', requirePermission('compensation.approve'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const { version } = parseInput(z.object({ version: z.number().int().min(0) }), req.body);
    const s = await draftOr409(tenant, req);
    const ledger = await settingsOf(tenant.organizationId);
    const today = await ledgerToday(tenant.organizationId);
    await prepareLedger(tenant.organizationId);
    try {
      const approved = await runTransaction(async (session) => {
        const updated = await SettlementModel.findOneAndUpdate(
          { organizationId: tenant.organizationId, _id: s._id, status: 'draft', version },
          {
            $set: { status: s.total === 0 ? 'paid' : 'approved', approval: { by: tenant.userId, at: clock.now(), entryId: null } },
            $inc: { version: 1 },
          },
          { session, returnDocument: 'after' },
        ).lean<Lean<Settlement>>();
        if (!updated) throw conflict('VERSION_CONFLICT', 'This settlement was changed meanwhile');
        if (updated.lines.length)
          await SettledItemModel.insertMany(
            updated.lines.map((l) => ({
              organizationId: tenant.organizationId,
              sourceKey: l.sourceKey,
              settlementId: updated._id,
              practitionerId: updated.practitionerId,
            })),
            { session },
          );
        if (ledger && today >= ledger.cutoverDate && updated.total !== 0) {
          // Fees by branch (cost centers); adjustments at organization level.
          const byBranch = new Map<string, number>();
          for (const l of updated.lines) byBranch.set(String(l.branchId), (byBranch.get(String(l.branchId)) ?? 0) + l.amount);
          const adjustments = updated.adjustments.reduce((sum, a) => sum + a.amount, 0);
          const expense: LineInput[] = [...byBranch.entries()].map(([b, amount]) => ({
            accountId: mapped(ledger, 'practitionerFees'),
            debit: Math.max(amount, 0),
            credit: Math.max(-amount, 0),
            branchId: new Types.ObjectId(b),
          }));
          if (adjustments)
            expense.push({ accountId: mapped(ledger, 'practitionerFees'), debit: Math.max(adjustments, 0), credit: Math.max(-adjustments, 0) });
          const partner = { type: 'practitioner' as const, id: updated.practitionerId };
          const entry = await postEntry(
            {
              organizationId: tenant.organizationId,
              userId: tenant.userId,
              date: today,
              journal: 'compensation',
              memo: updated.number,
              lines: [
                ...expense,
                { accountId: mapped(ledger, 'practitionerPayable'), debit: Math.max(-updated.total, 0), credit: Math.max(updated.total, 0), partner },
              ],
              source: { type: 'settlement', id: updated._id, event: 'approved' },
            },
            session,
            ledger,
          );
          await SettlementModel.updateOne(
            { organizationId: tenant.organizationId, _id: updated._id },
            { $set: { 'approval.entryId': entry._id } },
            { session },
          );
        }
        await audit(tenant, 'compensation.settlement_approved', updated._id, { number: updated.number, total: updated.total }, session);
        return updated;
      });
      res.json({ settlement: settlementDto(approved) });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw conflict('ITEMS_ALREADY_SETTLED', 'Some items were settled meanwhile; recompute this draft');
      throw err;
    }
  });

  router.post('/compensation/settlements/:settlementId/payments', requirePermission('compensation.pay'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const key = requireKey(req);
    const sid = parseObjectId(req.params.settlementId);
    if (!sid) throw notFound();
    const input = parseInput(z.object({ cashAccountId: objectIdSchema, amount: z.number().int().min(1).max(MAX_AMOUNT) }), req.body);
    // A retried payment (same key) is answered with the settlement as it is, never paid twice.
    const replayed = await SettlementModel.findOne({ organizationId: tenant.organizationId, _id: sid, 'payments.key': key }).lean<Lean<Settlement>>();
    if (replayed) return void res.json({ settlement: settlementDto(replayed), replayed: true });
    const ledger = await settingsOf(tenant.organizationId);
    if (!ledger) throw conflict('ACCOUNTING_NOT_SET_UP', 'Paying practitioners needs the ledger');
    const box = await CashAccountModel.findOne({
      organizationId: tenant.organizationId,
      _id: new Types.ObjectId(input.cashAccountId),
      status: 'active',
    }).lean();
    if (!box) throw validationError({ cashAccountId: 'not_available' });
    const today = await ledgerToday(tenant.organizationId);
    await prepareLedger(tenant.organizationId);
    const paid = await runTransaction(async (session) => {
      const s = await SettlementModel.findOneAndUpdate(
        { organizationId: tenant.organizationId, _id: sid, status: 'approved', $expr: { $lte: [{ $add: ['$paid', input.amount] }, '$total'] } },
        { $inc: { paid: input.amount, version: 1 } },
        { session, returnDocument: 'after' },
      ).lean<Lean<Settlement>>();
      if (!s) {
        if (await SettlementModel.exists({ organizationId: tenant.organizationId, _id: sid }).session(session))
          throw conflict('OVER_PAYMENT', 'More than the settlement still owes');
        throw notFound();
      }
      if (box.kind === 'cash' && (await accountBalance(tenant.organizationId, box.accountId, undefined, session)) < input.amount)
        throw conflict('INSUFFICIENT_CASH', 'The cashbox does not hold this amount');
      const open = await CashSessionModel.findOne({
        organizationId: tenant.organizationId,
        status: 'open',
        openedBy: tenant.userId,
        cashAccountId: box._id,
      })
        .session(session)
        .lean();
      const entry = await postEntry(
        {
          organizationId: tenant.organizationId,
          userId: tenant.userId,
          date: today,
          journal: box.kind === 'cash' ? 'cash' : 'bank',
          memo: s.number,
          lines: [
            { accountId: mapped(ledger, 'practitionerPayable'), debit: input.amount, partner: { type: 'practitioner', id: s.practitionerId } },
            { accountId: box.accountId, credit: input.amount, branchId: box.branchId },
          ],
          source: { type: 'settlement', id: s._id, event: `payment-${s.payments.length + 1}` },
          cashSessionId: open?._id ?? null,
        },
        session,
        ledger,
      );
      const done = await SettlementModel.findOneAndUpdate(
        { organizationId: tenant.organizationId, _id: sid },
        {
          $push: { payments: { amount: input.amount, cashAccountId: box._id, entryId: entry._id, by: tenant.userId, at: clock.now(), key } },
          $set: { status: s.paid === s.total ? 'paid' : 'approved' },
        },
        { session, returnDocument: 'after' },
      ).lean<Lean<Settlement>>();
      await audit(tenant, 'compensation.settlement_paid', sid, { number: s.number, amount: input.amount }, session);
      return done!;
    });
    res.status(201).json({ settlement: settlementDto(paid) });
  });

  return router;
}
