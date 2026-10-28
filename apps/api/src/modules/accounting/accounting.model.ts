import { Schema, model, type Query, type Types } from 'mongoose';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';
import { clock } from '../../time/clock.js';
import { CURRENCY_CODES, MAX_AMOUNT, type Currency } from '../finance/finance.model.js';

// Clinic general ledger (docs/architecture/ACCOUNTING.md). One legal entity per organization;
// branches are cost centers. One currency per organization (the clinic-finance currency).
//
// - A journal entry is posted once and never edited or deleted. Corrections are linked reversal
//   entries; the only change an entry may receive is the link to its reversal.
// - Entries generated from business documents carry a unique source key, so posting the same
//   event twice is impossible (idempotent posting, enforced by a unique index).
// - Dates are the organization's local calendar dates (YYYY-MM-DD), never the browser's.
// - Months up to `lockedThrough` are closed: nothing can be posted into them (checked server-side).

const currentTime = () => clock.now();
const ref = (name: string, required = true) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required,
});
const money = {
  type: Number,
  required: true,
  min: 0,
  max: MAX_AMOUNT * 100,
  validate: { validator: Number.isSafeInteger, message: 'not_integer' },
};

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
/** Debit-normal account types; the others are credit-normal. */
export const DEBIT_NORMAL: readonly AccountType[] = ['asset', 'expense'];

/** Accounts the posting rules need; each points at a postable account of the organization's chart. */
export const MAPPING_KEYS = [
  'receivable',
  'patientAdvances',
  'serviceRevenue',
  'salesDiscounts',
  'salesReturns',
  'cash',
  'bank',
  'cashOverShort',
  'openingEquity',
  'payable',
  'grni',
  'inventory',
  'consumablesExpense',
  'inventoryAdjustments',
  'purchaseVariance',
  'practitionerFees',
  'practitionerPayable',
] as const;
export type MappingKey = (typeof MAPPING_KEYS)[number];

export const JOURNALS = ['sales', 'cash', 'bank', 'purchases', 'inventory', 'general', 'opening', 'compensation'] as const;
export type Journal = (typeof JOURNALS)[number];

