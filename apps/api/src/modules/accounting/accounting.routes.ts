import { createHash } from 'node:crypto';
import { Router, type Request } from 'express';
import { Types, type ClientSession } from 'mongoose';
import { z } from 'zod';
import { runTransaction } from '../../db/transaction.js';
import { HttpError, conflict, forbidden, isDuplicateKeyError, notFound, validationError } from '../../http/errors.js';
import { objectIdSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { branchOwnedFilter } from '../../tenancy/scope.js';
import { parseObjectId, requirePermission, tenantCan, tenantOf, type TenantContext } from '../../tenancy/tenant-context.js';
import { clock } from '../../time/clock.js';
import { DATE_PATTERN, addDays, dayRange, isValidDate } from '../../time/local-time.js';
import { recordAudit, type AuditAction, type AuditTargetType } from '../audit/audit-event.model.js';
import { BranchModel } from '../branches/branch.model.js';
import { AdjustmentModel, InvoiceModel, MAX_AMOUNT, PaymentModel } from '../finance/finance.model.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { PatientModel } from '../patients/patient.model.js';
import { CHART_TEMPLATE_ID, DOCUMENT_ONLY_KEYS, MAPPING_TYPES } from './accounting.chart.js';
import { createLedger, documentsSince } from './accounting.setup.js';
import {
  ACCOUNT_TYPES,
  AccountingSettingsModel,
  CashAccountModel,
  CashSessionModel,
  DEBIT_NORMAL,
  JournalEntryModel,
  LedgerAccountModel,
  MAPPING_KEYS,
  PeriodEventModel,
  type AccountType,
  type AccountingSettings,
  type JournalEntry,
  type LedgerAccount,
  type MappingKey,
} from './accounting.model.js';
import {
  ledgerToday,
  monthEnd,
  monthOf,
  organizationZone,
  postEntry,
  prepareLedger,
  reverseEntry,
  settingsOf,
  type Lean,
} from './accounting.posting.js';

// General ledger of a clinic (docs/architecture/ACCOUNTING.md). Ledger-wide views (chart balances,
// journal, statements) need organization-wide scope: a branch-restricted accountant would otherwise
// see other branches' amounts. Patient-level detail never includes clinical text.

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;
const dateSchema = z.string().regex(DATE_PATTERN).refine(isValidDate, 'invalid_date');
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
/** Control accounts have sub-ledgers (invoices, receipts, bills, stock); only opening entries may post to them by hand. */
const CONTROL_KEYS: readonly MappingKey[] = ['receivable', 'patientAdvances', 'payable', 'grni', 'inventory', 'practitionerPayable'];

function requireKey(req: Request): string {
  const key = req.get('idempotency-key') ?? '';
  if (!IDEMPOTENCY_KEY.test(key)) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header');
  return key;
}

export function requireOrgWide(tenant: TenantContext) {
  if (tenant.branchScope.type !== 'all') throw forbidden('ORG_WIDE_SCOPE_REQUIRED', 'The ledger needs access to all branches');
}

export async function requireSettings(tenant: TenantContext) {
  const settings = await settingsOf(tenant.organizationId);
  if (!settings) throw conflict('ACCOUNTING_NOT_SET_UP', 'Accounting is not set up for this organization');
  return settings;
}

export const auditLedger = (
  tenant: TenantContext,
  action: AuditAction,
  target: { type: AuditTargetType; id: Types.ObjectId },
  changes: Record<string, unknown>,
  session?: ClientSession,
) =>
  recordAudit(
    {
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      action,
      target,
      changes,
    },
    session,
  );

const accountDto = (a: Lean<LedgerAccount>, balance?: number) => ({
  id: String(a._id),
  code: a.code,
  name: a.name,
  templateKey: a.templateKey,
  type: a.type,
  isGroup: a.isGroup,
  parentId: a.parentId ? String(a.parentId) : null,
  role: a.role,
  status: a.status,
  version: a.version,
  ...(balance === undefined ? {} : { balance }),
});
export const entryDto = (e: Lean<JournalEntry>, accounts?: Map<string, Lean<LedgerAccount>>) => ({
  id: String(e._id),
  number: e.number,
  date: e.date,
  journal: e.journal,
  memo: e.memo,
  total: e.total,
  currency: e.currency,
  source: {
    type: e.source.type,
    id: e.source.id ? String(e.source.id) : null,
    event: e.source.event,
  },
  cashSessionId: e.cashSessionId ? String(e.cashSessionId) : null,
  reversalOf: e.reversalOf ? String(e.reversalOf) : null,
  reversedBy: e.reversedBy ? String(e.reversedBy) : null,
  createdAt: e.createdAt.toISOString(),
  lines: e.lines.map((l) => {
    const account = accounts?.get(String(l.accountId));
    return {
      accountId: String(l.accountId),
      accountCode: account?.code ?? null,
      accountName: account?.name ?? null,
      accountTemplateKey: account?.templateKey ?? null,
      debit: l.debit,
      credit: l.credit,
      branchId: l.branchId ? String(l.branchId) : null,
      partner: l.partner ? { type: l.partner.type, id: String(l.partner.id) } : null,
      memo: l.memo,
    };
  }),
});
const settingsDto = (s: Lean<AccountingSettings>) => ({
  currency: s.currency,
  cutoverDate: s.cutoverDate,
  lockedThrough: s.lockedThrough,
  template: s.template,
  mappings: Object.fromEntries(MAPPING_KEYS.map((k) => [k, String(s.mappings[k])])),
  requireCashSession: s.requireCashSession,
  version: s.version,
});

export async function accountMap(organizationId: Types.ObjectId) {
  const accounts = await LedgerAccountModel.find({ organizationId }).lean<Lean<LedgerAccount>[]>();
  return new Map(accounts.map((a) => [String(a._id), a]));
}

/** Net (debit − credit) per account; optional date bounds and branch filter on lines. */
async function netByAccount(organizationId: Types.ObjectId, opts: { from?: string; to?: string; branchId?: Types.ObjectId }) {
  const date = {
    ...(opts.from ? { $gte: opts.from } : {}),
    ...(opts.to ? { $lte: opts.to } : {}),
  };
  const rows = await JournalEntryModel.aggregate<{
    _id: Types.ObjectId;
    debit: number;
    credit: number;
  }>([
    { $match: { organizationId, ...(opts.from || opts.to ? { date } : {}) } },
    { $unwind: '$lines' },
    ...(opts.branchId ? [{ $match: { 'lines.branchId': opts.branchId } }] : []),
    {
      $group: {
        _id: '$lines.accountId',
        debit: { $sum: '$lines.debit' },
        credit: { $sum: '$lines.credit' },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), r]));
}

const signed = (type: AccountType, debit: number, credit: number) => (DEBIT_NORMAL.includes(type) ? debit - credit : credit - debit);

function boundedRange(from: string, to: string) {
  if (to < from) throw validationError({ to: 'before_from' });
  if (addDays(from, 400) < to) throw validationError({ to: 'range_too_long' });
}

// ---------------------------------------------------------------------------------------------
const setupSchema = z.object({
  cutoverDate: dateSchema,
  requireCashSession: z.boolean().default(false),
});
const settingsUpdateSchema = z.object({
  mappings: z.partialRecord(z.enum(MAPPING_KEYS), objectIdSchema).optional(),
  requireCashSession: z.boolean().optional(),
  version: z.number().int().min(0),
});
const accountCreateSchema = z.object({
  code: z.string().regex(/^\d{3,8}$/),
  name: z.string().trim().min(2).max(120),
  type: z.enum(ACCOUNT_TYPES),
  parentId: objectIdSchema.nullable().default(null),
  isGroup: z.boolean().default(false),
});
const accountUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  status: z.enum(['active', 'archived']).optional(),
  version: z.number().int().min(0),
});
const lineSchema = z.object({
  accountId: objectIdSchema,
  debit: z.number().int().min(0).max(MAX_AMOUNT).default(0),
  credit: z.number().int().min(0).max(MAX_AMOUNT).default(0),
  branchId: objectIdSchema.nullable().default(null),
  memo: z.string().trim().max(200).default(''),
});
const manualEntrySchema = z.object({
  date: dateSchema,
  journal: z.enum(['general', 'opening']),
  memo: z.string().trim().min(3).max(200),
  lines: z.array(lineSchema).min(2).max(100),
});
const reverseSchema = z.object({
  date: dateSchema.optional(),
  reason: z.string().trim().min(3).max(200),
});
const rangeSchema = z.object({ from: dateSchema, to: dateSchema });
const entryListSchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  accountId: objectIdSchema.optional(),
  journal: z.string().max(20).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export function createAccountingRouter() {
  const router = Router({ mergeParams: true });
  const canRead = (tenant: TenantContext) =>
    ['accounting.read', 'accounting.settings.manage', 'cash.session.operate'].some((p) => tenantCan(tenant, p as never));

  // ---- setup and settings -----------------------------------------------------------------
  router.get('/accounting/settings', async (req, res) => {
    const tenant = tenantOf(req);
    if (!canRead(tenant)) throw forbidden();
    const [settings, org] = await Promise.all([
      settingsOf(tenant.organizationId),
      OrganizationModel.findById(tenant.organizationId).select('currency timeZone').lean(),
    ]);
    res.json({
      configured: Boolean(settings),
      settings: settings ? settingsDto(settings) : null,
      prerequisites: {
        currency: org?.currency ?? null,
        timeZone: org?.timeZone ?? null,
      },
      template: CHART_TEMPLATE_ID,
      today: org?.timeZone ? await ledgerToday(tenant.organizationId) : null,
    });
  });

  // Creates the template chart and the posting map. Business events from the cutover date on are
  // posted automatically; earlier balances come in through opening entries (see migration preview).
  router.post('/accounting/setup', requirePermission('accounting.settings.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(setupSchema, req.body);
    const org = await OrganizationModel.findById(tenant.organizationId).select('currency timeZone').lean();
    if (!org?.currency) throw conflict('CURRENCY_REQUIRED', 'An owner must choose the organization’s currency first');
    if (!org.timeZone) throw conflict('TIME_ZONE_REQUIRED', 'An owner must choose the organization’s time zone first');
    const currency = org.currency;
    if (await documentsSince(tenant.organizationId, dayRange(input.cutoverDate, org.timeZone).start))
      throw conflict('DOCUMENTS_AFTER_CUTOVER', 'Documents were recorded on or after this date; choose a later start date', {
        earliest: await ledgerToday(tenant.organizationId),
      });
    try {
      const settings = await runTransaction(async (session) => {
        if (
          await AccountingSettingsModel.exists({
            organizationId: tenant.organizationId,
          }).session(session)
        )
          throw conflict('ACCOUNTING_ALREADY_SET_UP', 'Accounting is already set up');
        const created = await createLedger(
          { organizationId: tenant.organizationId, userId: tenant.userId, currency, cutoverDate: input.cutoverDate, requireCashSession: input.requireCashSession },
          session,
        );
        await auditLedger(
          tenant,
          'accounting.set_up',
          { type: 'organization', id: tenant.organizationId },
          {
            cutoverDate: input.cutoverDate,
            template: CHART_TEMPLATE_ID,
            currency,
          },
          session,
        );
        return created;
      });
      res.status(201).json({ settings: settingsDto(settings) });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw conflict('ACCOUNTING_ALREADY_SET_UP', 'Accounting is already set up');
      throw err;
    }
  });

  router.patch('/accounting/settings', requirePermission('accounting.settings.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(settingsUpdateSchema, req.body);
    const settings = await requireSettings(tenant);
    const set: Record<string, unknown> = {};
    if (input.requireCashSession !== undefined) set.requireCashSession = input.requireCashSession;
    const changed: Record<string, unknown> = {};
    for (const [key, id] of Object.entries(input.mappings ?? {}) as [MappingKey, string][]) {
      const account = await LedgerAccountModel.findOne({
        organizationId: tenant.organizationId,
        _id: new Types.ObjectId(id),
        status: 'active',
        isGroup: false,
      }).lean();
      if (!account || !MAPPING_TYPES[key].includes(account.type)) throw validationError({ [`mappings.${key}`]: 'account_not_allowed' });
      set[`mappings.${key}`] = account._id;
      changed[key] = account.code;
    }
    const updated = await AccountingSettingsModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, version: input.version },
      { $set: set, $inc: { version: 1 } },
      { returnDocument: 'after' },
    ).lean<Lean<AccountingSettings>>();
    if (!updated) throw conflict('VERSION_CONFLICT', 'The settings were changed meanwhile');
    await auditLedger(
      tenant,
      'accounting.settings_updated',
      { type: 'organization', id: tenant.organizationId },
      {
        mappings: changed,
        ...(input.requireCashSession !== undefined ? { requireCashSession: input.requireCashSession } : {}),
        before: settings.version,
      },
    );
    res.json({ settings: settingsDto(updated) });
  });

  // ---- chart of accounts ------------------------------------------------------------------
  router.get('/accounting/accounts', requirePermission('accounting.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    await requireSettings(tenant);
    const [accounts, nets] = await Promise.all([
      LedgerAccountModel.find({ organizationId: tenant.organizationId }).sort({ code: 1 }).lean<Lean<LedgerAccount>[]>(),
      netByAccount(tenant.organizationId, {}),
    ]);
    res.json({
      accounts: accounts.map((a) => {
        const n = nets.get(String(a._id));
        return accountDto(a, n ? signed(a.type, n.debit, n.credit) : 0);
      }),
    });
  });

  router.post('/accounting/accounts', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(accountCreateSchema, req.body);
    await requireSettings(tenant);
    let parentId: Types.ObjectId | null = null;
    if (input.parentId) {
      const parent = await LedgerAccountModel.findOne({
        organizationId: tenant.organizationId,
        _id: new Types.ObjectId(input.parentId),
      }).lean();
      if (!parent || !parent.isGroup || parent.type !== input.type) throw validationError({ parentId: 'not_a_matching_group' });
      parentId = parent._id;
    }
    try {
      const created = await LedgerAccountModel.create({
        organizationId: tenant.organizationId,
        code: input.code,
        name: input.name,
        type: input.type,
        isGroup: input.isGroup,
        parentId,
      });
      await auditLedger(tenant, 'ledger_account.created', { type: 'ledger_account', id: created._id }, { code: input.code, type: input.type });
      res.status(201).json({
        account: accountDto(created.toObject() as Lean<LedgerAccount>),
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw conflict('ACCOUNT_CODE_TAKEN', 'Another account has this code');
      throw err;
    }
  });

  router.patch('/accounting/accounts/:accountId', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const id = parseObjectId(req.params.accountId);
    if (!id) throw notFound();
    const input = parseInput(accountUpdateSchema, req.body);
    const settings = await requireSettings(tenant);
    const account = await LedgerAccountModel.findOne({
      organizationId: tenant.organizationId,
      _id: id,
    }).lean<Lean<LedgerAccount>>();
    if (!account) throw notFound();
    if (input.name !== undefined && account.templateKey) throw conflict('TEMPLATE_ACCOUNT_NAME', 'Template accounts keep their translated name');
    if (input.status === 'archived' && account.status === 'active') {
      if (MAPPING_KEYS.some((k) => settings.mappings[k].equals(id))) throw conflict('ACCOUNT_MAPPED', 'This account is used by a posting rule');
      if (
        await CashAccountModel.exists({
          organizationId: tenant.organizationId,
          accountId: id,
          status: 'active',
        })
      )
        throw conflict('ACCOUNT_IN_USE', 'An active cashbox or bank account uses this account');
      if (
        account.isGroup &&
        (await LedgerAccountModel.exists({
          organizationId: tenant.organizationId,
          parentId: id,
          status: 'active',
        }))
      )
        throw conflict('ACCOUNT_IN_USE', 'This group still has active accounts');
      const n = (await netByAccount(tenant.organizationId, {})).get(String(id));
      if (n && n.debit !== n.credit) throw conflict('ACCOUNT_HAS_BALANCE', 'Only accounts with a zero balance can be archived');
    }
    const updated = await LedgerAccountModel.findOneAndUpdate(
      {
        organizationId: tenant.organizationId,
        _id: id,
        version: input.version,
      },
      {
        $set: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    ).lean<Lean<LedgerAccount>>();
    if (!updated) throw conflict('VERSION_CONFLICT', 'This account was changed meanwhile');
    await auditLedger(
      tenant,
      'ledger_account.updated',
      { type: 'ledger_account', id },
      {
        code: account.code,
        ...(input.status ? { status: input.status } : {}),
        ...(input.name ? { renamed: true } : {}),
      },
    );
    res.json({ account: accountDto(updated) });
  });

  // ---- journal ----------------------------------------------------------------------------
  router.get('/accounting/entries', requirePermission('accounting.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const q = parseInput(entryListSchema, req.query);
    const filter: Record<string, unknown> = {
      organizationId: tenant.organizationId,
    };
    if (q.from || q.to)
      filter.date = {
        ...(q.from ? { $gte: q.from } : {}),
        ...(q.to ? { $lte: q.to } : {}),
      };
    if (q.accountId) filter['lines.accountId'] = new Types.ObjectId(q.accountId);
    if (q.journal) filter.journal = q.journal;
    const [entries, total, accounts] = await Promise.all([
      JournalEntryModel.find(filter)
        .sort({ date: -1, number: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean<Lean<JournalEntry>[]>(),
      JournalEntryModel.countDocuments(filter),
      accountMap(tenant.organizationId),
    ]);
    res.json({
      data: entries.map((e) => entryDto(e, accounts)),
      page: q.page,
      pageSize: q.pageSize,
      total,
    });
  });

  router.get('/accounting/entries/:entryId', requirePermission('accounting.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const id = parseObjectId(req.params.entryId);
    if (!id) throw notFound();
    const entry = await JournalEntryModel.findOne({
      organizationId: tenant.organizationId,
      _id: id,
    }).lean<Lean<JournalEntry>>();
    if (!entry) throw notFound();
    res.json({
      entry: entryDto(entry, await accountMap(tenant.organizationId)),
    });
  });

  router.post('/accounting/entries', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const key = requireKey(req);
    const input = parseInput(manualEntrySchema, req.body);
    const settings = await requireSettings(tenant);
    const sourceKey = `manual:${String(tenant.userId)}:${key}`;
    const requestHash = hash(input);
    const previous = await JournalEntryModel.findOne({
      organizationId: tenant.organizationId,
      sourceKey,
    }).lean<Lean<JournalEntry>>();
    if (previous) {
      if (previous.source.event !== requestHash)
        throw conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different request');
      res.json({
        entry: entryDto(previous, await accountMap(tenant.organizationId)),
        replayed: true,
      });
      return;
    }
    if (input.journal === 'opening' && input.date !== settings.cutoverDate) throw validationError({ date: 'opening_must_be_on_cutover' });
    const control = new Set(CONTROL_KEYS.map((k) => String(settings.mappings[k])));
    if (input.journal !== 'opening' && input.lines.some((l) => control.has(l.accountId)))
      throw conflict('CONTROL_ACCOUNT', 'Receivables, payables, advances and stock change only through their documents (or opening entries)');
    const documentOnly = await LedgerAccountModel.exists({
      organizationId: tenant.organizationId,
      _id: { $in: input.lines.map((l) => new Types.ObjectId(l.accountId)) },
      templateKey: { $in: DOCUMENT_ONLY_KEYS },
    });
    if (documentOnly) throw conflict('CONTROL_ACCOUNT', 'Staff advances and custody change only through their documents');
    for (const l of input.lines) {
      if (
        l.branchId &&
        !(await BranchModel.exists({
          organizationId: tenant.organizationId,
          _id: new Types.ObjectId(l.branchId),
        }))
      )
        throw validationError({ branchId: 'not_found' });
    }
    await prepareLedger(tenant.organizationId, [input.date]);
    const entry = await runTransaction(async (session) => {
      const posted = await postEntry(
        {
          organizationId: tenant.organizationId,
          userId: tenant.userId,
          date: input.date,
          journal: input.journal,
          memo: input.memo,
          lines: input.lines.map((l) => ({
            accountId: new Types.ObjectId(l.accountId),
            debit: l.debit,
            credit: l.credit,
            branchId: l.branchId ? new Types.ObjectId(l.branchId) : null,
            memo: l.memo,
          })),
          // The request hash in `event` lets a retried request be recognized as the same one.
          source: {
            type: input.journal === 'opening' ? 'opening' : 'manual',
            id: null,
            event: requestHash,
          },
          sourceKey,
        },
        session,
      );
      await auditLedger(
        tenant,
        'journal.posted',
        { type: 'journal_entry', id: posted._id },
        {
          number: posted.number,
          total: posted.total,
          journal: posted.journal,
        },
        session,
      );
      return posted;
    });
    res.status(201).json({
      entry: entryDto(entry, await accountMap(tenant.organizationId)),
      replayed: false,
    });
  });

  router.post('/accounting/entries/:entryId/reverse', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const id = parseObjectId(req.params.entryId);
    if (!id) throw notFound();
    const input = parseInput(reverseSchema, req.body);
    await requireSettings(tenant);
    const date = input.date ?? (await ledgerToday(tenant.organizationId));
    const existing = await JournalEntryModel.findOne({
      organizationId: tenant.organizationId,
      _id: id,
    }).lean<Lean<JournalEntry>>();
    if (!existing) throw notFound();
    // Document postings are corrected through their documents (credit note, receipt reversal...).
    if (!['manual', 'opening', 'voucher'].includes(existing.source.type))
      throw conflict('DOCUMENT_POSTING', 'Correct this through its document instead');
    await prepareLedger(tenant.organizationId, [date]);
    const result = await runTransaction(async (session) => {
      const reversed = await reverseEntry(tenant.organizationId, tenant.userId, id, date, input.reason, session);
      if (!reversed) throw notFound();
      await auditLedger(
        tenant,
        'journal.reversed',
        { type: 'journal_entry', id },
        {
          number: reversed.original.number,
          reversal: reversed.reversal.number,
        },
        session,
      );
      return reversed.reversal;
    });
    res.status(201).json({
      entry: entryDto(result, await accountMap(tenant.organizationId)),
    });
  });

  // ---- periods ----------------------------------------------------------------------------
  router.get('/accounting/periods', requirePermission('accounting.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const settings = await requireSettings(tenant);
    const today = await ledgerToday(tenant.organizationId);
    const months: {
      month: string;
      start: string;
      end: string;
      status: 'closed' | 'open';
      ended: boolean;
    }[] = [];
    for (let m = monthOf(settings.cutoverDate); m <= monthOf(today) && months.length < 240; m = monthOf(addDays(monthEnd(m), 1))) {
      const end = monthEnd(m);
      months.push({
        month: m,
        start: m === monthOf(settings.cutoverDate) ? settings.cutoverDate : `${m}-01`,
        end,
        status: settings.lockedThrough && end <= settings.lockedThrough ? 'closed' : 'open',
        ended: end < today,
      });
    }
    const history = await PeriodEventModel.find({
      organizationId: tenant.organizationId,
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(50)
      .lean();
    res.json({
      lockedThrough: settings.lockedThrough,
      months: months.reverse(),
      history: history.map((h) => ({
        month: h.month,
        action: h.action,
        reason: h.reason,
        at: h.createdAt.toISOString(),
      })),
    });
  });

  // Months close in order (like a lock date): the next open month, once it has ended.
  router.post('/accounting/periods/close', requirePermission('accounting.period.close'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const { month } = parseInput(z.object({ month: monthSchema }), req.body);
    const settings = await requireSettings(tenant);
    const expected = settings.lockedThrough ? monthOf(addDays(settings.lockedThrough, 1)) : monthOf(settings.cutoverDate);
    if (month !== expected)
      throw conflict('PERIOD_ORDER', 'Months close in order', {
        next: expected,
      });
    const end = monthEnd(month);
    if (end >= (await ledgerToday(tenant.organizationId))) throw conflict('PERIOD_NOT_ENDED', 'A month can be closed once it has ended');
    const zone = await organizationZone(tenant.organizationId);
    const openSessions = await CashSessionModel.countDocuments({
      organizationId: tenant.organizationId,
      status: 'open',
      openedAt: { $lt: dayRange(end, zone).end },
    });
    if (openSessions > 0) throw conflict('OPEN_CASH_SESSIONS', 'Close the cashier sessions of this month first', { count: openSessions });
    await runTransaction(async (session) => {
      const updated = await AccountingSettingsModel.updateOne(
        {
          organizationId: tenant.organizationId,
          lockedThrough: settings.lockedThrough,
        },
        { $set: { lockedThrough: end }, $inc: { version: 1 } },
        { session },
      );
      if (updated.modifiedCount !== 1) throw conflict('VERSION_CONFLICT', 'The periods were changed meanwhile');
      await PeriodEventModel.create(
        [
          {
            organizationId: tenant.organizationId,
            month,
            action: 'closed',
            by: tenant.userId,
          },
        ],
        { session },
      );
      await auditLedger(tenant, 'period.closed', { type: 'organization', id: tenant.organizationId }, { month }, session);
    });
    res.json({ lockedThrough: end });
  });

  // Only the latest closed month can be reopened, by an owner, with a reason.
  router.post('/accounting/periods/reopen', requirePermission('accounting.period.reopen'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(
      z.object({
        month: monthSchema,
        reason: z.string().trim().min(10).max(300),
      }),
      req.body,
    );
    const settings = await requireSettings(tenant);
    if (!settings.lockedThrough || monthOf(settings.lockedThrough) !== input.month)
      throw conflict('PERIOD_NOT_LATEST_CLOSED', 'Only the latest closed month can be reopened');
    const previousEnd = addDays(`${input.month}-01`, -1);
    const lockedThrough = previousEnd < settings.cutoverDate ? null : previousEnd;
    await runTransaction(async (session) => {
      const updated = await AccountingSettingsModel.updateOne(
        {
          organizationId: tenant.organizationId,
          lockedThrough: settings.lockedThrough,
        },
        { $set: { lockedThrough }, $inc: { version: 1 } },
        { session },
      );
      if (updated.modifiedCount !== 1) throw conflict('VERSION_CONFLICT', 'The periods were changed meanwhile');
      await PeriodEventModel.create(
        [
          {
            organizationId: tenant.organizationId,
            month: input.month,
            action: 'reopened',
            reason: input.reason,
            by: tenant.userId,
          },
        ],
        { session },
      );
      await auditLedger(tenant, 'period.reopened', { type: 'organization', id: tenant.organizationId }, { month: input.month }, session);
    });
    res.json({ lockedThrough });
  });

  // ---- statements -------------------------------------------------------------------------
  router.get('/accounting/reports/trial-balance', requirePermission('accounting.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const settings = await requireSettings(tenant);
    const { from, to } = parseInput(rangeSchema, req.query);
    boundedRange(from, to);
    const [accounts, before, during] = await Promise.all([
      LedgerAccountModel.find({
        organizationId: tenant.organizationId,
        isGroup: false,
      })
        .sort({ code: 1 })
        .lean<Lean<LedgerAccount>[]>(),
      netByAccount(tenant.organizationId, { to: addDays(from, -1) }),
      netByAccount(tenant.organizationId, { from, to }),
    ]);
    const rows = accounts
      .map((a) => {
        const b = before.get(String(a._id));
        const d = during.get(String(a._id));
        const opening = b ? b.debit - b.credit : 0;
        const debit = d?.debit ?? 0;
        const credit = d?.credit ?? 0;
        return {
          ...accountDto(a),
          opening,
          debit,
          credit,
          closing: opening + debit - credit,
        };
      })
      .filter((r) => r.opening !== 0 || r.debit !== 0 || r.credit !== 0);
    const totals = rows.reduce(
      (t, r) => ({
        opening: t.opening + r.opening,
        debit: t.debit + r.debit,
        credit: t.credit + r.credit,
        closing: t.closing + r.closing,
      }),
      { opening: 0, debit: 0, credit: 0, closing: 0 },
    );
    res.json({
      from,
      to,
      currency: settings.currency,
      rows,
      totals,
      balanced: totals.debit === totals.credit && totals.closing === 0,
    });
  });

  router.get('/accounting/reports/ledger', requirePermission('accounting.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const settings = await requireSettings(tenant);
    const input = parseInput(rangeSchema.extend({ accountId: objectIdSchema }), req.query);
    boundedRange(input.from, input.to);
    const accountId = new Types.ObjectId(input.accountId);
    const account = await LedgerAccountModel.findOne({
      organizationId: tenant.organizationId,
      _id: accountId,
    }).lean<Lean<LedgerAccount>>();
    if (!account) throw notFound();
    const before = (
      await netByAccount(tenant.organizationId, {
        to: addDays(input.from, -1),
      })
    ).get(input.accountId);
    const opening = before ? before.debit - before.credit : 0;
    const LIMIT = 1000;
    const entries = await JournalEntryModel.find({
      organizationId: tenant.organizationId,
      'lines.accountId': accountId,
      date: { $gte: input.from, $lte: input.to },
    })
      .sort({ date: 1, number: 1 })
      .limit(LIMIT + 1)
      .lean<Lean<JournalEntry>[]>();
    let running = opening;
    const lines = entries.slice(0, LIMIT).flatMap((e) =>
      e.lines
        .filter((l) => l.accountId.equals(accountId))
        .map((l) => {
          running += l.debit - l.credit;
          return {
            entryId: String(e._id),
            number: e.number,
            date: e.date,
            journal: e.journal,
            memo: e.memo || l.memo,
            source: {
              type: e.source.type,
              event: e.source.event.length > 30 ? '' : e.source.event,
            },
            branchId: l.branchId ? String(l.branchId) : null,
            debit: l.debit,
            credit: l.credit,
            balance: running,
          };
        }),
    );
    res.json({
      account: accountDto(account),
      from: input.from,
      to: input.to,
      currency: settings.currency,
      opening,
      lines,
      closing: running,
      truncated: entries.length > LIMIT,
    });
  });

  const statementGroups = async (tenant: TenantContext, types: readonly AccountType[], nets: Awaited<ReturnType<typeof netByAccount>>) => {
    const accounts = await LedgerAccountModel.find({
      organizationId: tenant.organizationId,
      isGroup: false,
      type: { $in: types },
    })
      .sort({ code: 1 })
      .lean<Lean<LedgerAccount>[]>();
    return types.map((type) => {
      const rows = accounts
        .filter((a) => a.type === type)
        .map((a) => {
          const n = nets.get(String(a._id));
          return {
            ...accountDto(a),
            amount: n ? signed(a.type, n.debit, n.credit) : 0,
          };
        })
        .filter((r) => r.amount !== 0);
      return { type, rows, total: rows.reduce((s, r) => s + r.amount, 0) };
    });
  };

  // "Result per ledger": income minus expenses as posted — not a certified net profit.
  router.get('/accounting/reports/profit-loss', requirePermission('accounting.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const settings = await requireSettings(tenant);
    const input = parseInput(rangeSchema.extend({ branchId: objectIdSchema.optional() }), req.query);
    boundedRange(input.from, input.to);
    const branchId = input.branchId ? new Types.ObjectId(input.branchId) : undefined;
    if (
      branchId &&
      !(await BranchModel.exists({
        organizationId: tenant.organizationId,
        _id: branchId,
      }))
    )
      throw notFound();
    const nets = await netByAccount(tenant.organizationId, {
      from: input.from,
      to: input.to,
      branchId,
    });
    const [income, expense] = await statementGroups(tenant, ['income', 'expense'], nets);
    res.json({
      from: input.from,
      to: input.to,
      branchId: input.branchId ?? null,
      currency: settings.currency,
      income,
      expense,
      result: income!.total - expense!.total,
    });
  });

  router.get('/accounting/reports/balance-sheet', requirePermission('accounting.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const settings = await requireSettings(tenant);
    const { asOf } = parseInput(z.object({ asOf: dateSchema }), req.query);
    const nets = await netByAccount(tenant.organizationId, { to: asOf });
    const [asset, liability, equity, income, expense] = await statementGroups(tenant, ['asset', 'liability', 'equity', 'income', 'expense'], nets);
    // No year-end closing entries: the accumulated result is shown as its own equity line.
    const accumulatedResult = income!.total - expense!.total;
    const equityTotal = equity!.total + accumulatedResult;
    res.json({
      asOf,
      currency: settings.currency,
      assets: asset,
      liabilities: liability,
      equity: { ...equity!, accumulatedResult, total: equityTotal },
      balanced: asset!.total === liability!.total + equityTotal,
    });
  });

  // Open patient invoices by age (branch-scoped: it reads the invoices themselves).
  router.get('/accounting/reports/receivables-aging', requirePermission('accounting.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const settings = await requireSettings(tenant);
    const now = clock.now();
    const day = 86_400_000;
    const rows = await InvoiceModel.aggregate<{
      _id: Types.ObjectId;
      b0: number;
      b30: number;
      b60: number;
      b90: number;
      total: number;
      count: number;
    }>([
      {
        $match: {
          ...branchOwnedFilter(tenant, { status: 'issued' }),
          $expr: { $gt: ['$total', { $add: ['$paid', '$credited'] }] },
        },
      },
      {
        $project: {
          patientId: 1,
          open: { $subtract: ['$total', { $add: ['$paid', '$credited'] }] },
          age: { $divide: [{ $subtract: [now, '$issuedAt'] }, day] },
        },
      },
      {
        $group: {
          _id: '$patientId',
          b0: { $sum: { $cond: [{ $lte: ['$age', 30] }, '$open', 0] } },
          b30: {
            $sum: {
              $cond: [{ $and: [{ $gt: ['$age', 30] }, { $lte: ['$age', 60] }] }, '$open', 0],
            },
          },
          b60: {
            $sum: {
              $cond: [{ $and: [{ $gt: ['$age', 60] }, { $lte: ['$age', 90] }] }, '$open', 0],
            },
          },
          b90: { $sum: { $cond: [{ $gt: ['$age', 90] }, '$open', 0] } },
          total: { $sum: '$open' },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
      { $limit: 200 },
    ]);
    const patients = await PatientModel.find({
      organizationId: tenant.organizationId,
      _id: { $in: rows.map((r) => r._id) },
    })
      .select('fullName patientNumber')
      .lean();
    const byId = new Map(patients.map((p) => [String(p._id), p]));
    const totals = rows.reduce(
      (t, r) => ({
        b0: t.b0 + r.b0,
        b30: t.b30 + r.b30,
        b60: t.b60 + r.b60,
        b90: t.b90 + r.b90,
        total: t.total + r.total,
      }),
      { b0: 0, b30: 0, b60: 0, b90: 0, total: 0 },
    );
    res.json({
      currency: settings.currency,
      rows: rows.map((r) => ({
        patientId: String(r._id),
        fullName: byId.get(String(r._id))?.fullName ?? '',
        patientNumber: byId.get(String(r._id))?.patientNumber ?? '',
        count: r.count,
        buckets: {
          d0_30: r.b0,
          d31_60: r.b30,
          d61_90: r.b60,
          d90plus: r.b90,
        },
        total: r.total,
      })),
      totals: {
        d0_30: totals.b0,
        d31_60: totals.b30,
        d61_90: totals.b60,
        d90plus: totals.b90,
        total: totals.total,
      },
    });
  });

  // Sub-ledgers against the ledger: open invoices vs the receivable account, unallocated receipts
  // vs patient advances. A difference means missing opening balances or a posting problem.
  router.get('/accounting/reports/reconciliation', requirePermission('accounting.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const settings = await requireSettings(tenant);
    const nets = await netByAccount(tenant.organizationId, {});
    const ledgerOf = (key: MappingKey, credit = false) => {
      const n = nets.get(String(settings.mappings[key]));
      return n ? (credit ? n.credit - n.debit : n.debit - n.credit) : 0;
    };
    const [receivable] = await InvoiceModel.aggregate<{ open: number }>([
      { $match: { organizationId: tenant.organizationId, status: 'issued' } },
      {
        $group: {
          _id: null,
          open: {
            $sum: { $subtract: ['$total', { $add: ['$paid', '$credited'] }] },
          },
        },
      },
    ]);
    const [advances] = await PaymentModel.aggregate<{ open: number }>([
      { $match: { organizationId: tenant.organizationId, status: 'active' } },
      {
        $group: {
          _id: null,
          open: {
            $sum: {
              $subtract: ['$amount', { $add: ['$allocated', '$refunded'] }],
            },
          },
        },
      },
    ]);
    const rows = [
      {
        key: 'receivable',
        subledger: receivable?.open ?? 0,
        ledger: ledgerOf('receivable'),
      },
      {
        key: 'patientAdvances',
        subledger: advances?.open ?? 0,
        ledger: ledgerOf('patientAdvances', true),
      },
    ].map((r) => ({ ...r, difference: r.ledger - r.subledger }));
    res.json({ currency: settings.currency, rows });
  });

  // Dry run for the cutover: patient balances at the start of the cutover date, from the documents,
  // as proposed opening lines. Nothing is posted; an accountant reviews and posts an opening entry.
  router.get('/accounting/migration/preview', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const settings = await requireSettings(tenant);
    const zone = await organizationZone(tenant.organizationId);
    const at = dayRange(settings.cutoverDate, zone).start;
    const org = tenant.organizationId;
    const [invoices, notes, payments, refunds] = await Promise.all([
      InvoiceModel.find({
        organizationId: org,
        status: 'issued',
        issuedAt: { $lt: at },
      })
        .select('total')
        .lean(),
      AdjustmentModel.find({
        organizationId: org,
        type: 'credit_note',
        createdAt: { $lt: at },
      })
        .select('invoiceId amount')
        .lean(),
      PaymentModel.find({ organizationId: org, receivedAt: { $lt: at } })
        .select('amount allocations status reversal')
        .lean(),
      AdjustmentModel.find({
        organizationId: org,
        type: 'refund',
        createdAt: { $lt: at },
      })
        .select('paymentId amount')
        .lean(),
    ]);
    const invoiceIds = new Set(invoices.map((i) => String(i._id)));
    let receivable = invoices.reduce((s, i) => s + i.total, 0);
    receivable -= notes.filter((n) => n.invoiceId && invoiceIds.has(String(n.invoiceId))).reduce((s, n) => s + n.amount, 0);
    let advances = 0;
    for (const p of payments) {
      // A receipt reversed before the cutover no longer counts; one reversed later still did then.
      if (p.status === 'reversed' && p.reversal && p.reversal.at < at) continue;
      const allocatedBefore = p.allocations.filter((a) => a.at < at).reduce((s, a) => s + a.amount, 0);
      receivable -= p.allocations.filter((a) => a.at < at && invoiceIds.has(String(a.invoiceId))).reduce((s, a) => s + a.amount, 0);
      const refundedBefore = refunds.filter((r) => r.paymentId && r.paymentId.equals(p._id)).reduce((s, r) => s + r.amount, 0);
      advances += p.amount - allocatedBefore - refundedBefore;
    }
    const posted = await JournalEntryModel.countDocuments({
      organizationId: org,
      journal: 'opening',
      reversedBy: null,
    });
    res.json({
      cutoverDate: settings.cutoverDate,
      currency: settings.currency,
      documentsBefore: {
        invoices: invoices.length,
        receipts: payments.length,
      },
      proposal: [
        {
          key: 'receivable',
          accountId: String(settings.mappings.receivable),
          debit: Math.max(receivable, 0),
          credit: Math.max(-receivable, 0),
        },
        {
          key: 'patientAdvances',
          accountId: String(settings.mappings.patientAdvances),
          debit: 0,
          credit: Math.max(advances, 0),
        },
        {
          key: 'openingEquity',
          accountId: String(settings.mappings.openingEquity),
          debit: Math.max(advances - receivable, 0),
          credit: Math.max(receivable - advances, 0),
        },
      ],
      openingEntriesPosted: posted,
    });
  });

  return router;
}
