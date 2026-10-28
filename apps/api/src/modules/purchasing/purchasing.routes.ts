import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { Types, type ClientSession } from 'mongoose';
import { z } from 'zod';
import { runTransaction } from '../../db/transaction.js';
import { HttpError, conflict, forbidden, isDuplicateKeyError, notFound, validationError } from '../../http/errors.js';
import { objectIdSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { canAccessBranch } from '../../tenancy/scope.js';
import { parseObjectId, requirePermission, tenantCan, tenantOf, type TenantContext } from '../../tenancy/tenant-context.js';
import { DATE_PATTERN, addDays, isValidDate } from '../../time/local-time.js';
import { CashAccountModel, CashSessionModel, LedgerAccountModel } from '../accounting/accounting.model.js';
import {
  accountBalance,
  ledgerToday,
  mapped,
  postEntry,
  prepareLedger,
  settingsOf,
  type Lean,
  type LineInput,
} from '../accounting/accounting.posting.js';
import { recordAudit, type AuditAction } from '../audit/audit-event.model.js';
import { BranchModel } from '../branches/branch.model.js';
import { MAX_AMOUNT, ensureCounter, nextNumber } from '../finance/finance.model.js';
import { StockItemModel, WarehouseModel, type StockItem, type Warehouse } from '../inventory/inventory.model.js';
import { STOCK_POSTINGS, lockItem, newId, saveDocument, stockIn, stockOut } from '../inventory/inventory.stock.js';
import {
  GoodsReceiptModel,
  PurchaseOrderModel,
  PurchaseRequestModel,
  PurchaseSettingsModel,
  QuotationModel,
  RfqModel,
  SupplierBillModel,
  SupplierCreditModel,
  SupplierModel,
  SupplierPaymentModel,
  type GoodsReceipt,
  type PurchaseLine,
  type PurchaseOrder,
  type PurchaseRequest,
  type PurchaseSettings,
  type Quotation,
  type Rfq,
  type Supplier,
  type SupplierBill,
  type SupplierCredit,
  type SupplierPayment,
} from './purchasing.model.js';

// Suppliers, purchasing and payables (docs/architecture/PURCHASING.md). Requests, RFQs, orders and
// receipts belong to a branch (branch scope applies); bills, payments, credits and payables reports
// are ledger documents and need organization-wide scope. Every document is numbered, idempotent and
// never edited after the fact; corrections are returns and supplier credit notes.

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;
const dateSchema = z.string().regex(DATE_PATTERN).refine(isValidDate, 'invalid_date');
const money = z.number().int().min(0).max(MAX_AMOUNT);
const qty = z.number().int().min(1).max(1_000_000);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
const pad = (n: number) => String(n).padStart(6, '0');
const reused = () => conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different request');

function requireKey(req: Request): string {
  const key = req.get('idempotency-key') ?? '';
  if (!IDEMPOTENCY_KEY.test(key)) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header');
  return key;
}
function requireOrgWide(tenant: TenantContext) {
  if (tenant.branchScope.type !== 'all') throw forbidden('ORG_WIDE_SCOPE_REQUIRED', 'Payables need access to all branches');
}
const audit = (tenant: TenantContext, action: AuditAction, id: Types.ObjectId, changes: Record<string, unknown>, session?: ClientSession) =>
  recordAudit(
    { organizationId: tenant.organizationId, actorUserId: tenant.userId, action, target: { type: 'purchase_document', id }, changes },
    session,
  );

async function nextDoc(organizationId: Types.ObjectId, prefix: string, date: string, session: ClientSession) {
  const year = date.slice(0, 4);
  return `${prefix}-${year}-${pad(await nextNumber(organizationId, `${prefix}:${year}`, session))}`;
}
async function prepare(organizationId: Types.ObjectId, prefixes: string[]) {
  const today = await ledgerToday(organizationId);
  await Promise.all(prefixes.map((p) => ensureCounter(organizationId, `${p}:${today.slice(0, 4)}`)));
  await prepareLedger(organizationId);
  return today;
}

/** Replays a document created with the same key (same request) or refuses a reused key. */
async function replay<T extends { requestHash: string }>(find: () => Promise<T | null>, requestHash: string): Promise<T | null> {
  const previous = await find();
  if (!previous) return null;
  if (previous.requestHash !== requestHash) throw reused();
  return previous;
}

export async function purchaseSettings(
  organizationId: Types.ObjectId,
): Promise<Pick<PurchaseSettings, 'approvalThreshold' | 'separation' | 'version'>> {
  const s = await PurchaseSettingsModel.findOne({ organizationId }).lean();
  return s ?? { approvalThreshold: 0, separation: { approve: true, receive: false, pay: false }, version: 0 };
}

async function accessibleBranchId(tenant: TenantContext, id: string) {
  const branchId = new Types.ObjectId(id);
  if (!canAccessBranch(tenant, branchId) || !(await BranchModel.exists({ organizationId: tenant.organizationId, _id: branchId }))) throw notFound();
  return branchId;
}

// ---- lines ------------------------------------------------------------------------------------
const lineInput = z.object({
  itemId: objectIdSchema.optional(),
  description: z.string().trim().min(2).max(160).optional(),
  unit: z.string().trim().min(1).max(20).optional(),
  qty,
  unitPrice: money.default(0),
  expenseAccountId: objectIdSchema.optional(),
});
type LineInputT = z.infer<typeof lineInput>;

/**
 * Resolves request/order lines: a stock item in its base unit or one of its purchase units
 * (description snapshot = item name), or a non-stock purchase with a description; non-stock order
 * lines need an expense account.
 */
async function resolveLines(tenant: TenantContext, lines: LineInputT[], needExpenseAccount: boolean): Promise<PurchaseLine[]> {
  const out: PurchaseLine[] = [];
  for (const l of lines) {
    let expenseAccountId: Types.ObjectId | null = null;
    if (l.expenseAccountId) {
      const account = await LedgerAccountModel.findOne({
        organizationId: tenant.organizationId,
        _id: new Types.ObjectId(l.expenseAccountId),
        status: 'active',
        isGroup: false,
        type: { $in: ['expense', 'asset'] },
        role: null,
      }).lean();
      if (!account) throw validationError({ expenseAccountId: 'account_not_allowed' });
      expenseAccountId = account._id;
    }
    if (l.itemId) {
      const item = await StockItemModel.findOne({ organizationId: tenant.organizationId, _id: new Types.ObjectId(l.itemId), status: 'active' }).lean<
        Lean<StockItem>
      >();
      if (!item) throw validationError({ itemId: 'not_available' });
      const unit = l.unit ?? item.baseUnit;
      const factor = unit === item.baseUnit ? 1 : item.purchaseUnits.find((u) => u.unit === unit)?.factor;
      if (!factor) throw validationError({ unit: 'unknown_unit' });
      out.push({ itemId: item._id, description: item.name, unit, factor, qty: l.qty, unitPrice: l.unitPrice, expenseAccountId: null });
    } else {
      if (!l.description) throw validationError({ description: 'required' });
      if (needExpenseAccount && !expenseAccountId) throw validationError({ expenseAccountId: 'required' });
      out.push({ itemId: null, description: l.description, unit: l.unit ?? 'unit', factor: 1, qty: l.qty, unitPrice: l.unitPrice, expenseAccountId });
    }
  }
  return out;
}
const totalOf = (lines: Pick<PurchaseLine, 'qty' | 'unitPrice'>[]) => {
  const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  if (!Number.isSafeInteger(total) || total > MAX_AMOUNT) throw validationError({ lines: 'out_of_range' });
  return total;
};

// ---- DTOs -------------------------------------------------------------------------------------
const id = (v: Types.ObjectId | null | undefined) => (v ? String(v) : null);
const lineDto = (l: PurchaseLine & { received?: number; billed?: number; returned?: number }) => ({
  itemId: id(l.itemId),
  description: l.description,
  unit: l.unit,
  factor: l.factor,
  qty: l.qty,
  unitPrice: l.unitPrice,
  amount: l.qty * l.unitPrice,
  expenseAccountId: id(l.expenseAccountId),
  ...(l.received !== undefined ? { received: l.received, billed: l.billed, returned: l.returned } : {}),
});
const supplierDto = (s: Lean<Supplier>) => ({
  id: String(s._id),
  code: s.code,
  name: s.name,
  phone: s.phone,
  email: s.email,
  paymentTermsDays: s.paymentTermsDays,
  status: s.status,
  notes: s.notes,
  version: s.version,
});
const requestDto = (r: Lean<PurchaseRequest>) => ({
  id: String(r._id),
  number: r.number,
  branchId: String(r.branchId),
  requestedBy: String(r.requestedBy),
  reason: r.reason,
  lines: r.lines.map(lineDto),
  estimatedTotal: r.estimatedTotal,
  status: r.status,
  decision: r.decision
    ? { by: id(r.decision.by), at: r.decision.at.toISOString(), reason: r.decision.reason, automatic: r.decision.automatic }
    : null,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
});
const rfqDto = (r: Lean<Rfq>) => ({
  id: String(r._id),
  number: r.number,
  requestId: id(r.requestId),
  branchId: String(r.branchId),
  supplierIds: r.supplierIds.map(String),
  lines: r.lines.map(lineDto),
  dueDate: r.dueDate,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
});
const quotationDto = (q: Lean<Quotation>) => ({
  id: String(q._id),
  rfqId: String(q.rfqId),
  supplierId: String(q.supplierId),
  reference: q.reference,
  lines: q.lines,
  validUntil: q.validUntil,
  terms: q.terms,
  createdAt: q.createdAt.toISOString(),
});
const orderDto = (o: Lean<PurchaseOrder>) => ({
  id: String(o._id),
  number: o.number,
  supplierId: String(o.supplierId),
  branchId: String(o.branchId),
  warehouseId: id(o.warehouseId),
  source: { requestId: id(o.source.requestId), rfqId: id(o.source.rfqId), quotationId: id(o.source.quotationId) },
  lines: o.lines.map(lineDto),
  total: o.total,
  expectedDate: o.expectedDate,
  status: o.status,
  closeReason: o.closeReason,
  version: o.version,
  createdAt: o.createdAt.toISOString(),
});
const receiptDto = (r: Lean<GoodsReceipt>) => ({
  id: String(r._id),
  number: r.number,
  orderId: String(r.orderId),
  kind: r.kind,
  lines: r.lines,
  stockDocumentId: id(r.stockDocumentId),
  entryId: id(r.entryId),
  note: r.note,
  createdAt: r.createdAt.toISOString(),
});
export const billBalance = (b: Pick<SupplierBill, 'status' | 'total' | 'paid' | 'credited'>) =>
  b.status === 'posted' ? b.total - b.paid - b.credited : 0;
const billDto = (b: Lean<SupplierBill>) => ({
  id: String(b._id),
  number: b.number,
  supplierId: String(b.supplierId),
  supplierReference: b.supplierReference,
  orderId: id(b.orderId),
  branchId: String(b.branchId),
  billDate: b.billDate,
  dueDate: b.dueDate,
  lines: b.lines.map((l) => ({ ...l, expenseAccountId: id(l.expenseAccountId) })),
  total: b.total,
  paid: b.paid,
  credited: b.credited,
  balance: billBalance(b),
  status: b.status,
  entryId: id(b.entryId),
  createdAt: b.createdAt.toISOString(),
});
const paymentDto = (p: Lean<SupplierPayment>) => ({
  id: String(p._id),
  number: p.number,
  supplierId: String(p.supplierId),
  cashAccountId: String(p.cashAccountId),
  date: p.date,
  amount: p.amount,
  allocations: p.allocations.map((a) => ({ billId: String(a.billId), amount: a.amount })),
  reference: p.reference,
  entryId: id(p.entryId),
  createdAt: p.createdAt.toISOString(),
});
const creditDto = (c: Lean<SupplierCredit>) => ({
  id: String(c._id),
  number: c.number,
  supplierId: String(c.supplierId),
  billId: String(c.billId),
  supplierReference: c.supplierReference,
  lines: c.lines,
  amount: c.amount,
  reason: c.reason,
  stockDocumentId: id(c.stockDocumentId),
  entryId: id(c.entryId),
  createdAt: c.createdAt.toISOString(),
});

// ---- schemas ----------------------------------------------------------------------------------
const supplierSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,20}$/),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).default(''),
  email: z.string().trim().max(254).default(''),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  notes: z.string().trim().max(500).default(''),
});
const requestSchema = z.object({
  branchId: objectIdSchema,
  reason: z.string().trim().max(300).default(''),
  lines: z.array(lineInput).min(1).max(50),
});
const rfqSchema = z.object({
  requestId: objectIdSchema,
  supplierIds: z.array(objectIdSchema).min(1).max(10),
  dueDate: dateSchema.nullable().default(null),
});
const quotationSchema = z.object({
  supplierId: objectIdSchema,
  reference: z.string().trim().max(60).default(''),
  lines: z
    .array(
      z.object({
        lineIndex: z.number().int().min(0).max(99),
        unitPrice: money,
        qty: z.number().int().min(0).max(1_000_000),
        leadTimeDays: z.number().int().min(0).max(365).default(0),
      }),
    )
    .min(1)
    .max(50),
  validUntil: dateSchema.nullable().default(null),
  terms: z.string().trim().max(300).default(''),
});
const orderSchema = z.object({
  supplierId: objectIdSchema,
  branchId: objectIdSchema,
  warehouseId: objectIdSchema.optional(),
  requestId: objectIdSchema.optional(),
  quotationId: objectIdSchema.optional(),
  lines: z.array(lineInput).max(50).optional(),
  expectedDate: dateSchema.nullable().default(null),
});
const receiveSchema = z.object({
  lines: z
    .array(
      z.object({
        lineIndex: z.number().int().min(0).max(99),
        qty,
        lot: z.string().trim().max(40).default(''),
        expiry: dateSchema.nullable().default(null),
      }),
    )
    .min(1)
    .max(50),
  note: z.string().trim().max(300).default(''),
});
const returnSchema = z.object({
  lines: z
    .array(z.object({ lineIndex: z.number().int().min(0).max(99), qty, lot: z.string().trim().max(40).optional() }))
    .min(1)
    .max(50),
  note: z.string().trim().min(3).max(300),
});
const billSchema = z.object({
  supplierId: objectIdSchema,
  supplierReference: z.string().trim().min(1).max(60),
  orderId: objectIdSchema.optional(),
  branchId: objectIdSchema.optional(),
  billDate: dateSchema,
  dueDate: dateSchema.optional(),
  lines: z
    .array(
      z.object({
        orderLineIndex: z.number().int().min(0).max(99).optional(),
        description: z.string().trim().min(2).max(160).optional(),
        qty,
        unitPrice: money,
        expenseAccountId: objectIdSchema.optional(),
      }),
    )
    .min(1)
    .max(50),
});
const paymentSchema = z.object({
  supplierId: objectIdSchema,
  cashAccountId: objectIdSchema,
  amount: z.number().int().min(1).max(MAX_AMOUNT),
  allocations: z
    .array(z.object({ billId: objectIdSchema, amount: z.number().int().min(1).max(MAX_AMOUNT) }))
    .min(1)
    .max(20),
  reference: z.string().trim().max(60).default(''),
});
const creditSchema = z.object({
  supplierReference: z.string().trim().max(60).default(''),
  lines: z
    .array(z.object({ billLineIndex: z.number().int().min(0).max(99), qty, lot: z.string().trim().max(40).optional() }))
    .min(1)
    .max(50),
  reason: z.string().trim().min(3).max(300),
});

