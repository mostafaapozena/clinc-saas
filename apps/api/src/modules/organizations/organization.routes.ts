import { runTransaction } from '../../db/transaction.js';
import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { createRateLimiter } from '../../auth/rate-limit.js';
import { requireAuth, authOf } from '../../auth/session.middleware.js';
import type { AppConfig } from '../../config/app-config.js';
import { HttpError, conflict, notFound } from '../../http/errors.js';
import { branchNameSchema, citySchema, objectIdSchema, organizationNameSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { hasPermission, effectivePermissions } from '../../tenancy/permissions.js';
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
import { assertCatalogSpecialties, specialtyListSchema } from '../specialties/specialty.service.js';
import { createClinicalRouter } from '../clinical/clinical.routes.js';
import { createCoverageRouter } from '../clinical/coverage.routes.js';
import { createSpecialtyRouter } from '../clinical/specialty.routes.js';
import { createFinanceRouter } from '../finance/finance.routes.js';
import { createAccountingRouter } from '../accounting/accounting.routes.js';
import { createCashRouter } from '../accounting/cash.routes.js';
import { createInventoryRouter } from '../inventory/inventory.routes.js';
import { createPurchasingRouter } from '../purchasing/purchasing.routes.js';
import { createCompensationRouter } from '../compensation/compensation.routes.js';
import { createSubscriptionRouter } from '../platform/subscription.routes.js';
import { restrictedWriteGuard } from '../platform/subscription.lifecycle.js';
import type { Mailer } from '../mail/mailer.js';
import { createInvitationsRouter } from '../memberships/invitation.routes.js';
import { createSupportRouter } from '../support/support.routes.js';
import { ORGANIZATION_TYPES, OrganizationModel, specialtiesOf, type Organization } from './organization.model.js';
import { createOrganizationWithOwner } from './organization.service.js';
import {
  branchSpecialtiesInvalid,
  lockSpecialtyConfig,
  practitionersOutsideConfig,
  sameCodes,
  specialtyInUse,
} from './specialty-config.js';

export const timeZoneSchema = z.enum(SUPPORTED_TIME_ZONES);

const createOrganizationSchema = z.object({
  name: organizationNameSchema,
  // Chosen explicitly during onboarding (the form shows the default); never inferred from language.
  timeZone: timeZoneSchema,
  type: z.enum(ORGANIZATION_TYPES).optional(),
  specialtyCodes: specialtyListSchema.optional(),
  branch: z.object({ name: branchNameSchema, city: citySchema.optional(), specialtyCodes: specialtyListSchema.optional() }),
});
const updateOrganizationSchema = z
  .object({
    name: organizationNameSchema.optional(),
    timeZone: timeZoneSchema.optional(),
    type: z.enum(ORGANIZATION_TYPES).optional(),
  })
  .refine((v) => v.name !== undefined || v.timeZone !== undefined || v.type !== undefined, { message: 'empty_update' });

const specialtySetupSchema = z.object({
  specialtyCodes: specialtyListSchema,
  /** Branches not listed keep their current specialties (which must still fit). */
  branches: z
    .array(z.object({ branchId: objectIdSchema, specialtyCodes: specialtyListSchema }))
    .max(200)
    .default([])
    .refine((list) => new Set(list.map((b) => b.branchId)).size === list.length, 'duplicate_branch'),
  configVersion: z.number().int().min(0),
});

function toOrganizationDto(org: Organization & { _id: unknown }) {
  return {
    id: String(org._id),
    name: org.name,
    timeZone: org.timeZone ?? null,
    type: org.type ?? null,
    specialtyCodes: [...specialtiesOf(org)],
    configVersion: org.configVersion ?? 0,
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
    permissions: effectivePermissions(tenant.role, tenant.capabilities),
    capabilities: tenant.capabilities,
    practitionerId: practitionerId ? String(practitionerId) : null,
  };
}

export function createOrganizationsRouter(config: AppConfig, mailer: Mailer = { name: 'none', send: async () => {} }) {
  const router = Router();
  const setupLimiter = createRateLimiter(config.setupRateLimit, 'organization-create');
  router.use(requireAuth);

  // Organizations the caller belongs to (never anyone else's).
  router.get('/', async (req, res) => {
    res.json({ data: await listActiveMembershipsForUser(authOf(req).user._id) });
  });

  // Any signed-in user may create an organization and becomes its owner. The web app uses the
  // resumable onboarding flow (/api/v1/onboarding); this direct form remains for API clients.
  router.post('/', setupLimiter, async (req, res) => {
    const { user } = authOf(req);
    const input = parseInput(createOrganizationSchema, req.body);
    const { organization, branch } = await createOrganizationWithOwner({
      userId: user._id,
      name: input.name,
      timeZone: input.timeZone,
      type: input.type,
      specialtyCodes: input.specialtyCodes,
      branch: input.branch,
    });
    res.status(201).json({
      organization: toOrganizationDto(organization),
      branch: toBranchDto(branch),
    });
  });

  router.use('/:orgId', requireMembership);
  // Only with SUBSCRIPTION_ENFORCEMENT=on and a read_only billing policy (both off by default).
  router.use('/:orgId', restrictedWriteGuard);

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
    if (input.type !== undefined && input.type !== organization.type) {
      changes.type = { from: organization.type ?? null, to: input.type };
      organization.type = input.type;
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

  /**
   * Sets the organization's specialties and, in the same transaction, the branches' specialties.
   * Also the explicit setup for organizations created before phase 4. Nothing is inferred or
   * dropped: a configuration that would leave a branch without specialties, or a practitioner
   * outside them, is refused with the records to fix.
   */
  router.put('/:orgId/specialties', requirePermission('organization.update'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(specialtySetupSchema, req.body);
    await assertCatalogSpecialties(input.specialtyCodes, 'specialtyCodes');
    await assertCatalogSpecialties(input.branches.flatMap((b) => b.specialtyCodes), 'branches');

    const result = await runTransaction(async (session) => {
      const before = await lockSpecialtyConfig(tenant.organizationId, session);
      if ((before.configVersion ?? 0) !== input.configVersion) {
        throw conflict('VERSION_CONFLICT', 'The specialty setup was changed by someone else. Reload and try again.');
      }
      const branches = await BranchModel.find({ organizationId: tenant.organizationId }).session(session).lean();
      const current = new Map(branches.map((b) => [String(b._id), [...(b.specialtyCodes ?? [])]]));
      const next = new Map(current);
      for (const entry of input.branches) {
        if (!current.has(entry.branchId)) {
          throw new HttpError(400, 'INVALID_BRANCH', 'One or more branches are not available');
        }
        next.set(entry.branchId, entry.specialtyCodes);
      }
      const invalid = [...next]
        .filter(([, codes]) => codes.length === 0 || codes.some((code) => !input.specialtyCodes.includes(code)))
        .map(([id]) => id);
      if (invalid.length > 0) throw branchSpecialtiesInvalid(invalid);
      const outside = await practitionersOutsideConfig(tenant.organizationId, input.specialtyCodes, next, session);
      if (outside.length > 0) throw specialtyInUse(outside);

      const changed = [...next].filter(([id, codes]) => !sameCodes(codes, current.get(id) ?? []));
      for (const [id, codes] of changed) {
        await BranchModel.updateOne(
          { organizationId: tenant.organizationId, _id: new Types.ObjectId(id) },
          { $set: { specialtyCodes: codes } },
          { session },
        );
      }
      const saved = await OrganizationModel.findOneAndUpdate(
        { _id: tenant.organizationId },
        { $set: { specialtyCodes: input.specialtyCodes } },
        { session, returnDocument: 'after' },
      ).lean();
      if (!saved) throw notFound();
      await recordAudit(
        {
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          action: 'organization.specialties_updated',
          target: { type: 'organization', id: tenant.organizationId },
          changes: { from: specialtiesOf(before), to: input.specialtyCodes, branchesChanged: changed.length },
        },
        session,
      );
      const after = await BranchModel.find({ organizationId: tenant.organizationId }).sort({ name: 1 }).session(session).lean();
      return { saved, branches: after };
    });
    res.json({ organization: toOrganizationDto(result.saved), branches: result.branches.map(toBranchDto) });
  });

  // Clinical records first: they own /appointments/:id/encounter and /patients/:id/clinical-history.
  router.use('/:orgId', createCoverageRouter(config));
  router.use('/:orgId', createSpecialtyRouter());
  router.use('/:orgId', createFinanceRouter());
  router.use('/:orgId', createAccountingRouter());
  router.use('/:orgId', createCashRouter());
  router.use('/:orgId', createInventoryRouter());
  router.use('/:orgId', createPurchasingRouter());
  router.use('/:orgId', createCompensationRouter());
  router.use('/:orgId', createSubscriptionRouter(config));
  router.use('/:orgId', createClinicalRouter());
  router.use('/:orgId/branches', branchesRouter);
  router.use('/:orgId/members', createMembersRouter(config));
  router.use('/:orgId/invitations', createInvitationsRouter(config, mailer));
  router.use('/:orgId/support', createSupportRouter(config));
  router.use('/:orgId/patients', patientsRouter);
  router.use('/:orgId/practitioners', practitionersRouter);
  router.use('/:orgId/appointments', appointmentsRouter);
  router.use('/:orgId/queue', queueRouter);
  router.use('/:orgId/dashboard', dashboardRouter);

  return router;
}
