import { runTransaction } from '../../db/transaction.js';
import { type ClientSession, type Types } from 'mongoose';
import { validationError } from '../../http/errors.js';
import { recordAudit } from '../audit/audit-event.model.js';
import { BranchModel } from '../branches/branch.model.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { assertCatalogSpecialties } from '../specialties/specialty.service.js';
import { OrganizationModel, type OrganizationType } from './organization.model.js';

function first<T>(items: T[]): T {
  const [item] = items;
  if (item === undefined) throw new Error('Expected a created document');
  return item;
}

export type NewOrganization = {
  userId: Types.ObjectId;
  name: string;
  timeZone: string;
  type?: OrganizationType | null;
  /** Omitted only by API clients that predate phase 4; the onboarding flow always sends them. */
  specialtyCodes?: string[];
  branch: { name: string; city?: string; specialtyCodes?: string[] };
};

/**
 * Checks the specialty part of a new organization: catalog codes only, and the first branch
 * offers a subset of the organization's specialties (all of them when not given).
 */
export async function resolveNewOrganizationSpecialties(input: NewOrganization) {
  const organization = input.specialtyCodes ?? [];
  const branch = input.branch.specialtyCodes ?? organization;
  if (organization.length === 0 && branch.length > 0) {
    throw validationError({ 'branch.specialtyCodes': 'requires_organization_specialties' });
  }
  await assertCatalogSpecialties(organization, 'specialtyCodes');
  if (branch.some((code) => !organization.includes(code))) {
    throw validationError({ 'branch.specialtyCodes': 'not_in_organization' });
  }
  return { organization, branch };
}

/** Writes organization, first branch, owner membership and audit event in the given transaction. */
export async function createOrganizationInSession(input: NewOrganization, session: ClientSession) {
  const specialties = await resolveNewOrganizationSpecialties(input);
  const organization = first(
    await OrganizationModel.create(
      [
        {
          name: input.name,
          timeZone: input.timeZone,
          type: input.type ?? null,
          specialtyCodes: specialties.organization,
          createdBy: input.userId,
        },
      ],
      { session },
    ),
  );
  const branch = first(
    await BranchModel.create(
      [
        {
          organizationId: organization._id,
          name: input.branch.name,
          city: input.branch.city ?? '',
          specialtyCodes: specialties.branch,
        },
      ],
      { session },
    ),
  );
  const membership = first(
    await MembershipModel.create(
      [
        {
          organizationId: organization._id,
          userId: input.userId,
          role: 'owner',
          status: 'active',
          branchScope: { type: 'all', branchIds: [] },
        },
      ],
      { session },
    ),
  );
  await recordAudit(
    {
      organizationId: organization._id,
      actorUserId: input.userId,
      action: 'organization.created',
      target: { type: 'organization', id: organization._id },
      changes: {
        initialBranchId: branch._id,
        timeZone: input.timeZone,
        type: input.type ?? null,
        specialtyCodes: specialties.organization,
      },
    },
    session,
  );
  return { organization, branch, membership };
}

/**
 * Creates an organization, its first branch and the creator's active owner membership in a
 * single MongoDB transaction: either all three exist afterwards, or none do. Transactions
 * need a replica set (the devcontainer and CI run a single-node one).
 */
export async function createOrganizationWithOwner(input: NewOrganization) {
  return runTransaction((session) => createOrganizationInSession(input, session));
}
