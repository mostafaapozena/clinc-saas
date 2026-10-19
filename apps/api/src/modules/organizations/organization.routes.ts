import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, authOf } from '../../auth/session.middleware.js';
import type { AppConfig } from '../../config/app-config.js';
import { notFound } from '../../http/errors.js';
import { branchNameSchema, citySchema, organizationNameSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { hasPermission, permissionsFor } from '../../tenancy/permissions.js';
import { accessibleBranchesFilter, orgScope } from '../../tenancy/scope.js';
import {
  requireMembership,
  requirePermission,
  tenantOf,
  type TenantContext,
} from '../../tenancy/tenant-context.js';
import { recordAudit } from '../audit/audit-event.model.js';
import { BranchModel, toBranchDto } from '../branches/branch.model.js';
import { branchesRouter } from '../branches/branch.routes.js';
import { createMembersRouter } from '../memberships/membership.routes.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { listActiveMembershipsForUser } from '../memberships/membership.service.js';
import { OrganizationModel, type Organization } from './organization.model.js';
import { createOrganizationWithOwner } from './organization.service.js';

const createOrganizationSchema = z.object({
  name: organizationNameSchema,
  branch: z.object({ name: branchNameSchema, city: citySchema.optional() }),
});
const updateOrganizationSchema = z.object({ name: organizationNameSchema });

function toOrganizationDto(org: Organization & { _id: unknown }) {
  return { id: String(org._id), name: org.name, createdAt: org.createdAt.toISOString() };
}

function membershipView(tenant: TenantContext) {
  return {
    id: String(tenant.membershipId),
    role: tenant.role,
    branchScope:
      tenant.branchScope.type === 'all'
        ? { type: 'all' as const, branchIds: [] }
        : { type: 'selected' as const, branchIds: tenant.branchScope.branchIds.map(String) },
    permissions: permissionsFor(tenant.role),
  };
}

export function createOrganizationsRouter(config: AppConfig) {
  const router = Router();
  router.use(requireAuth);

  // Organizations the caller belongs to (never anyone else's).
  router.get('/', async (req, res) => {
    res.json({ data: await listActiveMembershipsForUser(authOf(req).user._id) });
  });

  // Onboarding: any signed-in user may create an organization and becomes its owner.
  router.post('/', async (req, res) => {
    const { user } = authOf(req);
    const input = parseInput(createOrganizationSchema, req.body);
    const { organization, branch } = await createOrganizationWithOwner({
      userId: user._id,
      name: input.name,
      branch: input.branch,
    });
    res.status(201).json({
      organization: toOrganizationDto(organization),
      branch: toBranchDto(branch),
    });
  });

  router.use('/:orgId', requireMembership);

  router.get('/:orgId', requirePermission('organization.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const organization = await OrganizationModel.findById(tenant.organizationId).lean();
    if (!organization) throw notFound();
    const accessibleBranches = await BranchModel.countDocuments(
      accessibleBranchesFilter(tenant, { status: 'active' }),
    );
    // Team size is administrative information: only returned to roles that may read members.
    const activeMembers = hasPermission(tenant.role, 'member.read')
      ? await MembershipModel.countDocuments(orgScope(tenant, { status: 'active' }))
      : undefined;
    res.json({
      organization: toOrganizationDto(organization),
      membership: membershipView(tenant),
      stats: { accessibleBranches, ...(activeMembers === undefined ? {} : { activeMembers }) },
    });
  });

  router.patch('/:orgId', requirePermission('organization.update'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(updateOrganizationSchema, req.body);
    const organization = await OrganizationModel.findById(tenant.organizationId);
    if (!organization) throw notFound();
    const previousName = organization.name;
    organization.name = input.name;
    await organization.save();
    if (previousName !== input.name) {
      await recordAudit({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'organization.updated',
        target: { type: 'organization', id: tenant.organizationId },
        changes: { name: { from: previousName, to: input.name } },
      });
    }
    res.json({ organization: toOrganizationDto(organization) });
  });

  router.use('/:orgId/branches', branchesRouter);
  router.use('/:orgId/members', createMembersRouter(config));

  return router;
}
