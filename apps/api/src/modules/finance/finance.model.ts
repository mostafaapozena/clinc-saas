import { Schema, model, type ClientSession, type Query, type Types } from 'mongoose';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';
import { clock } from '../../time/clock.js';

// Clinic financial operations (docs/architecture/FINANCE.md). Separate from platform billing.
//
// - Money is an integer number of minor units (piastres, halalas) with an explicit currency;
//   there is no floating point anywhere, and amounts of different currencies are never summed.
// - Issued invoices, receipts, credit notes and refunds are never edited or deleted. Corrections
//   are new records with a reason (credit note, refund, payment reversal) that keep the original.
// - Running totals on invoices (`paid`, `credited`) and receipts (`allocated`, `refunded`) only
//   change through conditional `$inc` updates that keep balances within bounds atomically.

/** Currencies supported now (target markets); minor units per major unit. */
export const CURRENCIES = { EGP: 100, SAR: 100 } as const;
export type Currency = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as [Currency, ...Currency[]];
/** Upper bound for any single amount (10 million major units), to keep sums exact. */
export const MAX_AMOUNT = 1_000_000_000;

const currentTime = () => clock.now();
const money = {
  type: Number,
  required: true,
  min: 0,
  max: MAX_AMOUNT,
  validate: { validator: Number.isSafeInteger, message: 'not_integer' },
};
const currency = { type: String, enum: CURRENCY_CODES, required: true };
const ref = (name: string, required = true) => ({ type: Schema.Types.ObjectId, ref: name, required });

