import { Schema, model, type Query, type Types } from 'mongoose';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';
import { clock } from '../../time/clock.js';
import { MAX_AMOUNT } from '../finance/finance.model.js';

// Suppliers, purchasing and payables (docs/architecture/PURCHASING.md).
//
// Request → approval → RFQ → supplier quotations → purchase order → receipts → supplier bills →
// payments, with returns and supplier credit notes. Quantities on order lines are in the line's unit
// (a purchase unit of the item, or the item's base unit) and prices are per that unit, in integer
// minor units — no fractions anywhere. Receiving, billing and paying are separate documents; a bill
// can only cover quantities already received and not yet billed (3-way match).

const currentTime = () => clock.now();
const ref = (name: string, required = true) => ({ type: Schema.Types.ObjectId, ref: name, required });
const optionalRef = (name: string) => ({ type: Schema.Types.ObjectId, ref: name, default: null });
const int = (min = 0, max = MAX_AMOUNT) => ({
  type: Number,
  required: true,
  min,
  max,
  validate: { validator: Number.isSafeInteger, message: 'not_integer' },
});
const keyed = { createdBy: ref('User'), idempotencyKey: { type: String, required: true }, requestHash: { type: String, required: true } };
const DELETES = ['deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne', 'findOneAndReplace'] as const;
function blockUnlessSeedCleanup(this: Query<unknown, unknown>) {
  if (this.getOptions().allowSeedCleanup !== true) throw new Error('Purchasing records cannot be deleted or replaced');
}
const guard = (schema: Schema) => {
  schema.plugin(tenantGuardPlugin);
  schema.pre([...DELETES], blockUnlessSeedCleanup);
};

// ---------------------------------------------------------------------------------------------
export interface PurchaseSettings {
  organizationId: Types.ObjectId;
  /** Requests (and direct bills) whose estimated total is at or above this need an approver. 0: always. */
  approvalThreshold: number;
  /** Segregation of duties, each optional for small clinics. */
  separation: { approve: boolean; receive: boolean; pay: boolean };
  version: number;
}
const settingsSchema = new Schema<PurchaseSettings>(
  {
    organizationId: ref('Organization'),
    approvalThreshold: { ...int(), default: 0 },
    separation: {
      type: new Schema(
        { approve: { type: Boolean, default: true }, receive: { type: Boolean, default: false }, pay: { type: Boolean, default: false } },
        { _id: false },
      ),
      default: () => ({ approve: true, receive: false, pay: false }),
    },
    version: { type: Number, required: true, default: 0 },
  },
  { collection: 'pur_settings' },
);
settingsSchema.index({ organizationId: 1 }, { unique: true });
settingsSchema.plugin(tenantGuardPlugin);

