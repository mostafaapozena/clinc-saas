import type { Request, RequestHandler } from 'express';
import { Types } from 'mongoose';
import { forbidden, notFound, unauthenticated } from '../http/errors.js';
import { MembershipModel } from '../modules/memberships/membership.model.js';
import { hasPermission, isOrgWideRole, type Permission, type Role } from './permissions.js';

export type BranchScope = { type: 'all' } | { type: 'selected'; branchIds: Types.ObjectId[] };

export type TenantContext = {
  organizationId: Types.ObjectId;
  membershipId: Types.ObjectId;
  userId: Types.ObjectId;
  role: Role;
  branchScope: BranchScope;
};

export function parseObjectId(value: unknown): Types.ObjectId | null {
  return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value) ? new Types.ObjectId(value) : null;
}

/**
 * Resolves the caller's active membership in the organization named in the URL — fresh from
 * the database on every request, so suspensions and role changes apply immediately. Unknown
 * organizations and organizations the caller cannot access both produce the same 404.
 */
export const requireMembership: RequestHandler = async (req, _res, next) => {
  if (!req.auth) throw unauthenticated();
  const organizationId = parseObjectId(req.params.orgId);
  if (!organizationId) throw notFound();

  const membership = await MembershipModel.findOne({
    organizationId,
    userId: req.auth.user._id,
    status: 'active',
  });
  if (!membership) throw notFound();

  req.tenant = {
    organizationId,
    membershipId: membership._id,
    userId: membership.userId,
    role: membership.role,
    branchScope:
      isOrgWideRole(membership.role) || membership.branchScope.type === 'all'
        ? { type: 'all' }
        : { type: 'selected', branchIds: membership.branchScope.branchIds },
  };
  next();
};

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.tenant) throw notFound();
    if (!hasPermission(req.tenant.role, permission)) throw forbidden();
    next();
  };
}

export function tenantOf(req: Request): TenantContext {
  if (!req.tenant) throw notFound();
  return req.tenant;
}