// ---------------------------------------------------------------------------------------------
// Service catalog (prices per organization, optionally overridden per branch).
export interface FinanceService {
  organizationId: Types.ObjectId;
  code: string;
  name: string;
  specialtyCode: string | null;
  status: 'active' | 'inactive';
  price: number;
  branchPrices: { branchId: Types.ObjectId; price: number }[];
  currency: Currency;
  version: number;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
const serviceSchema = new Schema<FinanceService>(
  {
    organizationId: ref('Organization'),
    code: { type: String, required: true, match: /^[A-Z0-9-]{1,20}$/ },
    name: { type: String, required: true, minlength: 2, maxlength: 120 },
    specialtyCode: { type: String, default: null },
    status: { type: String, enum: ['active', 'inactive'], required: true, default: 'active' },
    price: money,
    branchPrices: { type: [new Schema({ branchId: ref('Branch'), price: money }, { _id: false })], default: [] },
    currency,
    version: { type: Number, required: true, default: 0 },
    createdBy: ref('User'),
    updatedBy: ref('User'),
  },
  { collection: 'finance_services', timestamps: { currentTime } },
);
serviceSchema.index({ organizationId: 1, code: 1 }, { unique: true });
serviceSchema.plugin(tenantGuardPlugin);

// ---------------------------------------------------------------------------------------------
// Charges: what was performed, waiting to be invoiced. Clinical charges reference the record item
// (never its text); the unique index makes charging the same item twice impossible.
export const CHARGE_SOURCES = ['manual', 'clinical_procedure', 'plan_item'] as const;
export interface Charge {
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  patientId: Types.ObjectId;
  appointmentId: Types.ObjectId | null;
  serviceId: Types.ObjectId;
  /** The service name at the time (never clinical text). */
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  currency: Currency;
  status: 'pending' | 'invoiced' | 'voided';
  invoiceId: Types.ObjectId | null;
  source: { type: (typeof CHARGE_SOURCES)[number]; encounterId: Types.ObjectId | null; itemId: string | null };
  voidReason: string | null;
  createdBy: Types.ObjectId;
  idempotencyKey: string;
  requestHash: string;
  createdAt: Date;
}
const chargeSchema = new Schema<Charge>(
  {
    organizationId: ref('Organization'),
    branchId: ref('Branch'),
    patientId: ref('Patient'),
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment', default: null },
    serviceId: ref('FinanceService'),
    description: { type: String, required: true, maxlength: 120 },
    quantity: { type: Number, required: true, min: 1, max: 100 },
    unitPrice: money,
    amount: money,
    currency,
    status: { type: String, enum: ['pending', 'invoiced', 'voided'], required: true, default: 'pending' },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null },
    source: {
      type: new Schema(
        {
          type: { type: String, enum: CHARGE_SOURCES, required: true },
          encounterId: { type: Schema.Types.ObjectId, default: null },
          itemId: { type: String, default: null },
        },
        { _id: false },
      ),
      required: true,
    },
    voidReason: { type: String, default: null, maxlength: 300 },
    createdBy: ref('User'),
    idempotencyKey: { type: String, required: true },
    requestHash: { type: String, required: true },
  },
  { collection: 'finance_charges', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
chargeSchema.index({ organizationId: 1, patientId: 1, status: 1, createdAt: -1 });
chargeSchema.index({ organizationId: 1, createdBy: 1, idempotencyKey: 1 }, { unique: true });
// One charge per clinical item (a voided charge still holds the slot: void, then re-charge is
// deliberately not possible without a new record item).
chargeSchema.index(
  { organizationId: 1, 'source.encounterId': 1, 'source.itemId': 1 },
  { unique: true, partialFilterExpression: { 'source.itemId': { $type: 'string' } } },
);
chargeSchema.plugin(tenantGuardPlugin);

// ---------------------------------------------------------------------------------------------
// Invoices: draft (editable: discount, discard) → issued (immutable, numbered).
export interface InvoiceLine {
  chargeId: Types.ObjectId;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}
export interface Invoice {
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  patientId: Types.ObjectId;
  number: string | null;
  status: 'draft' | 'issued' | 'discarded';
  lines: InvoiceLine[];
  subtotal: number;
  discount: { amount: number; reason: string; appliedBy: Types.ObjectId } | null;
  total: number;
  currency: Currency;
  /** Allocated from receipts (minus reversed allocations). */
  paid: number;
  /** Credit notes issued against it. */
  credited: number;
  issuedAt: Date | null;
  issuedBy: Types.ObjectId | null;
  issueKey: string | null;
  version: number;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
const invoiceSchema = new Schema<Invoice>(
  {
    organizationId: ref('Organization'),
    branchId: ref('Branch'),
    patientId: ref('Patient'),
    number: { type: String, default: null },
    status: { type: String, enum: ['draft', 'issued', 'discarded'], required: true, default: 'draft' },
    lines: {
      type: [
        new Schema(
          {
            chargeId: ref('Charge'),
            description: { type: String, required: true },
            quantity: { type: Number, required: true },
            unitPrice: money,
            amount: money,
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    subtotal: money,
    discount: {
      type: new Schema({ amount: money, reason: { type: String, required: true, maxlength: 300 }, appliedBy: ref('User') }, { _id: false }),
      default: null,
    },
    total: money,
    currency,
    paid: { ...money, default: 0 },
    credited: { ...money, default: 0 },
    issuedAt: { type: Date, default: null },
    issuedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    issueKey: { type: String, default: null },
    version: { type: Number, required: true, default: 0 },
    createdBy: ref('User'),
  },
  { collection: 'finance_invoices', timestamps: { currentTime } },
);
invoiceSchema.index({ organizationId: 1, number: 1 }, { unique: true, partialFilterExpression: { number: { $type: 'string' } } });
invoiceSchema.index({ organizationId: 1, patientId: 1, createdAt: -1 });
invoiceSchema.index({ organizationId: 1, branchId: 1, issuedAt: -1 });
invoiceSchema.plugin(tenantGuardPlugin);

// ---------------------------------------------------------------------------------------------
// Receipts (payments recorded by the clinic) and their allocation to issued invoices.
export const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'other'] as const;
export interface Payment {
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  patientId: Types.ObjectId;
  number: string;
  amount: number;
  currency: Currency;
  method: (typeof PAYMENT_METHODS)[number];
  reference: string;
  receivedAt: Date;
  allocations: { invoiceId: Types.ObjectId; amount: number; at: Date }[];
  allocated: number;
  refunded: number;
  status: 'active' | 'reversed';
  reversal: { reason: string; at: Date; by: Types.ObjectId } | null;
  createdBy: Types.ObjectId;
  idempotencyKey: string;
  requestHash: string;
  createdAt: Date;
}
const paymentSchema = new Schema<Payment>(
  {
    organizationId: ref('Organization'),
    branchId: ref('Branch'),
    patientId: ref('Patient'),
    number: { type: String, required: true },
    amount: { ...money, min: 1 },
    currency,
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    reference: { type: String, default: '', maxlength: 60 },
    receivedAt: { type: Date, required: true },
    allocations: {
      type: [new Schema({ invoiceId: ref('Invoice'), amount: { ...money, min: 1 }, at: { type: Date, required: true } }, { _id: false })],
      default: [],
    },
    allocated: { ...money, default: 0 },
    refunded: { ...money, default: 0 },
    status: { type: String, enum: ['active', 'reversed'], required: true, default: 'active' },
    reversal: {
      type: new Schema(
        { reason: { type: String, required: true, maxlength: 300 }, at: { type: Date, required: true }, by: ref('User') },
        { _id: false },
      ),
      default: null,
    },
    createdBy: ref('User'),
    idempotencyKey: { type: String, required: true },
    requestHash: { type: String, required: true },
  },
  { collection: 'finance_payments', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
paymentSchema.index({ organizationId: 1, number: 1 }, { unique: true });
paymentSchema.index({ organizationId: 1, createdBy: 1, idempotencyKey: 1 }, { unique: true });
paymentSchema.index({ organizationId: 1, patientId: 1, receivedAt: -1 });
paymentSchema.plugin(tenantGuardPlugin);

// ---------------------------------------------------------------------------------------------
// Adjustments: credit notes (reduce what an issued invoice asks) and refunds (money returned from a
// receipt's unallocated part). Append-only.
export interface Adjustment {
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  patientId: Types.ObjectId;
  type: 'credit_note' | 'refund';
  number: string;
  invoiceId: Types.ObjectId | null;
  paymentId: Types.ObjectId | null;
  amount: number;
  currency: Currency;
  reason: string;
  createdBy: Types.ObjectId;
  idempotencyKey: string;
  requestHash: string;
  createdAt: Date;
}
const adjustmentSchema = new Schema<Adjustment>(
  {
    organizationId: ref('Organization'),
    branchId: ref('Branch'),
    patientId: ref('Patient'),
    type: { type: String, enum: ['credit_note', 'refund'], required: true },
    number: { type: String, required: true },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    amount: { ...money, min: 1 },
    currency,
    reason: { type: String, required: true, minlength: 3, maxlength: 300 },
    createdBy: ref('User'),
    idempotencyKey: { type: String, required: true },
    requestHash: { type: String, required: true },
  },
  { collection: 'finance_adjustments', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
adjustmentSchema.index({ organizationId: 1, number: 1 }, { unique: true });
adjustmentSchema.index({ organizationId: 1, createdBy: 1, idempotencyKey: 1 }, { unique: true });
adjustmentSchema.index({ organizationId: 1, patientId: 1, createdAt: -1 });
adjustmentSchema.plugin(tenantGuardPlugin);

// ---------------------------------------------------------------------------------------------
// Number sequences per organization, branch, document type and year (e.g. INV-NASR-2026-000012).
interface FinanceCounter {
  organizationId: Types.ObjectId;
  key: string;
  seq: number;
}
const counterSchema = new Schema<FinanceCounter>(
  { organizationId: ref('Organization'), key: { type: String, required: true }, seq: { type: Number, required: true, default: 0 } },
  { collection: 'finance_counters' },
);
counterSchema.index({ organizationId: 1, key: 1 }, { unique: true });
counterSchema.plugin(tenantGuardPlugin);

// Issued documents and their history are never deleted or replaced; the seed may clean its own.
function blockUnlessSeedCleanup(this: Query<unknown, unknown>) {
  if (this.getOptions().allowSeedCleanup !== true) throw new Error('Financial records cannot be deleted or replaced');
}
const DELETES = ['deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne', 'findOneAndReplace'] as const;
for (const schema of [chargeSchema, invoiceSchema, paymentSchema, adjustmentSchema] as Schema[]) {
  schema.pre([...DELETES], blockUnlessSeedCleanup);
}
// Adjustments are insert-only; an issued invoice changes only through paid/credited counters.
adjustmentSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], blockUnlessSeedCleanup);
invoiceSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function (this: Query<unknown, unknown>) {
  if (this.getOptions().allowSeedCleanup === true) return;
  const filter = this.getFilter() as { status?: unknown };
  if (filter.status === 'draft') return;
  const update = (this.getUpdate() ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const fields = Object.entries(update).flatMap(([op, v]) => (op.startsWith('$') ? Object.keys(v ?? {}) : [op]));
  if (filter.status !== 'issued' || fields.some((f) => f !== 'paid' && f !== 'credited' && f !== 'updatedAt')) {
    throw new Error('Issued invoices cannot be changed');
  }
});

export const FinanceServiceModel = model<FinanceService>('FinanceService', serviceSchema);
export const ChargeModel = model<Charge>('Charge', chargeSchema);
export const InvoiceModel = model<Invoice>('Invoice', invoiceSchema);
export const PaymentModel = model<Payment>('Payment', paymentSchema);
export const AdjustmentModel = model<Adjustment>('FinanceAdjustment', adjustmentSchema);
const FinanceCounterModel = model<FinanceCounter>('FinanceCounter', counterSchema);

/** Creates the sequence document outside any transaction (so first uses never race on the insert). */
export async function ensureCounter(organizationId: Types.ObjectId, key: string): Promise<void> {
  try {
    await FinanceCounterModel.updateOne({ organizationId, key }, { $setOnInsert: { seq: 0 } }, { upsert: true });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
  }
}

/**
 * Next number of a sequence, inside the caller's transaction: a write-conflict between two
 * concurrent issues makes one retry, so numbers are unique and gap-free per committed document.
 * Call ensureCounter first.
 */
export async function nextNumber(organizationId: Types.ObjectId, key: string, session: ClientSession): Promise<number> {
  const counter = await FinanceCounterModel.findOneAndUpdate(
    { organizationId, key },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', session },
  ).lean();
  if (!counter) throw new Error('Sequence not initialized');
  return counter.seq;
}

/** INV-2026-000012 — one sequence per organization, document type and calendar year (UTC). */
export function formatNumber(prefix: 'INV' | 'RCPT' | 'CN' | 'REF', year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(6, '0')}`;
}