// ---------------------------------------------------------------------------------------------
export interface AccountingSettings {
  organizationId: Types.ObjectId;
  currency: Currency;
  /** First local date the ledger covers; business events before it are summarized by opening entries. */
  cutoverDate: string;
  /** Last local date of the latest closed month, or null when no month is closed. */
  lockedThrough: string | null;
  template: string;
  mappings: Record<MappingKey, Types.ObjectId>;
  /** When true, cash receipts need an open cashier session of the receiving user at that branch. */
  requireCashSession: boolean;
  version: number;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
const mappingsSchema = new Schema(Object.fromEntries(MAPPING_KEYS.map((k) => [k, ref('LedgerAccount')])), { _id: false });
const settingsSchema = new Schema<AccountingSettings>(
  {
    organizationId: ref('Organization'),
    currency: { type: String, enum: CURRENCY_CODES, required: true },
    cutoverDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    lockedThrough: { type: String, default: null },
    template: { type: String, required: true },
    mappings: { type: mappingsSchema, required: true },
    requireCashSession: { type: Boolean, required: true, default: false },
    version: { type: Number, required: true, default: 0 },
    createdBy: ref('User'),
  },
  { collection: 'acct_settings', timestamps: { currentTime } },
);
settingsSchema.index({ organizationId: 1 }, { unique: true });
settingsSchema.plugin(tenantGuardPlugin);

// ---------------------------------------------------------------------------------------------
export interface LedgerAccount {
  organizationId: Types.ObjectId;
  code: string;
  /** Free name for accounts the clinic adds; template accounts are named by `templateKey`. */
  name: string;
  templateKey: string | null;
  type: AccountType;
  /** Group accounts only organize the chart; postings go to non-group accounts. */
  isGroup: boolean;
  parentId: Types.ObjectId | null;
  /** cash / bank accounts are managed through cash accounts (cashboxes, bank accounts). */
  role: 'cash' | 'bank' | null;
  status: 'active' | 'archived';
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
const accountSchema = new Schema<LedgerAccount>(
  {
    organizationId: ref('Organization'),
    code: { type: String, required: true, match: /^\d{3,8}$/ },
    name: { type: String, required: true, minlength: 2, maxlength: 120 },
    templateKey: { type: String, default: null },
    type: { type: String, enum: ACCOUNT_TYPES, required: true },
    isGroup: { type: Boolean, required: true, default: false },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: 'LedgerAccount',
      default: null,
    },
    role: { type: String, enum: ['cash', 'bank', null], default: null },
    status: {
      type: String,
      enum: ['active', 'archived'],
      required: true,
      default: 'active',
    },
    version: { type: Number, required: true, default: 0 },
  },
  { collection: 'acct_accounts', timestamps: { currentTime } },
);
accountSchema.index({ organizationId: 1, code: 1 }, { unique: true });
accountSchema.plugin(tenantGuardPlugin);

// ---------------------------------------------------------------------------------------------
export const PARTNER_TYPES = ['patient', 'supplier', 'practitioner', 'member'] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];
export interface EntryLine {
  accountId: Types.ObjectId;
  debit: number;
  credit: number;
  /** Cost center: the branch the amount belongs to (null = organization level). */
  branchId: Types.ObjectId | null;
  partner: { type: PartnerType; id: Types.ObjectId } | null;
  memo: string;
}
export interface JournalEntry {
  organizationId: Types.ObjectId;
  number: string;
  date: string;
  journal: Journal;
  memo: string;
  lines: EntryLine[];
  total: number;
  currency: Currency;
  source: { type: string; id: Types.ObjectId | null; event: string };
  /** `${type}:${id}:${event}` for document postings; unique per organization. */
  sourceKey: string;
  /** Cashier session the cash movement belongs to, if any. */
  cashSessionId: Types.ObjectId | null;
  reversalOf: Types.ObjectId | null;
  reversedBy: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
}
const lineSchema = new Schema<EntryLine>(
  {
    accountId: ref('LedgerAccount'),
    debit: money,
    credit: money,
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    partner: {
      type: new Schema(
        {
          type: { type: String, enum: PARTNER_TYPES, required: true },
          id: ref('Partner'),
        },
        { _id: false },
      ),
      default: null,
    },
    memo: { type: String, default: '', maxlength: 200 },
  },
  { _id: false },
);
const entrySchema = new Schema<JournalEntry>(
  {
    organizationId: ref('Organization'),
    number: { type: String, required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    journal: { type: String, enum: JOURNALS, required: true },
    memo: { type: String, default: '', maxlength: 200 },
    lines: { type: [lineSchema], required: true },
    total: money,
    currency: { type: String, enum: CURRENCY_CODES, required: true },
    source: {
      type: new Schema(
        {
          type: { type: String, required: true },
          id: { type: Schema.Types.ObjectId, default: null },
          event: { type: String, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    sourceKey: { type: String, required: true },
    cashSessionId: {
      type: Schema.Types.ObjectId,
      ref: 'CashSession',
      default: null,
    },
    reversalOf: {
      type: Schema.Types.ObjectId,
      ref: 'JournalEntry',
      default: null,
    },
    reversedBy: {
      type: Schema.Types.ObjectId,
      ref: 'JournalEntry',
      default: null,
    },
    createdBy: ref('User'),
  },
  {
    collection: 'acct_entries',
    timestamps: { createdAt: true, updatedAt: false, currentTime },
  },
);
entrySchema.index({ organizationId: 1, sourceKey: 1 }, { unique: true });
entrySchema.index({ organizationId: 1, number: 1 }, { unique: true });
entrySchema.index({ organizationId: 1, date: -1, number: -1 });
entrySchema.index({ organizationId: 1, 'lines.accountId': 1, date: 1 });
entrySchema.index({ organizationId: 1, cashSessionId: 1 }, { partialFilterExpression: { cashSessionId: { $type: 'objectId' } } });
entrySchema.plugin(tenantGuardPlugin);

// Posted history is never deleted or replaced; the only permitted update links a reversal once.
function blockUnlessSeedCleanup(this: Query<unknown, unknown>) {
  if (this.getOptions().allowSeedCleanup !== true) throw new Error('Journal entries cannot be deleted or replaced');
}
entrySchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne', 'findOneAndReplace'], blockUnlessSeedCleanup);
entrySchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function (this: Query<unknown, unknown>) {
  if (this.getOptions().allowSeedCleanup === true) return;
  const filter = this.getFilter() as { reversedBy?: unknown };
  const update = (this.getUpdate() ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const fields = Object.entries(update).flatMap(([op, v]) => (op.startsWith('$') ? Object.keys(v ?? {}) : [op]));
  if (filter.reversedBy !== null || fields.length !== 1 || fields[0] !== 'reversedBy') {
    throw new Error('Journal entries cannot be changed');
  }
});

// ---------------------------------------------------------------------------------------------
// Month closing history (the current state is AccountingSettings.lockedThrough).
export interface PeriodEvent {
  organizationId: Types.ObjectId;
  month: string;
  action: 'closed' | 'reopened';
  reason: string;
  by: Types.ObjectId;
  createdAt: Date;
}
const periodEventSchema = new Schema<PeriodEvent>(
  {
    organizationId: ref('Organization'),
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    action: { type: String, enum: ['closed', 'reopened'], required: true },
    reason: { type: String, default: '', maxlength: 300 },
    by: ref('User'),
  },
  {
    collection: 'acct_period_events',
    timestamps: { createdAt: true, updatedAt: false, currentTime },
  },
);
periodEventSchema.index({ organizationId: 1, createdAt: -1 });
periodEventSchema.plugin(tenantGuardPlugin);

// ---------------------------------------------------------------------------------------------
// Cashboxes and bank accounts: an operational face of a cash/bank ledger account.
export interface CashAccount {
  organizationId: Types.ObjectId;
  name: string;
  kind: 'cash' | 'bank';
  branchId: Types.ObjectId | null;
  accountId: Types.ObjectId;
  status: 'active' | 'archived';
  createdAt: Date;
}
const cashAccountSchema = new Schema<CashAccount>(
  {
    organizationId: ref('Organization'),
    name: { type: String, required: true, minlength: 2, maxlength: 80 },
    kind: { type: String, enum: ['cash', 'bank'], required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    accountId: ref('LedgerAccount'),
    status: {
      type: String,
      enum: ['active', 'archived'],
      required: true,
      default: 'active',
    },
  },
  {
    collection: 'acct_cash_accounts',
    timestamps: { createdAt: true, updatedAt: false, currentTime },
  },
);
cashAccountSchema.index({ organizationId: 1, accountId: 1 }, { unique: true });
cashAccountSchema.plugin(tenantGuardPlugin);

// Cashier sessions (shifts) on a cashbox: opening count, movements, closing count, difference.
export interface CashSession {
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  cashAccountId: Types.ObjectId;
  number: string;
  status: 'open' | 'closed';
  openedBy: Types.ObjectId;
  openedAt: Date;
  /** Ledger balance of the cashbox when the session opened, and what the cashier counted. */
  openingExpected: number;
  openingCounted: number;
  closedBy: Types.ObjectId | null;
  closedAt: Date | null;
  closingExpected: number | null;
  closingCounted: number | null;
  difference: number | null;
  note: string;
  createdAt: Date;
}
const sessionSchema = new Schema<CashSession>(
  {
    organizationId: ref('Organization'),
    branchId: ref('Branch'),
    cashAccountId: ref('CashAccount'),
    number: { type: String, required: true },
    status: {
      type: String,
      enum: ['open', 'closed'],
      required: true,
      default: 'open',
    },
    openedBy: ref('User'),
    openedAt: { type: Date, required: true },
    openingExpected: { type: Number, required: true },
    openingCounted: money,
    closedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    closedAt: { type: Date, default: null },
    closingExpected: { type: Number, default: null },
    closingCounted: { type: Number, default: null },
    difference: { type: Number, default: null },
    note: { type: String, default: '', maxlength: 300 },
  },
  {
    collection: 'acct_cash_sessions',
    timestamps: { createdAt: true, updatedAt: false, currentTime },
  },
);
// One open session per cashbox.
sessionSchema.index({ organizationId: 1, cashAccountId: 1 }, { unique: true, partialFilterExpression: { status: 'open' } });
sessionSchema.index({ organizationId: 1, openedAt: -1 });
sessionSchema.index({ organizationId: 1, number: 1 }, { unique: true });
sessionSchema.plugin(tenantGuardPlugin);
sessionSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne', 'findOneAndReplace'], blockUnlessSeedCleanup);

// Cash vouchers: money in or out of a cash/bank account that is not a patient receipt
// (petty expenses, other income, owner deposits) and transfers between cash/bank accounts.
export interface CashVoucher {
  organizationId: Types.ObjectId;
  number: string;
  type: 'in' | 'out' | 'transfer';
  date: string;
  cashAccountId: Types.ObjectId;
  /** Transfers: the receiving cash/bank account. */
  toCashAccountId: Types.ObjectId | null;
  /** In/out: the ledger account on the other side (income, expense, equity, ...). */
  counterAccountId: Types.ObjectId | null;
  branchId: Types.ObjectId | null;
  amount: number;
  reference: string;
  memo: string;
  entryId: Types.ObjectId;
  createdBy: Types.ObjectId;
  idempotencyKey: string;
  requestHash: string;
  createdAt: Date;
}
const voucherSchema = new Schema<CashVoucher>(
  {
    organizationId: ref('Organization'),
    number: { type: String, required: true },
    type: { type: String, enum: ['in', 'out', 'transfer'], required: true },
    date: { type: String, required: true },
    cashAccountId: ref('CashAccount'),
    toCashAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'CashAccount',
      default: null,
    },
    counterAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'LedgerAccount',
      default: null,
    },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    amount: { ...money, min: 1 },
    reference: { type: String, default: '', maxlength: 60 },
    memo: { type: String, default: '', maxlength: 200 },
    entryId: ref('JournalEntry'),
    createdBy: ref('User'),
    idempotencyKey: { type: String, required: true },
    requestHash: { type: String, required: true },
  },
  {
    collection: 'acct_cash_vouchers',
    timestamps: { createdAt: true, updatedAt: false, currentTime },
  },
);
voucherSchema.index({ organizationId: 1, number: 1 }, { unique: true });
voucherSchema.index({ organizationId: 1, createdBy: 1, idempotencyKey: 1 }, { unique: true });
voucherSchema.plugin(tenantGuardPlugin);
voucherSchema.pre(
  ['deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne', 'findOneAndReplace', 'updateOne', 'updateMany', 'findOneAndUpdate'],
  blockUnlessSeedCleanup,
);

// Bank statement lines entered or imported by the clinic, matched to ledger lines of a bank account.
export interface BankStatementLine {
  organizationId: Types.ObjectId;
  cashAccountId: Types.ObjectId;
  date: string;
  /** Positive: money into the account; negative: money out. */
  amount: number;
  description: string;
  reference: string;
  status: 'unmatched' | 'matched';
  match: { entryId: Types.ObjectId; at: Date; by: Types.ObjectId } | null;
  importBatch: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
}
const bankLineSchema = new Schema<BankStatementLine>(
  {
    organizationId: ref('Organization'),
    cashAccountId: ref('CashAccount'),
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    amount: {
      type: Number,
      required: true,
      validate: { validator: Number.isSafeInteger, message: 'not_integer' },
    },
    description: { type: String, default: '', maxlength: 140 },
    reference: { type: String, default: '', maxlength: 60 },
    status: {
      type: String,
      enum: ['unmatched', 'matched'],
      required: true,
      default: 'unmatched',
    },
    match: {
      type: new Schema(
        {
          entryId: ref('JournalEntry'),
          at: { type: Date, required: true },
          by: ref('User'),
        },
        { _id: false },
      ),
      default: null,
    },
    importBatch: { type: String, required: true },
    createdBy: ref('User'),
  },
  {
    collection: 'acct_bank_lines',
    timestamps: { createdAt: true, updatedAt: false, currentTime },
  },
);
bankLineSchema.index({ organizationId: 1, cashAccountId: 1, date: 1 });
// An entry is matched to at most one statement line.
bankLineSchema.index(
  { organizationId: 1, 'match.entryId': 1 },
  {
    unique: true,
    partialFilterExpression: { 'match.entryId': { $type: 'objectId' } },
  },
);
bankLineSchema.plugin(tenantGuardPlugin);

export const AccountingSettingsModel = model<AccountingSettings>('AccountingSettings', settingsSchema);
export const LedgerAccountModel = model<LedgerAccount>('LedgerAccount', accountSchema);
export const JournalEntryModel = model<JournalEntry>('JournalEntry', entrySchema);
export const PeriodEventModel = model<PeriodEvent>('PeriodEvent', periodEventSchema);
export const CashAccountModel = model<CashAccount>('CashAccount', cashAccountSchema);
export const CashSessionModel = model<CashSession>('CashSession', sessionSchema);
export const CashVoucherModel = model<CashVoucher>('CashVoucher', voucherSchema);
export const BankStatementLineModel = model<BankStatementLine>('BankStatementLine', bankLineSchema);
