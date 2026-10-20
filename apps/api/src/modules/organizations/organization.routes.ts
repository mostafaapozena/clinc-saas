import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, authOf } from '../../auth/session.middleware.js';
import type { AppConfig } from '../../config/app-config.js';
import { conflict, notFound } from '../../http/errors.js';
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
import { SUPPORTED_TIME_ZONES } from '../../time/local-time.js';
import { appointmentsRouter } from '../appointments/appointment.routes.js';
import { dashboardRouter, queueRouter } from '../appointments/front-desk.routes.js';
import { recordAudit } from '../audit/audit-event.model.js';
import { BranchModel, toBranchDto } from '../branches/branch.model.js';
import { branchesRouter } from '../branches/branch.routes.js';
import { createMembersRouter } from '../memberships/membership.routes.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { listActiveMembershipsForUser } from '../memberships/membership.service.js';
import { patientsRouter } from '../patients/patient.routes.js';
import { practitionersRouter } from '../practitioners/practitioner.routes.js';
import { futureActiveAppointments } from '../scheduling/schedule.service.js';
import { ownPractitionerId } from '../scheduling/scheduling-context.js';
import { OrganizationModel, type Organization } from './organization.model.js';
import { createOrganizationWithOwner } from './organization.service.js';

const timeZoneSchema = z.enum(SUPPORTED_TIME_ZONES);

const createOrganizationSchema = z.object({
  name: organizationNameSchema,
  // Chosen explicitly during onboarding (the form shows the default); never inferred from language.
  timeZone: timeZoneSchema,
  branch: z.object({ name: branchNameSchema, city: citySchema.optional() }),
});
const updateOrganizationSchema = z
  .object({ name: organizationNameSchema.optional(), timeZone: timeZoneSchema.optional() })
  .refine((v) => v.name !== undefined || v.timeZone !== undefined, { message: 'empty_update' });

function toOrganizationDto(org: Organization & { _id: unknown }) {
  return {
    id: String(org._id),
    name: org.name,
    timeZone: org.timeZone ?? null,
    createdAt: org.createdAt.toISOString(),
  };
}

async function membershipView(tenant: TenantContext) {
  const practitionerId = await ownPractitionerId(tenant);
  return {
    id: String(tenant.membershipId),
    role: tenant.role,
    branchScope:
      tenant.branchScope.type === 'all'
        ? { type: 'all' as const, branchIds: [] }
        : { type: 'selected' as const, branchIds: tenant.branchScope.branchIds.map(String) },
    permissions: permissionsFor(tenant.role),
    practitionerId: practitionerId ? String(practitionerId) : null,
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
      timeZone: input.timeZone,
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
      membership: await membershipView(tenant),
      stats: { accessibleBranches, ...(activeMembers === undefined ? {} : { activeMembers }) },
    });
  });

  router.patch('/:orgId', requirePermission('organization.update'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(updateOrganizationSchema, req.body);
    const organization = await OrganizationModel.findById(tenant.organizationId);
    if (!organization) throw notFound();
    const changes: Record<string, { from: string | null; to: string }> = {};
    if (input.timeZone !== undefined && input.timeZone !== organization.timeZone) {
      // Existing bookings were made in the old zone; a safe migration is a later feature.
      if (organization.timeZone) {
        const future = await futureActiveAppointments(tenant.organizationId, {});
        if (future.length > 0) {
          throw conflict('TIME_ZONE_LOCKED', 'The time zone cannot change while future appointments exist', {
            futureAppointments: future.length,
          });
        }
      }
      changes.timeZone = { from: organization.timeZone, to: input.timeZone };
      organization.timeZone = input.timeZone;
    }
    if (input.name !== undefined && input.name !== organization.name) {
      changes.name = { from: organization.name, to: input.name };
      organization.name = input.name;
    }
    await organization.save();
    if (Object.keys(changes).length > 0) {
      await recordAudit({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'organization.updated',
        target: { type: 'organization', id: tenant.organizationId },
        changes,
      });
    }
    res.json({ organization: toOrganizationDto(organization) });
  });

  router.use('/:orgId/branches', branchesRouter);
  router.use('/:orgId/members', createMembersRouter(config));
  router.use('/:orgId/patients', patientsRouter);
  router.use('/:orgId/practitioners', practitionersRouter);
  router.use('/:orgId/appointments', appointmentsRouter);
  router.use('/:orgId/queue', queueRouter);
  router.use('/:orgId/dashboard', dashboardRouter);

  return router;
}
