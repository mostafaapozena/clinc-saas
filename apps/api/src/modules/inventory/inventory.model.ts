import { Schema, model, type Query, type Types } from 'mongoose';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';
import { clock } from '../../time/clock.js';

// Inventory and medical consumables (docs/architecture/INVENTORY.md).
//
// - Quantities are integers in the item's base unit (piece, ml, g...). Purchase units convert by a
//   validated integer factor.
// - Valuation is a perpetual moving weighted average per item at organization level: the item holds
//   its total quantity and total value (integer minor units). An issue takes value × qty ÷ onHand,
//   and the last unit takes the remaining value exactly, so there is no rounding drift.
// - Stock never goes negative: balances change through conditional `$inc` inside a transaction that
//   first takes a write lock on the item.
// - Stock documents and their moves are never edited or deleted; a consumption is corrected by a
//   linked return document.

const currentTime = () => clock.now();
const ref = (name: string, required = true) => ({ type: Schema.Types.ObjectId, ref: name, required });
const int = (min = 0) => ({ type: Number, required: true, min, validate: { validator: Number.isSafeInteger, message: 'not_integer' } });
const blockedDeletes = ['deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne', 'findOneAndReplace'] as const;
function blockUnlessSeedCleanup(this: Query<unknown, unknown>) {
  if (this.getOptions().allowSeedCleanup !== true) throw new Error('Stock records cannot be deleted or replaced');
}