export interface Supplier {
  organizationId: Types.ObjectId;
  code: string;
  name: string;
  phone: string;
  email: string;
  paymentTermsDays: number;
  status: 'active' | 'archived';
  notes: string;
  version: number;
  createdAt: Date;
}
const supplierSchema = new Schema<Supplier>(
  {
    organizationId: ref('Organization'),
    code: { type: String, required: true, match: /^[A-Z0-9-]{1,20}$/ },
    name: { type: String, required: true, minlength: 2, maxlength: 120 },
    phone: { type: String, default: '', maxlength: 30 },
    email: { type: String, default: '', maxlength: 254 },
    paymentTermsDays: { ...int(0, 365), default: 30 },
    status: { type: String, enum: ['active', 'archived'], required: true, default: 'active' },
    notes: { type: String, default: '', maxlength: 500 },
    version: { type: Number, required: true, default: 0 },
  },
  { collection: 'pur_suppliers', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
supplierSchema.index({ organizationId: 1, code: 1 }, { unique: true });
supplierSchema.plugin(tenantGuardPlugin);

/** A line as requested, quoted or ordered: a stock item in one of its units, or a non-stock purchase. */
export interface PurchaseLine {
  itemId: Types.ObjectId | null;
  description: string;
  unit: string;
  /** Base units per `unit` (1 for the base unit and for non-stock lines). */
  factor: number;
  qty: number;
  unitPrice: number;
  /** Non-stock lines (services, non-stocked supplies) are expensed to this account when billed. */
  expenseAccountId: Types.ObjectId | null;
}
const lineFields = {
  itemId: optionalRef('StockItem'),
  description: { type: String, required: true, minlength: 2, maxlength: 160 },
  unit: { type: String, required: true, maxlength: 20 },
  factor: { ...int(1, 100_000), default: 1 },
  qty: int(1, 1_000_000),
  unitPrice: { ...int(), default: 0 },
  expenseAccountId: optionalRef('LedgerAccount'),
};

// ---------------------------------------------------------------------------------------------
export interface PurchaseRequest {
  organizationId: Types.ObjectId;
  number: string;
  branchId: Types.ObjectId;
  requestedBy: Types.ObjectId;
  reason: string;
  lines: PurchaseLine[];
  estimatedTotal: number;
  status: 'submitted' | 'approved' | 'rejected' | 'ordered' | 'cancelled';
  decision: { by: Types.ObjectId | null; at: Date; reason: string; automatic: boolean } | null;
  version: number;
  createdBy: Types.ObjectId;
  idempotencyKey: string;
  requestHash: string;
  createdAt: Date;
}
const requestSchema = new Schema<PurchaseRequest>(
  {
    organizationId: ref('Organization'),
    number: { type: String, required: true },
    branchId: ref('Branch'),
    requestedBy: ref('User'),
    reason: { type: String, default: '', maxlength: 300 },
    lines: { type: [new Schema(lineFields, { _id: false })], required: true },
    estimatedTotal: int(),
    status: { type: String, enum: ['submitted', 'approved', 'rejected', 'ordered', 'cancelled'], required: true },
    decision: {
      type: new Schema(
        {
          by: optionalRef('User'),
          at: { type: Date, required: true },
          reason: { type: String, default: '', maxlength: 300 },
          automatic: { type: Boolean, default: false },
        },
        { _id: false },
      ),
      default: null,
    },
    version: { type: Number, required: true, default: 0 },
    ...keyed,
  },
  { collection: 'pur_requests', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
requestSchema.index({ organizationId: 1, number: 1 }, { unique: true });
requestSchema.index({ organizationId: 1, createdBy: 1, idempotencyKey: 1 }, { unique: true });
requestSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
guard(requestSchema);

export interface Rfq {
  organizationId: Types.ObjectId;
  number: string;
  requestId: Types.ObjectId | null;
  branchId: Types.ObjectId;
  supplierIds: Types.ObjectId[];
  lines: PurchaseLine[];
  dueDate: string | null;
  status: 'open' | 'awarded' | 'closed';
  version: number;
  createdBy: Types.ObjectId;
  idempotencyKey: string;
  requestHash: string;
  createdAt: Date;
}
const rfqSchema = new Schema<Rfq>(
  {
    organizationId: ref('Organization'),
    number: { type: String, required: true },
    requestId: optionalRef('PurchaseRequest'),
    branchId: ref('Branch'),
    supplierIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Supplier' }], required: true },
    lines: { type: [new Schema(lineFields, { _id: false })], required: true },
    dueDate: { type: String, default: null },
    status: { type: String, enum: ['open', 'awarded', 'closed'], required: true, default: 'open' },
    version: { type: Number, required: true, default: 0 },
    ...keyed,
  },
  { collection: 'pur_rfqs', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
rfqSchema.index({ organizationId: 1, number: 1 }, { unique: true });
rfqSchema.index({ organizationId: 1, createdBy: 1, idempotencyKey: 1 }, { unique: true });
guard(rfqSchema);

export interface Quotation {
  organizationId: Types.ObjectId;
  rfqId: Types.ObjectId;
  supplierId: Types.ObjectId;
  reference: string;
  /** Per RFQ line: the supplier's price per the line's unit, quantity offered and lead time. */
  lines: { lineIndex: number; unitPrice: number; qty: number; leadTimeDays: number }[];
  validUntil: string | null;
  terms: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
}
const quotationSchema = new Schema<Quotation>(
  {
    organizationId: ref('Organization'),
    rfqId: ref('Rfq'),
    supplierId: ref('Supplier'),
    reference: { type: String, default: '', maxlength: 60 },
    lines: {
      type: [
        new Schema({ lineIndex: int(0, 99), unitPrice: int(), qty: int(0, 1_000_000), leadTimeDays: { ...int(0, 365), default: 0 } }, { _id: false }),
      ],
      required: true,
    },
    validUntil: { type: String, default: null },
    terms: { type: String, default: '', maxlength: 300 },
    createdBy: ref('User'),
  },
  { collection: 'pur_quotations', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
// One quotation per supplier per RFQ (a revised offer replaces it while the RFQ is open).
quotationSchema.index({ organizationId: 1, rfqId: 1, supplierId: 1 }, { unique: true });
quotationSchema.plugin(tenantGuardPlugin);

// ---------------------------------------------------------------------------------------------
export interface OrderLine extends PurchaseLine {
  received: number;
  billed: number;
  returned: number;
}
export interface PurchaseOrder {
  organizationId: Types.ObjectId;
  number: string;
  supplierId: Types.ObjectId;
  branchId: Types.ObjectId;
  warehouseId: Types.ObjectId | null;
  source: { requestId: Types.ObjectId | null; rfqId: Types.ObjectId | null; quotationId: Types.ObjectId | null };
  lines: OrderLine[];
  total: number;
  expectedDate: string | null;
  status: 'draft' | 'confirmed' | 'received' | 'closed' | 'cancelled';
  closeReason: string;
  version: number;
  createdBy: Types.ObjectId;
  idempotencyKey: string;
  requestHash: string;
  createdAt: Date;
}
const orderSchema = new Schema<PurchaseOrder>(
  {
    organizationId: ref('Organization'),
    number: { type: String, required: true },
    supplierId: ref('Supplier'),
    branchId: ref('Branch'),
    warehouseId: optionalRef('Warehouse'),
    source: {
      type: new Schema(
        { requestId: optionalRef('PurchaseRequest'), rfqId: optionalRef('Rfq'), quotationId: optionalRef('Quotation') },
        { _id: false },
      ),
      default: () => ({ requestId: null, rfqId: null, quotationId: null }),
    },
    lines: {
      type: [
        new Schema(
          {
            ...lineFields,
            received: { ...int(0, 1_000_000), default: 0 },
            billed: { ...int(0, 1_000_000), default: 0 },
            returned: { ...int(0, 1_000_000), default: 0 },
          },
          { _id: false },
        ),
      ],
      required: true,
    },
    total: int(),
    expectedDate: { type: String, default: null },
    status: { type: String, enum: ['draft', 'confirmed', 'received', 'closed', 'cancelled'], required: true, default: 'draft' },
    closeReason: { type: String, default: '', maxlength: 300 },
    version: { type: Number, required: true, default: 0 },
    ...keyed,
  },
  { collection: 'pur_orders', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
orderSchema.index({ organizationId: 1, number: 1 }, { unique: true });
orderSchema.index({ organizationId: 1, createdBy: 1, idempotencyKey: 1 }, { unique: true });
orderSchema.index({ organizationId: 1, supplierId: 1, createdAt: -1 });
guard(orderSchema);

export interface GoodsReceipt {
  organizationId: Types.ObjectId;
  number: string;
  orderId: Types.ObjectId;
  branchId: Types.ObjectId;
  kind: 'receipt' | 'return';
  lines: { lineIndex: number; qty: number; lot: string; expiry: string | null }[];
  stockDocumentId: Types.ObjectId | null;
  entryId: Types.ObjectId | null;
  note: string;
  createdBy: Types.ObjectId;
  idempotencyKey: string;
  requestHash: string;
  createdAt: Date;
}
const receiptSchema = new Schema<GoodsReceipt>(
  {
    organizationId: ref('Organization'),
    number: { type: String, required: true },
    orderId: ref('PurchaseOrder'),
    branchId: ref('Branch'),
    kind: { type: String, enum: ['receipt', 'return'], required: true },
    lines: {
      type: [
        new Schema(
          { lineIndex: int(0, 99), qty: int(1, 1_000_000), lot: { type: String, default: '' }, expiry: { type: String, default: null } },
          { _id: false },
        ),
      ],
      required: true,
    },
    stockDocumentId: optionalRef('StockDocument'),
    entryId: optionalRef('JournalEntry'),
    note: { type: String, default: '', maxlength: 300 },
    ...keyed,
  },
  { collection: 'pur_receipts', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
receiptSchema.index({ organizationId: 1, number: 1 }, { unique: true });
receiptSchema.index({ organizationId: 1, createdBy: 1, idempotencyKey: 1 }, { unique: true });
receiptSchema.index({ organizationId: 1, orderId: 1 });
guard(receiptSchema);
receiptSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], blockUnlessSeedCleanup);

export interface BillLine {
  orderLineIndex: number | null;
  description: string;
  qty: number;
  unitPrice: number;
  amount: number;
  expenseAccountId: Types.ObjectId | null;
  /** Credited quantity (supplier credit notes against this line). */
  credited: number;
}
export interface SupplierBill {
  organizationId: Types.ObjectId;
  number: string;
  supplierId: Types.ObjectId;
  supplierReference: string;
  orderId: Types.ObjectId | null;
  branchId: Types.ObjectId;
  billDate: string;
  dueDate: string;
  lines: BillLine[];
  total: number;
  paid: number;
  credited: number;
  status: 'awaiting_approval' | 'posted' | 'rejected';
  approval: { by: Types.ObjectId; at: Date } | null;
  entryId: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  idempotencyKey: string;
  requestHash: string;
  createdAt: Date;
}
const billSchema = new Schema<SupplierBill>(
  {
    organizationId: ref('Organization'),
    number: { type: String, required: true },
    supplierId: ref('Supplier'),
    supplierReference: { type: String, required: true, minlength: 1, maxlength: 60 },
    orderId: optionalRef('PurchaseOrder'),
    branchId: ref('Branch'),
    billDate: { type: String, required: true },
    dueDate: { type: String, required: true },
    lines: {
      type: [
        new Schema(
          {
            orderLineIndex: { type: Number, default: null },
            description: { type: String, required: true, maxlength: 160 },
            qty: int(1, 1_000_000),
            unitPrice: int(),
            amount: int(),
            expenseAccountId: optionalRef('LedgerAccount'),
            credited: { ...int(0, 1_000_000), default: 0 },
          },
          { _id: false },
        ),
      ],
      required: true,
    },
    total: int(),
    paid: { ...int(), default: 0 },
    credited: { ...int(), default: 0 },
    status: { type: String, enum: ['awaiting_approval', 'posted', 'rejected'], required: true },
    approval: { type: new Schema({ by: ref('User'), at: { type: Date, required: true } }, { _id: false }), default: null },
    entryId: optionalRef('JournalEntry'),
    ...keyed,
  },
  { collection: 'pur_bills', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
billSchema.index({ organizationId: 1, number: 1 }, { unique: true });
billSchema.index({ organizationId: 1, createdBy: 1, idempotencyKey: 1 }, { unique: true });
// The same supplier invoice cannot be recorded twice.
billSchema.index(
  { organizationId: 1, supplierId: 1, supplierReference: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['awaiting_approval', 'posted'] } } },
);
billSchema.index({ organizationId: 1, status: 1, dueDate: 1 });
guard(billSchema);

export interface SupplierPayment {
  organizationId: Types.ObjectId;
  number: string;
  supplierId: Types.ObjectId;
  cashAccountId: Types.ObjectId;
  date: string;
  amount: number;
  allocations: { billId: Types.ObjectId; amount: number }[];
  reference: string;
  entryId: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  idempotencyKey: string;
  requestHash: string;
  createdAt: Date;
}
const paymentSchema = new Schema<SupplierPayment>(
  {
    organizationId: ref('Organization'),
    number: { type: String, required: true },
    supplierId: ref('Supplier'),
    cashAccountId: ref('CashAccount'),
    date: { type: String, required: true },
    amount: int(1),
    allocations: { type: [new Schema({ billId: ref('SupplierBill'), amount: int(1) }, { _id: false })], required: true },
    reference: { type: String, default: '', maxlength: 60 },
    entryId: optionalRef('JournalEntry'),
    ...keyed,
  },
  { collection: 'pur_payments', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
paymentSchema.index({ organizationId: 1, number: 1 }, { unique: true });
paymentSchema.index({ organizationId: 1, createdBy: 1, idempotencyKey: 1 }, { unique: true });
guard(paymentSchema);
paymentSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], blockUnlessSeedCleanup);

export interface SupplierCredit {
  organizationId: Types.ObjectId;
  number: string;
  supplierId: Types.ObjectId;
  billId: Types.ObjectId;
  supplierReference: string;
  /** Per bill line: credited quantity (stock lines also leave stock: goods sent back). */
  lines: { billLineIndex: number; qty: number; lot: string }[];
  amount: number;
  reason: string;
  stockDocumentId: Types.ObjectId | null;
  entryId: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  idempotencyKey: string;
  requestHash: string;
  createdAt: Date;
}
const creditSchema = new Schema<SupplierCredit>(
  {
    organizationId: ref('Organization'),
    number: { type: String, required: true },
    supplierId: ref('Supplier'),
    billId: ref('SupplierBill'),
    supplierReference: { type: String, default: '', maxlength: 60 },
    lines: {
      type: [new Schema({ billLineIndex: int(0, 99), qty: int(1, 1_000_000), lot: { type: String, default: '' } }, { _id: false })],
      required: true,
    },
    amount: int(1),
    reason: { type: String, required: true, minlength: 3, maxlength: 300 },
    stockDocumentId: optionalRef('StockDocument'),
    entryId: optionalRef('JournalEntry'),
    ...keyed,
  },
  { collection: 'pur_credits', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
creditSchema.index({ organizationId: 1, number: 1 }, { unique: true });
creditSchema.index({ organizationId: 1, createdBy: 1, idempotencyKey: 1 }, { unique: true });
guard(creditSchema);
creditSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], blockUnlessSeedCleanup);

export const PurchaseSettingsModel = model<PurchaseSettings>('PurchaseSettings', settingsSchema);
export const SupplierModel = model<Supplier>('Supplier', supplierSchema);
export const PurchaseRequestModel = model<PurchaseRequest>('PurchaseRequest', requestSchema);
export const RfqModel = model<Rfq>('Rfq', rfqSchema);
export const QuotationModel = model<Quotation>('Quotation', quotationSchema);
export const PurchaseOrderModel = model<PurchaseOrder>('PurchaseOrder', orderSchema);
export const GoodsReceiptModel = model<GoodsReceipt>('GoodsReceipt', receiptSchema);
export const SupplierBillModel = model<SupplierBill>('SupplierBill', billSchema);
export const SupplierPaymentModel = model<SupplierPayment>('SupplierPayment', paymentSchema);
export const SupplierCreditModel = model<SupplierCredit>('SupplierCredit', creditSchema);
