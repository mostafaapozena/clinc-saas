import { createHash, randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { Types, type ClientSession } from 'mongoose';
import { z } from 'zod';
import { runTransaction } from '../../db/transaction.js';
import { HttpError, conflict, isDuplicateKeyError, notFound, validationError } from '../../http/errors.js';
import { objectIdSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { canAccessBranch } from '../../tenancy/scope.js';
import { parseObjectId, requirePermission, tenantCan, tenantOf, type TenantContext } from '../../tenancy/tenant-context.js';
import { clock } from '../../time/clock.js';
import { DATE_PATTERN, isValidDate } from '../../time/local-time.js';
import { UserModel } from '../../users/user.model.js';
import { BranchModel } from '../branches/branch.model.js';
import { MAX_AMOUNT, ensureCounter, nextNumber } from '../finance/finance.model.js';
import {
  BankStatementLineModel,
  CashAccountModel,
  CashSessionModel,
  CashVoucherModel,
  JournalEntryModel,
  LedgerAccountModel,
  type BankStatementLine,
  type CashAccount,
  type CashSession,
  type CashVoucher,
  type JournalEntry,
  type MappingKey,
} from './accounting.model.js';
import { accountBalance, ledgerToday, mapped, postEntry, prepareLedger, type Lean } from './accounting.posting.js';
import { auditLedger, requireOrgWide, requireSettings } from './accounting.routes.js';

// Cashboxes, bank accounts, cashier sessions, cash vouchers and bank reconciliation
// (docs/architecture/ACCOUNTING.md, "Cash and banks"). Every movement is a balanced journal entry;
// a transfer is one entry with both sides, so it can never be one-sided.

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;
const amount = z.number().int().min(1).max(MAX_AMOUNT);
const counted = z.number().int().min(0).max(MAX_AMOUNT);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
const year = (date: string) => Number(date.slice(0, 4));
const pad = (n: number) => String(n).padStart(6, '0');

function requireKey(req: Request): string {
  const key = req.get('idempotency-key') ?? '';
  if (!IDEMPOTENCY_KEY.test(key)) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header');
  return key;
}

/** Cash accounts the caller may see: their branches' and, for organization-wide callers, organization-level ones. */
const visible = (tenant: TenantContext, a: Pick<CashAccount, 'branchId'>) =>
  a.branchId ? canAccessBranch(tenant, a.branchId) : tenant.branchScope.type === 'all';

async function cashAccountOr404(tenant: TenantContext, id: string | Types.ObjectId, session?: ClientSession) {
  const oid = typeof id === 'string' ? parseObjectId(id) : id;
  if (!oid) throw notFound();
  const account = await CashAccountModel.findOne({
    organizationId: tenant.organizationId,
    _id: oid,
  })
    .session(session ?? null)
    .lean<Lean<CashAccount>>();
  if (!account || !visible(tenant, account)) throw notFound();
  return account;
}

const cashAccountDto = (a: Lean<CashAccount>, balance?: number) => ({
  id: String(a._id),
  name: a.name,
  kind: a.kind,
  branchId: a.branchId ? String(a.branchId) : null,
  accountId: String(a.accountId),
  status: a.status,
  ...(balance === undefined ? {} : { balance }),
});
const sessionDto = (s: Lean<CashSession>, names?: Map<string, string>) => ({
  id: String(s._id),
  number: s.number,
  branchId: String(s.branchId),
  cashAccountId: String(s.cashAccountId),
  status: s.status,
  openedBy: String(s.openedBy),
  openedByName: names?.get(String(s.openedBy)) ?? null,
  openedAt: s.openedAt.toISOString(),
  openingExpected: s.openingExpected,
  openingCounted: s.openingCounted,
  closedAt: s.closedAt ? s.closedAt.toISOString() : null,
  closingExpected: s.closingExpected,
  closingCounted: s.closingCounted,
  difference: s.difference,
  note: s.note,
});
const voucherDto = (v: Lean<CashVoucher>) => ({
  id: String(v._id),
  number: v.number,
  type: v.type,
  date: v.date,
  cashAccountId: String(v.cashAccountId),
  toCashAccountId: v.toCashAccountId ? String(v.toCashAccountId) : null,
  counterAccountId: v.counterAccountId ? String(v.counterAccountId) : null,
  branchId: v.branchId ? String(v.branchId) : null,
  amount: v.amount,
  reference: v.reference,
  memo: v.memo,
  entryId: String(v.entryId),
  createdAt: v.createdAt.toISOString(),
});
const bankLineDto = (l: Lean<BankStatementLine>) => ({
  id: String(l._id),
  date: l.date,
  amount: l.amount,
  description: l.description,
  reference: l.reference,
  status: l.status,
  entryId: l.match ? String(l.match.entryId) : null,
});

/** Display names of the cashiers (no other user data). */
async function cashierNames(sessions: Lean<CashSession>[]) {
  const ids = [...new Set(sessions.map((s) => String(s.openedBy)))].map((id) => new Types.ObjectId(id));
  const users = await UserModel.find({ _id: { $in: ids } })
    .select('displayName')
    .lean();
  return new Map(users.map((u) => [String(u._id), u.displayName]));
}

/** Movements of a session: lines on its cashbox account in entries tagged with the session. */
async function sessionMovements(organizationId: Types.ObjectId, s: Lean<CashSession>, ledgerAccountId: Types.ObjectId, session?: ClientSession) {
  const entries = await JournalEntryModel.find({
    organizationId,
    cashSessionId: s._id,
  })
    .sort({ createdAt: 1 })
    .session(session ?? null)
    .lean<Lean<JournalEntry>[]>();
  const rows = entries.flatMap((e) =>
    e.lines
      .filter((l) => l.accountId.equals(ledgerAccountId))
      .map((l) => ({
        entryId: String(e._id),
        number: e.number,
        memo: e.memo,
        sourceType: e.source.type,
        event: e.source.event.length > 30 ? '' : e.source.event,
        amount: l.debit - l.credit,
        at: e.createdAt.toISOString(),
      })),
  );
  return { rows, net: rows.reduce((sum, r) => sum + r.amount, 0) };
}

const sessionSchema = z.object({
  cashAccountId: objectIdSchema,
  openingCounted: counted,
  note: z.string().trim().max(300).default(''),
});
const closeSchema = z.object({
  counted,
  note: z.string().trim().max(300).default(''),
});
const cashAccountSchema = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['cash', 'bank']),
  branchId: objectIdSchema.nullable().default(null),
});
const voucherSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.enum(['in', 'out']),
    cashAccountId: objectIdSchema,
    counterAccountId: objectIdSchema,
    amount,
    reference: z.string().trim().max(60).default(''),
    memo: z.string().trim().min(3).max(200),
  }),
  z.object({
    type: z.literal('transfer'),
    cashAccountId: objectIdSchema,
    toCashAccountId: objectIdSchema,
    amount,
    reference: z.string().trim().max(60).default(''),
    memo: z.string().trim().min(3).max(200),
  }),
]);
const importSchema = z.object({ csv: z.string().min(1).max(100_000) });

