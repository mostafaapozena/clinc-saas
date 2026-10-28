import { createHash } from 'node:crypto';
import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { runTransaction } from '../../db/transaction.js';
import { HttpError, conflict, isDuplicateKeyError, notFound, validationError } from '../../http/errors.js';
import { escapeRegex, objectIdSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { canAccessBranch } from '../../tenancy/scope.js';
import { parseObjectId, requirePermission, tenantCan, tenantOf, type TenantContext } from '../../tenancy/tenant-context.js';
import { DATE_PATTERN, addDays, isValidDate } from '../../time/local-time.js';
import { ledgerToday, prepareLedger, type Lean } from '../accounting/accounting.posting.js';
import { recordAudit, type AuditAction } from '../audit/audit-event.model.js';
import { BranchModel } from '../branches/branch.model.js';
import { resolveClinicalActor, treats } from '../clinical/clinical-access.js';
import { EncounterModel } from '../clinical/clinical.model.js';
import { MAX_AMOUNT, ensureCounter } from '../finance/finance.model.js';
import {
  StockBalanceModel,
  StockDocumentModel,
  StockItemModel,
  StockMoveModel,
  WarehouseModel,
  type StockBalance,
  type StockDocument,
  type StockItem,
  type StockMove,
  type Warehouse,
} from './inventory.model.js';
import { STOCK_POSTINGS, lockItem, newId, saveDocument, stockIn, stockOut, type Ctx } from './inventory.stock.js';

// Inventory and medical consumables (docs/architecture/INVENTORY.md). Warehouses belong to a branch;
// branch-restricted users see and move only their branches' stock. Costs and values are financial
// data, shown only with `inventory.value.read`. Consumption links stock to a finalized record by id.

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;
const dateSchema = z.string().regex(DATE_PATTERN).refine(isValidDate, 'invalid_date');
const qtySchema = z.number().int().min(1).max(1_000_000);
const unitSchema = z.string().trim().min(1).max(20);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');

function requireKey(req: Request): string {
  const key = req.get('idempotency-key') ?? '';
  if (!IDEMPOTENCY_KEY.test(key)) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header');
  return key;
}
const reused = () => conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different request');
const ctxOf = (tenant: TenantContext): Ctx => ({ organizationId: tenant.organizationId, userId: tenant.userId });
const audit = (
  tenant: TenantContext,
  action: AuditAction,
  type: 'stock_item' | 'warehouse' | 'stock_document',
  id: Types.ObjectId,
  changes: Record<string, unknown>,
) => recordAudit({ organizationId: tenant.organizationId, actorUserId: tenant.userId, action, target: { type, id }, changes });

/** Converts a quantity in a purchase unit to base units (the unit must be the base unit or one of the item's). */
export function toBaseUnits(item: Pick<StockItem, 'baseUnit' | 'purchaseUnits'>, qty: number, unit?: string): number {
  if (!unit || unit === item.baseUnit) return qty;
  const u = item.purchaseUnits.find((p) => p.unit === unit);
  if (!u) throw validationError({ unit: 'unknown_unit' });
  const base = qty * u.factor;
  if (!Number.isSafeInteger(base) || base > 100_000_000) throw validationError({ qty: 'out_of_range' });
  return base;
}

async function warehouseOr404(tenant: TenantContext, id: string | Types.ObjectId, activeOnly = true) {
  const oid = typeof id === 'string' ? parseObjectId(id) : id;
  if (!oid) throw notFound();
  const w = await WarehouseModel.findOne({ organizationId: tenant.organizationId, _id: oid }).lean<Lean<Warehouse>>();
  if (!w || !canAccessBranch(tenant, w.branchId)) throw notFound();
  if (activeOnly && w.status !== 'active') throw conflict('WAREHOUSE_ARCHIVED', 'This warehouse is archived');
  return w;
}

const itemDto = (i: Lean<StockItem>, withValue: boolean) => ({
  id: String(i._id),
  code: i.code,
  name: i.name,
  category: i.category,
  baseUnit: i.baseUnit,
  purchaseUnits: i.purchaseUnits,
  tracking: i.tracking,
  reorderLevel: i.reorderLevel,
  status: i.status,
  onHand: i.onHand,
  belowReorder: i.reorderLevel > 0 && i.onHand <= i.reorderLevel,
  version: i.version,
  ...(withValue ? { stockValue: i.stockValue, averageCost: i.onHand > 0 ? i.stockValue / i.onHand : null } : {}),
});
const warehouseDto = (w: Lean<Warehouse>) => ({ id: String(w._id), name: w.name, branchId: String(w.branchId), status: w.status });
const balanceDto = (b: Lean<StockBalance>, today: string) => ({
  itemId: String(b.itemId),
  warehouseId: String(b.warehouseId),
  lot: b.lot,
  expiry: b.expiry,
  qty: b.qty,
  expired: Boolean(b.expiry && b.expiry < today),
});
const documentDto = (d: Lean<StockDocument>, withValue: boolean) => ({
  id: String(d._id),
  number: d.number,
  type: d.type,
  date: d.date,
  warehouseId: String(d.warehouseId),
  toWarehouseId: d.toWarehouseId ? String(d.toWarehouseId) : null,
  branchId: String(d.branchId),
  reason: d.reason,
  source: {
    encounterId: d.source.encounterId ? String(d.source.encounterId) : null,
    recordItemId: d.source.recordItemId,
    documentId: d.source.documentId ? String(d.source.documentId) : null,
  },
  entryId: d.entryId ? String(d.entryId) : null,
  reversalOf: d.reversalOf ? String(d.reversalOf) : null,
  reversedBy: d.reversedBy ? String(d.reversedBy) : null,
  createdAt: d.createdAt.toISOString(),
  ...(withValue ? { totalValue: d.totalValue } : {}),
});
const moveDto = (m: Lean<StockMove>, withValue: boolean) => ({
  id: String(m._id),
  documentId: String(m.documentId),
  type: m.type,
  date: m.date,
  itemId: String(m.itemId),
  warehouseId: String(m.warehouseId),
  lot: m.lot,
  expiry: m.expiry,
  qty: m.qty,
  onHandAfter: m.onHandAfter,
  ...(withValue ? { value: m.value, valueAfter: m.valueAfter } : {}),
});

const itemCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,20}$/),
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().max(60).default(''),
  baseUnit: unitSchema,
  purchaseUnits: z
    .array(z.object({ unit: unitSchema, factor: z.number().int().min(2).max(100_000) }))
    .max(5)
    .default([]),
  tracking: z.enum(['none', 'lot']).default('none'),
  reorderLevel: z.number().int().min(0).max(10_000_000).default(0),
});
const itemUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  category: z.string().trim().max(60).optional(),
  reorderLevel: z.number().int().min(0).max(10_000_000).optional(),
  purchaseUnits: z
    .array(z.object({ unit: unitSchema, factor: z.number().int().min(2).max(100_000) }))
    .max(5)
    .optional(),
  status: z.enum(['active', 'archived']).optional(),
  version: z.number().int().min(0),
});
const lineIn = z.object({
  itemId: objectIdSchema,
  qty: qtySchema,
  unit: unitSchema.optional(),
  lot: z.string().trim().max(40).optional(),
  expiry: dateSchema.optional(),
  /** Minor units per entered unit (opening stock, adjustments of an item with no stock). */
  unitCost: z.number().int().min(0).max(MAX_AMOUNT).optional(),
});
const lineOut = z.object({ itemId: objectIdSchema, qty: qtySchema, unit: unitSchema.optional(), lot: z.string().trim().max(40).optional() });
const countLine = z.object({
  itemId: objectIdSchema,
  lot: z.string().trim().max(40).default(''),
  expiry: dateSchema.optional(),
  counted: z.number().int().min(0).max(100_000_000),
  unitCost: z.number().int().min(0).max(MAX_AMOUNT).optional(),
});
const reason = z.string().trim().min(3).max(300);
const operationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('opening'),
    warehouseId: objectIdSchema,
    lines: z.array(lineIn).min(1).max(100),
    reason: z.string().trim().max(300).default(''),
  }),
  z.object({ type: z.literal('adjustment'), warehouseId: objectIdSchema, lines: z.array(countLine).min(1).max(100), reason }),
  z.object({ type: z.literal('write_off'), warehouseId: objectIdSchema, lines: z.array(lineOut).min(1).max(100), reason }),
  z.object({ type: z.literal('issue'), warehouseId: objectIdSchema, lines: z.array(lineOut).min(1).max(100), reason }),
  z.object({
    type: z.literal('transfer'),
    warehouseId: objectIdSchema,
    toWarehouseId: objectIdSchema,
    lines: z.array(lineOut).min(1).max(100),
    reason: z.string().trim().max(300).default(''),
  }),
]);
const consumptionSchema = z.object({
  encounterId: objectIdSchema,
  recordItemId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{6,40}$/)
    .nullable()
    .default(null),
  warehouseId: objectIdSchema,
  lines: z.array(lineOut).min(1).max(30),
  /** The doctor explicitly confirms the materials used. */
  confirm: z.literal(true),
});

