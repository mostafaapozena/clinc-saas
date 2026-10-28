import type { ClientSession, Types } from 'mongoose';
import { hasPermission, type Capability } from '../../tenancy/permissions.js';
import type { TenantContext } from '../../tenancy/tenant-context.js';
import { clock } from '../../time/clock.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { PractitionerModel } from '../practitioners/practitioner.model.js';
import { EncounterModel, type Encounter } from './clinical.model.js';
import { CoverageModel, type CoverageAccess } from './coverage.model.js';

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
//
// Coverage (milestone 1) is the only other way in: an active, explicit grant to this practitioner
// for records of another practitioner, for one patient or one encounter (activeCoverage below).

export type ClinicalActor = {
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  membershipId: Types.ObjectId;
  practitionerId: Types.ObjectId;
  /** Capabilities of the freshly read membership (not the ones cached on the request). */
  capabilities: Capability[];
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
    capabilities: membership.capabilities ?? [],
    canAccessBranch: (branchId) => allBranches || allowed.has(String(branchId)),
  };
}

type CoveredRecord = { _id: Types.ObjectId; practitionerId: Types.ObjectId; patientId: Types.ObjectId; branchId: Types.ObjectId };

/** Filter for coverage grants that match a record for this actor, active or not. */
function coverageMatch(actor: ClinicalActor, record: CoveredRecord) {
  return {
    organizationId: actor.organizationId,
    granteePractitionerId: actor.practitionerId,
    granteeUserId: actor.userId,
    sourcePractitionerId: record.practitionerId,
    $or: [
      { 'scope.type': 'patient' as const, 'scope.patientId': record.patientId },
      { 'scope.type': 'encounter' as const, 'scope.encounterId': record._id },
    ],
  };
}

/**
 * An active coverage grant giving this actor `need` access to a record written by someone else,
 * or null. The record's branch must still be in the actor's own scope. With `lock` (inside a
 * covered write's transaction) the grant is written (`useSeq`), so a concurrent revocation
 * conflicts with the write and the retry decides on the new state.
 */
export async function activeCoverage(
  actor: ClinicalActor,
  record: CoveredRecord,
  need: CoverageAccess,
  options: { session?: ClientSession; lock?: boolean } = {},
) {
  if (!actor.canAccessBranch(record.branchId)) return null;
  const now = clock.now();
  const filter = {
    ...coverageMatch(actor, record),
    revokedAt: null,
    startsAt: { $lte: now },
    expiresAt: { $gt: now },
    access: need === 'author' ? ('author' as const) : { $in: ['read', 'author'] as CoverageAccess[] },
  };
  return options.lock
    ? CoverageModel.findOneAndUpdate(filter, { $inc: { useSeq: 1 } }, { session: options.session, returnDocument: 'after' }).lean()
    : CoverageModel.findOne(filter)
        .session(options.session ?? null)
        .lean();
}

/** Why a matching grant no longer applies ("coverage_revoked" / "coverage_expired"), for the audit. */
export async function inactiveCoverageReason(actor: ClinicalActor, record: CoveredRecord): Promise<string | null> {
  const last = await CoverageModel.findOne(coverageMatch(actor, record)).sort({ createdAt: -1 }).lean();
  if (!last) return null;
  if (last.revokedAt) return 'coverage_revoked';
  const now = clock.now();
  if (last.expiresAt <= now) return 'coverage_expired';
  if (last.startsAt > now) return 'coverage_not_started';
  return 'coverage_out_of_scope';
}

export type RecordAccess = 'own' | CoverageAccess;

/** Own records first; otherwise what an active grant allows (read or author), or null. */
export async function recordAccess(
  actor: ClinicalActor,
  record: CoveredRecord & { authorUserId: Types.ObjectId },
  options: { session?: ClientSession } = {},
): Promise<{ access: RecordAccess; coverageId: Types.ObjectId | null } | null> {
  if (treats(actor, record)) return { access: 'own', coverageId: null };
  const grant = await activeCoverage(actor, record, 'read', options);
  return grant ? { access: grant.access, coverageId: grant._id } : null;
}

/**
 * Every record of one patient this actor may read: their own, plus those covered by an active
 * grant (patient-wide or per encounter), within the actor's current branch scope. The single
 * source for the history, the dental chart and the physiotherapy courses.
 */
export async function visibleEncountersForPatient(
  actor: ClinicalActor,
  patientId: Types.ObjectId,
  extra: Record<string, unknown> = {},
  options: { session?: ClientSession; limit?: number } = {},
) {
  const now = clock.now();
  const grants = await CoverageModel.find({
    organizationId: actor.organizationId,
    granteePractitionerId: actor.practitionerId,
    granteeUserId: actor.userId,
    'scope.patientId': patientId,
    revokedAt: null,
    startsAt: { $lte: now },
    expiresAt: { $gt: now },
  })
    .session(options.session ?? null)
    .lean();
  const covered = grants.map((g) =>
    g.scope.type === 'patient'
      ? { practitionerId: g.sourcePractitionerId }
      : { _id: g.scope.encounterId, practitionerId: g.sourcePractitionerId },
  );
  const own = { practitionerId: actor.practitionerId, authorUserId: actor.userId };
  const candidates = await EncounterModel.find({ organizationId: actor.organizationId, patientId, ...extra, $or: [own, ...covered] })
    .sort({ createdAt: -1 })
    .limit(options.limit ?? 200)
    .session(options.session ?? null)
    .lean<(Encounter & { _id: Types.ObjectId })[]>();
  return candidates.filter((e) => actor.canAccessBranch(e.branchId));
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
