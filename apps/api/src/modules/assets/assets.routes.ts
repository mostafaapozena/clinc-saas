import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { runTransaction } from '../../db/transaction.js';
import { conflict, isDuplicateKeyError, notFound, validationError } from '../../http/errors.js';
import { objectIdSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { canAccessBranch } from '../../tenancy/scope.js';
import { parseObjectId, requirePermission, tenantOf, type TenantContext } from '../../tenancy/tenant-context.js';
import { DATE_PATTERN, addDays, isValidDate } from '../../time/local-time.js';
import { CashVoucherModel, LedgerAccountModel } from '../accounting/accounting.model.js';
import { ledgerToday, postEntry, prepareLedger, settingsOf, type Lean } from '../accounting/accounting.posting.js';
import { recordAudit, type AuditAction } from '../audit/audit-event.model.js';
import { BranchModel } from '../branches/branch.model.js';
import { MAX_AMOUNT } from '../finance/finance.model.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { SupplierBillModel, SupplierModel } from '../purchasing/purchasing.model.js';
import { AssetModel, MaintenanceRecordModel, type Asset, type MaintenanceRecord } from './assets.model.js';
import { depreciationDto } from './depreciation.routes.js';

// Equipment register and maintenance (docs/architecture/ASSETS.md). Assets belong to a branch and
// follow branch scope. Costs are recorded once, by the supplier bill or cash voucher they came
// with; maintenance records only link to them. Disposal writes off a capitalized cost.

const dateSchema = z.string().regex(DATE_PATTERN).refine(isValidDate, 'invalid_date');
const money = z.number().int().min(0).max(MAX_AMOUNT);
const audit = (tenant: TenantContext, action: AuditAction, id: Types.ObjectId, changes: Record<string, unknown>) =>
  recordAudit({ organizationId: tenant.organizationId, actorUserId: tenant.userId, action, target: { type: 'asset', id }, changes });

const id = (v: Types.ObjectId | null | undefined) => (v ? String(v) : null);
const assetDto = (a: Lean<Asset>, today: string) => ({
  id: String(a._id),
  code: a.code,
  name: a.name,
  category: a.category,
  serialNumber: a.serialNumber,
  branchId: String(a.branchId),
  location: a.location,
  custodianId: id(a.custodianId),
  purchase: { date: a.purchase.date, cost: a.purchase.cost, supplierId: id(a.purchase.supplierId), billId: id(a.purchase.billId) },
  capitalized: Boolean(a.ledgerAccountId),
  maintenanceIntervalDays: a.maintenanceIntervalDays,
  nextMaintenanceDue: a.nextMaintenanceDue,
  maintenanceDue: Boolean(
    a.nextMaintenanceDue && a.nextMaintenanceDue <= addDays(today, 14) && (a.status === 'active' || a.status === 'out_of_service'),
  ),
  status: a.status,
  disposal: a.disposal ? { date: a.disposal.date, reason: a.disposal.reason, entryId: id(a.disposal.entryId) } : null,
  depreciation: depreciationDto(a),
  version: a.version,
});
const recordDto = (r: Lean<MaintenanceRecord>) => ({
  id: String(r._id),
  date: r.date,
  kind: r.kind,
  description: r.description,
  performedBy: r.performedBy,
  supplierId: id(r.supplierId),
  cost: r.cost,
  billId: id(r.billId),
  voucherId: id(r.voucherId),
  outOfService: r.outOfService,
  createdAt: r.createdAt.toISOString(),
});

async function assetOr404(tenant: TenantContext, raw: unknown) {
  const aid = parseObjectId(raw);
  if (!aid) throw notFound();
  const a = await AssetModel.findOne({ organizationId: tenant.organizationId, _id: aid }).lean<Lean<Asset>>();
  if (!a || !canAccessBranch(tenant, a.branchId)) throw notFound();
  return a;
}

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,20}$/),
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().max(60).default(''),
  serialNumber: z.string().trim().max(60).default(''),
  branchId: objectIdSchema,
  location: z.string().trim().max(80).default(''),
  custodianId: objectIdSchema.nullable().default(null),
  purchase: z
    .object({
      date: dateSchema.nullable().default(null),
      cost: money.default(0),
      supplierId: objectIdSchema.nullable().default(null),
      billId: objectIdSchema.nullable().default(null),
    })
    .default({ date: null, cost: 0, supplierId: null, billId: null }),
  maintenanceIntervalDays: z.number().int().min(1).max(3650).nullable().default(null),
  nextMaintenanceDue: dateSchema.nullable().default(null),
});
const updateSchema = z.object({
  location: z.string().trim().max(80).optional(),
  custodianId: objectIdSchema.nullable().optional(),
  maintenanceIntervalDays: z.number().int().min(1).max(3650).nullable().optional(),
  nextMaintenanceDue: dateSchema.nullable().optional(),
  status: z.enum(['active', 'out_of_service']).optional(),
  version: z.number().int().min(0),
});
const maintenanceSchema = z.object({
  date: dateSchema,
  kind: z.enum(['preventive', 'corrective', 'inspection']),
  description: z.string().trim().min(3).max(500),
  performedBy: z.string().trim().max(120).default(''),
  supplierId: objectIdSchema.nullable().default(null),
  cost: money.default(0),
  billId: objectIdSchema.nullable().default(null),
  voucherId: objectIdSchema.nullable().default(null),
  outOfService: z.boolean().default(false),
  nextDue: dateSchema.nullable().optional(),
});