export function createInventoryRouter() {
  const router = Router({ mergeParams: true });
  const withValue = (tenant: TenantContext) => tenantCan(tenant, 'inventory.value.read');

  // ---- items and warehouses ----------------------------------------------------------------
  router.get('/inventory/items', requirePermission('inventory.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const q = parseInput(z.object({ q: z.string().trim().max(60).optional(), status: z.enum(['active', 'archived']).optional() }), req.query);
    const filter: Record<string, unknown> = { organizationId: tenant.organizationId, ...(q.status ? { status: q.status } : {}) };
    if (q.q) filter.$or = [{ code: { $regex: `^${escapeRegex(q.q.toUpperCase())}` } }, { name: { $regex: escapeRegex(q.q), $options: 'i' } }];
    const items = await StockItemModel.find(filter).sort({ code: 1 }).limit(500).lean<Lean<StockItem>[]>();
    // Organization-wide totals are shown only to organization-wide callers; others see their branches' balances.
    const orgWide = tenant.branchScope.type === 'all';
    let scoped: Map<string, number> | null = null;
    if (!orgWide) {
      const rows = await StockBalanceModel.aggregate<{ _id: Types.ObjectId; qty: number }>([
        {
          $match: {
            organizationId: tenant.organizationId,
            branchId: { $in: tenant.branchScope.type === 'selected' ? tenant.branchScope.branchIds : [] },
          },
        },
        { $group: { _id: '$itemId', qty: { $sum: '$qty' } } },
      ]);
      scoped = new Map(rows.map((r) => [String(r._id), r.qty]));
    }
    res.json({
      items: items.map((i) => {
        const dto = itemDto(i, withValue(tenant) && orgWide);
        return scoped ? { ...dto, onHand: scoped.get(String(i._id)) ?? 0, belowReorder: false } : dto;
      }),
    });
  });

  router.post('/inventory/items', requirePermission('inventory.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(itemCreateSchema, req.body);
    if (
      new Set(input.purchaseUnits.map((u) => u.unit)).size !== input.purchaseUnits.length ||
      input.purchaseUnits.some((u) => u.unit === input.baseUnit)
    )
      throw validationError({ purchaseUnits: 'duplicate_unit' });
    try {
      const item = await StockItemModel.create({ ...input, organizationId: tenant.organizationId, createdBy: tenant.userId });
      await audit(tenant, 'stock_item.created', 'stock_item', item._id, { code: input.code, tracking: input.tracking });
      res.status(201).json({ item: itemDto(item.toObject() as Lean<StockItem>, withValue(tenant)) });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw conflict('ITEM_CODE_TAKEN', 'Another item has this code');
      throw err;
    }
  });

  router.patch('/inventory/items/:itemId', requirePermission('inventory.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const id = parseObjectId(req.params.itemId);
    if (!id) throw notFound();
    const input = parseInput(itemUpdateSchema, req.body);
    const current = await StockItemModel.findOne({ organizationId: tenant.organizationId, _id: id }).lean<Lean<StockItem>>();
    if (!current) throw notFound();
    if (input.status === 'archived' && current.onHand > 0) throw conflict('ITEM_HAS_STOCK', 'Items with stock on hand cannot be archived');
    // Existing conversions are part of history: units can be added, never changed or removed.
    if (input.purchaseUnits) {
      for (const u of current.purchaseUnits) {
        const next = input.purchaseUnits.find((p) => p.unit === u.unit);
        if (!next || next.factor !== u.factor) throw validationError({ purchaseUnits: 'existing_unit_changed' });
      }
      if (
        new Set(input.purchaseUnits.map((u) => u.unit)).size !== input.purchaseUnits.length ||
        input.purchaseUnits.some((u) => u.unit === current.baseUnit)
      )
        throw validationError({ purchaseUnits: 'duplicate_unit' });
    }
    const { version, ...set } = input;
    const updated = await StockItemModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, _id: id, version },
      { $set: set, $inc: { version: 1 } },
      { returnDocument: 'after' },
    ).lean<Lean<StockItem>>();
    if (!updated) throw conflict('VERSION_CONFLICT', 'This item was changed meanwhile');
    await audit(tenant, 'stock_item.updated', 'stock_item', id, { fields: Object.keys(set) });
    res.json({ item: itemDto(updated, withValue(tenant)) });
  });

  router.get('/inventory/warehouses', requirePermission('inventory.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const all = await WarehouseModel.find({ organizationId: tenant.organizationId }).sort({ createdAt: 1 }).lean<Lean<Warehouse>[]>();
    res.json({ warehouses: all.filter((w) => canAccessBranch(tenant, w.branchId)).map(warehouseDto) });
  });

  router.post('/inventory/warehouses', requirePermission('inventory.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(z.object({ name: z.string().trim().min(2).max(80), branchId: objectIdSchema }), req.body);
    const branchId = new Types.ObjectId(input.branchId);
    if (!canAccessBranch(tenant, branchId) || !(await BranchModel.exists({ organizationId: tenant.organizationId, _id: branchId }))) throw notFound();
    try {
      const w = await WarehouseModel.create({ organizationId: tenant.organizationId, branchId, name: input.name });
      await audit(tenant, 'warehouse.created', 'warehouse', w._id, { branchId: input.branchId });
      res.status(201).json({ warehouse: warehouseDto(w.toObject() as Lean<Warehouse>) });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw conflict('WAREHOUSE_NAME_TAKEN', 'This branch already has a warehouse with this name');
      throw err;
    }
  });

  router.patch('/inventory/warehouses/:warehouseId', requirePermission('inventory.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const w = await warehouseOr404(tenant, req.params.warehouseId as string, false);
    const { status } = parseInput(z.object({ status: z.enum(['active', 'archived']) }), req.body);
    if (status === 'archived' && (await StockBalanceModel.exists({ organizationId: tenant.organizationId, warehouseId: w._id, qty: { $gt: 0 } })))
      throw conflict('WAREHOUSE_HAS_STOCK', 'Move or write off the stock before archiving');
    await WarehouseModel.updateOne({ organizationId: tenant.organizationId, _id: w._id }, { $set: { status } });
    await audit(tenant, 'warehouse.updated', 'warehouse', w._id, { status });
    res.json({ warehouse: warehouseDto({ ...w, status }) });
  });

  // ---- balances, ledger, alerts -------------------------------------------------------------
  router.get('/inventory/balances', requirePermission('inventory.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const q = parseInput(z.object({ warehouseId: objectIdSchema.optional(), itemId: objectIdSchema.optional() }), req.query);
    const filter: Record<string, unknown> = { organizationId: tenant.organizationId, qty: { $gt: 0 } };
    if (q.warehouseId) filter.warehouseId = (await warehouseOr404(tenant, q.warehouseId, false))._id;
    else if (tenant.branchScope.type === 'selected') filter.branchId = { $in: tenant.branchScope.branchIds };
    if (q.itemId) filter.itemId = new Types.ObjectId(q.itemId);
    const today = await ledgerToday(tenant.organizationId);
    const rows = await StockBalanceModel.find(filter).sort({ expiry: 1 }).limit(1000).lean<Lean<StockBalance>[]>();
    res.json({ today, balances: rows.map((b) => balanceDto(b, today)) });
  });

  router.get('/inventory/alerts', requirePermission('inventory.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const { days } = parseInput(z.object({ days: z.coerce.number().int().min(1).max(365).default(60) }), req.query);
    const today = await ledgerToday(tenant.organizationId);
    const scope = tenant.branchScope.type === 'selected' ? { branchId: { $in: tenant.branchScope.branchIds } } : {};
    const [expiring, reorder] = await Promise.all([
      StockBalanceModel.find({
        organizationId: tenant.organizationId,
        ...scope,
        qty: { $gt: 0 },
        expiry: { $type: 'string', $lte: addDays(today, days) },
      })
        .sort({ expiry: 1 })
        .limit(200)
        .lean<Lean<StockBalance>[]>(),
      tenant.branchScope.type === 'all'
        ? StockItemModel.find({
            organizationId: tenant.organizationId,
            status: 'active',
            reorderLevel: { $gt: 0 },
            $expr: { $lte: ['$onHand', '$reorderLevel'] },
          })
            .limit(200)
            .lean<Lean<StockItem>[]>()
        : Promise.resolve([] as Lean<StockItem>[]),
    ]);
    res.json({
      today,
      expiring: expiring.map((b) => balanceDto(b, today)),
      // Suggested quantity: back to twice the reorder level (a simple default, editable when ordering).
      reorder: reorder.map((i) => ({
        itemId: String(i._id),
        code: i.code,
        name: i.name,
        onHand: i.onHand,
        reorderLevel: i.reorderLevel,
        suggested: Math.max(i.reorderLevel * 2 - i.onHand, 1),
      })),
    });
  });

  router.get('/inventory/moves', requirePermission('inventory.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const q = parseInput(
      z.object({
        itemId: objectIdSchema.optional(),
        warehouseId: objectIdSchema.optional(),
        page: z.coerce.number().int().min(1).max(10_000).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(50),
      }),
      req.query,
    );
    const filter: Record<string, unknown> = { organizationId: tenant.organizationId };
    if (q.warehouseId) filter.warehouseId = (await warehouseOr404(tenant, q.warehouseId, false))._id;
    else if (tenant.branchScope.type === 'selected') filter.branchId = { $in: tenant.branchScope.branchIds };
    if (q.itemId) filter.itemId = new Types.ObjectId(q.itemId);
    const [moves, total] = await Promise.all([
      StockMoveModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean<Lean<StockMove>[]>(),
      StockMoveModel.countDocuments(filter),
    ]);
    const docs = await StockDocumentModel.find({ organizationId: tenant.organizationId, _id: { $in: moves.map((m) => m.documentId) } })
      .select('number reason')
      .lean();
    const numberOf = new Map(docs.map((d) => [String(d._id), d.number]));
    res.json({
      data: moves.map((m) => ({
        ...moveDto(m, withValue(tenant) && tenant.branchScope.type === 'all'),
        documentNumber: numberOf.get(String(m.documentId)) ?? null,
      })),
      page: q.page,
      pageSize: q.pageSize,
      total,
    });
  });

  router.get('/inventory/documents/:documentId', requirePermission('inventory.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const id = parseObjectId(req.params.documentId);
    if (!id) throw notFound();
    const doc = await StockDocumentModel.findOne({ organizationId: tenant.organizationId, _id: id }).lean<Lean<StockDocument>>();
    if (!doc || !canAccessBranch(tenant, doc.branchId)) throw notFound();
    const moves = await StockMoveModel.find({ organizationId: tenant.organizationId, documentId: id }).lean<Lean<StockMove>[]>();
    const v = withValue(tenant) && tenant.branchScope.type === 'all';
    res.json({ document: documentDto(doc, v), moves: moves.map((m) => moveDto(m, v)) });
  });

  // ---- stock operations ---------------------------------------------------------------------
  router.post('/inventory/operations', requirePermission('inventory.move'), async (req, res) => {
    const tenant = tenantOf(req);
    const key = requireKey(req);
    const input = parseInput(operationSchema, req.body);
    const requestHash = hash(input);
    const previous = await StockDocumentModel.findOne({ organizationId: tenant.organizationId, createdBy: tenant.userId, idempotencyKey: key }).lean<
      Lean<StockDocument>
    >();
    if (previous) {
      if (previous.requestHash !== requestHash) throw reused();
      res.json({ document: documentDto(previous, withValue(tenant)), replayed: true });
      return;
    }
    const warehouse = await warehouseOr404(tenant, input.warehouseId);
    const to = input.type === 'transfer' ? await warehouseOr404(tenant, input.toWarehouseId) : null;
    if (to && to._id.equals(warehouse._id)) throw validationError({ toWarehouseId: 'same_warehouse' });
    const today = await ledgerToday(tenant.organizationId);
    await ensureCounter(tenant.organizationId, `SD:${today.slice(0, 4)}`);
    await prepareLedger(tenant.organizationId);
    const ctx = ctxOf(tenant);
    try {
      const doc = await runTransaction(async (session) => {
        const moves = [];
        if (input.type === 'opening') {
          for (const l of input.lines) {
            const item = await lockItem(ctx, new Types.ObjectId(l.itemId), session);
            const qty = toBaseUnits(item, l.qty, l.unit);
            if (l.unitCost === undefined) throw validationError({ unitCost: 'required' });
            moves.push(await stockIn(ctx, item, warehouse, { qty, lot: l.lot, expiry: l.expiry, value: l.unitCost * l.qty }, session));
          }
        } else if (input.type === 'adjustment') {
          for (const l of input.lines) {
            const item = await lockItem(ctx, new Types.ObjectId(l.itemId), session);
            const lot = item.tracking === 'lot' ? l.lot : '';
            const balance = await StockBalanceModel.findOne({
              organizationId: tenant.organizationId,
              itemId: item._id,
              warehouseId: warehouse._id,
              lot,
            })
              .session(session)
              .lean();
            const diff = l.counted - (balance?.qty ?? 0);
            if (diff > 0) {
              // Found stock comes in at the current average cost (or the given cost when none is on hand).
              const unit = item.onHand > 0 ? item.stockValue / item.onHand : l.unitCost;
              if (unit === undefined) throw validationError({ unitCost: 'required' });
              moves.push(
                await stockIn(
                  ctx,
                  item,
                  warehouse,
                  { qty: diff, lot, expiry: balance?.expiry ?? l.expiry ?? null, value: Math.round(unit * diff) },
                  session,
                ),
              );
            } else if (diff < 0) {
              moves.push(...(await stockOut(ctx, item, warehouse, { qty: -diff, lot }, today, { allowExpired: true }, session)));
            }
          }
          if (moves.length === 0) throw conflict('NO_DIFFERENCE', 'The counts match the stock; nothing to adjust');
        } else {
          for (const l of input.lines) {
            const item = await lockItem(ctx, new Types.ObjectId(l.itemId), session);
            const qty = toBaseUnits(item, l.qty, l.unit);
            const out = await stockOut(ctx, item, warehouse, { qty, lot: l.lot }, today, { allowExpired: input.type === 'write_off' }, session);
            moves.push(...out);
            if (to)
              for (const m of out) moves.push(await stockIn(ctx, item, to, { qty: -m.qty, lot: m.lot, expiry: m.expiry, value: -m.value }, session));
          }
        }
        const net = moves.reduce((s, m) => s + m.value, 0);
        const posting =
          input.type === 'adjustment'
            ? net >= 0
              ? { debit: 'inventory' as const, credit: 'inventoryAdjustments' as const }
              : { debit: 'inventoryAdjustments' as const, credit: 'inventory' as const }
            : (STOCK_POSTINGS[input.type] ?? null);
        return saveDocument(
          ctx,
          {
            _id: newId(),
            type: input.type,
            date: today,
            warehouseId: warehouse._id,
            toWarehouseId: to?._id ?? null,
            branchId: warehouse.branchId,
            reason: input.reason,
            source: { encounterId: null, recordItemId: null, documentId: null },
            sourceKey: null,
            reversalOf: null,
            idempotencyKey: key,
            requestHash,
          },
          moves,
          posting,
          session,
        );
      });
      await audit(tenant, 'stock_document.created', 'stock_document', doc._id, { number: doc.number, type: doc.type, lines: input.lines.length });
      res.status(201).json({ document: documentDto(doc, withValue(tenant)), replayed: false });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const again = await StockDocumentModel.findOne({ organizationId: tenant.organizationId, createdBy: tenant.userId, idempotencyKey: key }).lean<
        Lean<StockDocument>
      >();
      if (!again || again.requestHash !== requestHash) throw reused();
      res.json({ document: documentDto(again, withValue(tenant)), replayed: true });
    }
  });

  // ---- consumption from a performed visit ---------------------------------------------------
  // The treating doctor records materials used in their own finalized record (optionally one
  // procedure item of it). Once per record item; a linked return corrects it. Planned treatment
  // items never consume stock: only a finalized (performed) record can.
  router.post('/inventory/consumptions', requirePermission('inventory.consume'), async (req, res) => {
    const tenant = tenantOf(req);
    const key = requireKey(req);
    const input = parseInput(consumptionSchema, req.body);
    const requestHash = hash(input);
    const previous = await StockDocumentModel.findOne({ organizationId: tenant.organizationId, createdBy: tenant.userId, idempotencyKey: key }).lean<
      Lean<StockDocument>
    >();
    if (previous) {
      if (previous.requestHash !== requestHash) throw reused();
      res.json({ document: documentDto(previous, false), replayed: true });
      return;
    }
    const actor = await resolveClinicalActor(tenant);
    if (!actor) throw notFound();
    const encounter = await EncounterModel.findOne({ organizationId: tenant.organizationId, _id: input.encounterId }).lean();
    if (!encounter || !treats(actor, encounter)) throw notFound();
    if (encounter.status !== 'finalized') throw conflict('RECORD_NOT_FINALIZED', 'Materials are recorded on a finalized (performed) visit record');
    if (input.recordItemId) {
      const procedures = ((encounter.specialty?.data ?? {}) as { procedures?: { id: string }[] }).procedures ?? [];
      if (!procedures.some((p) => p.id === input.recordItemId)) throw validationError({ recordItemId: 'invalid_reference' });
    }
    const warehouse = await warehouseOr404(tenant, input.warehouseId);
    if (!warehouse.branchId.equals(encounter.branchId)) throw validationError({ warehouseId: 'other_branch' });
    const today = await ledgerToday(tenant.organizationId);
    await ensureCounter(tenant.organizationId, `SD:${today.slice(0, 4)}`);
    await prepareLedger(tenant.organizationId);
    const ctx = ctxOf(tenant);
    const sourceKey = `consumption:${input.encounterId}:${input.recordItemId ?? 'record'}`;
    try {
      const doc = await runTransaction(async (session) => {
        const moves = [];
        for (const l of input.lines) {
          const item = await lockItem(ctx, new Types.ObjectId(l.itemId), session);
          moves.push(
            ...(await stockOut(ctx, item, warehouse, { qty: toBaseUnits(item, l.qty, l.unit), lot: l.lot }, today, { allowExpired: false }, session)),
          );
        }
        return saveDocument(
          ctx,
          {
            _id: newId(),
            type: 'consumption',
            date: today,
            warehouseId: warehouse._id,
            toWarehouseId: null,
            branchId: warehouse.branchId,
            reason: '',
            source: { encounterId: encounter._id, recordItemId: input.recordItemId, documentId: null },
            sourceKey,
            reversalOf: null,
            idempotencyKey: key,
            requestHash,
          },
          moves,
          STOCK_POSTINGS.consumption!,
          session,
        );
      });
      await audit(tenant, 'stock_document.created', 'stock_document', doc._id, {
        number: doc.number,
        type: 'consumption',
        lines: input.lines.length,
      });
      res.status(201).json({ document: documentDto(doc, false), replayed: false });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const again = await StockDocumentModel.findOne({ organizationId: tenant.organizationId, createdBy: tenant.userId, idempotencyKey: key }).lean<
        Lean<StockDocument>
      >();
      if (again && again.requestHash === requestHash) {
        res.json({ document: documentDto(again, false), replayed: true });
        return;
      }
      if (again) throw reused();
      throw conflict('ALREADY_CONSUMED', 'Materials were already recorded for this item; return them first to correct');
    }
  });

  router.get('/inventory/consumptions', requirePermission('inventory.consume'), async (req, res) => {
    const tenant = tenantOf(req);
    const { encounterId } = parseInput(z.object({ encounterId: objectIdSchema }), req.query);
    const actor = await resolveClinicalActor(tenant);
    const encounter = actor ? await EncounterModel.findOne({ organizationId: tenant.organizationId, _id: encounterId }).lean() : null;
    if (!actor || !encounter || !treats(actor, encounter)) throw notFound();
    const docs = await StockDocumentModel.find({ organizationId: tenant.organizationId, 'source.encounterId': encounter._id, type: 'consumption' })
      .sort({ createdAt: 1 })
      .lean<Lean<StockDocument>[]>();
    const moves = await StockMoveModel.find({ organizationId: tenant.organizationId, documentId: { $in: docs.map((d) => d._id) } }).lean<
      Lean<StockMove>[]
    >();
    res.json({
      consumptions: docs.map((d) => ({
        ...documentDto(d, false),
        moves: moves.filter((m) => m.documentId.equals(d._id)).map((m) => moveDto(m, false)),
      })),
    });
  });

  // Return of a consumption (materials not actually used, or recorded by mistake): the same lots
  // come back at the value they left with; the record item can then be recorded again.
  router.post('/inventory/consumptions/:documentId/return', requirePermission('inventory.consume'), async (req, res) => {
    const tenant = tenantOf(req);
    const key = requireKey(req);
    const id = parseObjectId(req.params.documentId);
    if (!id) throw notFound();
    const { reason: why } = parseInput(z.object({ reason }), req.body);
    const original = await StockDocumentModel.findOne({ organizationId: tenant.organizationId, _id: id, type: 'consumption' }).lean<
      Lean<StockDocument>
    >();
    const actor = await resolveClinicalActor(tenant);
    const encounter =
      original && actor ? await EncounterModel.findOne({ organizationId: tenant.organizationId, _id: original.source.encounterId }).lean() : null;
    if (!original || !actor || !encounter || !treats(actor, encounter)) throw notFound();
    if (original.reversedBy) throw conflict('ALREADY_RETURNED', 'These materials were already returned');
    const today = await ledgerToday(tenant.organizationId);
    await ensureCounter(tenant.organizationId, `SD:${today.slice(0, 4)}`);
    await prepareLedger(tenant.organizationId);
    const ctx = ctxOf(tenant);
    const doc = await runTransaction(async (session) => {
      const moves = await StockMoveModel.find({ organizationId: tenant.organizationId, documentId: original._id })
        .session(session)
        .lean<Lean<StockMove>[]>();
      const warehouse = await WarehouseModel.findOne({ organizationId: tenant.organizationId, _id: original.warehouseId })
        .session(session)
        .lean<Lean<Warehouse>>();
      if (!warehouse) throw notFound();
      const back = [];
      for (const m of moves) {
        const item = await StockItemModel.findOneAndUpdate(
          { organizationId: tenant.organizationId, _id: m.itemId },
          { $inc: { lockSeq: 1 } },
          { session, returnDocument: 'after' },
        ).lean<Lean<StockItem>>();
        if (!item) throw notFound();
        back.push(await stockIn(ctx, item, warehouse, { qty: -m.qty, lot: m.lot, expiry: m.expiry, value: -m.value }, session));
      }
      const created = await saveDocument(
        ctx,
        {
          _id: newId(),
          type: 'consumption_return',
          date: today,
          warehouseId: warehouse._id,
          toWarehouseId: null,
          branchId: warehouse.branchId,
          reason: why,
          source: { encounterId: original.source.encounterId, recordItemId: original.source.recordItemId, documentId: original._id },
          sourceKey: null,
          reversalOf: original._id,
          idempotencyKey: key,
          requestHash: hash([String(id), why]),
        },
        back,
        STOCK_POSTINGS.consumption_return!,
        session,
      );
      const linked = await StockDocumentModel.updateOne(
        { organizationId: tenant.organizationId, _id: original._id, reversedBy: null },
        { $set: { reversedBy: created._id, sourceKey: null } },
        { session },
      );
      if (linked.modifiedCount !== 1) throw conflict('ALREADY_RETURNED', 'These materials were already returned');
      return created;
    });
    await audit(tenant, 'stock_document.created', 'stock_document', doc._id, { number: doc.number, type: 'consumption_return', of: original.number });
    res.status(201).json({ document: documentDto(doc, false) });
  });

  return router;
}