/** Locks a purchase order inside a transaction (bumps its version) and returns it. */
async function lockOrder(tenant: TenantContext, orderId: Types.ObjectId, session: ClientSession) {
  const order = await PurchaseOrderModel.findOneAndUpdate(
    { organizationId: tenant.organizationId, _id: orderId },
    { $inc: { version: 1 } },
    { session, returnDocument: 'after' },
  ).lean<Lean<PurchaseOrder>>();
  if (!order || !canAccessBranch(tenant, order.branchId)) throw notFound();
  return order;
}
async function warehouseOf(tenant: TenantContext, order: Lean<PurchaseOrder>, session: ClientSession) {
  const w = order.warehouseId
    ? await WarehouseModel.findOne({ organizationId: tenant.organizationId, _id: order.warehouseId }).session(session).lean<Lean<Warehouse>>()
    : null;
  if (!w) throw conflict('WAREHOUSE_REQUIRED', 'This order has no warehouse for stock lines');
  return w;
}

export function createPurchasingRouter() {
  const router = Router({ mergeParams: true });
  const ctxOf = (tenant: TenantContext) => ({ organizationId: tenant.organizationId, userId: tenant.userId });

  // ---- settings -------------------------------------------------------------------------------
  router.get('/purchasing/settings', requirePermission('purchase.request'), async (req, res) => {
    res.json({ settings: await purchaseSettings(tenantOf(req).organizationId) });
  });
  router.put('/purchasing/settings', requirePermission('purchase.settings.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(
      z.object({
        approvalThreshold: money,
        separation: z.object({ approve: z.boolean(), receive: z.boolean(), pay: z.boolean() }),
        version: z.number().int().min(0),
      }),
      req.body,
    );
    const current = await purchaseSettings(tenant.organizationId);
    if (current.version !== input.version) throw conflict('VERSION_CONFLICT', 'The settings were changed meanwhile');
    await PurchaseSettingsModel.updateOne(
      { organizationId: tenant.organizationId, version: input.version },
      { $set: { approvalThreshold: input.approvalThreshold, separation: input.separation }, $inc: { version: 1 } },
      { upsert: true },
    );
    await audit(tenant, 'purchase.settings_updated', tenant.organizationId, {
      approvalThreshold: input.approvalThreshold,
      separation: input.separation,
    });
    res.json({ settings: await purchaseSettings(tenant.organizationId) });
  });

  // ---- suppliers ------------------------------------------------------------------------------
  router.get('/purchasing/suppliers', requirePermission('purchase.request'), async (req, res) => {
    const tenant = tenantOf(req);
    const suppliers = await SupplierModel.find({ organizationId: tenant.organizationId }).sort({ name: 1 }).limit(500).lean<Lean<Supplier>[]>();
    res.json({ suppliers: suppliers.map(supplierDto) });
  });
  router.post('/purchasing/suppliers', requirePermission('purchase.supplier.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(supplierSchema, req.body);
    try {
      const s = await SupplierModel.create({ ...input, organizationId: tenant.organizationId });
      await audit(tenant, 'supplier.created', s._id, { code: input.code });
      res.status(201).json({ supplier: supplierDto(s.toObject() as Lean<Supplier>) });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw conflict('SUPPLIER_CODE_TAKEN', 'Another supplier has this code');
      throw err;
    }
  });
  router.patch('/purchasing/suppliers/:supplierId', requirePermission('purchase.supplier.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const sid = parseObjectId(req.params.supplierId);
    if (!sid) throw notFound();
    const input = parseInput(
      supplierSchema
        .omit({ code: true })
        .partial()
        .extend({ status: z.enum(['active', 'archived']).optional(), version: z.number().int().min(0) }),
      req.body,
    );
    const { version, ...set } = input;
    const s = await SupplierModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, _id: sid, version },
      { $set: set, $inc: { version: 1 } },
      { returnDocument: 'after' },
    ).lean<Lean<Supplier>>();
    if (!s) {
      if (await SupplierModel.exists({ organizationId: tenant.organizationId, _id: sid }))
        throw conflict('VERSION_CONFLICT', 'This supplier was changed meanwhile');
      throw notFound();
    }
    await audit(tenant, 'supplier.updated', sid, { fields: Object.keys(set) });
    res.json({ supplier: supplierDto(s) });
  });

  // ---- purchase requests -------------------------------------------------------------------
  router.get('/purchasing/requests', requirePermission('purchase.request'), async (req, res) => {
    const tenant = tenantOf(req);
    const { status } = parseInput(z.object({ status: z.enum(['submitted', 'approved', 'rejected', 'ordered', 'cancelled']).optional() }), req.query);
    const filter: Record<string, unknown> = { organizationId: tenant.organizationId, ...(status ? { status } : {}) };
    if (tenant.branchScope.type === 'selected') filter.branchId = { $in: tenant.branchScope.branchIds };
    // Requesters without purchasing access see only their own requests.
    if (!tenantCan(tenant, 'purchase.read')) filter.requestedBy = tenant.userId;
    const rows = await PurchaseRequestModel.find(filter).sort({ createdAt: -1 }).limit(200).lean<Lean<PurchaseRequest>[]>();
    res.json({ requests: rows.map(requestDto) });
  });

  router.post('/purchasing/requests', requirePermission('purchase.request'), async (req, res) => {
    const tenant = tenantOf(req);
    const key = requireKey(req);
    const input = parseInput(requestSchema, req.body);
    const requestHash = hash(input);
    const previous = await replay(
      () =>
        PurchaseRequestModel.findOne({ organizationId: tenant.organizationId, createdBy: tenant.userId, idempotencyKey: key }).lean<
          Lean<PurchaseRequest>
        >(),
      requestHash,
    );
    if (previous) return void res.json({ request: requestDto(previous), replayed: true });
    const branchId = await accessibleBranchId(tenant, input.branchId);
    const lines = await resolveLines(tenant, input.lines, false);
    const estimatedTotal = totalOf(lines);
    const settings = await purchaseSettings(tenant.organizationId);
    // Below the threshold a request is approved by policy (recorded as automatic).
    const automatic = settings.approvalThreshold > 0 && estimatedTotal < settings.approvalThreshold;
    const today = await prepare(tenant.organizationId, ['PR']);
    try {
      const created = await runTransaction(async (session) => {
        const number = await nextDoc(tenant.organizationId, 'PR', today, session);
        const [doc] = await PurchaseRequestModel.create(
          [
            {
              organizationId: tenant.organizationId,
              number,
              branchId,
              requestedBy: tenant.userId,
              reason: input.reason,
              lines,
              estimatedTotal,
              status: automatic ? 'approved' : 'submitted',
              decision: automatic ? { by: null, at: new Date(), reason: '', automatic: true } : null,
              createdBy: tenant.userId,
              idempotencyKey: key,
              requestHash,
            },
          ],
          { session },
        );
        await audit(tenant, 'purchase.request_created', doc!._id, { number, estimatedTotal, automatic }, session);
        return doc!.toObject() as Lean<PurchaseRequest>;
      });
      res.status(201).json({ request: requestDto(created), replayed: false });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const again = await replay(
        () =>
          PurchaseRequestModel.findOne({ organizationId: tenant.organizationId, createdBy: tenant.userId, idempotencyKey: key }).lean<
            Lean<PurchaseRequest>
          >(),
        requestHash,
      );
      if (!again) throw err;
      res.json({ request: requestDto(again), replayed: true });
    }
  });

  const decide = (action: 'approve' | 'reject') =>
    async function (req: Request, res: Response) {
      const tenant = tenantOf(req);
      const rid = parseObjectId(req.params.requestId);
      if (!rid) throw notFound();
      const input = parseInput(
        z.object({
          version: z.number().int().min(0),
          reason: action === 'reject' ? z.string().trim().min(3).max(300) : z.string().trim().max(300).default(''),
        }),
        req.body,
      );
      const current = await PurchaseRequestModel.findOne({ organizationId: tenant.organizationId, _id: rid }).lean<Lean<PurchaseRequest>>();
      if (!current || !canAccessBranch(tenant, current.branchId)) throw notFound();
      if (current.status !== 'submitted') throw conflict('REQUEST_NOT_PENDING', 'This request is not waiting for a decision');
      const settings = await purchaseSettings(tenant.organizationId);
      if (settings.separation.approve && current.requestedBy.equals(tenant.userId))
        throw forbidden('SEPARATION_OF_DUTIES', 'The requester cannot approve their own request');
      const updated = await PurchaseRequestModel.findOneAndUpdate(
        { organizationId: tenant.organizationId, _id: rid, status: 'submitted', version: input.version },
        {
          $set: {
            status: action === 'approve' ? 'approved' : 'rejected',
            decision: { by: tenant.userId, at: new Date(), reason: input.reason, automatic: false },
          },
          $inc: { version: 1 },
        },
        { returnDocument: 'after' },
      ).lean<Lean<PurchaseRequest>>();
      if (!updated) throw conflict('VERSION_CONFLICT', 'This request was changed meanwhile');
      await audit(tenant, action === 'approve' ? 'purchase.request_approved' : 'purchase.request_rejected', rid, { number: current.number });
      res.json({ request: requestDto(updated) });
    };
  router.post('/purchasing/requests/:requestId/approve', requirePermission('purchase.approve'), decide('approve'));
  router.post('/purchasing/requests/:requestId/reject', requirePermission('purchase.approve'), decide('reject'));
  router.post('/purchasing/requests/:requestId/cancel', requirePermission('purchase.request'), async (req, res) => {
    const tenant = tenantOf(req);
    const rid = parseObjectId(req.params.requestId);
    if (!rid) throw notFound();
    const current = await PurchaseRequestModel.findOne({ organizationId: tenant.organizationId, _id: rid }).lean<Lean<PurchaseRequest>>();
    if (!current || !canAccessBranch(tenant, current.branchId)) throw notFound();
    if (!current.requestedBy.equals(tenant.userId) && !tenantCan(tenant, 'purchase.approve')) throw notFound();
    const updated = await PurchaseRequestModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, _id: rid, status: { $in: ['submitted', 'approved'] } },
      { $set: { status: 'cancelled' }, $inc: { version: 1 } },
      { returnDocument: 'after' },
    ).lean<Lean<PurchaseRequest>>();
    if (!updated) throw conflict('REQUEST_NOT_CANCELLABLE', 'Only open requests can be cancelled');
    await audit(tenant, 'purchase.request_cancelled', rid, { number: current.number });
    res.json({ request: requestDto(updated) });
  });

  // ---- RFQs and quotations ------------------------------------------------------------------
  router.post('/purchasing/rfqs', requirePermission('purchase.order.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const key = requireKey(req);
    const input = parseInput(rfqSchema, req.body);
    const requestHash = hash(input);
    const previous = await replay(
      () => RfqModel.findOne({ organizationId: tenant.organizationId, createdBy: tenant.userId, idempotencyKey: key }).lean<Lean<Rfq>>(),
      requestHash,
    );
    if (previous) return void res.json({ rfq: rfqDto(previous), replayed: true });
    const request = await PurchaseRequestModel.findOne({ organizationId: tenant.organizationId, _id: new Types.ObjectId(input.requestId) }).lean<
      Lean<PurchaseRequest>
    >();
    if (!request || !canAccessBranch(tenant, request.branchId)) throw notFound();
    if (request.status !== 'approved') throw conflict('REQUEST_NOT_APPROVED', 'Quotations are requested for approved requests');
    const supplierIds = [...new Set(input.supplierIds)].map((s) => new Types.ObjectId(s));
    if (
      (await SupplierModel.countDocuments({ organizationId: tenant.organizationId, _id: { $in: supplierIds }, status: 'active' })) !==
      supplierIds.length
    )
      throw validationError({ supplierIds: 'not_available' });
    const today = await prepare(tenant.organizationId, ['RFQ']);
    const rfq = await runTransaction(async (session) => {
      const number = await nextDoc(tenant.organizationId, 'RFQ', today, session);
      const [doc] = await RfqModel.create(
        [
          {
            organizationId: tenant.organizationId,
            number,
            requestId: request._id,
            branchId: request.branchId,
            supplierIds,
            lines: request.lines,
            dueDate: input.dueDate,
            createdBy: tenant.userId,
            idempotencyKey: key,
            requestHash,
          },
        ],
        { session },
      );
      await audit(tenant, 'purchase.rfq_created', doc!._id, { number, suppliers: supplierIds.length }, session);
      return doc!.toObject() as Lean<Rfq>;
    });
    res.status(201).json({ rfq: rfqDto(rfq), replayed: false });
  });

  router.get('/purchasing/rfqs', requirePermission('purchase.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const filter: Record<string, unknown> = { organizationId: tenant.organizationId };
    if (tenant.branchScope.type === 'selected') filter.branchId = { $in: tenant.branchScope.branchIds };
    const rows = await RfqModel.find(filter).sort({ createdAt: -1 }).limit(200).lean<Lean<Rfq>[]>();
    res.json({ rfqs: rows.map(rfqDto) });
  });

  // The RFQ with its quotations and a per-line comparison (lowest price, shortest lead time).
  router.get('/purchasing/rfqs/:rfqId', requirePermission('purchase.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const rid = parseObjectId(req.params.rfqId);
    if (!rid) throw notFound();
    const rfq = await RfqModel.findOne({ organizationId: tenant.organizationId, _id: rid }).lean<Lean<Rfq>>();
    if (!rfq || !canAccessBranch(tenant, rfq.branchId)) throw notFound();
    const quotations = await QuotationModel.find({ organizationId: tenant.organizationId, rfqId: rid }).lean<Lean<Quotation>[]>();
    const comparison = rfq.lines.map((line, lineIndex) => {
      const offers = quotations
        .flatMap((q) =>
          q.lines
            .filter((l) => l.lineIndex === lineIndex && l.qty > 0)
            .map((l) => ({ supplierId: String(q.supplierId), quotationId: String(q._id), ...l, covers: l.qty >= line.qty })),
        )
        .sort((a, b) => a.unitPrice - b.unitPrice || a.leadTimeDays - b.leadTimeDays);
      return {
        lineIndex,
        description: line.description,
        qty: line.qty,
        unit: line.unit,
        offers,
        bestPrice: offers[0]?.supplierId ?? null,
        fastest: [...offers].sort((a, b) => a.leadTimeDays - b.leadTimeDays)[0]?.supplierId ?? null,
      };
    });
    const totals = quotations.map((q) => ({
      supplierId: String(q.supplierId),
      quotationId: String(q._id),
      total: q.lines.reduce((s, l) => s + Math.min(l.qty, rfq.lines[l.lineIndex]?.qty ?? 0) * l.unitPrice, 0),
      linesCovered: q.lines.filter((l) => l.qty >= (rfq.lines[l.lineIndex]?.qty ?? Infinity)).length,
      maxLeadTimeDays: Math.max(0, ...q.lines.map((l) => l.leadTimeDays)),
    }));
    res.json({ rfq: rfqDto(rfq), quotations: quotations.map(quotationDto), comparison, totals });
  });

  router.put('/purchasing/rfqs/:rfqId/quotations', requirePermission('purchase.order.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const rid = parseObjectId(req.params.rfqId);
    if (!rid) throw notFound();
    const input = parseInput(quotationSchema, req.body);
    const rfq = await RfqModel.findOne({ organizationId: tenant.organizationId, _id: rid }).lean<Lean<Rfq>>();
    if (!rfq || !canAccessBranch(tenant, rfq.branchId)) throw notFound();
    if (rfq.status !== 'open') throw conflict('RFQ_CLOSED', 'This request for quotation is no longer open');
    const supplierId = new Types.ObjectId(input.supplierId);
    if (!rfq.supplierIds.some((s) => s.equals(supplierId))) throw validationError({ supplierId: 'not_invited' });
    if (input.lines.some((l) => l.lineIndex >= rfq.lines.length) || new Set(input.lines.map((l) => l.lineIndex)).size !== input.lines.length)
      throw validationError({ lines: 'invalid_reference' });
    const q = await QuotationModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, rfqId: rid, supplierId },
      { $set: { reference: input.reference, lines: input.lines, validUntil: input.validUntil, terms: input.terms, createdBy: tenant.userId } },
      { upsert: true, returnDocument: 'after' },
    ).lean<Lean<Quotation>>();
    await audit(tenant, 'purchase.quotation_recorded', rid, { supplier: input.supplierId, lines: input.lines.length });
    res.json({ quotation: quotationDto(q!) });
  });

  router.post('/purchasing/rfqs/:rfqId/close', requirePermission('purchase.order.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const rid = parseObjectId(req.params.rfqId);
    if (!rid) throw notFound();
    const rfq = await RfqModel.findOneAndUpdate(
      {
        organizationId: tenant.organizationId,
        _id: rid,
        status: 'open',
        ...(tenant.branchScope.type === 'selected' ? { branchId: { $in: tenant.branchScope.branchIds } } : {}),
      },
      { $set: { status: 'closed' } },
      { returnDocument: 'after' },
    ).lean<Lean<Rfq>>();
    if (!rfq) throw conflict('RFQ_CLOSED', 'This request for quotation is no longer open');
    res.json({ rfq: rfqDto(rfq) });
  });

  // ---- purchase orders ----------------------------------------------------------------------
  // From a quotation (lines and prices from the offer), from an approved request, or direct when
  // the total stays below the approval threshold. Stock lines need a warehouse of the branch.
  router.post('/purchasing/orders', requirePermission('purchase.order.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const key = requireKey(req);
    const input = parseInput(orderSchema, req.body);
    const requestHash = hash(input);
    const previous = await replay(
      () =>
        PurchaseOrderModel.findOne({ organizationId: tenant.organizationId, createdBy: tenant.userId, idempotencyKey: key }).lean<
          Lean<PurchaseOrder>
        >(),
      requestHash,
    );
    if (previous) return void res.json({ order: orderDto(previous), replayed: true });
    const branchId = await accessibleBranchId(tenant, input.branchId);
    const supplier = await SupplierModel.findOne({
      organizationId: tenant.organizationId,
      _id: new Types.ObjectId(input.supplierId),
      status: 'active',
    }).lean();
    if (!supplier) throw validationError({ supplierId: 'not_available' });
    let lines: PurchaseLine[];
    let request: Lean<PurchaseRequest> | null = null;
    let rfq: Lean<Rfq> | null = null;
    let quotation: Lean<Quotation> | null = null;
    if (input.quotationId) {
      quotation = await QuotationModel.findOne({ organizationId: tenant.organizationId, _id: new Types.ObjectId(input.quotationId) }).lean<
        Lean<Quotation>
      >();
      rfq = quotation ? await RfqModel.findOne({ organizationId: tenant.organizationId, _id: quotation.rfqId }).lean<Lean<Rfq>>() : null;
      if (!quotation || !rfq || !canAccessBranch(tenant, rfq.branchId)) throw notFound();
      if (!quotation.supplierId.equals(supplier._id) || !rfq.branchId.equals(branchId)) throw validationError({ quotationId: 'mismatch' });
      if (rfq.status !== 'open') throw conflict('RFQ_CLOSED', 'This request for quotation is no longer open');
      request = rfq.requestId
        ? await PurchaseRequestModel.findOne({ organizationId: tenant.organizationId, _id: rfq.requestId }).lean<Lean<PurchaseRequest>>()
        : null;
      lines = quotation.lines
        .filter((l) => l.qty > 0)
        .map((l) => ({ ...rfq!.lines[l.lineIndex]!, qty: Math.min(l.qty, rfq!.lines[l.lineIndex]!.qty), unitPrice: l.unitPrice }));
      // Non-stock lines can take an expense account from the order request body by position.
      lines = lines.map((l, i) =>
        l.itemId || l.expenseAccountId
          ? l
          : { ...l, expenseAccountId: input.lines?.[i]?.expenseAccountId ? new Types.ObjectId(input.lines[i]!.expenseAccountId) : null },
      );
    } else if (input.requestId) {
      request = await PurchaseRequestModel.findOne({ organizationId: tenant.organizationId, _id: new Types.ObjectId(input.requestId) }).lean<
        Lean<PurchaseRequest>
      >();
      if (!request || !canAccessBranch(tenant, request.branchId)) throw notFound();
      if (!request.branchId.equals(branchId)) throw validationError({ requestId: 'mismatch' });
      lines = input.lines ? await resolveLines(tenant, input.lines, true) : request.lines;
    } else {
      if (!input.lines?.length) throw validationError({ lines: 'required' });
      lines = await resolveLines(tenant, input.lines, true);
    }
    if (request && request.status !== 'approved') throw conflict('REQUEST_NOT_APPROVED', 'Orders are placed for approved requests');
    if (lines.some((l) => !l.itemId && !l.expenseAccountId)) throw validationError({ expenseAccountId: 'required' });
    if (lines.some((l) => l.unitPrice <= 0)) throw validationError({ unitPrice: 'required' });
    const total = totalOf(lines);
    const settings = await purchaseSettings(tenant.organizationId);
    if (!request && total >= settings.approvalThreshold)
      throw conflict('APPROVAL_REQUIRED', 'Orders at or above the approval threshold need an approved request');
    let warehouseId: Types.ObjectId | null = null;
    if (lines.some((l) => l.itemId)) {
      if (!input.warehouseId) throw validationError({ warehouseId: 'required' });
      const w = await WarehouseModel.findOne({
        organizationId: tenant.organizationId,
        _id: new Types.ObjectId(input.warehouseId),
        branchId,
        status: 'active',
      }).lean();
      if (!w) throw validationError({ warehouseId: 'not_available' });
      warehouseId = w._id;
    }
    const today = await prepare(tenant.organizationId, ['PO']);
    const order = await runTransaction(async (session) => {
      const number = await nextDoc(tenant.organizationId, 'PO', today, session);
      const [doc] = await PurchaseOrderModel.create(
        [
          {
            organizationId: tenant.organizationId,
            number,
            supplierId: supplier._id,
            branchId,
            warehouseId,
            source: { requestId: request?._id ?? null, rfqId: rfq?._id ?? null, quotationId: quotation?._id ?? null },
            lines: lines.map((l) => ({ ...l, received: 0, billed: 0, returned: 0 })),
            total,
            expectedDate: input.expectedDate,
            createdBy: tenant.userId,
            idempotencyKey: key,
            requestHash,
          },
        ],
        { session },
      );
      if (request) {
        const moved = await PurchaseRequestModel.updateOne(
          { organizationId: tenant.organizationId, _id: request._id, status: 'approved' },
          { $set: { status: 'ordered' }, $inc: { version: 1 } },
          { session },
        );
        if (moved.modifiedCount !== 1) throw conflict('REQUEST_NOT_APPROVED', 'This request was ordered or changed meanwhile');
      }
      if (rfq) await RfqModel.updateOne({ organizationId: tenant.organizationId, _id: rfq._id }, { $set: { status: 'awarded' } }, { session });
      await audit(tenant, 'purchase.order_created', doc!._id, { number, total, supplier: supplier.code }, session);
      return doc!.toObject() as Lean<PurchaseOrder>;
    });
    res.status(201).json({ order: orderDto(order), replayed: false });
  });

  router.get('/purchasing/orders', requirePermission('purchase.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const { status } = parseInput(z.object({ status: z.enum(['draft', 'confirmed', 'received', 'closed', 'cancelled']).optional() }), req.query);
    const filter: Record<string, unknown> = { organizationId: tenant.organizationId, ...(status ? { status } : {}) };
    if (tenant.branchScope.type === 'selected') filter.branchId = { $in: tenant.branchScope.branchIds };
    const rows = await PurchaseOrderModel.find(filter).sort({ createdAt: -1 }).limit(200).lean<Lean<PurchaseOrder>[]>();
    res.json({ orders: rows.map(orderDto) });
  });

  router.get('/purchasing/orders/:orderId', requirePermission('purchase.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const oid = parseObjectId(req.params.orderId);
    if (!oid) throw notFound();
    const order = await PurchaseOrderModel.findOne({ organizationId: tenant.organizationId, _id: oid }).lean<Lean<PurchaseOrder>>();
    if (!order || !canAccessBranch(tenant, order.branchId)) throw notFound();
    const [supplier, receipts, bills, branch] = await Promise.all([
      SupplierModel.findOne({ organizationId: tenant.organizationId, _id: order.supplierId }).lean<Lean<Supplier>>(),
      GoodsReceiptModel.find({ organizationId: tenant.organizationId, orderId: oid }).sort({ createdAt: 1 }).lean<Lean<GoodsReceipt>[]>(),
      tenant.branchScope.type === 'all' && tenantCan(tenant, 'purchase.bill.manage')
        ? SupplierBillModel.find({ organizationId: tenant.organizationId, orderId: oid }).sort({ createdAt: 1 }).lean<Lean<SupplierBill>[]>()
        : Promise.resolve([] as Lean<SupplierBill>[]),
      BranchModel.findOne({ organizationId: tenant.organizationId, _id: order.branchId }).select('name city').lean(),
    ]);
    res.json({
      order: orderDto(order),
      supplier: supplier ? supplierDto(supplier) : null,
      branch: branch ? { name: branch.name, city: branch.city } : null,
      receipts: receipts.map(receiptDto),
      bills: bills.map(billDto),
    });
  });

  const transition = (
    from: PurchaseOrder['status'][],
    to: PurchaseOrder['status'],
    action: AuditAction,
    guardFn?: (o: Lean<PurchaseOrder>) => void,
  ) =>
    async function (req: Request, res: Response) {
      const tenant = tenantOf(req);
      const oid = parseObjectId(req.params.orderId);
      if (!oid) throw notFound();
      const input = parseInput(z.object({ version: z.number().int().min(0), reason: z.string().trim().max(300).default('') }), req.body);
      const current = await PurchaseOrderModel.findOne({ organizationId: tenant.organizationId, _id: oid }).lean<Lean<PurchaseOrder>>();
      if (!current || !canAccessBranch(tenant, current.branchId)) throw notFound();
      if (!from.includes(current.status)) throw conflict('ORDER_STATUS', 'This order cannot change that way now');
      guardFn?.(current);
      if (to === 'closed' && input.reason.length < 3) throw validationError({ reason: 'too_short' });
      const updated = await PurchaseOrderModel.findOneAndUpdate(
        { organizationId: tenant.organizationId, _id: oid, version: input.version, status: current.status },
        { $set: { status: to, ...(to === 'closed' || to === 'cancelled' ? { closeReason: input.reason } : {}) }, $inc: { version: 1 } },
        { returnDocument: 'after' },
      ).lean<Lean<PurchaseOrder>>();
      if (!updated) throw conflict('VERSION_CONFLICT', 'This order was changed meanwhile');
      await audit(tenant, action, oid, { number: current.number });
      res.json({ order: orderDto(updated) });
    };
  router.post(
    '/purchasing/orders/:orderId/confirm',
    requirePermission('purchase.order.manage'),
    transition(['draft'], 'confirmed', 'purchase.order_confirmed'),
  );
  router.post(
    '/purchasing/orders/:orderId/cancel',
    requirePermission('purchase.order.manage'),
    transition(['draft', 'confirmed'], 'cancelled', 'purchase.order_cancelled', (o) => {
      if (o.lines.some((l) => l.received > 0 || l.billed > 0)) throw conflict('ORDER_HAS_RECEIPTS', 'Orders with receipts are closed, not cancelled');
    }),
  );
  // Short-close: what was received stays (and can be billed); nothing more can be received.
  router.post(
    '/purchasing/orders/:orderId/close',
    requirePermission('purchase.order.manage'),
    transition(['confirmed', 'received'], 'closed', 'purchase.order_closed'),
  );

  // ---- receipts and returns -----------------------------------------------------------------
  router.post('/purchasing/orders/:orderId/receipts', requirePermission('purchase.receive'), async (req, res) => {
    const tenant = tenantOf(req);
    const key = requireKey(req);
    const oid = parseObjectId(req.params.orderId);
    if (!oid) throw notFound();
    const input = parseInput(receiveSchema, req.body);
    const requestHash = hash([String(oid), input]);
    const previous = await replay(
      () =>
        GoodsReceiptModel.findOne({ organizationId: tenant.organizationId, createdBy: tenant.userId, idempotencyKey: key }).lean<
          Lean<GoodsReceipt>
        >(),
      requestHash,
    );
    if (previous) return void res.json({ receipt: receiptDto(previous), replayed: true });
    const settings = await purchaseSettings(tenant.organizationId);
    const today = await prepare(tenant.organizationId, ['GRN', 'SD']);
    const ctx = ctxOf(tenant);
    try {
      const receipt = await runTransaction(async (session) => {
        const order = await lockOrder(tenant, oid, session);
        if (order.status !== 'confirmed') throw conflict('ORDER_STATUS', 'Only confirmed orders can be received');
        if (settings.separation.receive && order.createdBy.equals(tenant.userId))
          throw forbidden('SEPARATION_OF_DUTIES', 'The person who placed the order cannot receive it');
        const lines = order.lines.map((l) => ({ ...l }));
        const moves = [];
        let warehouse: Lean<Warehouse> | null = null;
        for (const r of input.lines) {
          const line = lines[r.lineIndex];
          if (!line) throw validationError({ lineIndex: 'invalid_reference' });
          if (line.received + r.qty > line.qty) throw conflict('OVER_RECEIPT', 'More than ordered', { lineIndex: r.lineIndex });
          line.received += r.qty;
          if (line.itemId) {
            warehouse ??= await warehouseOf(tenant, order, session);
            const item = await lockItem(ctx, line.itemId, session);
            // Stock comes in at the order price; the bill later settles price differences.
            moves.push(
              await stockIn(ctx, item, warehouse, { qty: r.qty * line.factor, lot: r.lot, expiry: r.expiry, value: r.qty * line.unitPrice }, session),
            );
          }
        }
        const status = lines.every((l) => l.received >= l.qty) ? 'received' : 'confirmed';
        await PurchaseOrderModel.updateOne({ organizationId: tenant.organizationId, _id: oid }, { $set: { lines, status } }, { session });
        const number = await nextDoc(tenant.organizationId, 'GRN', today, session);
        const stockDoc = moves.length
          ? await saveDocument(
              ctx,
              {
                _id: newId(),
                type: 'receipt',
                date: today,
                warehouseId: warehouse!._id,
                toWarehouseId: null,
                branchId: order.branchId,
                reason: `${order.number} ${number}`,
                source: { encounterId: null, recordItemId: null, documentId: order._id },
                sourceKey: null,
                reversalOf: null,
                idempotencyKey: `grn-${key}`.slice(0, 100),
                requestHash,
              },
              moves,
              STOCK_POSTINGS.receipt!,
              session,
            )
          : null;
        const [doc] = await GoodsReceiptModel.create(
          [
            {
              organizationId: tenant.organizationId,
              number,
              orderId: oid,
              branchId: order.branchId,
              kind: 'receipt',
              lines: input.lines,
              stockDocumentId: stockDoc?._id ?? null,
              entryId: stockDoc?.entryId ?? null,
              note: input.note,
              createdBy: tenant.userId,
              idempotencyKey: key,
              requestHash,
            },
          ],
          { session },
        );
        await audit(tenant, 'purchase.goods_received', doc!._id, { number, order: order.number, lines: input.lines.length }, session);
        return doc!.toObject() as Lean<GoodsReceipt>;
      });
      res.status(201).json({ receipt: receiptDto(receipt), replayed: false });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const again = await replay(
        () =>
          GoodsReceiptModel.findOne({ organizationId: tenant.organizationId, createdBy: tenant.userId, idempotencyKey: key }).lean<
            Lean<GoodsReceipt>
          >(),
        requestHash,
      );
      if (!again) throw err;
      res.json({ receipt: receiptDto(again), replayed: true });
    }
  });

  // Return of received goods not yet billed: stock leaves at average cost; goods received not
  // billed is cleared at the order price; any difference is a purchase price difference.
  router.post('/purchasing/orders/:orderId/returns', requirePermission('purchase.receive'), async (req, res) => {
    const tenant = tenantOf(req);
    const key = requireKey(req);
    const oid = parseObjectId(req.params.orderId);
    if (!oid) throw notFound();
    const input = parseInput(returnSchema, req.body);
    const requestHash = hash([String(oid), input]);
    const previous = await replay(
      () =>
        GoodsReceiptModel.findOne({ organizationId: tenant.organizationId, createdBy: tenant.userId, idempotencyKey: key }).lean<
          Lean<GoodsReceipt>
        >(),
      requestHash,
    );
    if (previous) return void res.json({ receipt: receiptDto(previous), replayed: true });
    const today = await prepare(tenant.organizationId, ['PRT', 'SD']);
    const ctx = ctxOf(tenant);
    const result = await runTransaction(async (session) => {
      const order = await lockOrder(tenant, oid, session);
      if (order.status === 'cancelled') throw conflict('ORDER_STATUS', 'This order is cancelled');
      const lines = order.lines.map((l) => ({ ...l }));
      const moves = [];
      let atOrderPrice = 0;
      let warehouse: Lean<Warehouse> | null = null;
      for (const r of input.lines) {
        const line = lines[r.lineIndex];
        if (!line) throw validationError({ lineIndex: 'invalid_reference' });
        if (r.qty > line.received - line.billed)
          throw conflict(
            'RETURN_EXCEEDS_UNBILLED',
            'Only received, not yet billed quantities can be returned; use a supplier credit note after billing',
          );
        line.received -= r.qty;
        line.returned += r.qty;
        if (line.itemId) {
          warehouse ??= await warehouseOf(tenant, order, session);
          const item = await lockItem(ctx, line.itemId, session);
          moves.push(...(await stockOut(ctx, item, warehouse, { qty: r.qty * line.factor, lot: r.lot }, today, { allowExpired: true }, session)));
          atOrderPrice += r.qty * line.unitPrice;
        }
      }
      const status = order.status === 'received' && lines.some((l) => l.received < l.qty) ? 'confirmed' : order.status;
      await PurchaseOrderModel.updateOne({ organizationId: tenant.organizationId, _id: oid }, { $set: { lines, status } }, { session });
      const number = await nextDoc(tenant.organizationId, 'PRT', today, session);
      let stockDoc = null;
      let entryId: Types.ObjectId | null = null;
      if (moves.length) {
        stockDoc = await saveDocument(
          ctx,
          {
            _id: newId(),
            type: 'purchase_return',
            date: today,
            warehouseId: warehouse!._id,
            toWarehouseId: null,
            branchId: order.branchId,
            reason: `${order.number} ${number}`,
            source: { encounterId: null, recordItemId: null, documentId: order._id },
            sourceKey: null,
            reversalOf: null,
            idempotencyKey: `prt-${key}`.slice(0, 100),
            requestHash,
          },
          moves,
          null,
          session,
        );
        const cost = -moves.reduce((s, m) => s + m.value, 0);
        const settings = await settingsOf(tenant.organizationId, session);
        if (settings && today >= settings.cutoverDate) {
          const variance = atOrderPrice - cost;
          const entry = await postEntry(
            {
              ...ctx,
              date: today,
              journal: 'purchases',
              memo: number,
              lines: [
                {
                  accountId: mapped(settings, 'grni'),
                  debit: atOrderPrice,
                  branchId: order.branchId,
                  partner: { type: 'supplier', id: order.supplierId },
                },
                { accountId: mapped(settings, 'inventory'), credit: cost, branchId: order.branchId },
                {
                  accountId: mapped(settings, 'purchaseVariance'),
                  debit: Math.max(-variance, 0),
                  credit: Math.max(variance, 0),
                  branchId: order.branchId,
                },
              ],
              source: { type: 'purchase_return', id: stockDoc._id, event: 'returned' },
            },
            session,
            settings,
          );
          entryId = entry._id;
        }
      }
      const [doc] = await GoodsReceiptModel.create(
        [
          {
            organizationId: tenant.organizationId,
            number,
            orderId: oid,
            branchId: order.branchId,
            kind: 'return',
            lines: input.lines.map((l) => ({ lineIndex: l.lineIndex, qty: l.qty, lot: l.lot ?? '', expiry: null })),
            stockDocumentId: stockDoc?._id ?? null,
            entryId,
            note: input.note,
            createdBy: tenant.userId,
            idempotencyKey: key,
            requestHash,
          },
        ],
        { session },
      );
      await audit(tenant, 'purchase.goods_returned', doc!._id, { number, order: order.number }, session);
      return doc!.toObject() as Lean<GoodsReceipt>;
    });
    res.status(201).json({ receipt: receiptDto(result), replayed: false });
  });

  // ---- supplier bills ------------------------------------------------------------------------
  /** Posts a bill: goods received not billed at order price, price differences, expenses → payable. */
  async function postBill(tenant: TenantContext, bill: Lean<SupplierBill>, order: Lean<PurchaseOrder> | null, session: ClientSession) {
    const settings = await settingsOf(tenant.organizationId, session);
    if (!settings || bill.billDate < settings.cutoverDate) return null;
    const lines: LineInput[] = [];
    for (const l of bill.lines) {
      const orderLine = order && l.orderLineIndex !== null ? order.lines[l.orderLineIndex] : null;
      if (orderLine?.itemId) {
        const atOrder = l.qty * orderLine.unitPrice;
        const diff = l.amount - atOrder;
        lines.push({
          accountId: mapped(settings, 'grni'),
          debit: atOrder,
          branchId: bill.branchId,
          partner: { type: 'supplier', id: bill.supplierId },
        });
        lines.push({
          accountId: mapped(settings, 'purchaseVariance'),
          debit: Math.max(diff, 0),
          credit: Math.max(-diff, 0),
          branchId: bill.branchId,
        });
      } else {
        const account = l.expenseAccountId ?? orderLine?.expenseAccountId;
        if (!account) throw validationError({ expenseAccountId: 'required' });
        lines.push({ accountId: account, debit: l.amount, branchId: bill.branchId });
      }
    }
    lines.push({
      accountId: mapped(settings, 'payable'),
      credit: bill.total,
      branchId: bill.branchId,
      partner: { type: 'supplier', id: bill.supplierId },
    });
    const entry = await postEntry(
      {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        date: bill.billDate,
        journal: 'purchases',
        memo: `${bill.number} ${bill.supplierReference}`.slice(0, 200),
        lines,
        source: { type: 'supplier_bill', id: bill._id, event: 'posted' },
      },
      session,
      settings,
    );
    await SupplierBillModel.updateOne({ organizationId: tenant.organizationId, _id: bill._id }, { $set: { entryId: entry._id } }, { session });
    return entry;
  }

  router.get('/purchasing/bills', requirePermission('purchase.bill.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const { status, supplierId } = parseInput(
      z.object({ status: z.enum(['awaiting_approval', 'posted', 'rejected']).optional(), supplierId: objectIdSchema.optional() }),
      req.query,
    );
    const rows = await SupplierBillModel.find({
      organizationId: tenant.organizationId,
      ...(status ? { status } : {}),
      ...(supplierId ? { supplierId: new Types.ObjectId(supplierId) } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(300)
      .lean<Lean<SupplierBill>[]>();
    res.json({ bills: rows.map(billDto) });
  });

  router.get('/purchasing/bills/:billId', requirePermission('purchase.bill.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const bid = parseObjectId(req.params.billId);
    if (!bid) throw notFound();
    const bill = await SupplierBillModel.findOne({ organizationId: tenant.organizationId, _id: bid }).lean<Lean<SupplierBill>>();
    if (!bill) throw notFound();
    const [payments, credits] = await Promise.all([
      SupplierPaymentModel.find({ organizationId: tenant.organizationId, 'allocations.billId': bid }).lean<Lean<SupplierPayment>[]>(),
      SupplierCreditModel.find({ organizationId: tenant.organizationId, billId: bid }).lean<Lean<SupplierCredit>[]>(),
    ]);
    res.json({ bill: billDto(bill), payments: payments.map(paymentDto), credits: credits.map(creditDto) });
  });

  router.post('/purchasing/bills', requirePermission('purchase.bill.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const key = requireKey(req);
    const input = parseInput(billSchema, req.body);
    const requestHash = hash(input);
    const previous = await replay(
      () =>
        SupplierBillModel.findOne({ organizationId: tenant.organizationId, createdBy: tenant.userId, idempotencyKey: key }).lean<
          Lean<SupplierBill>
        >(),
      requestHash,
    );
    if (previous) return void res.json({ bill: billDto(previous), replayed: true });
    const supplier = await SupplierModel.findOne({ organizationId: tenant.organizationId, _id: new Types.ObjectId(input.supplierId) }).lean<
      Lean<Supplier>
    >();
    if (!supplier) throw validationError({ supplierId: 'not_available' });
    const today = await prepare(tenant.organizationId, ['BILL']);
    if (input.billDate > today) throw validationError({ billDate: 'in_future' });
    const settings = await purchaseSettings(tenant.organizationId);
    try {
      const bill = await runTransaction(async (session) => {
        let order: Lean<PurchaseOrder> | null = null;
        let branchId: Types.ObjectId;
        const lines = [];
        if (input.orderId) {
          order = await lockOrder(tenant, new Types.ObjectId(input.orderId), session);
          if (!order.supplierId.equals(supplier._id)) throw validationError({ orderId: 'other_supplier' });
          if (order.status === 'cancelled' || order.status === 'draft') throw conflict('ORDER_STATUS', 'This order cannot be billed');
          branchId = order.branchId;
          const orderLines = order.lines.map((l) => ({ ...l }));
          for (const l of input.lines) {
            const line = l.orderLineIndex === undefined ? undefined : orderLines[l.orderLineIndex];
            if (!line) throw validationError({ orderLineIndex: 'required' });
            // 3-way match: only received, not yet billed quantities.
            if (l.qty > line.received - line.billed)
              throw conflict('OVER_BILLING', 'More than received and not yet billed', { lineIndex: l.orderLineIndex });
            line.billed += l.qty;
            lines.push({
              orderLineIndex: l.orderLineIndex!,
              description: line.description,
              qty: l.qty,
              unitPrice: l.unitPrice,
              amount: l.qty * l.unitPrice,
              expenseAccountId: line.expenseAccountId,
              credited: 0,
            });
          }
          await PurchaseOrderModel.updateOne({ organizationId: tenant.organizationId, _id: order._id }, { $set: { lines: orderLines } }, { session });
        } else {
          if (!input.branchId) throw validationError({ branchId: 'required' });
          branchId = await accessibleBranchId(tenant, input.branchId);
          for (const l of input.lines) {
            if (!l.description || !l.expenseAccountId) throw validationError({ expenseAccountId: 'required' });
            const account = await LedgerAccountModel.findOne({
              organizationId: tenant.organizationId,
              _id: new Types.ObjectId(l.expenseAccountId),
              status: 'active',
              isGroup: false,
              type: { $in: ['expense', 'asset'] },
              role: null,
            })
              .session(session)
              .lean();
            if (!account) throw validationError({ expenseAccountId: 'account_not_allowed' });
            lines.push({
              orderLineIndex: null,
              description: l.description,
              qty: l.qty,
              unitPrice: l.unitPrice,
              amount: l.qty * l.unitPrice,
              expenseAccountId: account._id,
              credited: 0,
            });
          }
        }
        const total = totalOf(lines);
        if (total <= 0) throw validationError({ lines: 'out_of_range' });
        // Direct expense bills at or above the threshold wait for an approver; order bills were approved upstream.
        const needsApproval = !order && total >= settings.approvalThreshold;
        const number = await nextDoc(tenant.organizationId, 'BILL', today, session);
        const [doc] = await SupplierBillModel.create(
          [
            {
              organizationId: tenant.organizationId,
              number,
              supplierId: supplier._id,
              supplierReference: input.supplierReference,
              orderId: order?._id ?? null,
              branchId,
              billDate: input.billDate,
              dueDate: input.dueDate ?? addDays(input.billDate, supplier.paymentTermsDays),
              lines,
              total,
              status: needsApproval ? 'awaiting_approval' : 'posted',
              createdBy: tenant.userId,
              idempotencyKey: key,
              requestHash,
            },
          ],
          { session },
        );
        const created = doc!.toObject() as Lean<SupplierBill>;
        if (!needsApproval) {
          const entry = await postBill(tenant, created, order, session);
          created.entryId = entry?._id ?? null;
        }
        await audit(
          tenant,
          'purchase.bill_recorded',
          created._id,
          { number, total, supplier: supplier.code, awaitingApproval: needsApproval },
          session,
        );
        return created;
      });
      res.status(201).json({ bill: billDto(bill), replayed: false });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const again = await SupplierBillModel.findOne({ organizationId: tenant.organizationId, createdBy: tenant.userId, idempotencyKey: key }).lean<
        Lean<SupplierBill>
      >();
      if (again && again.requestHash === requestHash) return void res.json({ bill: billDto(again), replayed: true });
      if (again) throw reused();
      throw conflict('BILL_ALREADY_RECORDED', 'This supplier invoice is already recorded');
    }
  });

  router.post('/purchasing/bills/:billId/approve', requirePermission('purchase.approve'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const bid = parseObjectId(req.params.billId);
    if (!bid) throw notFound();
    const { decision } = parseInput(z.object({ decision: z.enum(['approve', 'reject']) }), req.body);
    const current = await SupplierBillModel.findOne({ organizationId: tenant.organizationId, _id: bid }).lean<Lean<SupplierBill>>();
    if (!current) throw notFound();
    if (current.status !== 'awaiting_approval') throw conflict('BILL_NOT_PENDING', 'This bill is not waiting for approval');
    const settings = await purchaseSettings(tenant.organizationId);
    if (settings.separation.approve && current.createdBy.equals(tenant.userId))
      throw forbidden('SEPARATION_OF_DUTIES', 'The person who recorded the bill cannot approve it');
    await prepareLedger(tenant.organizationId, [current.billDate]);
    const bill = await runTransaction(async (session) => {
      const updated = await SupplierBillModel.findOneAndUpdate(
        { organizationId: tenant.organizationId, _id: bid, status: 'awaiting_approval' },
        { $set: { status: decision === 'approve' ? 'posted' : 'rejected', approval: { by: tenant.userId, at: new Date() } } },
        { session, returnDocument: 'after' },
      ).lean<Lean<SupplierBill>>();
      if (!updated) throw conflict('BILL_NOT_PENDING', 'This bill is not waiting for approval');
      if (decision === 'approve') updated.entryId = (await postBill(tenant, updated, null, session))?._id ?? null;
      await audit(tenant, decision === 'approve' ? 'purchase.bill_approved' : 'purchase.bill_rejected', bid, { number: updated.number }, session);
      return updated;
    });
    res.json({ bill: billDto(bill) });
  });

  // ---- supplier payments --------------------------------------------------------------------
  router.get('/purchasing/payments', requirePermission('purchase.pay'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const rows = await SupplierPaymentModel.find({ organizationId: tenant.organizationId })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean<Lean<SupplierPayment>[]>();
    res.json({ payments: rows.map(paymentDto) });
  });

  router.post('/purchasing/payments', requirePermission('purchase.pay'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const key = requireKey(req);
    const input = parseInput(paymentSchema, req.body);
    const requestHash = hash(input);
    const previous = await replay(
      () =>
        SupplierPaymentModel.findOne({ organizationId: tenant.organizationId, createdBy: tenant.userId, idempotencyKey: key }).lean<
          Lean<SupplierPayment>
        >(),
      requestHash,
    );
    if (previous) return void res.json({ payment: paymentDto(previous), replayed: true });
    if (input.allocations.reduce((s, a) => s + a.amount, 0) !== input.amount) throw validationError({ allocations: 'must_equal_amount' });
    if (new Set(input.allocations.map((a) => a.billId)).size !== input.allocations.length) throw validationError({ allocations: 'duplicate_bill' });
    const box = await CashAccountModel.findOne({
      organizationId: tenant.organizationId,
      _id: new Types.ObjectId(input.cashAccountId),
      status: 'active',
    }).lean();
    if (!box) throw validationError({ cashAccountId: 'not_available' });
    const ledger = await settingsOf(tenant.organizationId);
    if (!ledger) throw conflict('ACCOUNTING_NOT_SET_UP', 'Supplier payments need the ledger to be set up');
    const settings = await purchaseSettings(tenant.organizationId);
    const today = await prepare(tenant.organizationId, ['SPAY']);
    const supplierId = new Types.ObjectId(input.supplierId);
    try {
      const payment = await runTransaction(async (session) => {
        for (const a of input.allocations) {
          const bill = await SupplierBillModel.findOneAndUpdate(
            {
              organizationId: tenant.organizationId,
              _id: new Types.ObjectId(a.billId),
              supplierId,
              status: 'posted',
              $expr: { $lte: [{ $add: ['$paid', '$credited', a.amount] }, '$total'] },
            },
            { $inc: { paid: a.amount } },
            { session, returnDocument: 'after' },
          ).lean<Lean<SupplierBill>>();
          if (!bill) throw conflict('OVER_PAYMENT', 'This amount is more than the bill still asks for', { billId: a.billId });
          if (settings.separation.pay && bill.createdBy.equals(tenant.userId))
            throw forbidden('SEPARATION_OF_DUTIES', 'The person who recorded the bill cannot pay it');
        }
        if (box.kind === 'cash' && (await accountBalance(tenant.organizationId, box.accountId, undefined, session)) < input.amount)
          throw conflict('INSUFFICIENT_CASH', 'The cashbox does not hold this amount');
        const open = await CashSessionModel.findOne({
          organizationId: tenant.organizationId,
          status: 'open',
          openedBy: tenant.userId,
          cashAccountId: box._id,
        })
          .session(session)
          .lean();
        const number = await nextDoc(tenant.organizationId, 'SPAY', today, session);
        const pid = new Types.ObjectId();
        const entry = await postEntry(
          {
            organizationId: tenant.organizationId,
            userId: tenant.userId,
            date: today,
            journal: box.kind === 'cash' ? 'cash' : 'bank',
            memo: number,
            lines: [
              { accountId: mapped(ledger, 'payable'), debit: input.amount, partner: { type: 'supplier', id: supplierId } },
              { accountId: box.accountId, credit: input.amount, branchId: box.branchId },
            ],
            source: { type: 'supplier_payment', id: pid, event: 'paid' },
            cashSessionId: open?._id ?? null,
          },
          session,
        );
        const [doc] = await SupplierPaymentModel.create(
          [
            {
              _id: pid,
              organizationId: tenant.organizationId,
              number,
              supplierId,
              cashAccountId: box._id,
              date: today,
              amount: input.amount,
              allocations: input.allocations.map((a) => ({ billId: new Types.ObjectId(a.billId), amount: a.amount })),
              reference: input.reference,
              entryId: entry._id,
              createdBy: tenant.userId,
              idempotencyKey: key,
              requestHash,
            },
          ],
          { session },
        );
        await audit(tenant, 'purchase.payment_recorded', pid, { number, amount: input.amount }, session);
        return doc!.toObject() as Lean<SupplierPayment>;
      });
      res.status(201).json({ payment: paymentDto(payment), replayed: false });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const again = await replay(
        () =>
          SupplierPaymentModel.findOne({ organizationId: tenant.organizationId, createdBy: tenant.userId, idempotencyKey: key }).lean<
            Lean<SupplierPayment>
          >(),
        requestHash,
      );
      if (!again) throw err;
      res.json({ payment: paymentDto(again), replayed: true });
    }
  });

  // ---- supplier credit notes ----------------------------------------------------------------
  // Against a posted bill: billed goods sent back (stock leaves at average cost) or price
  // allowances on non-stock lines. Bounded by the bill's open balance; a refund of money already
  // paid is not handled here (record it as a cash-in voucher).
  router.post('/purchasing/bills/:billId/credits', requirePermission('purchase.bill.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const key = requireKey(req);
    const bid = parseObjectId(req.params.billId);
    if (!bid) throw notFound();
    const input = parseInput(creditSchema, req.body);
    const requestHash = hash([String(bid), input]);
    const previous = await replay(
      () =>
        SupplierCreditModel.findOne({ organizationId: tenant.organizationId, createdBy: tenant.userId, idempotencyKey: key }).lean<
          Lean<SupplierCredit>
        >(),
      requestHash,
    );
    if (previous) return void res.json({ credit: creditDto(previous), replayed: true });
    const today = await prepare(tenant.organizationId, ['SCN', 'SD']);
    const ctx = ctxOf(tenant);
    const credit = await runTransaction(async (session) => {
      const bill = await SupplierBillModel.findOneAndUpdate(
        { organizationId: tenant.organizationId, _id: bid, status: 'posted' },
        { $inc: { credited: 0 } },
        { session, returnDocument: 'after' },
      ).lean<Lean<SupplierBill>>();
      if (!bill) throw notFound();
      const order = bill.orderId ? await lockOrder(tenant, bill.orderId, session) : null;
      const billLines = bill.lines.map((l) => ({ ...l }));
      const orderLines = order ? order.lines.map((l) => ({ ...l })) : [];
      let amount = 0;
      const stockLines: { orderLine: (typeof orderLines)[number]; qty: number; lot?: string; amount: number }[] = [];
      const expenseCredits: { accountId: Types.ObjectId; amount: number }[] = [];
      for (const c of input.lines) {
        const bl = billLines[c.billLineIndex];
        if (!bl) throw validationError({ billLineIndex: 'invalid_reference' });
        if (bl.credited + c.qty > bl.qty) throw conflict('OVER_CREDIT', 'More than billed on this line');
        bl.credited += c.qty;
        const lineAmount = c.qty * bl.unitPrice;
        amount += lineAmount;
        const ol = bl.orderLineIndex !== null ? orderLines[bl.orderLineIndex] : undefined;
        if (ol?.itemId) {
          ol.billed -= c.qty;
          ol.received -= c.qty;
          ol.returned += c.qty;
          stockLines.push({ orderLine: ol, qty: c.qty, lot: c.lot, amount: lineAmount });
        } else {
          expenseCredits.push({ accountId: (bl.expenseAccountId ?? ol?.expenseAccountId)!, amount: lineAmount });
        }
      }
      if (bill.paid + bill.credited + amount > bill.total) throw conflict('OVER_CREDIT', 'A credit note cannot exceed the bill’s open balance');
      await SupplierBillModel.updateOne(
        { organizationId: tenant.organizationId, _id: bid },
        { $set: { lines: billLines }, $inc: { credited: amount } },
        { session },
      );
      if (order)
        await PurchaseOrderModel.updateOne({ organizationId: tenant.organizationId, _id: order._id }, { $set: { lines: orderLines } }, { session });
      const number = await nextDoc(tenant.organizationId, 'SCN', today, session);
      let stockDoc = null;
      let cost = 0;
      if (stockLines.length) {
        const warehouse = await warehouseOf(tenant, order!, session);
        const moves = [];
        for (const s of stockLines) {
          const item = await lockItem(ctx, s.orderLine.itemId!, session);
          moves.push(
            ...(await stockOut(ctx, item, warehouse, { qty: s.qty * s.orderLine.factor, lot: s.lot }, today, { allowExpired: true }, session)),
          );
        }
        cost = -moves.reduce((s, m) => s + m.value, 0);
        stockDoc = await saveDocument(
          ctx,
          {
            _id: newId(),
            type: 'purchase_return',
            date: today,
            warehouseId: warehouse._id,
            toWarehouseId: null,
            branchId: bill.branchId,
            reason: `${bill.number} ${number}`,
            source: { encounterId: null, recordItemId: null, documentId: bill._id },
            sourceKey: null,
            reversalOf: null,
            idempotencyKey: `scn-${key}`.slice(0, 100),
            requestHash,
          },
          moves,
          null,
          session,
        );
      }
      const settings = await settingsOf(tenant.organizationId, session);
      let entryId: Types.ObjectId | null = null;
      if (settings && today >= settings.cutoverDate) {
        const stockAmount = stockLines.reduce((s, l) => s + l.amount, 0);
        const variance = stockAmount - cost;
        const entry = await postEntry(
          {
            ...ctx,
            date: today,
            journal: 'purchases',
            memo: `${number} ${bill.number}`,
            lines: [
              { accountId: mapped(settings, 'payable'), debit: amount, branchId: bill.branchId, partner: { type: 'supplier', id: bill.supplierId } },
              { accountId: mapped(settings, 'inventory'), credit: cost, branchId: bill.branchId },
              {
                accountId: mapped(settings, 'purchaseVariance'),
                debit: Math.max(-variance, 0),
                credit: Math.max(variance, 0),
                branchId: bill.branchId,
              },
              ...expenseCredits.map((e) => ({ accountId: e.accountId, credit: e.amount, branchId: bill.branchId })),
            ],
            source: { type: 'supplier_credit', id: bid, event: number },
          },
          session,
          settings,
        );
        entryId = entry._id;
      }
      const [doc] = await SupplierCreditModel.create(
        [
          {
            organizationId: tenant.organizationId,
            number,
            supplierId: bill.supplierId,
            billId: bid,
            supplierReference: input.supplierReference,
            lines: input.lines.map((l) => ({ billLineIndex: l.billLineIndex, qty: l.qty, lot: l.lot ?? '' })),
            amount,
            reason: input.reason,
            stockDocumentId: stockDoc?._id ?? null,
            entryId,
            createdBy: tenant.userId,
            idempotencyKey: key,
            requestHash,
          },
        ],
        { session },
      );
      await audit(tenant, 'purchase.credit_recorded', doc!._id, { number, bill: bill.number, amount }, session);
      return doc!.toObject() as Lean<SupplierCredit>;
    });
    res.status(201).json({ credit: creditDto(credit) });
  });

  // ---- payables aging -----------------------------------------------------------------------
  router.get('/purchasing/reports/payables-aging', requirePermission('purchase.bill.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const today = await ledgerToday(tenant.organizationId);
    const bills = await SupplierBillModel.find({
      organizationId: tenant.organizationId,
      status: 'posted',
      $expr: { $gt: ['$total', { $add: ['$paid', '$credited'] }] },
    }).lean<Lean<SupplierBill>[]>();
    const suppliers = await SupplierModel.find({
      organizationId: tenant.organizationId,
      _id: { $in: [...new Set(bills.map((b) => String(b.supplierId)))].map((s) => new Types.ObjectId(s)) },
    }).lean<Lean<Supplier>[]>();
    const days = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
    const rows = new Map<
      string,
      { supplierId: string; name: string; notDue: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number; total: number }
    >();
    for (const b of bills) {
      const open = billBalance(b);
      const overdue = days(today, b.dueDate);
      const key = String(b.supplierId);
      const row = rows.get(key) ?? {
        supplierId: key,
        name: suppliers.find((s) => s._id.equals(b.supplierId))?.name ?? '',
        notDue: 0,
        d1_30: 0,
        d31_60: 0,
        d61_90: 0,
        d90plus: 0,
        total: 0,
      };
      if (overdue <= 0) row.notDue += open;
      else if (overdue <= 30) row.d1_30 += open;
      else if (overdue <= 60) row.d31_60 += open;
      else if (overdue <= 90) row.d61_90 += open;
      else row.d90plus += open;
      row.total += open;
      rows.set(key, row);
    }
    const list = [...rows.values()].sort((a, b) => b.total - a.total);
    res.json({ today, rows: list, total: list.reduce((s, r) => s + r.total, 0) });
  });

  return router;
}
