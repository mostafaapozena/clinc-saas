import { createHash } from 'node:crypto';
import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { runTransaction } from '../../db/transaction.js';
import { HttpError, conflict, isDuplicateKeyError, notFound, validationError } from '../../http/errors.js';
import { objectIdSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { parseObjectId, requirePermission, tenantOf, type TenantContext } from '../../tenancy/tenant-context.js';
import { DATE_PATTERN, isValidDate } from '../../time/local-time.js';
import { CashAccountModel, CashSessionModel, LedgerAccountModel, type CashAccount } from '../accounting/accounting.model.js';
import { accountBalance, ledgerToday, postEntry, prepareLedger, type Lean, type LineInput } from '../accounting/accounting.posting.js';
import { auditLedger, requireOrgWide, requireSettings } from '../accounting/accounting.routes.js';
import { ensureTemplateAccount } from '../accounting/accounting.setup.js';
import { MAX_AMOUNT, ensureCounter, nextNumber } from '../finance/finance.model.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { UserModel } from '../../users/user.model.js';
import { STAFF_FUND_ACCOUNT, STAFF_FUND_KINDS, StaffFundModel, outstandingOf, type StaffFund, type StaffFundMovement } from './staff-funds.model.js';

// Employee cash advances (سلف) and petty-cash custody (عهد) — docs/architecture/STAFF_FUNDS.md.
//   issue      Dr advances/custody (partner: member)   Cr cashbox or bank
//   return     Dr cashbox or bank                       Cr advances/custody
//   expense    Dr expense accounts (custody receipts)   Cr custody
//   write-off  Dr other expenses (owner only)           Cr advances/custody
// The outstanding balance of every document adds up to the ledger account; vouchers and manual
// entries cannot post to these accounts.

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;
const dateSchema = z.string().regex(DATE_PATTERN).refine(isValidDate, 'invalid_date');
const amount = z.number().int().min(1).max(MAX_AMOUNT);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
const id = (v: Types.ObjectId | null | undefined) => (v ? String(v) : null);
const year = (date: string) => date.slice(0, 4);

function requireKey(req: Request): string {
  const key = req.get('idempotency-key') ?? '';
  if (!IDEMPOTENCY_KEY.test(key)) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header');
  return key;
}

const movementDto = (m: StaffFundMovement) => ({
  type: m.type,
  date: m.date,
  amount: m.amount,
  cashAccountId: id(m.cashAccountId),
  lines: m.lines.map((l) => ({ accountId: String(l.accountId), amount: l.amount, memo: l.memo })),
  memo: m.memo,
  entryId: String(m.entryId),
  at: m.at.toISOString(),
});
const fundDto = (f: Lean<StaffFund>, today: string, names?: Map<string, string>) => ({
  id: String(f._id),
  number: f.number,
  kind: f.kind,
  membershipId: String(f.membershipId),
  memberName: names?.get(String(f.membershipId)) ?? null,
  branchId: id(f.branchId),
  purpose: f.purpose,
  amount: f.amount,
  dueDate: f.dueDate,
  returned: f.returned,
  expensed: f.expensed,
  writtenOff: f.writtenOff,
  outstanding: outstandingOf(f),
  overdue: f.status === 'open' && Boolean(f.dueDate && f.dueDate < today),
  status: f.status,
  movements: f.movements.map(movementDto),
  version: f.version,
  createdAt: f.createdAt.toISOString(),
});

/** Display names of members (membership id → user display name). */
async function memberNames(organizationId: Types.ObjectId, membershipIds: Types.ObjectId[]) {
  const members = await MembershipModel.find({ organizationId, _id: { $in: membershipIds } })
    .select('userId')
    .lean();
  const users = await UserModel.find({ _id: { $in: members.map((m) => m.userId) } })
    .select('displayName')
    .lean();
  const byUser = new Map(users.map((u) => [String(u._id), u.displayName]));
  return new Map(members.map((m) => [String(m._id), byUser.get(String(m.userId)) ?? '']));
}

async function fundOr404(tenant: TenantContext, raw: unknown) {
  const fid = parseObjectId(raw);
  if (!fid) throw notFound();
  const f = await StaffFundModel.findOne({ organizationId: tenant.organizationId, _id: fid }).lean<Lean<StaffFund>>();
  if (!f) throw notFound();
  return f;
}

async function cashAccount(tenant: TenantContext, raw: string) {
  const c = await CashAccountModel.findOne({ organizationId: tenant.organizationId, _id: new Types.ObjectId(raw) }).lean<Lean<CashAccount>>();
  if (!c) throw validationError({ cashAccountId: 'not_found' });
  if (c.status !== 'active') throw conflict('CASH_ACCOUNT_ARCHIVED', 'This cash account is archived');
  return c;
}

/** The ledger account of a kind, created from the template on first use in older charts. */
async function fundAccount(organizationId: Types.ObjectId, kind: (typeof STAFF_FUND_KINDS)[number]) {
  try {
    return await runTransaction((session) => ensureTemplateAccount(organizationId, STAFF_FUND_ACCOUNT[kind], session));
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    // Created concurrently by another request.
    return runTransaction((session) => ensureTemplateAccount(organizationId, STAFF_FUND_ACCOUNT[kind], session));
  }
}

const issueSchema = z.object({
  kind: z.enum(STAFF_FUND_KINDS),
  membershipId: objectIdSchema,
  cashAccountId: objectIdSchema,
  amount,
  purpose: z.string().trim().min(3).max(200),
  dueDate: dateSchema.nullable().default(null),
});
const returnSchema = z.object({ cashAccountId: objectIdSchema, amount, version: z.number().int().min(0) });
const expenseSchema = z.object({
  lines: z
    .array(z.object({ accountId: objectIdSchema, amount, memo: z.string().trim().max(200).default('') }))
    .min(1)
    .max(30),
  memo: z.string().trim().max(300).default(''),
  version: z.number().int().min(0),
});
const writeOffSchema = z.object({ reason: z.string().trim().min(3).max(300), version: z.number().int().min(0) });

export function createStaffFundsRouter() {
  const router = Router({ mergeParams: true });

  router.get('/accounting/staff-funds', requirePermission('accounting.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const settings = await requireSettings(tenant);
    const input = parseInput(
      z.object({
        status: z.enum(['open', 'settled']).optional(),
        kind: z.enum(STAFF_FUND_KINDS).optional(),
        membershipId: objectIdSchema.optional(),
      }),
      req.query,
    );
    const rows = await StaffFundModel.find({
      organizationId: tenant.organizationId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.membershipId ? { membershipId: new Types.ObjectId(input.membershipId) } : {}),
    })
      .sort({ status: 1, createdAt: -1 })
      .limit(300)
      .lean<Lean<StaffFund>[]>();
    const today = await ledgerToday(tenant.organizationId);
    const names = await memberNames(
      tenant.organizationId,
      [...new Set(rows.map((r) => String(r.membershipId)))].map((v) => new Types.ObjectId(v)),
    );
    const open = rows.filter((r) => r.status === 'open');
    res.json({
      today,
      currency: settings.currency,
      funds: rows.map((r) => fundDto(r, today, names)),
      totals: Object.fromEntries(STAFF_FUND_KINDS.map((k) => [k, open.filter((r) => r.kind === k).reduce((s, r) => s + outstandingOf(r), 0)])),
    });
  });

  // Active members an amount can be handed to (names only; no member.read needed).
  router.get('/accounting/staff-funds/members', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const members = await MembershipModel.find({ organizationId: tenant.organizationId, status: 'active' }).select('_id role').lean();
    const names = await memberNames(
      tenant.organizationId,
      members.map((m) => m._id),
    );
    res.json({
      members: members
        .map((m) => ({ id: String(m._id), name: names.get(String(m._id)) ?? '', role: m.role }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  });

  router.get('/accounting/staff-funds/:fundId', requirePermission('accounting.read'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const f = await fundOr404(tenant, req.params.fundId);
    const names = await memberNames(tenant.organizationId, [f.membershipId]);
    res.json({ fund: fundDto(f, await ledgerToday(tenant.organizationId), names) });
  });

  router.post('/accounting/staff-funds', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const key = requireKey(req);
    const input = parseInput(issueSchema, req.body);
    const settings = await requireSettings(tenant);
    const requestHash = hash(input);
    const replay = async () => {
      const previous = await StaffFundModel.findOne({ organizationId: tenant.organizationId, createdBy: tenant.userId, idempotencyKey: key }).lean<
        Lean<StaffFund>
      >();
      if (!previous) return null;
      if (previous.requestHash !== requestHash) throw conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different request');
      return previous;
    };
    const today = await ledgerToday(tenant.organizationId);
    const previous = await replay();
    if (previous) {
      res.json({ fund: fundDto(previous, today), replayed: true });
      return;
    }
    const membershipId = new Types.ObjectId(input.membershipId);
    if (!(await MembershipModel.exists({ organizationId: tenant.organizationId, _id: membershipId, status: 'active' })))
      throw validationError({ membershipId: 'not_found' });
    if (input.dueDate && input.dueDate < today) throw validationError({ dueDate: 'in_past' });
    const box = await cashAccount(tenant, input.cashAccountId);
    const account = await fundAccount(tenant.organizationId, input.kind);
    const prefix = input.kind === 'advance' ? 'ADV' : 'CUS';
    await ensureCounter(tenant.organizationId, `${prefix}:${year(today)}`);
    await prepareLedger(tenant.organizationId);
    try {
      const fund = await runTransaction(async (session) => {
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
        const seq = await nextNumber(tenant.organizationId, `${prefix}:${year(today)}`, session);
        const number = `${prefix}-${year(today)}-${String(seq).padStart(6, '0')}`;
        const fundId = new Types.ObjectId();
        const entry = await postEntry(
          {
            organizationId: tenant.organizationId,
            userId: tenant.userId,
            date: today,
            journal: box.kind === 'bank' ? 'bank' : 'cash',
            memo: `${number} ${input.purpose}`.slice(0, 200),
            lines: [
              { accountId: account._id, debit: input.amount, branchId: box.branchId, partner: { type: 'member', id: membershipId } },
              { accountId: box.accountId, credit: input.amount, branchId: box.branchId },
            ],
            source: { type: 'staff_fund', id: fundId, event: 'issue' },
            cashSessionId: open?._id ?? null,
          },
          session,
          settings,
        );
        const [created] = await StaffFundModel.create(
          [
            {
              _id: fundId,
              organizationId: tenant.organizationId,
              number,
              kind: input.kind,
              membershipId,
              branchId: box.branchId,
              purpose: input.purpose,
              amount: input.amount,
              dueDate: input.dueDate,
              movements: [
                {
                  type: 'issue',
                  date: today,
                  amount: input.amount,
                  cashAccountId: box._id,
                  memo: input.purpose,
                  entryId: entry._id,
                  by: tenant.userId,
                  at: new Date(),
                },
              ],
              idempotencyKey: key,
              requestHash,
              createdBy: tenant.userId,
            },
          ],
          { session },
        );
        await auditLedger(
          tenant,
          'staff_fund.issued',
          { type: 'staff_fund', id: fundId },
          { number, kind: input.kind, amount: input.amount },
          session,
        );
        return created!.toObject() as Lean<StaffFund>;
      });
      res.status(201).json({ fund: fundDto(fund, today), replayed: false });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const again = await replay();
      if (!again) throw err;
      res.json({ fund: fundDto(again, today), replayed: true });
    }
  });

  /** One movement that reduces the outstanding amount, posted and recorded together. */
  async function settle(
    tenant: TenantContext,
    f: Lean<StaffFund>,
    version: number,
    movement: Omit<StaffFundMovement, 'entryId' | 'by' | 'at' | 'date'>,
    lines: LineInput[],
    journal: 'cash' | 'bank' | 'general',
    field: 'returned' | 'expensed' | 'writtenOff',
    cashSessionOf: Types.ObjectId | null,
  ) {
    if (f.status !== 'open') throw conflict('STAFF_FUND_SETTLED', 'This amount is already settled');
    if (movement.amount > outstandingOf(f)) throw validationError({ amount: 'more_than_outstanding' });
    if (f.version !== version) throw conflict('VERSION_CONFLICT', 'This record was changed meanwhile');
    const settings = await requireSettings(tenant);
    const today = await ledgerToday(tenant.organizationId);
    await prepareLedger(tenant.organizationId);
    const updated = await runTransaction(async (session) => {
      const open = cashSessionOf
        ? await CashSessionModel.findOne({
            organizationId: tenant.organizationId,
            status: 'open',
            openedBy: tenant.userId,
            cashAccountId: cashSessionOf,
          })
            .session(session)
            .lean()
        : null;
      const entry = await postEntry(
        {
          organizationId: tenant.organizationId,
          userId: tenant.userId,
          date: today,
          journal,
          memo: `${f.number} ${movement.memo}`.slice(0, 200),
          lines,
          // The movement's position makes the key: a retried request with the same version posts nothing twice.
          source: { type: 'staff_fund', id: f._id, event: `${movement.type}-${f.movements.length}` },
          cashSessionId: open?._id ?? null,
        },
        session,
        settings,
      );
      const remaining = outstandingOf(f) - movement.amount;
      const doc = await StaffFundModel.findOneAndUpdate(
        { organizationId: tenant.organizationId, _id: f._id, version, status: 'open' },
        {
          $push: { movements: { ...movement, date: today, entryId: entry._id, by: tenant.userId, at: new Date() } },
          $inc: { [field]: movement.amount, version: 1 },
          $set: { status: remaining === 0 ? 'settled' : 'open' },
        },
        { session, returnDocument: 'after' },
      ).lean<Lean<StaffFund>>();
      if (!doc) throw conflict('VERSION_CONFLICT', 'This record was changed meanwhile');
      await auditLedger(
        tenant,
        movement.type === 'write_off' ? 'staff_fund.written_off' : 'staff_fund.settled',
        { type: 'staff_fund', id: f._id },
        { number: f.number, movement: movement.type, amount: movement.amount },
        session,
      );
      return doc;
    });
    const names = await memberNames(tenant.organizationId, [f.membershipId]);
    return fundDto(updated, today, names);
  }

  router.post('/accounting/staff-funds/:fundId/return', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const f = await fundOr404(tenant, req.params.fundId);
    const input = parseInput(returnSchema, req.body);
    const box = await cashAccount(tenant, input.cashAccountId);
    const account = await fundAccount(tenant.organizationId, f.kind);
    const fund = await settle(
      tenant,
      f,
      input.version,
      { type: 'return', amount: input.amount, cashAccountId: box._id, lines: [], memo: 'returned' },
      [
        { accountId: box.accountId, debit: input.amount, branchId: box.branchId },
        { accountId: account._id, credit: input.amount, branchId: f.branchId, partner: { type: 'member', id: f.membershipId } },
      ],
      box.kind === 'bank' ? 'bank' : 'cash',
      'returned',
      box._id,
    );
    res.json({ fund });
  });

  // Custody receipts: what the member spent, on expense accounts.
  router.post('/accounting/staff-funds/:fundId/expenses', requirePermission('accounting.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const f = await fundOr404(tenant, req.params.fundId);
    if (f.kind !== 'custody') throw conflict('NOT_CUSTODY', 'Only petty-cash custody is settled with receipts');
    const input = parseInput(expenseSchema, req.body);
    const ids = [...new Set(input.lines.map((l) => l.accountId))].map((v) => new Types.ObjectId(v));
    const valid = await LedgerAccountModel.countDocuments({
      organizationId: tenant.organizationId,
      _id: { $in: ids },
      type: 'expense',
      isGroup: false,
      status: 'active',
    });
    if (valid !== ids.length) throw validationError({ lines: 'not_expense_account' });
    const total = input.lines.reduce((s, l) => s + l.amount, 0);
    const account = await fundAccount(tenant.organizationId, 'custody');
    const fund = await settle(
      tenant,
      f,
      input.version,
      {
        type: 'expense',
        amount: total,
        cashAccountId: null,
        lines: input.lines.map((l) => ({ accountId: new Types.ObjectId(l.accountId), amount: l.amount, memo: l.memo })),
        memo: input.memo || 'receipts',
      },
      [
        ...input.lines.map((l) => ({ accountId: new Types.ObjectId(l.accountId), debit: l.amount, branchId: f.branchId, memo: l.memo })),
        { accountId: account._id, credit: total, branchId: f.branchId, partner: { type: 'member' as const, id: f.membershipId } },
      ],
      'general',
      'expensed',
      null,
    );
    res.json({ fund });
  });

  // The owner writes off what is left (never recovered); it becomes an expense, once.
  router.post('/accounting/staff-funds/:fundId/write-off', requirePermission('accounting.settings.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    requireOrgWide(tenant);
    const f = await fundOr404(tenant, req.params.fundId);
    const input = parseInput(writeOffSchema, req.body);
    const left = outstandingOf(f);
    if (left <= 0) throw conflict('STAFF_FUND_SETTLED', 'This amount is already settled');
    const [account, expense] = await Promise.all([
      fundAccount(tenant.organizationId, f.kind),
      LedgerAccountModel.findOne({ organizationId: tenant.organizationId, templateKey: 'otherExpenses', status: 'active' }).lean(),
    ]);
    if (!expense) throw conflict('CHART_INCOMPLETE', 'The other expenses account is missing');
    const fund = await settle(
      tenant,
      f,
      input.version,
      { type: 'write_off', amount: left, cashAccountId: null, lines: [], memo: input.reason },
      [
        { accountId: expense._id, debit: left, branchId: f.branchId },
        { accountId: account._id, credit: left, branchId: f.branchId, partner: { type: 'member', id: f.membershipId } },
      ],
      'general',
      'writtenOff',
      null,
    );
    res.json({ fund });
  });

  return router;
}

/** Open amounts past their due date (for "Today's focus"). */
export async function overdueStaffFunds(organizationId: Types.ObjectId, today: string) {
  return StaffFundModel.countDocuments({ organizationId, status: 'open', dueDate: { $lt: today } });
}
