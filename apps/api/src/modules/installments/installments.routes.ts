import { createHash } from 'node:crypto';
import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { runTransaction } from '../../db/transaction.js';
import { HttpError, conflict, isDuplicateKeyError, notFound, validationError } from '../../http/errors.js';
import { objectIdSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { branchOwnedFilter } from '../../tenancy/scope.js';
import { parseObjectId, requirePermission, tenantOf, type TenantContext } from '../../tenancy/tenant-context.js';
import { clock } from '../../time/clock.js';
import { DATE_PATTERN, isValidDate } from '../../time/local-time.js';
import { ledgerToday, mapped, postEntry, prepareLedger, settingsOf, type Lean } from '../accounting/accounting.posting.js';
import { ensureTemplateAccount } from '../accounting/accounting.setup.js';
import { recordAudit, type AuditAction } from '../audit/audit-event.model.js';
import { AdjustmentModel, InvoiceModel, MAX_AMOUNT, ensureCounter, nextNumber, type Adjustment, type Invoice } from '../finance/finance.model.js';
import { InstallmentPlanModel, scheduleState, type InstallmentPlan, type ScheduleItem } from './installments.model.js';

// Installment plans, rescheduling and bad-debt write-offs on patient invoices
// (docs/architecture/INSTALLMENTS.md). Branch scope applies: plans live in the invoice's branch.

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;
const dateSchema = z.string().regex(DATE_PATTERN).refine(isValidDate, 'invalid_date');
const scheduleSchema = z
  .array(z.object({ dueDate: dateSchema, amount: z.number().int().min(1).max(MAX_AMOUNT) }))
  .min(1)
  .max(60);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
const year = () => clock.now().getUTCFullYear();
const open = (i: Pick<Invoice, 'total' | 'paid' | 'credited'>) => i.total - i.paid - i.credited;
const audit = (
  tenant: TenantContext,
  action: AuditAction,
  target: { type: 'installment_plan' | 'adjustment'; id: Types.ObjectId },
  changes: Record<string, unknown>,
) => recordAudit({ organizationId: tenant.organizationId, actorUserId: tenant.userId, action, target, changes });

/** Dates strictly increasing, none before today; amounts add up to `total`. */
function checkSchedule(schedule: ScheduleItem[], total: number, today: string) {
  if (schedule.some((s, i) => (i > 0 && s.dueDate <= schedule[i - 1]!.dueDate) || s.dueDate < today))
    throw validationError({ schedule: 'dates_not_increasing_from_today' });
  if (schedule.reduce((s, x) => s + x.amount, 0) !== total) throw validationError({ schedule: 'must_equal_open_balance' });
}

const planDto = (p: Lean<InstallmentPlan>, invoice: Pick<Invoice, 'total' | 'paid' | 'credited' | 'number'> | null, today: string) => {
  const settled = invoice ? Math.min(p.total, invoice.paid + invoice.credited - p.baseline) : 0;
  const items = scheduleState(p.schedule, settled, today);
  const completed = settled >= p.total;
  return {
    id: String(p._id),
    number: p.number,
    invoiceId: String(p.invoiceId),
    invoiceNumber: invoice?.number ?? null,
    patientId: String(p.patientId),
    branchId: String(p.branchId),
    total: p.total,
    settled,
    remaining: p.total - settled,
    status: p.status === 'cancelled' ? 'cancelled' : completed ? 'completed' : items.some((i) => i.state === 'overdue') ? 'overdue' : 'active',
    schedule: items,
    nextDue: items.find((i) => i.state !== 'paid') ?? null,
    revisions: p.revisions.map((r) => ({ at: r.at.toISOString(), reason: r.reason, schedule: r.schedule })),
    cancelReason: p.cancelReason,
    version: p.version,
    createdAt: p.createdAt.toISOString(),
  };
};

async function planOr404(tenant: TenantContext, raw: unknown) {
  const pid = parseObjectId(raw);
  if (!pid) throw notFound();
  const p = await InstallmentPlanModel.findOne(branchOwnedFilter(tenant, { _id: pid })).lean<Lean<InstallmentPlan>>();
  if (!p) throw notFound();
  return p;
}
const invoiceOf = (tenant: TenantContext, id: Types.ObjectId) =>
  InvoiceModel.findOne({ organizationId: tenant.organizationId, _id: id }).lean<Lean<Invoice>>();

export function createInstallmentsRouter() {
  const router = Router({ mergeParams: true });

  router.get('/finance/installment-plans', requirePermission('finance.account.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(
      z.object({
        status: z.enum(['active', 'overdue', 'completed', 'cancelled']).optional(),
        patientId: objectIdSchema.optional(),
        invoiceId: objectIdSchema.optional(),
      }),
      req.query,
    );
    const rows = await InstallmentPlanModel.find(
      branchOwnedFilter(tenant, {
        ...(input.status === 'cancelled' ? { status: 'cancelled' as const } : input.status ? { status: 'active' as const } : {}),
        ...(input.patientId ? { patientId: new Types.ObjectId(input.patientId) } : {}),
        ...(input.invoiceId ? { invoiceId: new Types.ObjectId(input.invoiceId) } : {}),
      }),
    )
      .sort({ createdAt: -1 })
      .limit(300)
      .lean<Lean<InstallmentPlan>[]>();
    const invoices = await InvoiceModel.find({ organizationId: tenant.organizationId, _id: { $in: rows.map((r) => r.invoiceId) } })
      .select('total paid credited number')
      .lean<Lean<Invoice>[]>();
    const byId = new Map(invoices.map((i) => [String(i._id), i]));
    const today = await ledgerToday(tenant.organizationId);
    const plans = rows.map((p) => planDto(p, byId.get(String(p.invoiceId)) ?? null, today)).filter((p) => !input.status || p.status === input.status);
    res.json({ today, plans });
  });

  router.get('/finance/installment-plans/:planId', requirePermission('finance.account.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const p = await planOr404(tenant, req.params.planId);
    res.json({ plan: planDto(p, await invoiceOf(tenant, p.invoiceId), await ledgerToday(tenant.organizationId)) });
  });

  router.post('/finance/installment-plans', requirePermission('finance.invoice.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(z.object({ invoiceId: objectIdSchema, schedule: scheduleSchema }), req.body);
    const invoice = await InvoiceModel.findOne(branchOwnedFilter(tenant, { _id: new Types.ObjectId(input.invoiceId) })).lean<Lean<Invoice>>();
    if (!invoice) throw notFound();
    if (invoice.status !== 'issued' || open(invoice) <= 0)
      throw conflict('INVOICE_NOT_OPEN', 'Only an issued invoice with an open balance is put on installments');
    const today = await ledgerToday(tenant.organizationId);
    checkSchedule(input.schedule, open(invoice), today);
    await ensureCounter(tenant.organizationId, `IP:${year()}`);
    try {
      const plan = await runTransaction(async (session) => {
        const seq = await nextNumber(tenant.organizationId, `IP:${year()}`, session);
        const [doc] = await InstallmentPlanModel.create(
          [
            {
              organizationId: tenant.organizationId,
              branchId: invoice.branchId,
              patientId: invoice.patientId,
              invoiceId: invoice._id,
              number: `IP-${year()}-${String(seq).padStart(6, '0')}`,
              baseline: invoice.paid + invoice.credited,
              total: open(invoice),
              schedule: input.schedule,
              createdBy: tenant.userId,
            },
          ],
          { session },
        );
        return doc!.toObject() as Lean<InstallmentPlan>;
      });
      await audit(
        tenant,
        'installment_plan.created',
        { type: 'installment_plan', id: plan._id },
        { invoice: invoice.number, installments: input.schedule.length, total: plan.total },
      );
      res.status(201).json({ plan: planDto(plan, invoice, today) });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw conflict('PLAN_EXISTS', 'This invoice already has an active installment plan');
      throw err;
    }
  });

  // A new schedule for what is still unsettled; the replaced one is kept in the revisions.
  router.post('/finance/installment-plans/:planId/reschedule', requirePermission('finance.invoice.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const p = await planOr404(tenant, req.params.planId);
    const input = parseInput(
      z.object({ schedule: scheduleSchema, reason: z.string().trim().min(3).max(300), version: z.number().int().min(0) }),
      req.body,
    );
    if (p.status !== 'active') throw conflict('PLAN_CANCELLED', 'This plan was cancelled');
    const invoice = await invoiceOf(tenant, p.invoiceId);
    const today = await ledgerToday(tenant.organizationId);
    const dto = planDto(p, invoice, today);
    if (dto.remaining <= 0) throw conflict('PLAN_COMPLETED', 'Nothing is left to schedule');
    checkSchedule(input.schedule, dto.remaining, today);
    // Settled installments stay as they were; the new schedule covers the rest.
    const paid = scheduleState(p.schedule, dto.settled, today)
      .filter((i) => i.covered > 0)
      .map((i) => ({ dueDate: i.dueDate, amount: i.covered }));
    if (paid.length && input.schedule[0]!.dueDate <= paid.at(-1)!.dueDate) throw validationError({ schedule: 'dates_not_increasing_from_today' });
    const updated = await InstallmentPlanModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, _id: p._id, version: input.version, status: 'active' },
      {
        $set: { schedule: [...paid, ...input.schedule] },
        $push: { revisions: { at: new Date(), by: tenant.userId, reason: input.reason, schedule: p.schedule } },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    ).lean<Lean<InstallmentPlan>>();
    if (!updated) throw conflict('VERSION_CONFLICT', 'This plan was changed meanwhile');
    await audit(
      tenant,
      'installment_plan.rescheduled',
      { type: 'installment_plan', id: p._id },
      { installments: input.schedule.length, remaining: dto.remaining },
    );
    res.json({ plan: planDto(updated, invoice, today) });
  });

  router.post('/finance/installment-plans/:planId/cancel', requirePermission('finance.invoice.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const p = await planOr404(tenant, req.params.planId);
    const input = parseInput(z.object({ reason: z.string().trim().min(3).max(300), version: z.number().int().min(0) }), req.body);
    const updated = await InstallmentPlanModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, _id: p._id, version: input.version, status: 'active' },
      { $set: { status: 'cancelled', cancelReason: input.reason }, $inc: { version: 1 } },
      { returnDocument: 'after' },
    ).lean<Lean<InstallmentPlan>>();
    if (!updated) throw conflict('VERSION_CONFLICT', 'This plan was changed meanwhile');
    await audit(tenant, 'installment_plan.cancelled', { type: 'installment_plan', id: p._id }, { reason: input.reason });
    res.json({ plan: planDto(updated, await invoiceOf(tenant, p.invoiceId), await ledgerToday(tenant.organizationId)) });
  });

  // Owner-only bad-debt write-off of (part of) an invoice's open balance:
  //   Dr bad debts (expense)   Cr patient receivables
  router.post('/finance/invoices/:invoiceId/write-offs', requirePermission('finance.writeoff'), async (req, res) => {
    const tenant = tenantOf(req);
    const key = req.get('idempotency-key') ?? '';
    if (!IDEMPOTENCY_KEY.test(key)) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header');
    const iid = parseObjectId(req.params.invoiceId);
    if (!iid) throw notFound();
    const input = parseInput(z.object({ amount: z.number().int().min(1).max(MAX_AMOUNT), reason: z.string().trim().min(3).max(300) }), req.body);
    const requestHash = hash([String(iid), input]);
    const replay = async () => {
      const previous = await AdjustmentModel.findOne({ organizationId: tenant.organizationId, createdBy: tenant.userId, idempotencyKey: key }).lean<
        Lean<Adjustment>
      >();
      if (previous && previous.requestHash !== requestHash)
        throw conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different request');
      return previous;
    };
    const writeOffDto = (a: Lean<Adjustment>) => ({
      id: String(a._id),
      number: a.number,
      invoiceId: String(a.invoiceId),
      amount: a.amount,
      reason: a.reason,
      createdAt: a.createdAt.toISOString(),
    });
    const previous = await replay();
    if (previous) {
      res.json({ writeOff: writeOffDto(previous), replayed: true });
      return;
    }
    await ensureCounter(tenant.organizationId, `WO:${year()}`);
    await prepareLedger(tenant.organizationId);
    const settings0 = await settingsOf(tenant.organizationId);
    const badDebts = settings0 ? await runTransaction((session) => ensureTemplateAccount(tenant.organizationId, 'badDebts', session)) : null;
    try {
      const created = await runTransaction(async (session) => {
        const invoice = await InvoiceModel.findOneAndUpdate(
          branchOwnedFilter(tenant, {
            _id: iid,
            status: 'issued' as const,
            $expr: { $lte: [{ $add: ['$paid', '$credited', input.amount] }, '$total'] },
          }),
          { $inc: { credited: input.amount } },
          { session, returnDocument: 'after' },
        ).lean<Lean<Invoice>>();
        if (!invoice) {
          if (await InvoiceModel.exists(branchOwnedFilter(tenant, { _id: iid })).session(session))
            throw conflict('OVER_CREDIT', 'A write-off cannot exceed the open balance of an issued invoice');
          throw notFound();
        }
        const seq = await nextNumber(tenant.organizationId, `WO:${year()}`, session);
        const [doc] = await AdjustmentModel.create(
          [
            {
              organizationId: tenant.organizationId,
              branchId: invoice.branchId,
              patientId: invoice.patientId,
              type: 'write_off',
              number: `WO-${year()}-${String(seq).padStart(6, '0')}`,
              invoiceId: invoice._id,
              paymentId: null,
              amount: input.amount,
              currency: invoice.currency,
              reason: input.reason,
              createdBy: tenant.userId,
              idempotencyKey: key,
              requestHash,
            },
          ],
          { session },
        );
        // Posted like a credit note when the ledger runs on this date (finance works without one).
        const settings = await settingsOf(tenant.organizationId, session);
        const date = await ledgerToday(tenant.organizationId, session);
        if (settings && badDebts && date >= settings.cutoverDate) {
          await postEntry(
            {
              organizationId: tenant.organizationId,
              userId: tenant.userId,
              date,
              journal: 'sales',
              memo: `${doc!.number} / ${invoice.number ?? ''}`,
              lines: [
                { accountId: badDebts._id, debit: input.amount, branchId: invoice.branchId },
                {
                  accountId: mapped(settings, 'receivable'),
                  credit: input.amount,
                  branchId: invoice.branchId,
                  partner: { type: 'patient', id: invoice.patientId },
                },
              ],
              source: { type: 'write_off', id: doc!._id, event: 'issued' },
            },
            session,
            settings,
          );
        }
        await recordAudit(
          {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            action: 'invoice.written_off',
            target: { type: 'adjustment', id: doc!._id },
            changes: { invoice: invoice.number, amount: input.amount, reason: input.reason },
          },
          session,
        );
        return doc!.toObject() as Lean<Adjustment>;
      });
      res.status(201).json({ writeOff: writeOffDto(created), replayed: false });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const again = await replay();
      if (!again) throw err;
      res.json({ writeOff: writeOffDto(again), replayed: true });
    }
  });

  return router;
}

/** Active plans with an installment past due (for "Today's focus"), within the caller's scope. */
export async function overdueInstallmentPlans(tenant: TenantContext, today: string, branchId?: Types.ObjectId) {
  const rows = await InstallmentPlanModel.find({ ...branchOwnedFilter(tenant, { status: 'active' as const }), ...(branchId ? { branchId } : {}) })
    .select('invoiceId schedule baseline total')
    .lean<Lean<InstallmentPlan>[]>();
  if (rows.length === 0) return 0;
  const invoices = await InvoiceModel.find({ organizationId: tenant.organizationId, _id: { $in: rows.map((r) => r.invoiceId) } })
    .select('paid credited')
    .lean<Lean<Invoice>[]>();
  const byId = new Map(invoices.map((i) => [String(i._id), i]));
  return rows.filter((p) => {
    const inv = byId.get(String(p.invoiceId));
    const settled = inv ? inv.paid + inv.credited - p.baseline : 0;
    return scheduleState(p.schedule, settled, today).some((i) => i.state === 'overdue');
  }).length;
}
