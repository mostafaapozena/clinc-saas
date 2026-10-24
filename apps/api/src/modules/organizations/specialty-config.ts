import type { ClientSession, Types } from 'mongoose';
import { HttpError, conflict, notFound } from '../../http/errors.js';
import { BranchModel } from '../branches/branch.model.js';
import { PractitionerModel } from '../practitioners/practitioner.model.js';
import { OrganizationModel, specialtiesOf, type Organization } from './organization.model.js';

// Consistency rules between organization, branch and practitioner specialties
// (docs/architecture/SPECIALTIES.md). They apply only once the organization has configured its
// specialties; before that (organizations created before phase 4) nothing is enforced, so
// existing workflows keep working until an owner completes the setup.

export type OrganizationLean = Organization & { _id: Types.ObjectId };

/**
 * Serializes specialty-configuration changes: increments configVersion inside the caller's
 * transaction, so two concurrent changes (e.g. removing a specialty from a branch while a
 * practitioner of that specialty is assigned to it) write-conflict and the retry sees the other's
 * result. Returns the organization as it was before the increment.
 */
export async function lockSpecialtyConfig(organizationId: Types.ObjectId, session: ClientSession): Promise<OrganizationLean> {
  const organization = await OrganizationModel.findOneAndUpdate(
    { _id: organizationId },
    { $inc: { configVersion: 1 } },
    { session, returnDocument: 'before' },
  ).lean();
  if (!organization) throw notFound();
  return organization;
}

export const specialtyNotEnabled = (field = 'specialtyCode') =>
  new HttpError(400, 'SPECIALTY_NOT_ENABLED', 'This specialty is not enabled for the organization', { [field]: 'not_enabled' });

/** A practitioner's specialty must be enabled for the organization and offered at each of their branches. */
export async function assertPractitionerFits(
  organization: OrganizationLean,
  specialtyCode: string,
  branchIds: Types.ObjectId[],
  session: ClientSession,
): Promise<void> {
  const enabled = specialtiesOf(organization);
  if (enabled.length === 0) return;
  if (!enabled.includes(specialtyCode)) throw specialtyNotEnabled();
  const branches = await BranchModel.find({ organizationId: organization._id, _id: { $in: branchIds } })
    .select('specialtyCodes')
    .session(session)
    .lean();
  const missing = branches.filter((b) => !(b.specialtyCodes ?? []).includes(specialtyCode)).map((b) => String(b._id));
  if (missing.length > 0) {
    throw conflict('SPECIALTY_NOT_OFFERED_AT_BRANCH', 'A selected branch does not offer this specialty', { branchIds: missing });
  }
}

/**
 * Practitioner profiles that a proposed configuration would leave inconsistent: their specialty
 * is not enabled, or a branch they work at would no longer offer it. Inactive profiles count too,
 * so reactivating one can never re-introduce an inconsistency.
 */
export async function practitionersOutsideConfig(
  organizationId: Types.ObjectId,
  enabled: string[],
  branchSpecialties: Map<string, string[]>,
  session: ClientSession,
) {
  const practitioners = await PractitionerModel.find({ organizationId })
    .select('displayName specialtyCode branchIds')
    .session(session)
    .lean();
  return practitioners.filter(
    (p) =>
      !enabled.includes(p.specialtyCode) ||
      p.branchIds.some((b) => {
        const offered = branchSpecialties.get(String(b));
        return offered !== undefined && !offered.includes(p.specialtyCode);
      }),
  );
}

export function specialtyInUse(practitioners: { _id: Types.ObjectId; displayName: string; specialtyCode: string }[]) {
  return conflict('SPECIALTY_IN_USE', 'Practitioners would work outside the enabled specialties; change or reassign them first', {
    practitioners: practitioners.map((p) => ({ id: String(p._id), displayName: p.displayName, specialtyCode: p.specialtyCode })),
  });
}

export function branchSpecialtiesInvalid(branchIds: string[]) {
  return new HttpError(400, 'BRANCH_SPECIALTIES_INVALID', "Each branch needs at least one of the organization's specialties", undefined, {
    branchIds,
  });
}

export const sameCodes = (a: string[], b: string[]) => a.length === b.length && a.every((code) => b.includes(code));
