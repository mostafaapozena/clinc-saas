import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMonths } from '../src/modules/planning/planning.routes.js';
import { addMember, register, send, testApp, type Client } from './helpers/api.js';
import { buildClinic, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// Budgets, budget against actual, cash flow and recurring commitments
// (docs/architecture/PLANNING.md). Clock: 2026-11-10 (Cairo).
const app = testApp();
let c: Clinic;
let accountant: Client;
let bank: string;
let accounts: { id: string; code: string }[];
const url = (path: string) => `/api/v1/orgs/${c.orgId}${path}`;
const acct = (code: string) => accounts.find((a) => a.code === code)!.id;
const voucher = (body: object) =>
  accountant.agent.post(url('/cash/vouchers')).set('X-CSRF-Token', accountant.csrf).set('Idempotency-Key', randomUUID()).send(body);
const months = (from: number, amount: number) => Array.from({ length: 12 }, (_, i) => (i >= from ? amount : 0));

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('planning');
  c = await buildClinic(app, 'planning');
  accountant = await register(app, 'planning-accountant');
  await addMember(c.owner, c.orgId, accountant, 'accountant');
  await send(c.owner, 'put', url('/finance/settings'), { currency: 'EGP' });
  await send(c.owner, 'post', url('/accounting/setup'), { cutoverDate: '2026-10-01' });
  accounts = (await accountant.agent.get(url('/accounting/accounts'))).body.accounts;
  bank = (await accountant.agent.get(url('/cash/accounts'))).body.accounts.find((a: { kind: string }) => a.kind === 'bank').id;
});
afterAll(() => dropTestDatabase());

