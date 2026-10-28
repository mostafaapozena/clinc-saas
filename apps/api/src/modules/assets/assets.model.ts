import { Schema, model, type Query, type Types } from 'mongoose';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';
import { clock } from '../../time/clock.js';
import { MAX_AMOUNT } from '../finance/finance.model.js';

// Equipment register and maintenance (docs/architecture/ASSETS.md). Depreciation is straight-line
// with the useful life and residual value the clinic's accountant enters per asset (milestone H4);
// no calibration certificates (E-13).

const currentTime = () => clock.now();
const ref = (name: string, required = true) => ({ type: Schema.Types.ObjectId, ref: name, required });
const optionalRef = (name: string) => ({ type: Schema.Types.ObjectId, ref: name, default: null });
const money = {
  type: Number,
  required: true,
  min: 0,
  max: MAX_AMOUNT,
  default: 0,
  validate: { validator: Number.isSafeInteger, message: 'not_integer' },
};
function blockUnlessSeedCleanup(this: Query<unknown, unknown>) {
  if (this.getOptions().allowSeedCleanup !== true) throw new Error('Asset records cannot be deleted or replaced');
}
const DELETES = ['deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne', 'findOneAndReplace'] as const;

export const ASSET_STATUSES = ['active', 'out_of_service', 'retired', 'disposed'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export interface Asset {
  organizationId: Types.ObjectId;
  code: string;
  name: string;
  category: string;
  serialNumber: string;
  branchId: Types.ObjectId;
  location: string;
  /** Team member responsible for the equipment (membership). */
  custodianId: Types.ObjectId | null;
  purchase: { date: string | null; cost: number; supplierId: Types.ObjectId | null; billId: Types.ObjectId | null };
  /** Ledger asset account the cost was capitalized to (through a supplier bill), if any. */
  ledgerAccountId: Types.ObjectId | null;
  maintenanceIntervalDays: number | null;
  nextMaintenanceDue: string | null;
  status: AssetStatus;
  disposal: { date: string; reason: string; entryId: Types.ObjectId | null } | null;
  depreciation: {
    method: 'straight_line';
    usefulLifeMonths: number;
    residualValue: number;
    /** First month depreciated (YYYY-MM). */
    startMonth: string;
    accumulated: number;
    lastMonth: string | null;
  } | null;
  version: number;
  createdBy: Types.ObjectId;
  createdAt: Date;
}
const assetSchema = new Schema<Asset>(
  {
    organizationId: ref('Organization'),
    code: { type: String, required: true, match: /^[A-Z0-9-]{1,20}$/ },
    name: { type: String, required: true, minlength: 2, maxlength: 120 },
    category: { type: String, default: '', maxlength: 60 },
    serialNumber: { type: String, default: '', maxlength: 60 },
    branchId: ref('Branch'),
    location: { type: String, default: '', maxlength: 80 },
    custodianId: optionalRef('Membership'),
    purchase: {
      type: new Schema(
        { date: { type: String, default: null }, cost: money, supplierId: optionalRef('Supplier'), billId: optionalRef('SupplierBill') },
        { _id: false },
      ),
      default: () => ({ date: null, cost: 0, supplierId: null, billId: null }),
    },
    ledgerAccountId: optionalRef('LedgerAccount'),
    maintenanceIntervalDays: { type: Number, default: null, min: 1, max: 3650 },
    nextMaintenanceDue: { type: String, default: null },
    status: { type: String, enum: ASSET_STATUSES, required: true, default: 'active' },
    disposal: {
      type: new Schema(
        { date: { type: String, required: true }, reason: { type: String, required: true, maxlength: 300 }, entryId: optionalRef('JournalEntry') },
        { _id: false },
      ),
      default: null,
    },
    depreciation: {
      type: new Schema(
        {
          method: { type: String, enum: ['straight_line'], required: true },
          usefulLifeMonths: { type: Number, required: true, min: 1, max: 600 },
          residualValue: money,
          startMonth: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
          accumulated: money,
          lastMonth: { type: String, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    version: { type: Number, required: true, default: 0 },
    createdBy: ref('User'),
  },
  { collection: 'ast_assets', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
assetSchema.index({ organizationId: 1, code: 1 }, { unique: true });
assetSchema.index({ organizationId: 1, branchId: 1, status: 1 });
assetSchema.index({ organizationId: 1, nextMaintenanceDue: 1 }, { partialFilterExpression: { nextMaintenanceDue: { $type: 'string' } } });
assetSchema.plugin(tenantGuardPlugin);
assetSchema.pre([...DELETES], blockUnlessSeedCleanup);

export interface MaintenanceRecord {
  organizationId: Types.ObjectId;
  assetId: Types.ObjectId;
  branchId: Types.ObjectId;
  date: string;
  kind: 'preventive' | 'corrective' | 'inspection';
  /** Work done (equipment, never patients). */
  description: string;
  performedBy: string;
  supplierId: Types.ObjectId | null;
  cost: number;
  /** Where the cost is recorded: a supplier bill or a cash voucher (not here, to avoid double costs). */
  billId: Types.ObjectId | null;
  voucherId: Types.ObjectId | null;
  outOfService: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
}
const maintenanceSchema = new Schema<MaintenanceRecord>(
  {
    organizationId: ref('Organization'),
    assetId: ref('Asset'),
    branchId: ref('Branch'),
    date: { type: String, required: true },
    kind: { type: String, enum: ['preventive', 'corrective', 'inspection'], required: true },
    description: { type: String, required: true, minlength: 3, maxlength: 500 },
    performedBy: { type: String, default: '', maxlength: 120 },
    supplierId: optionalRef('Supplier'),
    cost: money,
    billId: optionalRef('SupplierBill'),
    voucherId: optionalRef('CashVoucher'),
    outOfService: { type: Boolean, required: true, default: false },
    createdBy: ref('User'),
  },
  { collection: 'ast_maintenance', timestamps: { createdAt: true, updatedAt: false, currentTime } },
);
maintenanceSchema.index({ organizationId: 1, assetId: 1, date: -1 });
maintenanceSchema.plugin(tenantGuardPlugin);
maintenanceSchema.pre([...DELETES, 'updateOne', 'updateMany', 'findOneAndUpdate'], blockUnlessSeedCleanup);

export const AssetModel = model<Asset>('Asset', assetSchema);
export const MaintenanceRecordModel = model<MaintenanceRecord>('MaintenanceRecord', maintenanceSchema);
