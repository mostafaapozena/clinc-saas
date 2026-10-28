import { Schema, model, type Query, type Types } from 'mongoose';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';
import { clock } from '../../time/clock.js';
import { MAX_AMOUNT } from '../finance/finance.model.js';

// Practitioner compensation (docs/architecture/COMPENSATION.md) — fees owed to practitioners under
// explicit agreements. Not payroll: no salaries, taxes or insurance deductions.
//
// - Agreements are effective-dated and never overlap for one practitioner; a new agreement ends the
//   open one the day before. Settled periods cannot be re-priced by a later agreement.
// - A settlement is computed as a draft, then approved (frozen, posted) and paid. Every source item
//   (charge, invoice line, allocation, and their negative counterparts) is claimed once, ever, by a
//   unique index — two approvals can never pay the same item.

const currentTime = () => clock.now();
const ref = (name: string, required = true) => ({ type: Schema.Types.ObjectId, ref: name, required });
const int = (min = 0, max = MAX_AMOUNT) => ({
  type: Number,
  required: true,
  min,
  max,
  validate: { validator: Number.isSafeInteger, message: 'not_integer' },
});
function blockUnlessSeedCleanup(this: Query<unknown, unknown>) {
  if (this.getOptions().allowSeedCleanup !== true) throw new Error('Compensation records cannot be deleted or replaced');
}
const DELETES = ['deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne', 'findOneAndReplace'] as const;

export const BASES = ['performed', 'invoiced', 'collected'] as const;
export type Basis = (typeof BASES)[number];

