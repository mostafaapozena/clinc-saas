import { assertEntitlement } from '../platform/subscription.service.js';
import { Router } from 'express';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { createRateLimiter } from '../../auth/rate-limit.js';
import type { AppConfig } from '../../config/app-config.js';
import { HttpError, conflict, forbidden, notFound } from '../../http/errors.js';
import { emailSchema, objectIdSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { CAPABILITIES, ROLES, capabilityAllowed, isOrgWideRole, type Role } from '../../tenancy/permissions.js';
import { orgScope } from '../../tenancy/scope.js';
import {
  parseObjectId,
  requirePermission,
  tenantOf,
  type TenantContext,
} from '../../tenancy/tenant-context.js';
import { UserModel } from '../../users/user.model.js';
import { recordAudit, type AuditAction } from '../audit/audit-event.model.js';
import { MembershipModel, MEMBERSHIP_STATUSES, type Membership } from './membership.model.js';
import { resolveBranchScope, sameBranchScope } from './membership.service.js';

const branchScopeSchema = z.object({
  type: z.enum(['all', 'selected']),
  branchIds: z.array(objectIdSchema).max(200).default([]),
});

const addMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(ROLES),
  branchScope: branchScopeSchema.optional(),
});

const updateMemberSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    status: z.enum(MEMBERSHIP_STATUSES).optional(),
    branchScope: branchScopeSchema.optional(),
    capabilities: z.array(z.enum(CAPABILITIES)).max(CAPABILITIES.length).optional(),
  })
  .refine(
    (v) => v.role !== undefined || v.status !== undefined || v.branchScope !== undefined || v.capabilities !== undefined,
    { message: 'empty_update' },
  );

const roleNotAssignable = () =>
  forbidden('ROLE_NOT_ASSIGNABLE', 'The owner role cannot be assigned through team management');

type MemberUser = { _id: Types.ObjectId; displayName: string; email: string };

function toMemberDto(
  membership: Membership & { _id: Types.ObjectId },
  user: MemberUser | null | undefined,
  tenant: TenantContext,
) {
  return {
    id: String(membership._id),
    user: user ? { id: String(user._id), displayName: user.displayName, email: user.email } : null,
    role: membership.role,
    status: membership.status,
    branchScope: {
      type: membership.branchScope.type,
      branchIds: membership.branchScope.branchIds.map(String),
    },
    capabilities: membership.capabilities ?? [],
    isSelf: membership.userId.equals(tenant.userId),
    createdAt: membership.createdAt.toISOString(),
  };
}