describe('date helper', () => {
  it('keeps the payment day across short months', () => {
    expect(addMonths('2026-01-31', 1, 31)).toBe('2026-02-28');
    expect(addMonths('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addMonths('2026-11-15', 3, 15)).toBe('2027-02-15');
    expect(addMonths('2026-12-01', 12, 1)).toBe('2027-12-01');
  });
});

describe('budgets', () => {
  let version: number;
  it('saves a draft budget of income and expense accounts only', async () => {
    expect((await c.doctor.agent.get(url('/accounting/budgets?year=2026'))).status).toBe(403);
    const empty = await accountant.agent.get(url('/accounting/budgets?year=2026'));
    expect(empty.body.budget).toBeNull();
    expect(empty.body.accounts.every((a: { type: string }) => a.type === 'income' || a.type === 'expense')).toBe(true);
    expect(
      (
        await send(accountant, 'put', url('/accounting/budgets'), {
          year: 2026,
          lines: [{ accountId: acct('1110'), months: months(9, 1) }],
          version: null,
        })
      ).status,
    ).toBe(400);
    const saved = await send(accountant, 'put', url('/accounting/budgets'), {
      year: 2026,
      lines: [
        { accountId: acct('6100'), months: months(9, 1_000_000) },
        { accountId: acct('4100'), months: months(9, 3_000_000) },
        { accountId: acct('6500'), months: months(0, 0) },
      ],
      version: null,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.budget.lines).toHaveLength(2); // all-zero lines are dropped
    expect(saved.body.budget.lines[0].total).toBe(3_000_000);
    version = saved.body.budget.version;
    expect((await send(accountant, 'put', url('/accounting/budgets'), { year: 2026, lines: [], version: null })).body.error.code).toBe(
      'VERSION_CONFLICT',
    );
  });

  it('is approved by the owner, then frozen until reopened', async () => {
    expect((await send(accountant, 'post', url('/accounting/budgets/approve'), { year: 2026, version })).status).toBe(403);
    const approved = await send(c.owner, 'post', url('/accounting/budgets/approve'), { year: 2026, version });
    expect(approved.status).toBe(200);
    expect(approved.body.budget.status).toBe('approved');
    expect(
      (await send(accountant, 'put', url('/accounting/budgets'), { year: 2026, lines: [], version: approved.body.budget.version })).body.error.code,
    ).toBe('BUDGET_APPROVED');
    const reopened = await send(c.owner, 'post', url('/accounting/budgets/reopen'), { year: 2026, version: approved.body.budget.version });
    expect(reopened.body.budget.status).toBe('draft');
    const again = await send(c.owner, 'post', url('/accounting/budgets/approve'), { year: 2026, version: reopened.body.budget.version });
    expect(again.body.budget.status).toBe('approved');
  });

  it('compares the budget with posted actuals through a month', async () => {
    expect(
      (await voucher({ type: 'in', cashAccountId: bank, counterAccountId: acct('3100'), amount: 5_000_000, memo: 'Owner capital' })).status,
    ).toBe(201);
    expect(
      (await voucher({ type: 'out', cashAccountId: bank, counterAccountId: acct('6100'), amount: 1_200_000, memo: 'November rent' })).status,
    ).toBe(201);
    expect((await voucher({ type: 'out', cashAccountId: bank, counterAccountId: acct('6500'), amount: 40_000, memo: 'Paper' })).status).toBe(201);
    const report = await accountant.agent.get(url('/accounting/reports/budget-vs-actual?year=2026'));
    expect(report.status, JSON.stringify(report.body)).toBe(200);
    expect(report.body.through).toBe(11);
    const row = (code: string) => report.body.rows.find((r: { account: { code: string } }) => r.account.code === code);
    expect(row('6100')).toMatchObject({
      annualBudget: 3_000_000,
      budget: 2_000_000,
      actual: 1_200_000,
      variance: -800_000,
      usedPercent: 60,
      favourable: true,
    });
    expect(row('6500')).toMatchObject({ budget: 0, actual: 40_000, unbudgeted: true, favourable: false });
    expect(row('4100')).toMatchObject({ budget: 6_000_000, actual: 0, favourable: false });
    expect(report.body.totals.result).toEqual({ budget: 6_000_000 - 2_000_000, actual: -1_240_000 });
    // A branch budget is separate from the organization-wide one.
    expect((await accountant.agent.get(url(`/accounting/budgets?year=2026&branchId=${c.branchA}`))).body.budget).toBeNull();
  });
});

describe('cash flow', () => {
  it('classifies cash movements by the other side and reconciles with the cash balances', async () => {
    expect((await voucher({ type: 'out', cashAccountId: bank, counterAccountId: acct('1510'), amount: 800_000, memo: 'Autoclave' })).status).toBe(
      201,
    );
    const cashbox = (await accountant.agent.get(url('/cash/accounts'))).body.accounts.find((a: { kind: string }) => a.kind === 'cash').id;
    expect((await voucher({ type: 'transfer', cashAccountId: bank, toCashAccountId: cashbox, amount: 100_000, memo: 'Float' })).status).toBe(201);
    const flow = await accountant.agent.get(url('/accounting/reports/cash-flow?from=2026-11-01&to=2026-11-30'));
    expect(flow.status, JSON.stringify(flow.body)).toBe(200);
    const section = (k: string) => flow.body.sections.find((s: { activity: string }) => s.activity === k);
    expect(section('financing').net).toBe(5_000_000);
    expect(section('investing').net).toBe(-800_000);
    expect(section('operating').net).toBe(-1_240_000);
    expect(flow.body).toMatchObject({ opening: 0, net: 2_960_000, closing: 2_960_000, reconciled: true });
    expect((await c.receptionist.agent.get(url('/accounting/reports/cash-flow?from=2026-11-01&to=2026-11-30'))).status).toBe(403);
  });
});

describe('recurring commitments', () => {
  let rent: { id: string; version: number };
  it('registers a commitment on an expense account', async () => {
    expect(
      (
        await send(accountant, 'post', url('/accounting/commitments'), {
          name: 'Bad',
          accountId: acct('1110'),
          amount: 100,
          frequency: 'monthly',
          firstDue: '2026-11-05',
        })
      ).body.error.fields,
    ).toEqual({ accountId: 'not_expense_account' });
    const created = await send(accountant, 'post', url('/accounting/commitments'), {
      name: 'Clinic rent',
      accountId: acct('6100'),
      amount: 1_200_000,
      frequency: 'monthly',
      firstDue: '2026-11-05',
      endDate: '2026-12-31',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.commitment).toMatchObject({ due: 'overdue', monthlyEquivalent: 1_200_000, dayOfMonth: 5 });
    rent = created.body.commitment;
    await send(accountant, 'post', url('/accounting/commitments'), {
      name: 'Software subscription',
      accountId: acct('6990'),
      amount: 1_200_000,
      frequency: 'yearly',
      firstDue: '2027-01-15',
    });
    const list = await accountant.agent.get(url('/accounting/commitments'));
    expect(list.body.monthlyTotal).toBe(1_300_000);
    expect((await c.owner.agent.get(url('/workspace/focus'))).body.finance.commitmentsDue).toBe(1);
  });

  it('links the voucher that paid an installment once, and moves to the next due date', async () => {
    const vouchers = (await accountant.agent.get(url('/cash/vouchers'))).body.vouchers as { id: string; memo: string }[];
    const rentVoucher = vouchers.find((v) => v.memo === 'November rent')!.id;
    const paper = vouchers.find((v) => v.memo === 'Paper')!.id;
    expect(
      (await send(accountant, 'post', url(`/accounting/commitments/${rent.id}/record`), { voucherId: paper, version: rent.version })).body.error
        .fields,
    ).toEqual({
      voucherId: 'other_account',
    });
    const recorded = await send(accountant, 'post', url(`/accounting/commitments/${rent.id}/record`), {
      voucherId: rentVoucher,
      version: rent.version,
    });
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(200);
    expect(recorded.body.commitment).toMatchObject({ nextDue: '2026-12-05', due: null, status: 'active' });
    expect(
      (
        await send(accountant, 'post', url(`/accounting/commitments/${rent.id}/record`), {
          voucherId: rentVoucher,
          version: recorded.body.commitment.version,
        })
      ).body.error.code,
    ).toBe('ALREADY_LINKED');
    // Recording links only: the ledger still holds the voucher's rent once.
    const ledger = (await accountant.agent.get(url('/accounting/accounts'))).body.accounts.find((a: { code: string }) => a.code === '6100');
    expect(ledger.balance).toBe(1_200_000);
    const detail = await accountant.agent.get(url(`/accounting/commitments/${rent.id}`));
    expect(detail.body.commitment.payments).toEqual([expect.objectContaining({ dueDate: '2026-11-05', amount: 1_200_000, voucherId: rentVoucher })]);
    expect((await c.owner.agent.get(url('/workspace/focus'))).body.finance.commitmentsDue).toBe(0);
  });

  it('ends after its last installment', async () => {
    const december = await voucher({ type: 'out', cashAccountId: bank, counterAccountId: acct('6100'), amount: 1_200_000, memo: 'December rent' });
    const current = (await accountant.agent.get(url(`/accounting/commitments/${rent.id}`))).body.commitment;
    const done = await send(accountant, 'post', url(`/accounting/commitments/${rent.id}/record`), {
      voucherId: december.body.voucher.id,
      version: current.version,
    });
    expect(done.body.commitment).toMatchObject({ status: 'ended', nextDue: null });
    expect(
      (
        await send(accountant, 'post', url(`/accounting/commitments/${rent.id}/record`), {
          voucherId: december.body.voucher.id,
          version: done.body.commitment.version,
        })
      ).body.error.code,
    ).toBe('COMMITMENT_ENDED');
  });
});
