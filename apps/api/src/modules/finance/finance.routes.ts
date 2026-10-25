import { createHash } from 'node:crypto';
import { Router, type Request } from 'express';
import mongoose, { Types, type ClientSession } from 'mongoose';
import { z } from 'zod';
import { HttpError, conflict, forbidden, isDuplicateKeyError, notFound, validationError } from '../../http/errors.js';
import { objectIdSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { branchOwnedFilter, canAccessBranch } from '../../tenancy/scope.js';
import { parseObjectId, requirePermission, tenantCan, tenantOf, type TenantContext } from '../../tenancy/tenant-context.js';
import { clock } from '../../time/clock.js';
import { AppointmentModel } from '../appointments/appointment.model.js';
import { recordAudit, type AuditAction } from '../audit/audit-event.model.js';
import { BranchModel } from '../branches/branch.model.js';
import { resolveClinicalActor, treats } from '../clinical/clinical-access.js';
import { EncounterModel } from '../clinical/clinical.model.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { PatientModel } from '../patients/patient.model.js';
import {
  AdjustmentModel,
  CURRENCY_CODES,
  ChargeModel,
  FinanceServiceModel,
  InvoiceModel,
  MAX_AMOUNT,
  PAYMENT_METHODS,
  PaymentModel,
  ensureCounter,
  formatNumber,
  nextNumber,
  type Adjustment,
  type Charge,
  type Currency,
  type FinanceService,
  type Invoice,
  type Payment,
} from './finance.model.js';

// Clinic finances (docs/architecture/FINANCE.md). Every route: finance permission (never clinical),
// organization + branch scope, generic 404 for anything outside it. Money in integer minor units.
// Mutations that create documents take an Idempotency-Key; balance changes are conditional
// updates inside transactions, so concurrent requests can never over-allocate or over-credit.

type Lean<T> = T & { _id: Types.ObjectId };
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;
const amountSchema = z.number().int().min(0).max(MAX_AMOUNT);
const positiveAmount = z.number().int().min(1).max(MAX_AMOUNT);
const reasonSchema = z.string().trim().min(3).max(300);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');

function requireKey(req: Request): string {
  const key = req.get('idempotency-key') ?? '';
  if (!IDEMPOTENCY_KEY.test(key)) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header');
  return key;
}
const reused = () => conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different request');
const inTx = <T>(work: (session: ClientSession) => Promise<T>) => mongoose.connection.transaction(work);
const yearOf = (d: Date) => d.getUTCFullYear();

async function organizationCurrency(tenant: TenantContext, session?: ClientSession): Promise<Currency> {
  const org = await OrganizationModel.findById(tenant.organizationId)
    .select('currency')
    .session(session ?? null)
    .lean();
  const currency = (org as { currency?: Currency | null } | null)?.currency;
  if (!currency) throw conflict('CURRENCY_REQUIRED', 'An owner must choose the organization’s currency first');
  return currency;
}

/** A branch of this organization inside the caller's scope, or 404. */
async function accessibleBranch(tenant: TenantContext, branchId: string | Types.ObjectId, session?: ClientSession) {
  const id = typeof branchId === 'string' ? parseObjectId(branchId) : branchId;
  if (!id || !canAccessBranch(tenant, id)) throw notFound();
  const branch = await BranchModel.findOne({ organizationId: tenant.organizationId, _id: id })
    .session(session ?? null)
    .lean();
  if (!branch) throw notFound();
  return branch;
}

/** A patient registered at that branch (the same visibility the front desk has), or 404. */
async function patientAtBranch(
  tenant: TenantContext,
  patientId: string | Types.ObjectId,
  branchId: Types.ObjectId,
  session?: ClientSession,
) {
  const id = typeof patientId === 'string' ? parseObjectId(patientId) : patientId;
  if (!id) throw notFound();
  const patient = await PatientModel.findOne({ organizationId: tenant.organizationId, _id: id, 'registrations.branchId': branchId })
    .select('fullName patientNumber phone registrations')
    .session(session ?? null)
    .lean();
  if (!patient) throw notFound();
  return patient;
}

/** A patient visible to the caller in at least one of their branches. */
async function visiblePatient(tenant: TenantContext, patientId: string) {
  const id = parseObjectId(patientId);
  if (!id) throw notFound();
  const patient = await PatientModel.findOne({ organizationId: tenant.organizationId, _id: id })
    .select('fullName patientNumber phone registrations')
    .lean();
  if (!patient || !patient.registrations.some((r) => canAccessBranch(tenant, r.branchId))) throw notFound();
  return patient;
}

const priceAt = (service: Lean<FinanceService>, branchId: Types.ObjectId) =>
  service.branchPrices.find((p) => p.branchId.equals(branchId))?.price ?? service.price;

const audit = (
  tenant: TenantContext,
  action: AuditAction,
  target: { type: 'service' | 'charge' | 'invoice' | 'payment' | 'adjustment' | 'organization'; id: Types.ObjectId },
  changes: Record<string, unknown>,
  session?: ClientSession,
) => recordAudit({ organizationId: tenant.organizationId, actorUserId: tenant.userId, action, target, changes }, session);

// ---------------------------------------------------------------------------------------------
// DTOs

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const serviceDto = (s: Lean<FinanceService>, branchId?: Types.ObjectId) => ({
  id: String(s._id),
  code: s.code,
  name: s.name,
  specialtyCode: s.specialtyCode,
  status: s.status,
  price: s.price,
  branchPrices: s.branchPrices.map((p) => ({ branchId: String(p.branchId), price: p.price })),
  ...(branchId ? { effectivePrice: priceAt(s, branchId) } : {}),
  currency: s.currency,
  version: s.version,
});
const chargeDto = (c: Lean<Charge>) => ({
  id: String(c._id),
  branchId: String(c.branchId),
  patientId: String(c.patientId),
  appointmentId: c.appointmentId ? String(c.appointmentId) : null,
  serviceId: String(c.serviceId),
  description: c.description,
  quantity: c.quantity,
  unitPrice: c.unitPrice,
  amount: c.amount,
  currency: c.currency,
  status: c.status,
  invoiceId: c.invoiceId ? String(c.invoiceId) : null,
  source: { type: c.source.type, encounterId: c.source.encounterId ? String(c.source.encounterId) : null, itemId: c.source.itemId },
  voidReason: c.voidReason,
  createdAt: c.createdAt.toISOString(),
});
export const balanceOf = (i: Pick<Invoice, 'status' | 'total' | 'paid' | 'credited'>) =>
  i.status === 'issued' ? i.total - i.paid - i.credited : 0;
const invoiceDto = (i: Lean<Invoice>) => ({
  id: String(i._id),
  branchId: String(i.branchId),
  patientId: String(i.patientId),
  number: i.number,
  status: i.status,
  lines: i.lines.map((l) => ({
    chargeId: String(l.chargeId),
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    amount: l.amount,
  })),
  subtotal: i.subtotal,
  discount: i.discount ? { amount: i.discount.amount, reason: i.discount.reason } : null,
  total: i.total,
  paid: i.paid,
  credited: i.credited,
  balance: balanceOf(i),
  currency: i.currency,
  issuedAt: iso(i.issuedAt),
  version: i.version,
  createdAt: i.createdAt.toISOString(),
});
const paymentDto = (p: Lean<Payment>) => ({
  id: String(p._id),
  branchId: String(p.branchId),
  patientId: String(p.patientId),
  number: p.number,
  amount: p.amount,
  currency: p.currency,
  method: p.method,
  reference: p.reference,
  receivedAt: p.receivedAt.toISOString(),
  allocations: p.allocations.map((a) => ({ invoiceId: String(a.invoiceId), amount: a.amount, at: a.at.toISOString() })),
  allocated: p.allocated,
  refunded: p.refunded,
  unallocated: p.status === 'active' ? p.amount - p.allocated - p.refunded : 0,
  status: p.status,
  reversal: p.reversal ? { reason: p.reversal.reason, at: p.reversal.at.toISOString() } : null,
});
const adjustmentDto = (a: Lean<Adjustment>) => ({
  id: String(a._id),
  type: a.type,
  number: a.number,
  invoiceId: a.invoiceId ? String(a.invoiceId) : null,
  paymentId: a.paymentId ? String(a.paymentId) : null,
  amount: a.amount,
  currency: a.currency,
  reason: a.reason,
  createdAt: a.createdAt.toISOString(),
});

/** Allocates part of a receipt to an issued invoice — both bounds checked atomically. */
async function allocate(tenant: TenantContext, payment: Lean<Payment>, invoiceId: Types.ObjectId, amount: number, session: ClientSession) {
  const invoice = await InvoiceModel.findOneAndUpdate(
    {
      organizationId: tenant.organizationId,
      _id: invoiceId,
      status: 'issued',
      patientId: payment.patientId,
      currency: payment.currency,
      $expr: { $lte: [{ $add: ['$paid', '$credited', amount] }, '$total'] },
    },
    { $inc: { paid: amount } },
    { session, returnDocument: 'after' },
  ).lean<Lean<Invoice>>();
  if (!invoice || !canAccessBranch(tenant, invoice.branchId))
    throw conflict('OVER_ALLOCATION', 'This amount is more than the invoice still asks for');
  const updated = await PaymentModel.findOneAndUpdate(
    {
      organizationId: tenant.organizationId,
      _id: payment._id,
      status: 'active',
      $expr: { $lte: [{ $add: ['$allocated', '$refunded', amount] }, '$amount'] },
    },
    { $inc: { allocated: amount }, $push: { allocations: { invoiceId, amount, at: clock.now() } } },
    { session, returnDocument: 'after' },
  ).lean<Lean<Payment>>();
  if (!updated) throw conflict('OVER_ALLOCATION', 'This receipt has no unallocated amount left for this');
  return updated;
}

// ---------------------------------------------------------------------------------------------

const settingsSchema = z.object({ currency: z.enum(CURRENCY_CODES) });
const serviceCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,20}$/),
  name: z.string().trim().min(2).max(120),
  specialtyCode: z.string().trim().max(40).nullable().default(null),
  price: amountSchema,
  branchPrices: z
    .array(z.object({ branchId: objectIdSchema, price: amountSchema }))
    .max(50)
    .default([]),
});
const serviceUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  price: amountSchema.optional(),
  branchPrices: z
    .array(z.object({ branchId: objectIdSchema, price: amountSchema }))
    .max(50)
    .optional(),
  version: z.number().int().min(0),
});
const chargeSchema = z.object({
  patientId: objectIdSchema,
  branchId: objectIdSchema,
  serviceId: objectIdSchema,
  quantity: z.number().int().min(1).max(100).default(1),
  appointmentId: objectIdSchema.optional(),
});
const clinicalChargeSchema = z.object({
  encounterId: objectIdSchema,
  itemId: z.string().regex(/^[A-Za-z0-9_-]{6,40}$/),
  kind: z.enum(['procedure', 'plan_item']),
  serviceId: objectIdSchema,
  quantity: z.number().int().min(1).max(100).default(1),
  /** The doctor explicitly confirms turning this item into a charge. */
  confirm: z.literal(true),
});
const invoiceCreateSchema = z.object({
  patientId: objectIdSchema,
  branchId: objectIdSchema,
  chargeIds: z.array(objectIdSchema).min(1).max(100),
});
const discountSchema = z.object({ amount: amountSchema, reason: z.string().trim().max(300).default(''), version: z.number().int().min(0) });
const issueSchema = z.object({ version: z.number().int().min(0) });
const paymentSchema = z.object({
  patientId: objectIdSchema,
  branchId: objectIdSchema,
  amount: positiveAmount,
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(60).default(''),
  allocations: z
    .array(z.object({ invoiceId: objectIdSchema, amount: positiveAmount }))
    .max(20)
    .default([]),
});
const allocationSchema = z.object({ invoiceId: objectIdSchema, amount: positiveAmount });
const adjustmentSchema = z.object({ amount: positiveAmount, reason: reasonSchema });
const reportSchema = z.object({ from: z.iso.date(), to: z.iso.date(), branchId: objectIdSchema.optional() });

