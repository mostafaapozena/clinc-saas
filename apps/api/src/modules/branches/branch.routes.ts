import { Router } from 'express';
import { z } from 'zod';
import { conflict, isDuplicateKeyError, notFound } from '../../http/errors.js';
import { branchNameSchema, citySchema, escapeRegex } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { accessibleBranchesFilter, canAccessBranch, orgScope } from '../../tenancy/scope.js';
import { parseObjectId, requirePermission, tenantOf } from '../../tenancy/tenant-context.js';
import { recordAudit } from '../audit/audit-event.model.js';
import { BRANCH_STATUSES, BranchModel, toBranchDto } from './branch.model.js';

const listQuerySchema = z.object({ q: z.string().trim().max(80).optional() });
const createBranchSchema = z.object({ name: branchNameSchema, city: citySchema.optional() });
const updateBranchSchema = z
  .object({
    name: branchNameSchema.optional(),
    city: citySchema.optional(),
    status: z.enum(BRANCH_STATUSES).optional(),
  })
  .refine((v) => v.name !== undefined || v.city !== undefined || v.status !== undefined, {
    message: 'empty_update',
  });

const branchNameTaken = () => conflict('BRANCH_NAME_TAKEN', 'A branch with this name already exists');

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
  try {
    const branch = await BranchModel.create({
      organizationId: tenant.organizationId,
      name: input.name,
      city: input.city ?? '',
    });
    await recordAudit({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      action: 'branch.created',
      target: { type: 'branch', id: branch._id },
      changes: { name: branch.name },
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
  const branch = await BranchModel.findOne(orgScope(tenant, { _id: branchId }));
  if (!branch) throw notFound();

  const changes: Record<string, { from: string; to: string }> = {};
  for (const key of ['name', 'city', 'status'] as const) {
    const next = input[key];
    if (next !== undefined && next !== branch[key]) changes[key] = { from: branch[key], to: next };
  }
  if (input.name !== undefined) branch.name = input.name;
  if (input.city !== undefined) branch.city = input.city;
  if (input.status !== undefined) branch.status = input.status;
  try {
    await branch.save();
  } catch (err) {
    if (isDuplicateKeyError(err)) throw branchNameTaken();
    throw err;
  }
  if (Object.keys(changes).length > 0) {
    await recordAudit({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      action: 'branch.updated',
      target: { type: 'branch', id: branch._id },
      changes,
    });
  }
  res.json({ branch: toBranchDto(branch) });
});