export interface Agreement {
  organizationId: Types.ObjectId;
  practitionerId: Types.ObjectId;
  effectiveFrom: string;
  effectiveTo: string | null;
  basis: Basis;
  /** Percentage of the base in basis points (2500 = 25%). */
  percentBp: number;
  /** Fixed amount per unit performed or invoiced (minor units); not used with the collected basis. */
  fixedPerUnit: number;
  /** Empty = every service / branch. */
  serviceIds: Types.ObjectId[];
  branchIds: Types.ObjectId[];
  /** Invoice discounts reduce the base pro rata (invoiced and collected bases). */
  discountsReduceBase: boolean;
  /** Credit notes reduce the base (invoiced basis) — negative lines in the period they are issued. */
  creditsReduceBase: boolean;
  note: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
}
const agreementSchema = new Schema<Agreement>(
  {
    organizationId: ref('Organization'),
    practitionerId: ref('Practitioner'),
    effectiveFrom: { type: String, required: true },
    effectiveTo: { type: String, default: null },
    basis: { type: String, enum: BASES, required: true },
    percentBp: { ...int(0, 10_000), default: 0 },
    fixedPerUnit: { ...int(), default: 0 },
    serviceIds: { type: [{ type: Schema.Types.ObjectId, ref: 'FinanceService' }], default: [] },
    branchIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Branch' }], default: [] },
    discountsReduceBase: { type: Boolean, required: true, default: true },
    creditsReduceBase: { type: Boolean, required: true, default: true },
    note: { type: String, default: '', maxlength: 300 },
    createdBy: ref('User'),
  },
  { collection: 'comp_agreements', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
agreementSchema.index({ organizationId: 1, practitionerId: 1, effectiveFrom: 1 }, { unique: true });
agreementSchema.plugin(tenantGuardPlugin);
agreementSchema.pre([...DELETES], blockUnlessSeedCleanup);
// Terms are never edited; only an open agreement's end date can be set (by a newer agreement).
agreementSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function (this: Query<unknown, unknown>) {
  if (this.getOptions().allowSeedCleanup === true) return;
  const update = (this.getUpdate() ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const fields = Object.entries(update).flatMap(([op, v]) => (op.startsWith('$') ? Object.keys(v ?? {}) : [op]));
  if (fields.some((f) => f !== 'effectiveTo')) throw new Error('Agreement terms cannot be changed');
});

export interface SettlementLine {
  sourceKey: string;
  sourceType: 'charge' | 'charge_void' | 'invoice_line' | 'credit_note' | 'allocation' | 'allocation_reversal';
  date: string;
  branchId: Types.ObjectId;
  serviceId: Types.ObjectId | null;
  description: string;
  qty: number;
  /** Signed base (negative for voids, credit notes and reversals). */
  base: number;
  amount: number;
  agreementId: Types.ObjectId;
}
export interface Settlement {
  organizationId: Types.ObjectId;
  number: string;
  practitionerId: Types.ObjectId;
  periodFrom: string;
  periodTo: string;
  status: 'draft' | 'approved' | 'paid' | 'cancelled';
  lines: SettlementLine[];
  adjustments: { amount: number; reason: string; by: Types.ObjectId; at: Date }[];
  computed: number;
  total: number;
  paid: number;
  computedAt: Date;
  approval: { by: Types.ObjectId; at: Date; entryId: Types.ObjectId | null } | null;
  payments: { amount: number; cashAccountId: Types.ObjectId; entryId: Types.ObjectId; by: Types.ObjectId; at: Date; key: string }[];
  version: number;
  createdBy: Types.ObjectId;
  createdAt: Date;
}
const lineSchema = new Schema<SettlementLine>(
  {
    sourceKey: { type: String, required: true },
    sourceType: { type: String, required: true },
    date: { type: String, required: true },
    branchId: ref('Branch'),
    serviceId: { type: Schema.Types.ObjectId, ref: 'FinanceService', default: null },
    description: { type: String, default: '', maxlength: 160 },
    qty: { type: Number, required: true },
    base: { type: Number, required: true },
    amount: { type: Number, required: true },
    agreementId: ref('Agreement'),
  },
  { _id: false },
);
const settlementSchema = new Schema<Settlement>(
  {
    organizationId: ref('Organization'),
    number: { type: String, required: true },
    practitionerId: ref('Practitioner'),
    periodFrom: { type: String, required: true },
    periodTo: { type: String, required: true },
    status: { type: String, enum: ['draft', 'approved', 'paid', 'cancelled'], required: true, default: 'draft' },
    lines: { type: [lineSchema], default: [] },
    adjustments: {
      type: [
        new Schema(
          {
            amount: { type: Number, required: true },
            reason: { type: String, required: true, maxlength: 300 },
            by: ref('User'),
            at: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    computed: { type: Number, required: true, default: 0 },
    total: { type: Number, required: true, default: 0 },
    paid: { ...int(), default: 0 },
    computedAt: { type: Date, required: true },
    approval: {
      type: new Schema(
        { by: ref('User'), at: { type: Date, required: true }, entryId: { type: Schema.Types.ObjectId, default: null } },
        { _id: false },
      ),
      default: null,
    },
    payments: {
      type: [
        new Schema(
          {
            amount: int(1),
            cashAccountId: ref('CashAccount'),
            entryId: ref('JournalEntry'),
            by: ref('User'),
            at: { type: Date, required: true },
            key: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    version: { type: Number, required: true, default: 0 },
    createdBy: ref('User'),
  },
  { collection: 'comp_settlements', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
settlementSchema.index({ organizationId: 1, number: 1 }, { unique: true });
settlementSchema.index({ organizationId: 1, practitionerId: 1, periodTo: -1 });
settlementSchema.plugin(tenantGuardPlugin);
settlementSchema.pre([...DELETES], blockUnlessSeedCleanup);

/** One row per source item ever settled (approved): the guarantee against paying an item twice. */
export interface SettledItem {
  organizationId: Types.ObjectId;
  sourceKey: string;
  settlementId: Types.ObjectId;
  practitionerId: Types.ObjectId;
}
const settledSchema = new Schema<SettledItem>(
  {
    organizationId: ref('Organization'),
    sourceKey: { type: String, required: true },
    settlementId: ref('Settlement'),
    practitionerId: ref('Practitioner'),
  },
  { collection: 'comp_settled_items' },
);
settledSchema.index({ organizationId: 1, sourceKey: 1 }, { unique: true });
settledSchema.index({ organizationId: 1, practitionerId: 1 });
settledSchema.plugin(tenantGuardPlugin);
settledSchema.pre([...DELETES, 'updateOne', 'updateMany', 'findOneAndUpdate'], blockUnlessSeedCleanup);

export const AgreementModel = model<Agreement>('Agreement', agreementSchema);
export const SettlementModel = model<Settlement>('Settlement', settlementSchema);
export const SettledItemModel = model<SettledItem>('SettledItem', settledSchema);