export function createFinanceRouter() {
  const router = Router({ mergeParams: true });

  // ---- settings ---------------------------------------------------------------------------
  router.get('/finance/settings', async (req, res) => {
    const tenant = tenantOf(req);
    const any = ['finance.catalog.read', 'finance.account.read', 'finance.report.read', 'finance.settings.manage'] as const;
    if (!any.some((p) => tenantCan(tenant, p))) throw forbidden();
    const org = await OrganizationModel.findById(tenant.organizationId).select('currency').lean();
    const locked = Boolean(await InvoiceModel.exists({ organizationId: tenant.organizationId, status: 'issued' }));
    res.json({
      currency: (org as { currency?: string | null } | null)?.currency ?? null,
      currencyLocked: locked,
      supportedCurrencies: CURRENCY_CODES,
    });
  });

  router.put('/finance/settings', requirePermission('finance.settings.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(settingsSchema, req.body);
    const org = await OrganizationModel.findById(tenant.organizationId).select('currency').lean();
    const before = (org as { currency?: string | null } | null)?.currency ?? null;
    if (before && before !== input.currency) {
      // Changing the currency of existing prices or documents would misstate them.
      const used =
        (await FinanceServiceModel.exists({ organizationId: tenant.organizationId })) ||
        (await ChargeModel.exists({ organizationId: tenant.organizationId }));
      if (used) throw conflict('CURRENCY_LOCKED', 'The currency cannot change once prices or charges exist');
    }
    await OrganizationModel.updateOne({ _id: tenant.organizationId }, { $set: { currency: input.currency } });
    if (before !== input.currency)
      await audit(
        tenant,
        'finance.settings_updated',
        { type: 'organization', id: tenant.organizationId },
        { currency: { from: before, to: input.currency } },
      );
    res.json({ currency: input.currency });
  });

  // ---- service catalog --------------------------------------------------------------------
  router.get('/finance/services', requirePermission('finance.catalog.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const branchId = typeof req.query.branchId === 'string' ? (await accessibleBranch(tenant, req.query.branchId))._id : undefined;
    const filter: Record<string, unknown> = { organizationId: tenant.organizationId };
    if (req.query.status === 'active' || req.query.status === 'inactive') filter.status = req.query.status;
    const services = await FinanceServiceModel.find(filter).sort({ code: 1 }).limit(500).lean<Lean<FinanceService>[]>();
    res.json({ data: services.map((s) => serviceDto(s, branchId)) });
  });

  router.post('/finance/services', requirePermission('finance.catalog.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(serviceCreateSchema, req.body);
    const currency = await organizationCurrency(tenant);
    for (const p of input.branchPrices) await accessibleBranch(tenant, p.branchId);
    try {
      const service = await FinanceServiceModel.create({
        organizationId: tenant.organizationId,
        ...input,
        branchPrices: input.branchPrices.map((p) => ({ branchId: new Types.ObjectId(p.branchId), price: p.price })),
        currency,
        createdBy: tenant.userId,
        updatedBy: tenant.userId,
      });
      await audit(tenant, 'service.created', { type: 'service', id: service._id }, { code: input.code, price: input.price, currency });
      res.status(201).json({ service: serviceDto(service.toObject() as Lean<FinanceService>) });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw conflict('SERVICE_CODE_TAKEN', 'Another service already uses this code');
      throw err;
    }
  });

  router.patch('/finance/services/:serviceId', requirePermission('finance.catalog.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const id = parseObjectId(req.params.serviceId);
    if (!id) throw notFound();
    const input = parseInput(serviceUpdateSchema, req.body);
    for (const p of input.branchPrices ?? []) await accessibleBranch(tenant, p.branchId);
    const { version, ...changes } = input;
    const updated = await FinanceServiceModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, _id: id, version },
      {
        $set: {
          ...changes,
          ...(changes.branchPrices
            ? { branchPrices: changes.branchPrices.map((p) => ({ branchId: new Types.ObjectId(p.branchId), price: p.price })) }
            : {}),
          updatedBy: tenant.userId,
        },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    ).lean<Lean<FinanceService>>();
    if (!updated) {
      if (await FinanceServiceModel.exists({ organizationId: tenant.organizationId, _id: id }))
        throw conflict('VERSION_CONFLICT', 'This service was changed meanwhile');
      throw notFound();
    }
    // Prices already charged or invoiced keep their own snapshot; only new charges see the change.
    await audit(tenant, 'service.updated', { type: 'service', id }, { fields: Object.keys(changes) });
    res.json({ service: serviceDto(updated) });
  });

  // ---- charges ----------------------------------------------------------------------------
  router.post('/finance/charges', requirePermission('finance.charge.create'), async (req, res) => {
    const tenant = tenantOf(req);
    const key = requireKey(req);
    const input = parseInput(chargeSchema, req.body);
    const requestHash = hash(input);
    const previous = await ChargeModel.findOne({
      organizationId: tenant.organizationId,
      createdBy: tenant.userId,
      idempotencyKey: key,
    }).lean<Lean<Charge>>();
    if (previous) {
      if (previous.requestHash !== requestHash) throw reused();
      res.json({ charge: chargeDto(previous), replayed: true });
      return;
    }
    const branch = await accessibleBranch(tenant, input.branchId);
    const patient = await patientAtBranch(tenant, input.patientId, branch._id);
    const currency = await organizationCurrency(tenant);
    const service = await FinanceServiceModel.findOne({
      organizationId: tenant.organizationId,
      _id: input.serviceId,
      status: 'active',
    }).lean<Lean<FinanceService>>();
    if (!service) throw validationError({ serviceId: 'invalid_choice' });
    let appointmentId: Types.ObjectId | null = null;
    if (input.appointmentId) {
      const appointment = await AppointmentModel.findOne({
        organizationId: tenant.organizationId,
        _id: input.appointmentId,
        patientId: patient._id,
        branchId: branch._id,
      }).lean();
      if (!appointment) throw validationError({ appointmentId: 'invalid_choice' });
      appointmentId = appointment._id;
    }
    const unitPrice = priceAt(service, branch._id);
    try {
      const charge = await ChargeModel.create({
        organizationId: tenant.organizationId,
        branchId: branch._id,
        patientId: patient._id,
        appointmentId,
        serviceId: service._id,
        description: service.name,
        quantity: input.quantity,
        unitPrice,
        amount: unitPrice * input.quantity,
        currency,
        source: { type: 'manual', encounterId: null, itemId: null },
        createdBy: tenant.userId,
        idempotencyKey: key,
        requestHash,
      });
      await audit(tenant, 'charge.created', { type: 'charge', id: charge._id }, { source: 'manual', amount: charge.amount, currency });
      res.status(201).json({ charge: chargeDto(charge.toObject() as Lean<Charge>), replayed: false });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const again = await ChargeModel.findOne({
        organizationId: tenant.organizationId,
        createdBy: tenant.userId,
        idempotencyKey: key,
      }).lean<Lean<Charge>>();
      if (!again || again.requestHash !== requestHash) throw reused();
      res.json({ charge: chargeDto(again), replayed: true });
    }
  });

  // A doctor turns a procedure (or a treatment-plan item) of their OWN record into a charge, with
  // explicit confirmation. The charge carries the catalog service name — never clinical text.
  router.post('/finance/charges/clinical', requirePermission('finance.charge.clinical'), async (req, res) => {
    const tenant = tenantOf(req);
    const key = requireKey(req);
    const input = parseInput(clinicalChargeSchema, req.body);
    const requestHash = hash(input);
    const actor = await resolveClinicalActor(tenant);
    if (!actor) throw notFound();
    const encounter = await EncounterModel.findOne({ organizationId: tenant.organizationId, _id: input.encounterId }).lean();
    if (!encounter || !treats(actor, encounter)) throw notFound();
    const data = (encounter.specialty?.data ?? {}) as { procedures?: { id: string }[]; planItems?: { id: string }[] };
    const items = input.kind === 'procedure' ? data.procedures : data.planItems;
    // Plan items are billable once recorded in a finalized visit; procedures from any of the doctor's own records.
    if (!items?.some((i) => i.id === input.itemId) || (input.kind === 'plan_item' && encounter.status !== 'finalized')) {
      throw validationError({ itemId: 'invalid_reference' });
    }
    const currency = await organizationCurrency(tenant);
    const service = await FinanceServiceModel.findOne({
      organizationId: tenant.organizationId,
      _id: input.serviceId,
      status: 'active',
    }).lean<Lean<FinanceService>>();
    if (!service) throw validationError({ serviceId: 'invalid_choice' });
    const unitPrice = priceAt(service, encounter.branchId);
    try {
      const charge = await ChargeModel.create({
        organizationId: tenant.organizationId,
        branchId: encounter.branchId,
        patientId: encounter.patientId,
        appointmentId: encounter.appointmentId,
        serviceId: service._id,
        description: service.name,
        quantity: input.quantity,
        unitPrice,
        amount: unitPrice * input.quantity,
        currency,
        source: { type: input.kind === 'procedure' ? 'clinical_procedure' : 'plan_item', encounterId: encounter._id, itemId: input.itemId },
        createdBy: tenant.userId,
        idempotencyKey: key,
        requestHash,
      });
      await audit(
        tenant,
        'charge.created',
        { type: 'charge', id: charge._id },
        { source: charge.source.type, amount: charge.amount, currency },
      );
      res.status(201).json({ charge: chargeDto(charge.toObject() as Lean<Charge>), replayed: false });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const again = await ChargeModel.findOne({
        organizationId: tenant.organizationId,
        createdBy: tenant.userId,
        idempotencyKey: key,
      }).lean<Lean<Charge>>();
      if (again && again.requestHash === requestHash) {
        res.json({ charge: chargeDto(again), replayed: true });
        return;
      }
      if (again) throw reused();
      throw conflict('CHARGE_EXISTS', 'This item was already charged');
    }
  });

  // Which items of the doctor's own record are already charged (status only, no amounts needed).
  router.get('/finance/clinical-charges', requirePermission('finance.charge.clinical'), async (req, res) => {
    const tenant = tenantOf(req);
    const encounterId = parseObjectId(req.query.encounterId);
    const actor = await resolveClinicalActor(tenant);
    const encounter = encounterId ? await EncounterModel.findOne({ organizationId: tenant.organizationId, _id: encounterId }).lean() : null;
    if (!actor || !encounter || !treats(actor, encounter)) throw notFound();
    const charges = await ChargeModel.find({ organizationId: tenant.organizationId, 'source.encounterId': encounter._id }).lean<
      Lean<Charge>[]
    >();
    res.json({
      data: charges.map((c) => ({
        itemId: c.source.itemId,
        kind: c.source.type,
        status: c.status,
        chargeId: String(c._id),
        description: c.description,
      })),
    });
  });

  router.post('/finance/charges/:chargeId/void', requirePermission('finance.charge.create'), async (req, res) => {
    const tenant = tenantOf(req);
    const id = parseObjectId(req.params.chargeId);
    if (!id) throw notFound();
    const { reason } = parseInput(z.object({ reason: reasonSchema }), req.body);
    const charge = await ChargeModel.findOneAndUpdate(
      branchOwnedFilter(tenant, { _id: id, status: 'pending' as const }),
      { $set: { status: 'voided', voidReason: reason } },
      { returnDocument: 'after' },
    ).lean<Lean<Charge>>();
    if (!charge) {
      if (await ChargeModel.exists(branchOwnedFilter(tenant, { _id: id })))
        throw conflict('CHARGE_NOT_PENDING', 'Only charges not yet invoiced can be voided');
      throw notFound();
    }
    await audit(tenant, 'charge.voided', { type: 'charge', id }, { amount: charge.amount });
    res.json({ charge: chargeDto(charge) });
  });

  // ---- invoices ---------------------------------------------------------------------------
  router.post('/finance/invoices', requirePermission('finance.invoice.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(invoiceCreateSchema, req.body);
    const branch = await accessibleBranch(tenant, input.branchId);
    const patient = await patientAtBranch(tenant, input.patientId, branch._id);
    const ids = [...new Set(input.chargeIds)].map((c) => new Types.ObjectId(c));
    const invoice = await inTx(async (session) => {
      const charges = await ChargeModel.find({
        organizationId: tenant.organizationId,
        _id: { $in: ids },
        status: 'pending',
        patientId: patient._id,
        branchId: branch._id,
      })
        .session(session)
        .lean<Lean<Charge>[]>();
      if (charges.length !== ids.length) throw conflict('CHARGES_UNAVAILABLE', 'Some charges are not pending for this patient and branch');
      const currencies = new Set(charges.map((c) => c.currency));
      if (currencies.size !== 1) throw conflict('MIXED_CURRENCIES', 'Charges in different currencies cannot share an invoice');
      const subtotal = charges.reduce((sum, c) => sum + c.amount, 0);
      if (!Number.isSafeInteger(subtotal) || subtotal > MAX_AMOUNT) throw validationError({ chargeIds: 'out_of_range' });
      const [created] = await InvoiceModel.create(
        [
          {
            organizationId: tenant.organizationId,
            branchId: branch._id,
            patientId: patient._id,
            status: 'draft',
            lines: charges.map((c) => ({
              chargeId: c._id,
              description: c.description,
              quantity: c.quantity,
              unitPrice: c.unitPrice,
              amount: c.amount,
            })),
            subtotal,
            total: subtotal,
            currency: charges[0]!.currency,
            createdBy: tenant.userId,
          },
        ],
        { session },
      );
      if (!created) throw new Error('Expected a created invoice');
      // Claim the charges; a concurrent invoice claiming any of them makes this one fail.
      const claimed = await ChargeModel.updateMany(
        { organizationId: tenant.organizationId, _id: { $in: ids }, status: 'pending' },
        { $set: { status: 'invoiced', invoiceId: created._id } },
        { session },
      );
      if (claimed.modifiedCount !== ids.length) throw conflict('CHARGES_UNAVAILABLE', 'Some charges were invoiced meanwhile');
      await audit(
        tenant,
        'invoice.created',
        { type: 'invoice', id: created._id },
        { lines: ids.length, subtotal, currency: created.currency },
        session,
      );
      return created.toObject() as Lean<Invoice>;
    });
    res.status(201).json({ invoice: invoiceDto(invoice) });
  });

  router.get('/finance/invoices/:invoiceId', requirePermission('finance.account.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const id = parseObjectId(req.params.invoiceId);
    if (!id) throw notFound();
    const invoice = await InvoiceModel.findOne(branchOwnedFilter(tenant, { _id: id })).lean<Lean<Invoice>>();
    if (!invoice) throw notFound();
    const [patient, branch, org, payments, adjustments] = await Promise.all([
      PatientModel.findOne({ organizationId: tenant.organizationId, _id: invoice.patientId }).select('fullName patientNumber').lean(),
      BranchModel.findOne({ organizationId: tenant.organizationId, _id: invoice.branchId }).select('name city').lean(),
      OrganizationModel.findById(tenant.organizationId).select('name').lean(),
      PaymentModel.find({ organizationId: tenant.organizationId, 'allocations.invoiceId': invoice._id }).lean<Lean<Payment>[]>(),
      AdjustmentModel.find({ organizationId: tenant.organizationId, invoiceId: invoice._id })
        .sort({ createdAt: 1 })
        .lean<Lean<Adjustment>[]>(),
    ]);
    res.json({
      invoice: invoiceDto(invoice),
      patient: patient ? { id: String(patient._id), fullName: patient.fullName, patientNumber: patient.patientNumber } : null,
      branch: branch ? { id: String(branch._id), name: branch.name, city: branch.city } : null,
      organization: { name: org?.name ?? '' },
      payments: payments.map((p) => ({
        ...paymentDto(p),
        allocatedHere: p.allocations.filter((a) => a.invoiceId.equals(invoice._id)).reduce((s, a) => s + a.amount, 0),
      })),
      creditNotes: adjustments.map(adjustmentDto),
    });
  });

  router.put('/finance/invoices/:invoiceId/discount', requirePermission('finance.discount.apply'), async (req, res) => {
    const tenant = tenantOf(req);
    const id = parseObjectId(req.params.invoiceId);
    if (!id) throw notFound();
    const input = parseInput(discountSchema, req.body);
    if (input.amount > 0 && input.reason.length < 3) throw validationError({ reason: 'too_short' });
    const current = await InvoiceModel.findOne(branchOwnedFilter(tenant, { _id: id })).lean<Lean<Invoice>>();
    if (!current) throw notFound();
    if (current.status !== 'draft') throw conflict('INVOICE_NOT_DRAFT', 'Only draft invoices can be changed');
    if (input.amount > current.subtotal) throw validationError({ amount: 'out_of_range' });
    const updated = await InvoiceModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, _id: id, status: 'draft', version: input.version },
      {
        $set: {
          discount: input.amount > 0 ? { amount: input.amount, reason: input.reason, appliedBy: tenant.userId } : null,
          total: current.subtotal - input.amount,
        },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    ).lean<Lean<Invoice>>();
    if (!updated) throw conflict('VERSION_CONFLICT', 'This invoice was changed meanwhile');
    await audit(tenant, 'invoice.discount_applied', { type: 'invoice', id }, { amount: input.amount, currency: updated.currency });
    res.json({ invoice: invoiceDto(updated) });
  });

  router.post('/finance/invoices/:invoiceId/issue', requirePermission('finance.invoice.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const key = requireKey(req);
    const id = parseObjectId(req.params.invoiceId);
    if (!id) throw notFound();
    const input = parseInput(issueSchema, req.body);
    const now = clock.now();
    await ensureCounter(tenant.organizationId, `INV:${yearOf(now)}`);
    const issued = await inTx(async (session) => {
      const current = await InvoiceModel.findOne(branchOwnedFilter(tenant, { _id: id }))
        .session(session)
        .lean<Lean<Invoice>>();
      if (!current) throw notFound();
      if (current.status === 'issued') {
        if (current.issueKey === key) return current;
        throw conflict('INVOICE_NOT_DRAFT', 'This invoice is already issued');
      }
      if (current.status !== 'draft') throw conflict('INVOICE_NOT_DRAFT', 'Only draft invoices can be issued');
      if (current.version !== input.version) throw conflict('VERSION_CONFLICT', 'This invoice was changed meanwhile');
      const seq = await nextNumber(tenant.organizationId, `INV:${yearOf(now)}`, session);
      const updated = await InvoiceModel.findOneAndUpdate(
        { organizationId: tenant.organizationId, _id: id, status: 'draft', version: input.version },
        {
          $set: { status: 'issued', number: formatNumber('INV', yearOf(now), seq), issuedAt: now, issuedBy: tenant.userId, issueKey: key },
          $inc: { version: 1 },
        },
        { session, returnDocument: 'after' },
      ).lean<Lean<Invoice>>();
      if (!updated) throw conflict('VERSION_CONFLICT', 'This invoice was changed meanwhile');
      await audit(
        tenant,
        'invoice.issued',
        { type: 'invoice', id },
        { number: updated.number, total: updated.total, currency: updated.currency },
        session,
      );
      return updated;
    });
    res.json({ invoice: invoiceDto(issued) });
  });

  router.post('/finance/invoices/:invoiceId/discard', requirePermission('finance.invoice.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const id = parseObjectId(req.params.invoiceId);
    if (!id) throw notFound();
    const discarded = await inTx(async (session) => {
      const updated = await InvoiceModel.findOneAndUpdate(
        branchOwnedFilter(tenant, { _id: id, status: 'draft' as const }),
        { $set: { status: 'discarded' }, $inc: { version: 1 } },
        { session, returnDocument: 'after' },
      ).lean<Lean<Invoice>>();
      if (!updated) {
        if (await InvoiceModel.exists(branchOwnedFilter(tenant, { _id: id })).session(session))
          throw conflict('INVOICE_NOT_DRAFT', 'Only draft invoices can be discarded');
        throw notFound();
      }
      // The charges go back to "pending" so they can be invoiced again.
      await ChargeModel.updateMany(
        { organizationId: tenant.organizationId, invoiceId: id, status: 'invoiced' },
        { $set: { status: 'pending', invoiceId: null } },
        { session },
      );
      await audit(tenant, 'invoice.discarded', { type: 'invoice', id }, {}, session);
      return updated;
    });
    res.json({ invoice: invoiceDto(discarded) });
  });

  // Credit note: reduces what an issued invoice asks for; never more than its open balance.
  router.post('/finance/invoices/:invoiceId/credit-notes', requirePermission('finance.adjustment.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const key = requireKey(req);
    const id = parseObjectId(req.params.invoiceId);
    if (!id) throw notFound();
    const input = parseInput(adjustmentSchema, req.body);
    const requestHash = hash([String(id), input]);
    const previous = await AdjustmentModel.findOne({
      organizationId: tenant.organizationId,
      createdBy: tenant.userId,
      idempotencyKey: key,
    }).lean<Lean<Adjustment>>();
    if (previous) {
      if (previous.requestHash !== requestHash) throw reused();
      res.json({ creditNote: adjustmentDto(previous), replayed: true });
      return;
    }
    const now = clock.now();
    await ensureCounter(tenant.organizationId, `CN:${yearOf(now)}`);
    try {
      const note = await inTx(async (session) => {
        const invoice = await InvoiceModel.findOneAndUpdate(
          branchOwnedFilter(tenant, {
            _id: id,
            status: 'issued' as const,
            $expr: { $lte: [{ $add: ['$paid', '$credited', input.amount] }, '$total'] },
          }),
          { $inc: { credited: input.amount } },
          { session, returnDocument: 'after' },
        ).lean<Lean<Invoice>>();
        if (!invoice) {
          if (await InvoiceModel.exists(branchOwnedFilter(tenant, { _id: id })).session(session))
            throw conflict('OVER_CREDIT', 'A credit note cannot exceed the open balance of an issued invoice');
          throw notFound();
        }
        const seq = await nextNumber(tenant.organizationId, `CN:${yearOf(now)}`, session);
        const [created] = await AdjustmentModel.create(
          [
            {
              organizationId: tenant.organizationId,
              branchId: invoice.branchId,
              patientId: invoice.patientId,
              type: 'credit_note',
              number: formatNumber('CN', yearOf(now), seq),
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
        if (!created) throw new Error('Expected a credit note');
        await audit(
          tenant,
          'credit_note.issued',
          { type: 'adjustment', id: created._id },
          { invoice: invoice.number, amount: input.amount, currency: invoice.currency },
          session,
        );
        return created.toObject() as Lean<Adjustment>;
      });
      res.status(201).json({ creditNote: adjustmentDto(note), replayed: false });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const again = await AdjustmentModel.findOne({
        organizationId: tenant.organizationId,
        createdBy: tenant.userId,
        idempotencyKey: key,
      }).lean<Lean<Adjustment>>();
      if (!again || again.requestHash !== requestHash) throw reused();
      res.json({ creditNote: adjustmentDto(again), replayed: true });
    }
  });

  // ---- receipts ---------------------------------------------------------------------------
  router.post('/finance/payments', requirePermission('finance.payment.record'), async (req, res) => {
    const tenant = tenantOf(req);
    const key = requireKey(req);
    const input = parseInput(paymentSchema, req.body);
    const requestHash = hash(input);
    const previous = await PaymentModel.findOne({
      organizationId: tenant.organizationId,
      createdBy: tenant.userId,
      idempotencyKey: key,
    }).lean<Lean<Payment>>();
    if (previous) {
      if (previous.requestHash !== requestHash) throw reused();
      res.json({ payment: paymentDto(previous), replayed: true });
      return;
    }
    if (input.allocations.reduce((s, a) => s + a.amount, 0) > input.amount) throw validationError({ allocations: 'out_of_range' });
    const branch = await accessibleBranch(tenant, input.branchId);
    const patient = await patientAtBranch(tenant, input.patientId, branch._id);
    const currency = await organizationCurrency(tenant);
    const now = clock.now();
    await ensureCounter(tenant.organizationId, `RCPT:${yearOf(now)}`);
    try {
      const payment = await inTx(async (session) => {
        const seq = await nextNumber(tenant.organizationId, `RCPT:${yearOf(now)}`, session);
        const [created] = await PaymentModel.create(
          [
            {
              organizationId: tenant.organizationId,
              branchId: branch._id,
              patientId: patient._id,
              number: formatNumber('RCPT', yearOf(now), seq),
              amount: input.amount,
              currency,
              method: input.method,
              reference: input.reference,
              receivedAt: now,
              createdBy: tenant.userId,
              idempotencyKey: key,
              requestHash,
            },
          ],
          { session },
        );
        if (!created) throw new Error('Expected a receipt');
        let current = created.toObject() as Lean<Payment>;
        for (const a of input.allocations) current = await allocate(tenant, current, new Types.ObjectId(a.invoiceId), a.amount, session);
        await audit(
          tenant,
          'payment.recorded',
          { type: 'payment', id: created._id },
          { number: current.number, amount: input.amount, method: input.method, allocated: current.allocated, currency },
          session,
        );
        return current;
      });
      res.status(201).json({ payment: paymentDto(payment), replayed: false });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const again = await PaymentModel.findOne({
        organizationId: tenant.organizationId,
        createdBy: tenant.userId,
        idempotencyKey: key,
      }).lean<Lean<Payment>>();
      if (!again || again.requestHash !== requestHash) throw reused();
      res.json({ payment: paymentDto(again), replayed: true });
    }
  });

  router.get('/finance/payments/:paymentId', requirePermission('finance.account.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const id = parseObjectId(req.params.paymentId);
    if (!id) throw notFound();
    const payment = await PaymentModel.findOne(branchOwnedFilter(tenant, { _id: id })).lean<Lean<Payment>>();
    if (!payment) throw notFound();
    const [patient, branch, org, invoices, refunds] = await Promise.all([
      PatientModel.findOne({ organizationId: tenant.organizationId, _id: payment.patientId }).select('fullName patientNumber').lean(),
      BranchModel.findOne({ organizationId: tenant.organizationId, _id: payment.branchId }).select('name city').lean(),
      OrganizationModel.findById(tenant.organizationId).select('name').lean(),
      InvoiceModel.find({ organizationId: tenant.organizationId, _id: { $in: payment.allocations.map((a) => a.invoiceId) } })
        .select('number')
        .lean(),
      AdjustmentModel.find({ organizationId: tenant.organizationId, paymentId: payment._id }).lean<Lean<Adjustment>[]>(),
    ]);
    const numberOf = new Map(invoices.map((i) => [String(i._id), i.number]));
    res.json({
      payment: {
        ...paymentDto(payment),
        allocations: payment.allocations.map((a) => ({
          invoiceId: String(a.invoiceId),
          invoiceNumber: numberOf.get(String(a.invoiceId)) ?? null,
          amount: a.amount,
        })),
      },
      patient: patient ? { id: String(patient._id), fullName: patient.fullName, patientNumber: patient.patientNumber } : null,
      branch: branch ? { id: String(branch._id), name: branch.name, city: branch.city } : null,
      organization: { name: org?.name ?? '' },
      refunds: refunds.map(adjustmentDto),
    });
  });

  router.post('/finance/payments/:paymentId/allocations', requirePermission('finance.payment.record'), async (req, res) => {
    const tenant = tenantOf(req);
    const id = parseObjectId(req.params.paymentId);
    if (!id) throw notFound();
    const input = parseInput(allocationSchema, req.body);
    const updated = await inTx(async (session) => {
      const payment = await PaymentModel.findOne(branchOwnedFilter(tenant, { _id: id }))
        .session(session)
        .lean<Lean<Payment>>();
      if (!payment) throw notFound();
      if (payment.status !== 'active') throw conflict('PAYMENT_REVERSED', 'This receipt was reversed');
      const result = await allocate(tenant, payment, new Types.ObjectId(input.invoiceId), input.amount, session);
      await audit(tenant, 'payment.allocated', { type: 'payment', id }, { amount: input.amount, currency: payment.currency }, session);
      return result;
    });
    res.json({ payment: paymentDto(updated) });
  });

  // Reversal (e.g. a bounced transfer): the receipt stays, marked reversed; its allocations are
  // taken back from the invoices. Not possible once part of it was refunded.
  router.post('/finance/payments/:paymentId/reverse', requirePermission('finance.adjustment.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const id = parseObjectId(req.params.paymentId);
    if (!id) throw notFound();
    const { reason } = parseInput(z.object({ reason: reasonSchema }), req.body);
    const reversed = await inTx(async (session) => {
      const payment = await PaymentModel.findOneAndUpdate(
        branchOwnedFilter(tenant, { _id: id, status: 'active' as const, refunded: 0 }),
        { $set: { status: 'reversed', reversal: { reason, at: clock.now(), by: tenant.userId } } },
        { session, returnDocument: 'after' },
      ).lean<Lean<Payment>>();
      if (!payment) {
        const existing = await PaymentModel.findOne(branchOwnedFilter(tenant, { _id: id }))
          .session(session)
          .lean<Lean<Payment>>();
        if (!existing) throw notFound();
        throw conflict(existing.status === 'reversed' ? 'PAYMENT_REVERSED' : 'PAYMENT_REFUNDED', 'This receipt cannot be reversed');
      }
      const perInvoice = new Map<string, number>();
      for (const a of payment.allocations) perInvoice.set(String(a.invoiceId), (perInvoice.get(String(a.invoiceId)) ?? 0) + a.amount);
      for (const [invoiceId, amount] of perInvoice) {
        const r = await InvoiceModel.updateOne(
          { organizationId: tenant.organizationId, _id: new Types.ObjectId(invoiceId), status: 'issued', paid: { $gte: amount } },
          { $inc: { paid: -amount } },
          { session },
        );
        if (r.modifiedCount !== 1) throw new Error('Inconsistent invoice balance');
      }
      await audit(tenant, 'payment.reversed', { type: 'payment', id }, { amount: payment.amount, currency: payment.currency }, session);
      return payment;
    });
    res.json({ payment: paymentDto(reversed) });
  });

  // Refund from the receipt's unallocated part (money returned to the patient).
  router.post('/finance/payments/:paymentId/refunds', requirePermission('finance.adjustment.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const key = requireKey(req);
    const id = parseObjectId(req.params.paymentId);
    if (!id) throw notFound();
    const input = parseInput(adjustmentSchema, req.body);
    const requestHash = hash([String(id), input]);
    const previous = await AdjustmentModel.findOne({
      organizationId: tenant.organizationId,
      createdBy: tenant.userId,
      idempotencyKey: key,
    }).lean<Lean<Adjustment>>();
    if (previous) {
      if (previous.requestHash !== requestHash) throw reused();
      res.json({ refund: adjustmentDto(previous), replayed: true });
      return;
    }
    const now = clock.now();
    await ensureCounter(tenant.organizationId, `REF:${yearOf(now)}`);
    try {
      const refund = await inTx(async (session) => {
        const payment = await PaymentModel.findOneAndUpdate(
          branchOwnedFilter(tenant, {
            _id: id,
            status: 'active' as const,
            $expr: { $lte: [{ $add: ['$allocated', '$refunded', input.amount] }, '$amount'] },
          }),
          { $inc: { refunded: input.amount } },
          { session, returnDocument: 'after' },
        ).lean<Lean<Payment>>();
        if (!payment) {
          if (await PaymentModel.exists(branchOwnedFilter(tenant, { _id: id })).session(session))
            throw conflict('OVER_REFUND', 'A refund cannot exceed the unallocated part of an active receipt');
          throw notFound();
        }
        const seq = await nextNumber(tenant.organizationId, `REF:${yearOf(now)}`, session);
        const [created] = await AdjustmentModel.create(
          [
            {
              organizationId: tenant.organizationId,
              branchId: payment.branchId,
              patientId: payment.patientId,
              type: 'refund',
              number: formatNumber('REF', yearOf(now), seq),
              invoiceId: null,
              paymentId: payment._id,
              amount: input.amount,
              currency: payment.currency,
              reason: input.reason,
              createdBy: tenant.userId,
              idempotencyKey: key,
              requestHash,
            },
          ],
          { session },
        );
        if (!created) throw new Error('Expected a refund');
        await audit(
          tenant,
          'refund.recorded',
          { type: 'adjustment', id: created._id },
          { receipt: payment.number, amount: input.amount, currency: payment.currency },
          session,
        );
        return created.toObject() as Lean<Adjustment>;
      });
      res.status(201).json({ refund: adjustmentDto(refund), replayed: false });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const again = await AdjustmentModel.findOne({
        organizationId: tenant.organizationId,
        createdBy: tenant.userId,
        idempotencyKey: key,
      }).lean<Lean<Adjustment>>();
      if (!again || again.requestHash !== requestHash) throw reused();
      res.json({ refund: adjustmentDto(again), replayed: true });
    }
  });

  // ---- patient account and statement -------------------------------------------------------
  router.get('/finance/patients/:patientId/account', requirePermission('finance.account.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const patient = await visiblePatient(tenant, String(req.params.patientId));
    const scope = branchOwnedFilter(tenant, { patientId: patient._id });
    const [charges, invoices, payments, adjustments, settings] = await Promise.all([
      ChargeModel.find({ ...scope, status: { $in: ['pending', 'invoiced'] } })
        .sort({ createdAt: -1 })
        .limit(300)
        .lean<Lean<Charge>[]>(),
      InvoiceModel.find({ ...scope, status: { $in: ['draft', 'issued'] } })
        .sort({ createdAt: -1 })
        .limit(300)
        .lean<Lean<Invoice>[]>(),
      PaymentModel.find(scope).sort({ receivedAt: -1 }).limit(300).lean<Lean<Payment>[]>(),
      AdjustmentModel.find(scope).sort({ createdAt: -1 }).limit(300).lean<Lean<Adjustment>[]>(),
      OrganizationModel.findById(tenant.organizationId).select('currency').lean(),
    ]);
    const outstanding = invoices.reduce((s, i) => s + balanceOf(i), 0);
    const credit = payments.filter((p) => p.status === 'active').reduce((s, p) => s + (p.amount - p.allocated - p.refunded), 0);
    res.json({
      patient: { id: String(patient._id), fullName: patient.fullName, patientNumber: patient.patientNumber },
      currency: (settings as { currency?: string | null } | null)?.currency ?? null,
      charges: charges.map(chargeDto),
      invoices: invoices.map(invoiceDto),
      payments: payments.map(paymentDto),
      adjustments: adjustments.map(adjustmentDto),
      // One currency per organization: totals are only ever in that currency.
      balance: { outstanding, unallocatedCredit: credit, net: outstanding - credit },
    });
  });

  router.get('/finance/patients/:patientId/statement', requirePermission('finance.account.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const patient = await visiblePatient(tenant, String(req.params.patientId));
    const scope = branchOwnedFilter(tenant, { patientId: patient._id });
    const [invoices, payments, adjustments] = await Promise.all([
      InvoiceModel.find({ ...scope, status: 'issued' }).lean<Lean<Invoice>[]>(),
      PaymentModel.find(scope).lean<Lean<Payment>[]>(),
      AdjustmentModel.find(scope).lean<Lean<Adjustment>[]>(),
    ]);
    type Entry = { at: Date; type: string; number: string | null; debit: number; credit: number; currency: Currency };
    const entries: Entry[] = [
      ...invoices.map((i) => ({
        at: i.issuedAt ?? i.createdAt,
        type: 'invoice',
        number: i.number,
        debit: i.total,
        credit: 0,
        currency: i.currency,
      })),
      ...payments.map((p) => ({ at: p.receivedAt, type: 'payment', number: p.number, debit: 0, credit: p.amount, currency: p.currency })),
      ...payments
        .filter((p) => p.reversal)
        .map((p) => ({ at: p.reversal!.at, type: 'payment_reversal', number: p.number, debit: p.amount, credit: 0, currency: p.currency })),
      ...adjustments.map((a) => ({
        at: a.createdAt,
        type: a.type,
        number: a.number,
        debit: a.type === 'refund' ? a.amount : 0,
        credit: a.type === 'credit_note' ? a.amount : 0,
        currency: a.currency,
      })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    // Running balance per currency (debit = owed by the patient).
    const running = new Map<string, number>();
    res.json({
      patient: { id: String(patient._id), fullName: patient.fullName, patientNumber: patient.patientNumber },
      entries: entries.map((e) => {
        const balance = (running.get(e.currency) ?? 0) + e.debit - e.credit;
        running.set(e.currency, balance);
        return { at: e.at.toISOString(), type: e.type, number: e.number, debit: e.debit, credit: e.credit, currency: e.currency, balance };
      }),
      balances: [...running.entries()].map(([currency, balance]) => ({ currency, balance })),
    });
  });

  // ---- reports ----------------------------------------------------------------------------
  router.get('/finance/reports/summary', requirePermission('finance.report.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(reportSchema, req.query);
    const from = new Date(`${input.from}T00:00:00.000Z`);
    const to = new Date(`${input.to}T23:59:59.999Z`);
    if (to < from || to.getTime() - from.getTime() > 400 * 86_400_000) throw validationError({ to: 'range_too_long' });
    const branchFilter = input.branchId ? { branchId: (await accessibleBranch(tenant, input.branchId))._id } : {};
    const scope = branchOwnedFilter(tenant, branchFilter);
    const [invoiced, collected, adjustments, outstanding, byService] = await Promise.all([
      InvoiceModel.aggregate([
        { $match: { ...scope, status: 'issued', issuedAt: { $gte: from, $lte: to } } },
        {
          $group: {
            _id: '$currency',
            count: { $sum: 1 },
            subtotal: { $sum: '$subtotal' },
            discounts: { $sum: { $ifNull: ['$discount.amount', 0] } },
            total: { $sum: '$total' },
          },
        },
      ]),
      PaymentModel.aggregate([
        { $match: { ...scope, status: 'active', receivedAt: { $gte: from, $lte: to } } },
        { $group: { _id: { currency: '$currency', method: '$method' }, count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
      AdjustmentModel.aggregate([
        { $match: { ...scope, createdAt: { $gte: from, $lte: to } } },
        { $group: { _id: { currency: '$currency', type: '$type' }, count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
      InvoiceModel.aggregate([
        { $match: { ...scope, status: 'issued' } },
        { $group: { _id: '$currency', open: { $sum: { $subtract: ['$total', { $add: ['$paid', '$credited'] }] } } } },
      ]),
      InvoiceModel.aggregate([
        { $match: { ...scope, status: 'issued', issuedAt: { $gte: from, $lte: to } } },
        { $unwind: '$lines' },
        {
          $group: {
            _id: { currency: '$currency', description: '$lines.description' },
            quantity: { $sum: '$lines.quantity' },
            amount: { $sum: '$lines.amount' },
          },
        },
        { $sort: { amount: -1 } },
        { $limit: 50 },
      ]),
    ]);
    // Grouped by currency: amounts in different currencies are never added together.
    res.json({
      from: input.from,
      to: input.to,
      invoiced: invoiced.map((g) => ({ currency: g._id, count: g.count, subtotal: g.subtotal, discounts: g.discounts, total: g.total })),
      collected: collected.map((g) => ({ currency: g._id.currency, method: g._id.method, count: g.count, amount: g.amount })),
      adjustments: adjustments.map((g) => ({ currency: g._id.currency, type: g._id.type, count: g.count, amount: g.amount })),
      outstanding: outstanding.map((g) => ({ currency: g._id, amount: g.open })),
      byService: byService.map((g) => ({ currency: g._id.currency, service: g._id.description, quantity: g.quantity, amount: g.amount })),
    });
  });

  return router;
}
