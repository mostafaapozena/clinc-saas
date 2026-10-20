import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';

export const BRANCH_STATUSES = ['active', 'inactive'] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];

export interface Branch {
  organizationId: Types.ObjectId;
  name: string;
  city: string;
  status: BranchStatus;
  createdAt: Date;
  updatedAt: Date;
}

const branchSchema = new Schema<Branch>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    city: { type: String, trim: true, maxlength: 80, default: '' },
    status: { type: String, enum: BRANCH_STATUSES, required: true, default: 'active' },
  },
  { collection: 'branches', timestamps: true },
);
// Branch names are unique within an organization, ignoring case.
branchSchema.index(
  { organizationId: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);
branchSchema.plugin(tenantGuardPlugin);

export type BranchDocument = HydratedDocument<Branch>;
export const BranchModel = model<Branch>('Branch', branchSchema);

export type BranchDto = { id: string; name: string; city: string; status: BranchStatus; createdAt: string };

export function toBranchDto(branch: Branch & { _id: Types.ObjectId }): BranchDto {
  return {
    id: String(branch._id),
    name: branch.name,
    city: branch.city,
    status: branch.status,
    createdAt: branch.createdAt.toISOString(),
  };
}