export function createAssetsRouter() {
  const router = Router({ mergeParams: true });

  router.get('/assets', requirePermission('asset.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const { status } = parseInput(z.object({ status: z.enum(['active', 'out_of_service', 'retired', 'disposed']).optional() }), req.query);
    const filter: Record<string, unknown> = { organizationId: tenant.organizationId, ...(status ? { status } : {}) };
    if (tenant.branchScope.type === 'selected') filter.branchId = { $in: tenant.branchScope.branchIds };
    const today = await ledgerToday(tenant.organizationId);
    const rows = await AssetModel.find(filter).sort({ code: 1 }).limit(500).lean<Lean<Asset>[]>();
    res.json({ today, assets: rows.map((a) => assetDto(a, today)) });
  });

  router.get('/assets/:assetId', requirePermission('asset.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const a = await assetOr404(tenant, req.params.assetId);
    const records = await MaintenanceRecordModel.find({ organizationId: tenant.organizationId, assetId: a._id })
      .sort({ date: -1, createdAt: -1 })
      .limit(200)
      .lean<Lean<MaintenanceRecord>[]>();
    res.json({ asset: assetDto(a, await ledgerToday(tenant.organizationId)), maintenance: records.map(recordDto) });
  });

  router.post('/assets', requirePermission('asset.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(createSchema, req.body);
    const branchId = new Types.ObjectId(input.branchId);
    if (!canAccessBranch(tenant, branchId) || !(await BranchModel.exists({ organizationId: tenant.organizationId, _id: branchId }))) throw notFound();
    if (
      input.custodianId &&
      !(await MembershipModel.exists({ organizationId: tenant.organizationId, _id: new Types.ObjectId(input.custodianId), status: 'active' }))
    )
      throw validationError({ custodianId: 'not_found' });
    if (
      input.purchase.supplierId &&
      !(await SupplierModel.exists({ organizationId: tenant.organizationId, _id: new Types.ObjectId(input.purchase.supplierId) }))
    )
      throw validationError({ supplierId: 'not_found' });
    // A purchase bill line to an asset account capitalizes the cost (it is not expensed again here).
    let ledgerAccountId: Types.ObjectId | null = null;
    if (input.purchase.billId) {
      const bill = await SupplierBillModel.findOne({
        organizationId: tenant.organizationId,
        _id: new Types.ObjectId(input.purchase.billId),
        status: 'posted',
      }).lean();
      if (!bill) throw validationError({ billId: 'not_found' });
      const assetAccounts = await LedgerAccountModel.find({
        organizationId: tenant.organizationId,
        type: 'asset',
        _id: { $in: bill.lines.map((l) => l.expenseAccountId).filter(Boolean) },
      }).lean();
      ledgerAccountId = assetAccounts[0]?._id ?? null;
    }
    try {
      const a = await AssetModel.create({
        ...input,
        organizationId: tenant.organizationId,
        branchId,
        custodianId: input.custodianId ? new Types.ObjectId(input.custodianId) : null,
        purchase: {
          date: input.purchase.date,
          cost: input.purchase.cost,
          supplierId: input.purchase.supplierId ? new Types.ObjectId(input.purchase.supplierId) : null,
          billId: input.purchase.billId ? new Types.ObjectId(input.purchase.billId) : null,
        },
        ledgerAccountId,
        nextMaintenanceDue:
          input.nextMaintenanceDue ??
          (input.maintenanceIntervalDays && input.purchase.date ? addDays(input.purchase.date, input.maintenanceIntervalDays) : null),
        createdBy: tenant.userId,
      });
      await audit(tenant, 'asset.created', a._id, { code: input.code, capitalized: Boolean(ledgerAccountId) });
      res.status(201).json({ asset: assetDto(a.toObject() as Lean<Asset>, await ledgerToday(tenant.organizationId)) });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw conflict('ASSET_CODE_TAKEN', 'Another asset has this code');
      throw err;
    }
  });

  router.patch('/assets/:assetId', requirePermission('asset.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const a = await assetOr404(tenant, req.params.assetId);
    const input = parseInput(updateSchema, req.body);
    if (a.status === 'retired' || a.status === 'disposed') throw conflict('ASSET_RETIRED', 'Retired equipment is not changed');
    if (
      input.custodianId &&
      !(await MembershipModel.exists({ organizationId: tenant.organizationId, _id: new Types.ObjectId(input.custodianId), status: 'active' }))
    )
      throw validationError({ custodianId: 'not_found' });
    const { version, custodianId, ...rest } = input;
    const updated = await AssetModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, _id: a._id, version },
      {
        $set: { ...rest, ...(custodianId !== undefined ? { custodianId: custodianId ? new Types.ObjectId(custodianId) : null } : {}) },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    ).lean<Lean<Asset>>();
    if (!updated) throw conflict('VERSION_CONFLICT', 'This asset was changed meanwhile');
    await audit(tenant, 'asset.updated', a._id, { fields: Object.keys(input).filter((k) => k !== 'version') });
    res.json({ asset: assetDto(updated, await ledgerToday(tenant.organizationId)) });
  });

  // A maintenance record; the next due date follows the interval unless given.
  router.post('/assets/:assetId/maintenance', requirePermission('asset.maintain'), async (req, res) => {
    const tenant = tenantOf(req);
    const a = await assetOr404(tenant, req.params.assetId);
    const input = parseInput(maintenanceSchema, req.body);
    const today = await ledgerToday(tenant.organizationId);
    if (input.date > today) throw validationError({ date: 'in_future' });
    if (a.status === 'retired' || a.status === 'disposed') throw conflict('ASSET_RETIRED', 'Retired equipment is not maintained');
    if (input.billId && !(await SupplierBillModel.exists({ organizationId: tenant.organizationId, _id: new Types.ObjectId(input.billId) })))
      throw validationError({ billId: 'not_found' });
    if (input.voucherId && !(await CashVoucherModel.exists({ organizationId: tenant.organizationId, _id: new Types.ObjectId(input.voucherId) })))
      throw validationError({ voucherId: 'not_found' });
    const nextDue =
      input.nextDue !== undefined
        ? input.nextDue
        : a.maintenanceIntervalDays && !input.outOfService
          ? addDays(input.date, a.maintenanceIntervalDays)
          : a.nextMaintenanceDue;
    const record = await runTransaction(async (session) => {
      const [doc] = await MaintenanceRecordModel.create(
        [
          {
            organizationId: tenant.organizationId,
            assetId: a._id,
            branchId: a.branchId,
            date: input.date,
            kind: input.kind,
            description: input.description,
            performedBy: input.performedBy,
            supplierId: input.supplierId ? new Types.ObjectId(input.supplierId) : null,
            cost: input.cost,
            billId: input.billId ? new Types.ObjectId(input.billId) : null,
            voucherId: input.voucherId ? new Types.ObjectId(input.voucherId) : null,
            outOfService: input.outOfService,
            createdBy: tenant.userId,
          },
        ],
        { session },
      );
      await AssetModel.updateOne(
        { organizationId: tenant.organizationId, _id: a._id },
        { $set: { nextMaintenanceDue: nextDue, status: input.outOfService ? 'out_of_service' : 'active' }, $inc: { version: 1 } },
        { session },
      );
      return doc!.toObject() as Lean<MaintenanceRecord>;
    });
    await audit(tenant, 'asset.maintained', a._id, { kind: input.kind, outOfService: input.outOfService });
    res.status(201).json({ record: recordDto(record) });
  });

  // Retire (kept, no longer used) or dispose (gone): a capitalized cost is written off on disposal.
  router.post('/assets/:assetId/retire', requirePermission('asset.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const a = await assetOr404(tenant, req.params.assetId);
    const input = parseInput(
      z.object({ disposal: z.boolean().default(false), reason: z.string().trim().min(3).max(300), version: z.number().int().min(0) }),
      req.body,
    );
    if (a.status === 'disposed' || (a.status === 'retired' && !input.disposal)) throw conflict('ASSET_RETIRED', 'This equipment is already retired');
    const today = await ledgerToday(tenant.organizationId);
    await prepareLedger(tenant.organizationId);
    const updated = await runTransaction(async (session) => {
      let entryId: Types.ObjectId | null = null;
      const settings = await settingsOf(tenant.organizationId, session);
      if (input.disposal && a.ledgerAccountId && a.purchase.cost > 0 && settings && today >= settings.cutoverDate) {
        const writeOff = await LedgerAccountModel.findOne({ organizationId: tenant.organizationId, templateKey: 'otherExpenses', status: 'active' })
          .session(session)
          .lean();
        if (!writeOff) throw conflict('CHART_INCOMPLETE', 'The other expenses account is missing');
        // Depreciation already posted comes off the accumulated account; the book value is written off.
        const accumulated = a.depreciation?.accumulated ?? 0;
        const accumulatedAccount = accumulated
          ? await LedgerAccountModel.findOne({ organizationId: tenant.organizationId, templateKey: 'accumulatedDepreciation' }).session(session).lean()
          : null;
        if (accumulated && !accumulatedAccount) throw conflict('CHART_INCOMPLETE', 'The accumulated depreciation account is missing');
        const entry = await postEntry(
          {
            organizationId: tenant.organizationId,
            userId: tenant.userId,
            date: today,
            journal: 'general',
            memo: `${a.code} disposal`,
            lines: [
              ...(accumulatedAccount ? [{ accountId: accumulatedAccount._id, debit: accumulated, branchId: a.branchId }] : []),
              ...(a.purchase.cost > accumulated ? [{ accountId: writeOff._id, debit: a.purchase.cost - accumulated, branchId: a.branchId }] : []),
              { accountId: a.ledgerAccountId, credit: a.purchase.cost, branchId: a.branchId },
            ],
            source: { type: 'asset', id: a._id, event: 'disposed' },
          },
          session,
          settings,
        );
        entryId = entry._id;
      }
      const doc = await AssetModel.findOneAndUpdate(
        { organizationId: tenant.organizationId, _id: a._id, version: input.version },
        {
          $set: {
            status: input.disposal ? 'disposed' : 'retired',
            nextMaintenanceDue: null,
            disposal: { date: today, reason: input.reason, entryId },
          },
          $inc: { version: 1 },
        },
        { session, returnDocument: 'after' },
      ).lean<Lean<Asset>>();
      if (!doc) throw conflict('VERSION_CONFLICT', 'This asset was changed meanwhile');
      return doc;
    });
    await audit(tenant, input.disposal ? 'asset.disposed' : 'asset.retired', a._id, { code: a.code });
    res.json({ asset: assetDto(updated, today) });
  });

  return router;
}