// ---------------------------------------------------------------------------------------------
export interface StockItem {
  organizationId: Types.ObjectId;
  code: string;
  name: string;
  category: string;
  baseUnit: string;
  purchaseUnits: { unit: string; factor: number }[];
  /** `lot`: every receipt names a lot and an expiry date; issues come from lots. */
  tracking: 'none' | 'lot';
  reorderLevel: number;
  status: 'active' | 'archived';
  onHand: number;
  stockValue: number;
  /** Bumped by every stock transaction: the write lock that serializes valuation changes. */
  lockSeq: number;
  version: number;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
const itemSchema = new Schema<StockItem>(
  {
    organizationId: ref('Organization'),
    code: { type: String, required: true, match: /^[A-Z0-9-]{1,20}$/ },
    name: { type: String, required: true, minlength: 2, maxlength: 120 },
    category: { type: String, default: '', maxlength: 60 },
    baseUnit: { type: String, required: true, minlength: 1, maxlength: 20 },
    purchaseUnits: {
      type: [new Schema({ unit: { type: String, required: true, maxlength: 20 }, factor: { ...int(2), max: 100_000 } }, { _id: false })],
      default: [],
    },
    tracking: { type: String, enum: ['none', 'lot'], required: true, default: 'none' },
    reorderLevel: { ...int(), default: 0 },
    status: { type: String, enum: ['active', 'archived'], required: true, default: 'active' },
    onHand: { ...int(), default: 0 },
    stockValue: { ...int(), default: 0 },
    lockSeq: { type: Number, required: true, default: 0 },
    version: { type: Number, required: true, default: 0 },
    createdBy: ref('User'),
  },
  { collection: 'inv_items', timestamps: { currentTime } },
);
itemSchema.index({ organizationId: 1, code: 1 }, { unique: true });
itemSchema.plugin(tenantGuardPlugin);

export interface Warehouse {
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  name: string;
  status: 'active' | 'archived';
  createdAt: Date;
}
const warehouseSchema = new Schema<Warehouse>(
  {
    organizationId: ref('Organization'),
    branchId: ref('Branch'),
    name: { type: String, required: true, minlength: 2, maxlength: 80 },
    status: { type: String, enum: ['active', 'archived'], required: true, default: 'active' },
  },
  { collection: 'inv_warehouses', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
warehouseSchema.index({ organizationId: 1, branchId: 1, name: 1 }, { unique: true });
warehouseSchema.plugin(tenantGuardPlugin);

/** Quantity of an item in a warehouse, per lot ('' when the item is not lot-tracked). */
export interface StockBalance {
  organizationId: Types.ObjectId;
  itemId: Types.ObjectId;
  warehouseId: Types.ObjectId;
  branchId: Types.ObjectId;
  lot: string;
  expiry: string | null;
  qty: number;
}
const balanceSchema = new Schema<StockBalance>(
  {
    organizationId: ref('Organization'),
    itemId: ref('StockItem'),
    warehouseId: ref('Warehouse'),
    branchId: ref('Branch'),
    lot: { type: String, default: '', maxlength: 40 },
    expiry: { type: String, default: null },
    qty: { ...int(), default: 0 },
  },
  { collection: 'inv_balances' },
);
balanceSchema.index({ organizationId: 1, itemId: 1, warehouseId: 1, lot: 1 }, { unique: true });
balanceSchema.index({ organizationId: 1, warehouseId: 1, expiry: 1 });
balanceSchema.plugin(tenantGuardPlugin);
balanceSchema.pre([...blockedDeletes], blockUnlessSeedCleanup);

// ---------------------------------------------------------------------------------------------
export const STOCK_DOCUMENT_TYPES = [
  'opening',
  'adjustment',
  'write_off',
  'issue',
  'transfer',
  'consumption',
  'consumption_return',
  'receipt',
  'purchase_return',
] as const;
export type StockDocumentType = (typeof STOCK_DOCUMENT_TYPES)[number];

export interface StockDocument {
  organizationId: Types.ObjectId;
  number: string;
  type: StockDocumentType;
  date: string;
  warehouseId: Types.ObjectId;
  toWarehouseId: Types.ObjectId | null;
  branchId: Types.ObjectId;
  reason: string;
  /** Consumption: the finalized record and, optionally, its procedure item (ids only, never text). */
  source: { encounterId: Types.ObjectId | null; recordItemId: string | null; documentId: Types.ObjectId | null };
  /** Unique while active, e.g. `consumption:<encounter>:<item>`; a return frees it. */
  sourceKey: string | null;
  totalValue: number;
  entryId: Types.ObjectId | null;
  reversalOf: Types.ObjectId | null;
  reversedBy: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  idempotencyKey: string;
  requestHash: string;
  createdAt: Date;
}
const documentSchema = new Schema<StockDocument>(
  {
    organizationId: ref('Organization'),
    number: { type: String, required: true },
    type: { type: String, enum: STOCK_DOCUMENT_TYPES, required: true },
    date: { type: String, required: true },
    warehouseId: ref('Warehouse'),
    toWarehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    branchId: ref('Branch'),
    reason: { type: String, default: '', maxlength: 300 },
    source: {
      type: new Schema(
        {
          encounterId: { type: Schema.Types.ObjectId, default: null },
          recordItemId: { type: String, default: null },
          documentId: { type: Schema.Types.ObjectId, default: null },
        },
        { _id: false },
      ),
      default: () => ({ encounterId: null, recordItemId: null, documentId: null }),
    },
    sourceKey: { type: String, default: null },
    totalValue: { ...int(), default: 0 },
    entryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
    reversalOf: { type: Schema.Types.ObjectId, ref: 'StockDocument', default: null },
    reversedBy: { type: Schema.Types.ObjectId, ref: 'StockDocument', default: null },
    createdBy: ref('User'),
    idempotencyKey: { type: String, required: true },
    requestHash: { type: String, required: true },
  },
  { collection: 'inv_documents', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
documentSchema.index({ organizationId: 1, number: 1 }, { unique: true });
documentSchema.index({ organizationId: 1, createdBy: 1, idempotencyKey: 1 }, { unique: true });
documentSchema.index({ organizationId: 1, sourceKey: 1 }, { unique: true, partialFilterExpression: { sourceKey: { $type: 'string' } } });
documentSchema.index({ organizationId: 1, 'source.encounterId': 1 }, { partialFilterExpression: { 'source.encounterId': { $type: 'objectId' } } });
documentSchema.index({ organizationId: 1, createdAt: -1 });
documentSchema.plugin(tenantGuardPlugin);
documentSchema.pre([...blockedDeletes], blockUnlessSeedCleanup);
// Only two changes are allowed after creation: linking the return, and freeing the source key.
documentSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function (this: Query<unknown, unknown>) {
  if (this.getOptions().allowSeedCleanup === true) return;
  const update = (this.getUpdate() ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const fields = Object.entries(update).flatMap(([op, v]) => (op.startsWith('$') ? Object.keys(v ?? {}) : [op]));
  if (fields.some((f) => f !== 'reversedBy' && f !== 'sourceKey' && f !== 'entryId')) throw new Error('Stock documents cannot be changed');
});

/** One line of a stock document: signed quantity (base units) and value of one item and lot. */
export interface StockMove {
  organizationId: Types.ObjectId;
  documentId: Types.ObjectId;
  type: StockDocumentType;
  date: string;
  itemId: Types.ObjectId;
  warehouseId: Types.ObjectId;
  branchId: Types.ObjectId;
  lot: string;
  expiry: string | null;
  qty: number;
  value: number;
  /** Item quantity and value after the move (the valuation trail). */
  onHandAfter: number;
  valueAfter: number;
  createdAt: Date;
}
const moveSchema = new Schema<StockMove>(
  {
    organizationId: ref('Organization'),
    documentId: ref('StockDocument'),
    type: { type: String, enum: STOCK_DOCUMENT_TYPES, required: true },
    date: { type: String, required: true },
    itemId: ref('StockItem'),
    warehouseId: ref('Warehouse'),
    branchId: ref('Branch'),
    lot: { type: String, default: '' },
    expiry: { type: String, default: null },
    qty: { type: Number, required: true, validate: { validator: (v: number) => Number.isSafeInteger(v) && v !== 0, message: 'invalid_qty' } },
    value: { type: Number, required: true, validate: { validator: Number.isSafeInteger, message: 'not_integer' } },
    onHandAfter: { type: Number, required: true },
    valueAfter: { type: Number, required: true },
  },
  { collection: 'inv_moves', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
moveSchema.index({ organizationId: 1, itemId: 1, createdAt: -1 });
moveSchema.index({ organizationId: 1, documentId: 1 });
moveSchema.index({ organizationId: 1, warehouseId: 1, createdAt: -1 });
moveSchema.plugin(tenantGuardPlugin);
moveSchema.pre([...blockedDeletes, 'updateOne', 'updateMany', 'findOneAndUpdate'], blockUnlessSeedCleanup);

export const StockItemModel = model<StockItem>('StockItem', itemSchema);
export const WarehouseModel = model<Warehouse>('Warehouse', warehouseSchema);
export const StockBalanceModel = model<StockBalance>('StockBalance', balanceSchema);
export const StockDocumentModel = model<StockDocument>('StockDocument', documentSchema);
export const StockMoveModel = model<StockMove>('StockMove', moveSchema);
