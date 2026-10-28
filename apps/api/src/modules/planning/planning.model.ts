import { Schema, model, type Query, type Types } from 'mongoose';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';
import { clock } from '../../time/clock.js';
import { MAX_AMOUNT } from '../finance/finance.model.js';

// Budgets and recurring commitments (docs/architecture/PLANNING.md). Budgets are plans, never
// postings; commitments record nothing in the ledger themselves: each payment is the cash voucher
// or supplier bill that already posted it, linked once.

const currentTime = () => clock.now();
const ref = (name: string, required = true) => ({ type: Schema.Types.ObjectId, ref: name, required });
const optionalRef = (name: string) => ({ type: Schema.Types.ObjectId, ref: name, default: null });
const money = {
  type: Number,
  required: true,
  min: 0,
  max: MAX_AMOUNT,
  validate: { validator: Number.isSafeInteger, message: 'not_integer' },
};
function blockUnlessSeedCleanup(this: Query<unknown, unknown>) {
  if (this.getOptions().allowSeedCleanup !== true) throw new Error('Planning records cannot be deleted or replaced');
}
const DELETES = ['deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne', 'findOneAndReplace'] as const;

export interface BudgetLine {
  accountId: Types.ObjectId;
  /** Twelve monthly amounts in minor units, January first. */
  months: number[];
}
export interface Budget {
  organizationId: Types.ObjectId;
  year: number;
  /** null: the whole organization; otherwise one branch (cost center). */
  branchId: Types.ObjectId | null;
  status: 'draft' | 'approved';
  lines: BudgetLine[];
  approvedBy: Types.ObjectId | null;
  approvedAt: Date | null;
  version: number;
  createdBy: Types.ObjectId;
  createdAt: Date;
}
const budgetSchema = new Schema<Budget>(
  {
    organizationId: ref('Organization'),
    year: { type: Number, required: true, min: 2000, max: 2100 },
    branchId: optionalRef('Branch'),
    status: { type: String, enum: ['draft', 'approved'], required: true, default: 'draft' },
    lines: {
      type: [
        new Schema<BudgetLine>(
          {
            accountId: ref('LedgerAccount'),
            months: { type: [money], validate: { validator: (v: number[]) => v.length === 12, message: 'twelve_months' } },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    approvedBy: optionalRef('User'),
    approvedAt: { type: Date, default: null },
    version: { type: Number, required: true, default: 0 },
    createdBy: ref('User'),
  },
  { collection: 'pln_budgets', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
budgetSchema.index({ organizationId: 1, year: 1, branchId: 1 }, { unique: true });
budgetSchema.plugin(tenantGuardPlugin);
budgetSchema.pre([...DELETES], blockUnlessSeedCleanup);

export const FREQUENCIES = ['monthly', 'quarterly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const FREQUENCY_MONTHS: Record<Frequency, number> = { monthly: 1, quarterly: 3, yearly: 12 };

export interface Commitment {
  organizationId: Types.ObjectId;
  name: string;
  /** Expense account the payments post to (rent, utilities, subscriptions…). */
  accountId: Types.ObjectId;
  branchId: Types.ObjectId | null;
  supplierId: Types.ObjectId | null;
  amount: number;
  frequency: Frequency;
  /** Day of the month payments fall on (1–31; short months use their last day). */
  dayOfMonth: number;
  nextDue: string | null;
  endDate: string | null;
  status: 'active' | 'ended';
  version: number;
  createdBy: Types.ObjectId;
  createdAt: Date;
}
const commitmentSchema = new Schema<Commitment>(
  {
    organizationId: ref('Organization'),
    name: { type: String, required: true, minlength: 2, maxlength: 120 },
    accountId: ref('LedgerAccount'),
    branchId: optionalRef('Branch'),
    supplierId: optionalRef('Supplier'),
    amount: { ...money, min: 1 },
    frequency: { type: String, enum: FREQUENCIES, required: true },
    dayOfMonth: { type: Number, required: true, min: 1, max: 31 },
    nextDue: { type: String, default: null },
    endDate: { type: String, default: null },
    status: { type: String, enum: ['active', 'ended'], required: true, default: 'active' },
    version: { type: Number, required: true, default: 0 },
    createdBy: ref('User'),
  },
  { collection: 'pln_commitments', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
commitmentSchema.index({ organizationId: 1, status: 1, nextDue: 1 });
commitmentSchema.plugin(tenantGuardPlugin);
commitmentSchema.pre([...DELETES], blockUnlessSeedCleanup);

/** One paid installment: the voucher or bill that already posted it, linked to one commitment once. */
export interface CommitmentPayment {
  organizationId: Types.ObjectId;
  commitmentId: Types.ObjectId;
  dueDate: string;
  voucherId: Types.ObjectId | null;
  billId: Types.ObjectId | null;
  amount: number;
  createdBy: Types.ObjectId;
  createdAt: Date;
}
const paymentSchema = new Schema<CommitmentPayment>(
  {
    organizationId: ref('Organization'),
    commitmentId: ref('Commitment'),
    dueDate: { type: String, required: true },
    voucherId: optionalRef('CashVoucher'),
    billId: optionalRef('SupplierBill'),
    amount: money,
    createdBy: ref('User'),
  },
  { collection: 'pln_commitment_payments', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
paymentSchema.index({ organizationId: 1, commitmentId: 1, dueDate: 1 }, { unique: true });
paymentSchema.index({ organizationId: 1, voucherId: 1 }, { unique: true, partialFilterExpression: { voucherId: { $type: 'objectId' } } });
paymentSchema.index({ organizationId: 1, billId: 1 }, { unique: true, partialFilterExpression: { billId: { $type: 'objectId' } } });
paymentSchema.plugin(tenantGuardPlugin);
paymentSchema.pre([...DELETES, 'updateOne', 'updateMany', 'findOneAndUpdate'], blockUnlessSeedCleanup);

export const BudgetModel = model<Budget>('Budget', budgetSchema);
export const CommitmentModel = model<Commitment>('Commitment', commitmentSchema);
export const CommitmentPaymentModel = model<CommitmentPayment>('CommitmentPayment', paymentSchema);
