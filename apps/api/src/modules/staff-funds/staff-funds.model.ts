import { Schema, model, type Query, type Types } from 'mongoose';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';
import { clock } from '../../time/clock.js';
import { MAX_AMOUNT } from '../finance/finance.model.js';

// Employee cash advances (سلف) and petty-cash custody (عهد) — docs/architecture/STAFF_FUNDS.md.
// Each document is the sub-ledger of one amount handed to one team member; every movement posts
// through the posting engine and the ledger accounts change only through these documents.

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
  if (this.getOptions().allowSeedCleanup !== true) throw new Error('Staff fund records cannot be deleted or replaced');
}

export const STAFF_FUND_KINDS = ['advance', 'custody'] as const;
export type StaffFundKind = (typeof STAFF_FUND_KINDS)[number];
/** Ledger template keys behind each kind (created on first use in older charts). */
export const STAFF_FUND_ACCOUNT: Record<StaffFundKind, 'staffAdvances' | 'staffCustody'> = { advance: 'staffAdvances', custody: 'staffCustody' };

export interface StaffFundMovement {
  type: 'issue' | 'return' | 'expense' | 'write_off';
  date: string;
  amount: number;
  cashAccountId: Types.ObjectId | null;
  /** Expense lines of a custody settlement (receipts the member brought back). */
  lines: { accountId: Types.ObjectId; amount: number; memo: string }[];
  memo: string;
  entryId: Types.ObjectId;
  by: Types.ObjectId;
  at: Date;
}
export interface StaffFund {
  organizationId: Types.ObjectId;
  number: string;
  kind: StaffFundKind;
  membershipId: Types.ObjectId;
  branchId: Types.ObjectId | null;
  purpose: string;
  amount: number;
  /** Repayment or settlement expected by (optional). */
  dueDate: string | null;
  returned: number;
  expensed: number;
  writtenOff: number;
  status: 'open' | 'settled';
  movements: StaffFundMovement[];
  version: number;
  idempotencyKey: string;
  requestHash: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
}
const movementSchema = new Schema<StaffFundMovement>(
  {
    type: { type: String, enum: ['issue', 'return', 'expense', 'write_off'], required: true },
    date: { type: String, required: true },
    amount: { ...money, min: 1 },
    cashAccountId: optionalRef('CashAccount'),
    lines: {
      type: [
        new Schema(
          { accountId: ref('LedgerAccount'), amount: { ...money, min: 1 }, memo: { type: String, default: '', maxlength: 200 } },
          { _id: false },
        ),
      ],
      default: [],
    },
    memo: { type: String, default: '', maxlength: 300 },
    entryId: ref('JournalEntry'),
    by: ref('User'),
    at: { type: Date, required: true },
  },
  { _id: false },
);
const staffFundSchema = new Schema<StaffFund>(
  {
    organizationId: ref('Organization'),
    number: { type: String, required: true },
    kind: { type: String, enum: STAFF_FUND_KINDS, required: true },
    membershipId: ref('Membership'),
    branchId: optionalRef('Branch'),
    purpose: { type: String, required: true, minlength: 3, maxlength: 200 },
    amount: { ...money, min: 1 },
    dueDate: { type: String, default: null },
    returned: { ...money, default: 0 },
    expensed: { ...money, default: 0 },
    writtenOff: { ...money, default: 0 },
    status: { type: String, enum: ['open', 'settled'], required: true, default: 'open' },
    movements: { type: [movementSchema], default: [] },
    version: { type: Number, required: true, default: 0 },
    idempotencyKey: { type: String, required: true },
    requestHash: { type: String, required: true },
    createdBy: ref('User'),
  },
  { collection: 'acct_staff_funds', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
staffFundSchema.index({ organizationId: 1, number: 1 }, { unique: true });
staffFundSchema.index({ organizationId: 1, createdBy: 1, idempotencyKey: 1 }, { unique: true });
staffFundSchema.index({ organizationId: 1, status: 1, dueDate: 1 });
staffFundSchema.index({ organizationId: 1, membershipId: 1, createdAt: -1 });
staffFundSchema.plugin(tenantGuardPlugin);
staffFundSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne', 'findOneAndReplace'], blockUnlessSeedCleanup);

export const outstandingOf = (f: Pick<StaffFund, 'amount' | 'returned' | 'expensed' | 'writtenOff'>) =>
  f.amount - f.returned - f.expensed - f.writtenOff;

export const StaffFundModel = model<StaffFund>('StaffFund', staffFundSchema);
