import { Types } from 'mongoose';
import { HttpError, validationError } from '../../http/errors.js';
import { isOrgWideRole, type Role } from '../../tenancy/permissions.js';
import type { TenantContext } from '../../tenancy/tenant-context.js';
import { BranchModel } from '../branches/branch.model.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { MembershipModel, type StoredBranchScope } from './membership.model.js';

export type MembershipSummary = {
  organization: { id: string; name: string };
  role: Role;
};

/**
 * The caller's own active memberships across organizations. This is the one deliberate
 * cross-tenant read: it is filtered by the authenticated user's id, never by client input.
 */
export async function listActiveMembershipsForUser(
  userId: Types.ObjectId,
): Promise<MembershipSummary[]> {
  const memberships = await MembershipModel.find({ userId, status: 'active' })
    .setOptions({ skipTenantGuard: true })
    .lean();
  const organizations = await OrganizationModel.find({
    _id: { $in: memberships.map((m) => m.organizationId) },
  }).lean();
  const names = new Map(organizations.map((org) => [String(org._id), org.name]));
  return memberships
    .filter((m) => names.has(String(m.organizationId)))
    .map((m) => ({
      organization: { id: String(m.organizationId), name: names.get(String(m.organizationId)) ?? '' },
      role: m.role,
    }))
    .sort((a, b) => a.organization.name.localeCompare(b.organization.name));
}

export type BranchScopeInput = { type: 'all' | 'selected'; branchIds: string[] | Types.ObjectId[] };

/**
 * Normalizes and validates a branch scope for a role. Owners and admins are always
 * organization-wide. Selected branches must all belong to the caller's organization;
 * foreign or unknown ids produce the same error, so nothing about other tenants leaks.
 */
export async function resolveBranchScope(
  tenant: TenantContext,
  role: Role,
  input: BranchScopeInput | undefined,
): Promise<StoredBranchScope> {
  if (isOrgWideRole(role) || !input || input.type === 'all') return { type: 'all', branchIds: [] };

  const ids = [...new Set(input.branchIds.map(String))].map((id) => new Types.ObjectId(id));
  if (ids.length === 0) throw validationError({ 'branchScope.branchIds': 'too_short' });

  const found = await BranchModel.countDocuments({
    organizationId: tenant.organizationId,
    _id: { $in: ids },
  });
  if (found !== ids.length) {
    throw new HttpError(400, 'INVALID_BRANCH', 'One or more branches are not available');
  }
  return { type: 'selected', branchIds: ids };
}

export function sameBranchScope(a: StoredBranchScope, b: StoredBranchScope): boolean {
  if (a.type !== b.type) return false;
  const left = a.branchIds.map(String).sort();
  const right = b.branchIds.map(String).sort();
  return left.length === right.length && left.every((id, i) => id === right[i]);
}
