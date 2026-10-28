import type { ClientSession, Types } from 'mongoose';
import { hasPermission } from '../../tenancy/permissions.js';
import type { TenantContext } from '../../tenancy/tenant-context.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { PractitionerModel } from '../practitioners/practitioner.model.js';

// The single place that decides clinical access (docs/architecture/CLINICAL.md):
//
//   clinical access = permission `clinical.encounter.own` (doctor role)
//                   + active doctor membership (read fresh, not from the session)
//                   + active practitioner profile on that membership
//                   + the record's practitioner is that profile, and its author is the caller
//                   + the record's branch is inside the caller's current branch scope.
//
// Administrative roles (owner/admin) never pass: a practitioner profile can only belong to a
// doctor membership. Same organization or specialty grants nothing.

export type ClinicalActor = {
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  membershipId: Types.ObjectId;
  practitionerId: Types.ObjectId;
  canAccessBranch: (branchId: Types.ObjectId) => boolean;
};

/**
 * Resolves the caller as a treating clinician, or null. With `lock` (inside a mutation's
 * transaction) the membership document is written (`accessSeq`), so a concurrent suspension or
 * scope change conflicts with the mutation and the retry decides on the new state.
 */
export async function resolveClinicalActor(
  tenant: TenantContext,
  options: { session?: ClientSession; lock?: boolean } = {},
): Promise<ClinicalActor | null> {
  if (!hasPermission(tenant.role, 'clinical.encounter.own')) return null;
  const filter = {
    organizationId: tenant.organizationId,
    _id: tenant.membershipId,
    status: 'active' as const,
    role: 'doctor' as const,
  };
  const membership = options.lock
    ? await MembershipModel.findOneAndUpdate(
        filter,
        { $inc: { accessSeq: 1 } },
        { session: options.session, returnDocument: 'after' },
      ).lean()
    : await MembershipModel.findOne(filter)
        .session(options.session ?? null)
        .lean();
  if (!membership) return null;
  const practitioner = await PractitionerModel.findOne({
    organizationId: tenant.organizationId,
    membershipId: membership._id,
    status: 'active',
  })
    .select('_id')
    .session(options.session ?? null)
    .lean();
  if (!practitioner) return null;
  const allBranches = membership.branchScope.type === 'all';
  const allowed = new Set(membership.branchScope.branchIds.map(String));
  return {
    organizationId: tenant.organizationId,
    userId: tenant.userId,
    membershipId: membership._id,
    practitionerId: practitioner._id,
    canAccessBranch: (branchId) => allBranches || allowed.has(String(branchId)),
  };
}

/** The treating relationship for an appointment or a clinical record. */
export function treats(
  actor: ClinicalActor,
  record: {
    practitionerId: Types.ObjectId;
    branchId: Types.ObjectId;
    authorUserId?: Types.ObjectId;
  },
): boolean {
  return (
    record.practitionerId.equals(actor.practitionerId) &&
    actor.canAccessBranch(record.branchId) &&
    (record.authorUserId === undefined || record.authorUserId.equals(actor.userId))
  );
}