/** "2026-11-03,1250.50,Card settlement,REF1" lines → statement lines (amounts in minor units). */
export function parseStatementCsv(csv: string) {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 500) throw validationError({ csv: 'too_many_lines' });
  return lines.map((line, i) => {
    const [date = '', amountText = '', description = '', reference = ''] = line.split(',').map((c) => c.trim());
    const m = /^(-?)(\d{1,8})(?:\.(\d{1,2}))?$/.exec(amountText);
    if (!DATE_PATTERN.test(date) || !isValidDate(date) || !m) throw validationError({ csv: `invalid_line_${i + 1}` });
    const minor = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
    if (minor === 0) throw validationError({ csv: `invalid_line_${i + 1}` });
    return {
      date,
      amount: m[1] === '-' ? -minor : minor,
      description: description.slice(0, 140),
      reference: reference.slice(0, 60),
    };
  });
}

export function createCashRouter() {
  const router = Router({ mergeParams: true });
  const reviewer = (tenant: TenantContext) => tenantCan(tenant, 'cash.session.review');

  // ---- cash and bank accounts --------------------------------------------------------------
  router.get('/cash/accounts', requirePermission('cash.session.operate'), async (req, res) => {
    const tenant = tenantOf(req);
    await requireSettings(tenant);
    const all = await CashAccountModel.find({
      organizationId: tenant.organizationId,
    })
      .sort({ kind: 1, createdAt: 1 })
      .lean<Lean<CashAccount>[]>();
    const mine = all.filter((a) => visible(tenant, a));
    const withBalance = tenantCan(tenant, 'accounting.read') || reviewer(tenant);
    const rows = await Promise.all(
      mine.map(async (a) => cashAccountDto(a, withBalance ? await accountBalance(tenant.organizationId, a.accountId) : undefined)),
    );
    res.json({ accounts: rows });
  });

  // A new cashbox or bank account gets its own ledger account under "Cash and banks".
  router.post('/cash/accounts', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const input = parseInput(cashAccountSchema, req.body);
    const settings = await requireSettings(tenant);
    if (input.kind === 'cash' && !input.branchId) throw validationError({ branchId: 'required_for_cash' });
    const branchId = input.branchId ? new Types.ObjectId(input.branchId) : null;
    if (
      branchId &&
      !(await BranchModel.exists({
        organizationId: tenant.organizationId,
        _id: branchId,
      }))
    )
      throw validationError({ branchId: 'not_found' });
    const group = await LedgerAccountModel.findOne({
      organizationId: tenant.organizationId,
      templateKey: 'cashAndBanks',
    }).lean();
    const parent =
      group ??
      (await LedgerAccountModel.findOne({
        organizationId: tenant.organizationId,
        _id: mapped(settings, 'cash'),
      }).lean());
    if (!parent) throw conflict('CHART_INCOMPLETE', 'The cash and banks group is missing');
    const created = await runTransaction(async (session) => {
      const siblings = await LedgerAccountModel.find({
        organizationId: tenant.organizationId,
        code: { $regex: '^11\\d\\d$' },
      })
        .select('code')
        .session(session)
        .lean();
      const next = Math.max(1110, ...siblings.map((s) => Number(s.code))) + 1;
      if (next > 1199) throw conflict('CHART_FULL', 'No free account code under cash and banks');
      const [ledger] = await LedgerAccountModel.create(
        [
          {
            organizationId: tenant.organizationId,
            code: String(next),
            name: input.name,
            type: 'asset',
            parentId: group?._id ?? null,
            role: input.kind,
          },
        ],
        { session },
      );
      const [account] = await CashAccountModel.create(
        [
          {
            organizationId: tenant.organizationId,
            name: input.name,
            kind: input.kind,
            branchId,
            accountId: ledger!._id,
          },
        ],
        { session },
      );
      await auditLedger(
        tenant,
        'cash_account.created',
        { type: 'cash_account', id: account!._id },
        { kind: input.kind, code: ledger!.code },
        session,
      );
      return account!.toObject() as Lean<CashAccount>;
    });
    res.status(201).json({ account: cashAccountDto(created, 0) });
  });

  router.patch('/cash/accounts/:cashAccountId', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const { status } = parseInput(z.object({ status: z.enum(['active', 'archived']) }), req.body);
    const account = await cashAccountOr404(tenant, req.params.cashAccountId as string);
    if (status === 'archived') {
      if (
        await CashSessionModel.exists({
          organizationId: tenant.organizationId,
          cashAccountId: account._id,
          status: 'open',
        })
      )
        throw conflict('OPEN_CASH_SESSIONS', 'Close the open session of this cashbox first');
      if ((await accountBalance(tenant.organizationId, account.accountId)) !== 0)
        throw conflict('ACCOUNT_HAS_BALANCE', 'Move the balance out before archiving');
    }
    await CashAccountModel.updateOne({ organizationId: tenant.organizationId, _id: account._id }, { $set: { status } });
    await auditLedger(tenant, 'cash_account.updated', { type: 'cash_account', id: account._id }, { status });
    res.json({ account: cashAccountDto({ ...account, status }) });
  });

  // ---- cashier sessions -------------------------------------------------------------------
  router.get('/cash/sessions', requirePermission('cash.session.operate'), async (req, res) => {
    const tenant = tenantOf(req);
    await requireSettings(tenant);
    const { status } = parseInput(z.object({ status: z.enum(['open', 'closed']).optional() }), req.query);
    const filter: Record<string, unknown> = {
      organizationId: tenant.organizationId,
      ...(status ? { status } : {}),
    };
    if (tenant.branchScope.type !== 'all') filter.branchId = { $in: tenant.branchScope.branchIds };
    // Cashiers see their own sessions; reviewers everyone's within their branches.
    if (!reviewer(tenant)) filter.openedBy = tenant.userId;
    const sessions = await CashSessionModel.find(filter).sort({ openedAt: -1 }).limit(100).lean<Lean<CashSession>[]>();
    const names = await cashierNames(sessions);
    res.json({
      sessions: sessions.map((s) => ({
        ...sessionDto(s, names),
        mine: s.openedBy.equals(tenant.userId),
      })),
    });
  });

  router.post('/cash/sessions', requirePermission('cash.session.operate'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(sessionSchema, req.body);
    const settings = await requireSettings(tenant);
    const box = await cashAccountOr404(tenant, input.cashAccountId);
    if (box.kind !== 'cash' || !box.branchId || box.status !== 'active')
      throw conflict('NOT_A_BRANCH_CASHBOX', 'Sessions run on an active branch cashbox');
    const branchId = box.branchId;
    const now = clock.now();
    const date = await ledgerToday(tenant.organizationId);
    await ensureCounter(tenant.organizationId, `CS:${year(date)}`);
    await prepareLedger(tenant.organizationId);
    try {
      const created = await runTransaction(async (session) => {
        if (
          await CashSessionModel.exists({
            organizationId: tenant.organizationId,
            openedBy: tenant.userId,
            branchId,
            status: 'open',
          }).session(session)
        )
          throw conflict('SESSION_ALREADY_OPEN', 'You already have an open session at this branch');
        const expected = await accountBalance(tenant.organizationId, box.accountId, undefined, session);
        if (input.openingCounted !== expected && input.note.length < 3) throw validationError({ note: 'required_for_difference' });
        const seq = await nextNumber(tenant.organizationId, `CS:${year(date)}`, session);
        const [opened] = await CashSessionModel.create(
          [
            {
              organizationId: tenant.organizationId,
              branchId,
              cashAccountId: box._id,
              number: `CS-${year(date)}-${pad(seq)}`,
              openedBy: tenant.userId,
              openedAt: now,
              openingExpected: expected,
              openingCounted: input.openingCounted,
              note: input.note,
            },
          ],
          { session },
        );
        const s = opened!.toObject() as Lean<CashSession>;
        // The cashbox ledger follows the counted cash; the difference goes to cash over/short.
        const diff = input.openingCounted - expected;
        if (diff !== 0) {
          await postEntry(
            {
              organizationId: tenant.organizationId,
              userId: tenant.userId,
              date,
              journal: 'cash',
              memo: `${s.number} opening count`,
              lines: [
                {
                  accountId: box.accountId,
                  debit: Math.max(diff, 0),
                  credit: Math.max(-diff, 0),
                  branchId,
                },
                {
                  accountId: mapped(settings, 'cashOverShort'),
                  debit: Math.max(-diff, 0),
                  credit: Math.max(diff, 0),
                  branchId,
                },
              ],
              source: {
                type: 'cash_session',
                id: s._id,
                event: 'opening-difference',
              },
            },
            session,
            settings,
          );
        }
        await auditLedger(
          tenant,
          'cash_session.opened',
          { type: 'cash_session', id: s._id },
          {
            number: s.number,
            openingCounted: input.openingCounted,
            expected,
          },
          session,
        );
        return s;
      });
      res.status(201).json({ session: sessionDto(created) });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw conflict('CASHBOX_IN_USE', 'Another session is open on this cashbox');
      throw err;
    }
  });

  router.get('/cash/sessions/:sessionId', requirePermission('cash.session.operate'), async (req, res) => {
    const tenant = tenantOf(req);
    const id = parseObjectId(req.params.sessionId);
    if (!id) throw notFound();
    const s = await CashSessionModel.findOne({
      organizationId: tenant.organizationId,
      _id: id,
    }).lean<Lean<CashSession>>();
    if (!s || !canAccessBranch(tenant, s.branchId) || (!reviewer(tenant) && !s.openedBy.equals(tenant.userId))) throw notFound();
    const box = await CashAccountModel.findOne({
      organizationId: tenant.organizationId,
      _id: s.cashAccountId,
    }).lean<Lean<CashAccount>>();
    if (!box) throw notFound();
    const movements = await sessionMovements(tenant.organizationId, s, box.accountId);
    res.json({
      session: {
        ...sessionDto(s, await cashierNames([s])),
        mine: s.openedBy.equals(tenant.userId),
      },
      cashAccount: cashAccountDto(box),
      movements: movements.rows,
      expectedNow: s.openingCounted + movements.net,
    });
  });

  router.post('/cash/sessions/:sessionId/close', requirePermission('cash.session.operate'), async (req, res) => {
    const tenant = tenantOf(req);
    const id = parseObjectId(req.params.sessionId);
    if (!id) throw notFound();
    const input = parseInput(closeSchema, req.body);
    const settings = await requireSettings(tenant);
    const date = await ledgerToday(tenant.organizationId);
    await prepareLedger(tenant.organizationId);
    const closed = await runTransaction(async (session) => {
      const s = await CashSessionModel.findOne({
        organizationId: tenant.organizationId,
        _id: id,
      })
        .session(session)
        .lean<Lean<CashSession>>();
      if (!s || !canAccessBranch(tenant, s.branchId)) throw notFound();
      if (!s.openedBy.equals(tenant.userId) && !reviewer(tenant)) throw notFound();
      if (s.status !== 'open') throw conflict('SESSION_CLOSED', 'This session is already closed');
      const box = await CashAccountModel.findOne({
        organizationId: tenant.organizationId,
        _id: s.cashAccountId,
      })
        .session(session)
        .lean<Lean<CashAccount>>();
      if (!box) throw notFound();
      const movements = await sessionMovements(tenant.organizationId, s, box.accountId, session);
      const expected = s.openingCounted + movements.net;
      const difference = input.counted - expected;
      if (difference !== 0 && input.note.length < 3) throw validationError({ note: 'required_for_difference' });
      const updated = await CashSessionModel.findOneAndUpdate(
        { organizationId: tenant.organizationId, _id: id, status: 'open' },
        {
          $set: {
            status: 'closed',
            closedBy: tenant.userId,
            closedAt: clock.now(),
            closingExpected: expected,
            closingCounted: input.counted,
            difference,
            note: input.note || s.note,
          },
        },
        { session, returnDocument: 'after' },
      ).lean<Lean<CashSession>>();
      if (!updated) throw conflict('SESSION_CLOSED', 'This session is already closed');
      if (difference !== 0) {
        await postEntry(
          {
            organizationId: tenant.organizationId,
            userId: tenant.userId,
            date,
            journal: 'cash',
            memo: `${s.number} closing count`,
            lines: [
              {
                accountId: box.accountId,
                debit: Math.max(difference, 0),
                credit: Math.max(-difference, 0),
                branchId: s.branchId,
              },
              {
                accountId: mapped(settings, 'cashOverShort'),
                debit: Math.max(-difference, 0),
                credit: Math.max(difference, 0),
                branchId: s.branchId,
              },
            ],
            source: {
              type: 'cash_session',
              id: s._id,
              event: 'closing-difference',
            },
            cashSessionId: s._id,
          },
          session,
          settings,
        );
      }
      await auditLedger(
        tenant,
        'cash_session.closed',
        { type: 'cash_session', id },
        { number: s.number, expected, counted: input.counted, difference },
        session,
      );
      return updated;
    });
    res.json({ session: sessionDto(closed) });
  });

  // ---- vouchers and transfers -------------------------------------------------------------
  router.get('/cash/vouchers', requirePermission('cash.voucher.create'), async (req, res) => {
    const tenant = tenantOf(req);
    await requireSettings(tenant);
    const vouchers = await CashVoucherModel.find({
      organizationId: tenant.organizationId,
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean<Lean<CashVoucher>[]>();
    const boxes = await CashAccountModel.find({
      organizationId: tenant.organizationId,
    }).lean<Lean<CashAccount>[]>();
    const seen = new Set(boxes.filter((b) => visible(tenant, b)).map((b) => String(b._id)));
    res.json({
      vouchers: vouchers
        .filter((v) => seen.has(String(v.cashAccountId)) || (v.toCashAccountId && seen.has(String(v.toCashAccountId))))
        .map(voucherDto),
    });
  });

  router.post('/cash/vouchers', requirePermission('cash.voucher.create'), async (req, res) => {
    const tenant = tenantOf(req);
    const key = requireKey(req);
    const input = parseInput(voucherSchema, req.body);
    const settings = await requireSettings(tenant);
    const requestHash = hash(input);
    const previous = await CashVoucherModel.findOne({
      organizationId: tenant.organizationId,
      createdBy: tenant.userId,
      idempotencyKey: key,
    }).lean<Lean<CashVoucher>>();
    if (previous) {
      if (previous.requestHash !== requestHash) throw conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different request');
      res.json({ voucher: voucherDto(previous), replayed: true });
      return;
    }
    const from = await cashAccountOr404(tenant, input.cashAccountId);
    const to = input.type === 'transfer' ? await cashAccountOr404(tenant, input.toCashAccountId) : null;
    if (from.status !== 'active' || (to && to.status !== 'active')) throw conflict('CASH_ACCOUNT_ARCHIVED', 'This cash account is archived');
    if (to && to._id.equals(from._id)) throw validationError({ toCashAccountId: 'same_account' });
    let counterId: Types.ObjectId | null = null;
    if (input.type !== 'transfer') {
      const counter = await LedgerAccountModel.findOne({
        organizationId: tenant.organizationId,
        _id: new Types.ObjectId(input.counterAccountId),
        status: 'active',
        isGroup: false,
      }).lean();
      // Control accounts and cash/bank accounts are not allowed: those have their own documents.
      const control = new Set(
        ['receivable', 'patientAdvances', 'payable', 'grni', 'inventory', 'practitionerPayable'].map((k) =>
          String(settings.mappings[k as MappingKey]),
        ),
      );
      if (!counter || counter.role || control.has(String(counter._id))) throw validationError({ counterAccountId: 'account_not_allowed' });
      counterId = counter._id;
    }
    const date = await ledgerToday(tenant.organizationId);
    await ensureCounter(tenant.organizationId, `CV:${year(date)}`);
    await prepareLedger(tenant.organizationId);
    try {
      const voucher = await runTransaction(async (session) => {
        // Cash leaving a cashbox: never below zero.
        const goingOut = input.type !== 'in';
        if (goingOut && from.kind === 'cash' && (await accountBalance(tenant.organizationId, from.accountId, undefined, session)) < input.amount)
          throw conflict('INSUFFICIENT_CASH', 'The cashbox does not hold this amount');
        const open = await CashSessionModel.findOne({
          organizationId: tenant.organizationId,
          status: 'open',
          openedBy: tenant.userId,
          cashAccountId: { $in: [from._id, ...(to ? [to._id] : [])] },
        })
          .session(session)
          .lean();
        const seq = await nextNumber(tenant.organizationId, `CV:${year(date)}`, session);
        const number = `CV-${year(date)}-${pad(seq)}`;
        const voucherId = new Types.ObjectId();
        const lines =
          input.type === 'transfer'
            ? [
                {
                  accountId: to!.accountId,
                  debit: input.amount,
                  branchId: to!.branchId,
                },
                {
                  accountId: from.accountId,
                  credit: input.amount,
                  branchId: from.branchId,
                },
              ]
            : input.type === 'in'
              ? [
                  {
                    accountId: from.accountId,
                    debit: input.amount,
                    branchId: from.branchId,
                  },
                  {
                    accountId: counterId!,
                    credit: input.amount,
                    branchId: from.branchId,
                  },
                ]
              : [
                  {
                    accountId: counterId!,
                    debit: input.amount,
                    branchId: from.branchId,
                  },
                  {
                    accountId: from.accountId,
                    credit: input.amount,
                    branchId: from.branchId,
                  },
                ];
        const entry = await postEntry(
          {
            organizationId: tenant.organizationId,
            userId: tenant.userId,
            date,
            journal: from.kind === 'bank' && (!to || to.kind === 'bank') ? 'bank' : 'cash',
            memo: `${number} ${input.memo}`.slice(0, 200),
            lines,
            source: { type: 'voucher', id: voucherId, event: input.type },
            cashSessionId: open?._id ?? null,
          },
          session,
          settings,
        );
        const [created] = await CashVoucherModel.create(
          [
            {
              _id: voucherId,
              organizationId: tenant.organizationId,
              number,
              type: input.type,
              date,
              cashAccountId: from._id,
              toCashAccountId: to?._id ?? null,
              counterAccountId: counterId,
              branchId: from.branchId,
              amount: input.amount,
              reference: input.reference,
              memo: input.memo,
              entryId: entry._id,
              createdBy: tenant.userId,
              idempotencyKey: key,
              requestHash,
            },
          ],
          { session },
        );
        await auditLedger(
          tenant,
          'cash_voucher.created',
          { type: 'cash_voucher', id: voucherId },
          { number, type: input.type, amount: input.amount },
          session,
        );
        return created!.toObject() as Lean<CashVoucher>;
      });
      res.status(201).json({ voucher: voucherDto(voucher), replayed: false });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const again = await CashVoucherModel.findOne({
        organizationId: tenant.organizationId,
        createdBy: tenant.userId,
        idempotencyKey: key,
      }).lean<Lean<CashVoucher>>();
      if (!again || again.requestHash !== requestHash)
        throw conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different request');
      res.json({ voucher: voucherDto(again), replayed: true });
    }
  });

  // ---- bank reconciliation (manual or imported statements; no bank connection) -------------
  router.get('/cash/accounts/:cashAccountId/statement', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    await requireSettings(tenant);
    const account = await cashAccountOr404(tenant, req.params.cashAccountId as string);
    if (account.kind !== 'bank') throw conflict('NOT_A_BANK_ACCOUNT', 'Statements are for bank accounts');
    const [lines, entries] = await Promise.all([
      BankStatementLineModel.find({
        organizationId: tenant.organizationId,
        cashAccountId: account._id,
      })
        .sort({ date: -1 })
        .limit(300)
        .lean<Lean<BankStatementLine>[]>(),
      JournalEntryModel.find({
        organizationId: tenant.organizationId,
        'lines.accountId': account.accountId,
      })
        .sort({ date: -1 })
        .limit(300)
        .lean<Lean<JournalEntry>[]>(),
    ]);
    const matched = new Set(
      (
        await BankStatementLineModel.find({
          organizationId: tenant.organizationId,
          cashAccountId: account._id,
          status: 'matched',
        })
          .select('match')
          .lean()
      ).map((l) => String(l.match?.entryId)),
    );
    const candidates = entries
      .filter((e) => !matched.has(String(e._id)))
      .map((e) => ({
        entryId: String(e._id),
        number: e.number,
        date: e.date,
        memo: e.memo,
        amount: e.lines.filter((l) => l.accountId.equals(account.accountId)).reduce((s, l) => s + l.debit - l.credit, 0),
      }));
    res.json({
      account: cashAccountDto(account, await accountBalance(tenant.organizationId, account.accountId)),
      lines: lines.map(bankLineDto),
      unmatchedEntries: candidates,
    });
  });

  router.post('/cash/accounts/:cashAccountId/statement', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    await requireSettings(tenant);
    const account = await cashAccountOr404(tenant, req.params.cashAccountId as string);
    if (account.kind !== 'bank') throw conflict('NOT_A_BANK_ACCOUNT', 'Statements are for bank accounts');
    const rows = parseStatementCsv(parseInput(importSchema, req.body).csv);
    const importBatch = randomUUID();
    await BankStatementLineModel.insertMany(
      rows.map((r) => ({
        ...r,
        organizationId: tenant.organizationId,
        cashAccountId: account._id,
        importBatch,
        createdBy: tenant.userId,
      })),
    );
    await auditLedger(tenant, 'bank_statement.imported', { type: 'cash_account', id: account._id }, { lines: rows.length });
    res.status(201).json({ imported: rows.length });
  });

  // Match one statement line to one ledger entry with the same net amount on that bank account.
  router.post('/cash/statement-lines/:lineId/match', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const id = parseObjectId(req.params.lineId);
    if (!id) throw notFound();
    const { entryId } = parseInput(z.object({ entryId: objectIdSchema }), req.body);
    const line = await BankStatementLineModel.findOne({
      organizationId: tenant.organizationId,
      _id: id,
    }).lean<Lean<BankStatementLine>>();
    if (!line) throw notFound();
    const account = await cashAccountOr404(tenant, line.cashAccountId);
    const entry = await JournalEntryModel.findOne({
      organizationId: tenant.organizationId,
      _id: new Types.ObjectId(entryId),
    }).lean<Lean<JournalEntry>>();
    if (!entry) throw notFound();
    const net = entry.lines.filter((l) => l.accountId.equals(account.accountId)).reduce((s, l) => s + l.debit - l.credit, 0);
    if (net !== line.amount) throw conflict('AMOUNT_MISMATCH', 'The entry does not move this amount on this account');
    try {
      const updated = await BankStatementLineModel.findOneAndUpdate(
        {
          organizationId: tenant.organizationId,
          _id: id,
          status: 'unmatched',
        },
        {
          $set: {
            status: 'matched',
            match: { entryId: entry._id, at: clock.now(), by: tenant.userId },
          },
        },
        { returnDocument: 'after' },
      ).lean<Lean<BankStatementLine>>();
      if (!updated) throw conflict('LINE_ALREADY_MATCHED', 'This line is already matched');
      await auditLedger(tenant, 'bank_line.matched', { type: 'cash_account', id: account._id }, { entry: entry.number, amount: line.amount });
      res.json({ line: bankLineDto(updated) });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw conflict('ENTRY_ALREADY_MATCHED', 'This entry is matched to another line');
      throw err;
    }
  });

  router.post('/cash/statement-lines/:lineId/unmatch', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const id = parseObjectId(req.params.lineId);
    if (!id) throw notFound();
    const line = await BankStatementLineModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, _id: id, status: 'matched' },
      { $set: { status: 'unmatched', match: null } },
      { returnDocument: 'after' },
    ).lean<Lean<BankStatementLine>>();
    if (!line) throw notFound();
    await auditLedger(tenant, 'bank_line.unmatched', { type: 'cash_account', id: line.cashAccountId }, { amount: line.amount });
    res.json({ line: bankLineDto(line) });
  });

  return router;
}
