import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { CAPABILITIES, ROLES, type Capability, type Role } from '../../tenancy/permissions.js';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';

export const MEMBERSHIP_STATUSES = ['active', 'suspended'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export type StoredBranchScope = { type: 'all' | 'selected'; branchIds: Types.ObjectId[] };

export interface Membership {
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  role: Role;
  status: MembershipStatus;
  /** "all" = every branch of the organization; "selected" = only branchIds. */
  branchScope: StoredBranchScope;
  /**
   * Incremented by every clinical mutation inside its transaction, so a concurrent change of this
   * membership (suspension, role or branch change) write-conflicts with it and the retry sees the
   * new state (docs/architecture/CLINICAL.md).
   */
  accessSeq: number;
  /** Explicit grants on top of the role (permissions.ts `CAPABILITIES`); none by default. */
  capabilities: Capability[];
  createdAt: Date;
  updatedAt: Date;
}

const branchScopeSchema = new Schema<StoredBranchScope>(
  {
    type: { type: String, enum: ['all', 'selected'], required: true, default: 'all' },
    branchIds: { type: [Schema.Types.ObjectId], ref: 'Branch', default: [] },
  },
  { _id: false },
);

const membershipSchema = new Schema<Membership>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROLES, required: true },
    status: { type: String, enum: MEMBERSHIP_STATUSES, required: true, default: 'active' },
    branchScope: {
      type: branchScopeSchema,
      required: true,
      default: () => ({ type: 'all', branchIds: [] }),
    },
    accessSeq: { type: Number, required: true, default: 0 },
    capabilities: { type: [{ type: String, enum: CAPABILITIES }], default: [] },
  },
  { collection: 'memberships', timestamps: true },
);
// One membership per user per organization.
membershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ userId: 1, status: 1 });
membershipSchema.plugin(tenantGuardPlugin);

export type MembershipDocument = HydratedDocument<Membership>;
export const MembershipModel = model<Membership>('Membership', membershipSchema);
