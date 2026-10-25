import { runTransaction } from '../../db/transaction.js';
import { assertEntitlement } from '../platform/subscription.service.js';
import { Router } from 'express';
import { type Types } from 'mongoose';
import { z } from 'zod';
import { conflict, isDuplicateKeyError, notFound, validationError } from '../../http/errors.js';
import { branchNameSchema, citySchema, escapeRegex } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { accessibleBranchesFilter, canAccessBranch, orgScope } from '../../tenancy/scope.js';
import { parseObjectId, requirePermission, tenantOf } from '../../tenancy/tenant-context.js';
import { recordAudit } from '../audit/audit-event.model.js';
import { specialtiesOf } from '../organizations/organization.model.js';
import {
  lockSpecialtyConfig,
  practitionersOutsideConfig,
  sameCodes,
  specialtyInUse,
  type OrganizationLean,
} from '../organizations/specialty-config.js';
import { specialtyListSchema } from '../specialties/specialty.service.js';
import { BRANCH_STATUSES, BranchModel, toBranchDto } from './branch.model.js';

const listQuerySchema = z.object({ q: z.string().trim().max(80).optional() });
const createBranchSchema = z.object({
  name: branchNameSchema,
  city: citySchema.optional(),
  specialtyCodes: specialtyListSchema.optional(),
});
const updateBranchSchema = z
  .object({
    name: branchNameSchema.optional(),
    city: citySchema.optional(),
    status: z.enum(BRANCH_STATUSES).optional(),
    specialtyCodes: specialtyListSchema.optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.city !== undefined || v.status !== undefined || v.specialtyCodes !== undefined,
    { message: 'empty_update' },
  );

const branchNameTaken = () => conflict('BRANCH_NAME_TAKEN', 'A branch with this name already exists');

/**
 * A branch's specialties: required (and a subset of the organization's) once the organization
 * has configured specialties; not accepted before that, so the setup happens in one place.
 */
function checkBranchSpecialties(organization: OrganizationLean, codes: string[] | undefined, required: boolean) {
  const enabled = specialtiesOf(organization);
  if (enabled.length === 0) {
    if (codes !== undefined) {
      throw conflict('SPECIALTIES_NOT_CONFIGURED', "Choose the organization's specialties in settings first");
    }
    return;
  }
  if (codes === undefined) {
    if (required) throw validationError({ specialtyCodes: 'required' });
    return;
  }
  if (codes.some((code) => !enabled.includes(code))) throw validationError({ specialtyCodes: 'not_in_organization' });
}

export const branchesRouter = Router({ mergeParams: true });

// List and search are both limited to the branches the caller may access.
branchesRouter.get('/', requirePermission('branch.read'), async (req, res) => {
  const tenant = tenantOf(req);
  const { q } = parseInput(listQuerySchema, req.query);
  const nameFilter = q ? { name: { $regex: escapeRegex(q), $options: 'i' } } : {};
  const branches = await BranchModel.find(accessibleBranchesFilter(tenant, nameFilter))
    .sort({ name: 1 })
    .lean();
  res.json({ data: branches.map(toBranchDto) });
});

branchesRouter.get('/:branchId', requirePermission('branch.read'), async (req, res) => {
  const tenant = tenantOf(req);
  const branchId = parseObjectId(req.params.branchId);
  if (!branchId || !canAccessBranch(tenant, branchId)) throw notFound();
  const branch = await BranchModel.findOne(orgScope(tenant, { _id: branchId })).lean();
  if (!branch) throw notFound();
  res.json({ branch: toBranchDto(branch) });
});

branchesRouter.post('/', requirePermission('branch.create'), async (req, res) => {
  const tenant = tenantOf(req);
  const input = parseInput(createBranchSchema, req.body);
  await assertEntitlement(req, tenant, 'branches');
  try {
    const branch = await runTransaction(async (session) => {
      const organization = await lockSpecialtyConfig(tenant.organizationId, session);
      checkBranchSpecialties(organization, input.specialtyCodes, true);
      const [created] = await BranchModel.create(
        [
          {
            organizationId: tenant.organizationId,
            name: input.name,
            city: input.city ?? '',
            specialtyCodes: input.specialtyCodes ?? [],
          },
        ],
        { session },
      );
      if (!created) throw new Error('Expected a created branch');
      await recordAudit(
        {
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          action: 'branch.created',
          target: { type: 'branch', id: created._id },
          changes: { name: created.name, specialtyCodes: created.specialtyCodes },
        },
        session,
      );
      return created;
    });
    res.status(201).json({ branch: toBranchDto(branch) });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw branchNameTaken();
    throw err;
  }
});

branchesRouter.patch('/:branchId', requirePermission('branch.update'), async (req, res) => {
  const tenant = tenantOf(req);
  const input = parseInput(updateBranchSchema, req.body);
  const branchId = parseObjectId(req.params.branchId);
  if (!branchId || !canAccessBranch(tenant, branchId)) throw notFound();

  try {
    const saved = await runTransaction(async (session) => {
      const organization = await lockSpecialtyConfig(tenant.organizationId, session);
      const branch = await BranchModel.findOne(orgScope(tenant, { _id: branchId })).session(session);
      if (!branch) throw notFound();
      checkBranchSpecialties(organization, input.specialtyCodes, false);

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of ['name', 'city', 'status'] as const) {
        const next = input[key];
        if (next !== undefined && next !== branch[key]) changes[key] = { from: branch[key], to: next };
      }
      if (input.specialtyCodes !== undefined && !sameCodes(input.specialtyCodes, branch.specialtyCodes ?? [])) {
        // Practitioners assigned here must keep their specialty offered at this branch.
        const offered = new Map([[String(branch._id), input.specialtyCodes]]);
        const outside = await practitionersOutsideConfig(tenant.organizationId, specialtiesOf(organization), offered, session);
        const here = outside.filter((p) => p.branchIds.some((b: Types.ObjectId) => b.equals(branch._id)));
        if (here.length > 0) throw specialtyInUse(here);
        changes.specialtyCodes = { from: [...(branch.specialtyCodes ?? [])], to: input.specialtyCodes };
        branch.specialtyCodes = input.specialtyCodes;
      }
      if (input.name !== undefined) branch.name = input.name;
      if (input.city !== undefined) branch.city = input.city;
      if (input.status !== undefined) branch.status = input.status;
      await branch.save({ session });
      if (Object.keys(changes).length > 0) {
        await recordAudit(
          {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            action: 'branch.updated',
            target: { type: 'branch', id: branch._id },
            changes,
          },
          session,
        );
      }
      return branch;
    });
    res.json({ branch: toBranchDto(saved) });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw branchNameTaken();
    throw err;
  }
});
