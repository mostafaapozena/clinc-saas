import type { Types } from 'mongoose';
import type { TenantContext } from './tenant-context.js';

/** Adds the organization scope to a filter. The organization always comes from the membership. */
export function orgScope<const F extends object>(tenant: TenantContext, filter: F = {} as F) {
  return { ...filter, organizationId: tenant.organizationId };
}

/** Filter for branch documents the caller may see (organization + branch scope). */
export function accessibleBranchesFilter<const F extends object>(
  tenant: TenantContext,
  filter: F = {} as F,
) {
  return tenant.branchScope.type === 'all'
    ? orgScope(tenant, filter)
    : orgScope(tenant, { ...filter, _id: { $in: tenant.branchScope.branchIds } });
}

/** Filter for records owned by a branch (organizationId + branchId). For later branch-owned modules. */
export function branchOwnedFilter<const F extends object>(tenant: TenantContext, filter: F = {} as F) {
  return tenant.branchScope.type === 'all'
    ? orgScope(tenant, filter)
    : orgScope(tenant, { ...filter, branchId: { $in: tenant.branchScope.branchIds } });
}

export function canAccessBranch(tenant: TenantContext, branchId: Types.ObjectId): boolean {
  return (
    tenant.branchScope.type === 'all' ||
    tenant.branchScope.branchIds.some((id) => id.equals(branchId))
  );
}