export function createMembersRouter(config: AppConfig) {
  const router = Router({ mergeParams: true });
  // Looking members up by email is rate limited to curb account enumeration.
  const addLimiter = createRateLimiter({
    ...config.authRateLimit,
    max: config.authRateLimit.max * 3,
  }, 'member-lookup');

  router.get('/', requirePermission('member.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const memberships = await MembershipModel.find(orgScope(tenant)).sort({ createdAt: 1 }).lean();
    const users = await UserModel.find({ _id: { $in: memberships.map((m) => m.userId) } })
      .select('displayName email')
      .lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    res.json({ data: memberships.map((m) => toMemberDto(m, byId.get(String(m.userId)), tenant)) });
  });

  router.post('/', requirePermission('member.add'), addLimiter, async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(addMemberSchema, req.body);
    if (input.role === 'owner') throw roleNotAssignable();
    await assertEntitlement(req, tenant, 'members');

    const user = await UserModel.findOne({ email: input.email }).select('displayName email');
    if (!user) {
      throw new HttpError(
        404,
        'USER_NOT_FOUND',
        'No account uses this email. Ask the person to register first.',
      );
    }
    if (await MembershipModel.exists(orgScope(tenant, { userId: user._id }))) {
      throw conflict('ALREADY_MEMBER', 'This person is already a member of the organization');
    }
    const branchScope = await resolveBranchScope(tenant, input.role, input.branchScope);
    const membership = await MembershipModel.create({
      organizationId: tenant.organizationId,
      userId: user._id,
      role: input.role,
      status: 'active',
      branchScope,
    });
    await recordAudit({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      action: 'member.added',
      target: { type: 'membership', id: membership._id },
      changes: { role: input.role, branchScope: branchScope.type, branchCount: branchScope.branchIds.length },
    });
    res.status(201).json({ member: toMemberDto(membership.toObject(), user, tenant) });
  });

  router.patch('/:membershipId', requirePermission('member.update'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(updateMemberSchema, req.body);
    const targetId = parseObjectId(req.params.membershipId);
    if (!targetId) throw notFound();
    const target = await MembershipModel.findOne(orgScope(tenant, { _id: targetId }));
    if (!target) throw notFound();

    // Rule order matters: each check below is a distinct, tested policy.
    if (input.role === 'owner') throw roleNotAssignable();
    if (target.role === 'owner' && tenant.role !== 'owner') {
      throw forbidden('OWNER_PROTECTED', 'Only owners can change an owner membership');
    }
    const nextRole: Role = input.role ?? target.role;
    const nextStatus = input.status ?? target.status;
    const removesActiveOwner =
      target.role === 'owner' &&
      target.status === 'active' &&
      (nextRole !== 'owner' || nextStatus !== 'active');
    if (removesActiveOwner) {
      const otherOwners = await MembershipModel.countDocuments(
        orgScope(tenant, { role: 'owner', status: 'active', _id: { $ne: target._id } }),
      );
      if (otherOwners === 0) {
        throw conflict('LAST_OWNER', 'An organization must keep at least one active owner');
      }
    }
    if (target.userId.equals(tenant.userId)) {
      throw forbidden('SELF_MODIFICATION', 'You cannot change your own membership');
    }

    const scopeInput =
      input.branchScope ?? (isOrgWideRole(nextRole) ? undefined : target.branchScope);
    const nextScope = await resolveBranchScope(tenant, nextRole, scopeInput);

    // Capabilities: owners only; each must fit the (new) role; the clinical-lead capability stays
    // unavailable until the owner decides who may hold it (blocker B1, CLINICAL_LEAD_GRANTS_ENABLED).
    const current = target.capabilities ?? [];
    if (input.capabilities !== undefined) {
      if (tenant.role !== 'owner') throw forbidden('CAPABILITY_OWNER_ONLY', 'Only owners can change capabilities');
      if (input.capabilities.includes('clinical_lead') && !current.includes('clinical_lead') && !config.clinicalLeadGrantsEnabled) {
        throw forbidden('CAPABILITY_NOT_ENABLED', 'This capability is not enabled for this platform');
      }
      const unfit = input.capabilities.filter((c) => !capabilityAllowed(c, nextRole));
      if (unfit.length > 0) throw conflict('CAPABILITY_NOT_ELIGIBLE', 'The role cannot hold this capability', { capabilities: unfit });
    }
    // A role change silently drops capabilities the new role may not hold.
    const nextCapabilities = [...new Set(input.capabilities ?? current)].filter((c) => capabilityAllowed(c, nextRole)).sort();

    const events: { action: AuditAction; changes: Record<string, unknown> }[] = [];
    if (nextRole !== target.role) {
      events.push({ action: 'member.role_changed', changes: { from: target.role, to: nextRole } });
    }
    if (nextStatus !== target.status) {
      events.push({
        action: nextStatus === 'suspended' ? 'member.suspended' : 'member.reactivated',
        changes: {},
      });
    }
    if (!sameBranchScope(nextScope, target.branchScope)) {
      events.push({
        action: 'member.branch_scope_changed',
        changes: { type: nextScope.type, branchCount: nextScope.branchIds.length },
      });
    }

    if (nextCapabilities.join(',') !== [...current].sort().join(',')) {
      events.push({
        action: 'member.capabilities_changed',
        changes: { from: [...current].sort(), to: nextCapabilities },
      });
    }

    target.role = nextRole;
    target.status = nextStatus;
    target.branchScope = nextScope;
    target.capabilities = nextCapabilities;
    await target.save();
    for (const event of events) {
      await recordAudit({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        target: { type: 'membership', id: target._id },
        ...event,
      });
    }
    const user = await UserModel.findById(target.userId).select('displayName email');
    res.json({ member: toMemberDto(target.toObject(), user, tenant) });
  });

  return router;
}
