import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LedgerAccountModel } from '../src/modules/accounting/accounting.model.js';
import { addMember, register, send, testApp, type Client } from './helpers/api.js';
import { buildClinic, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// Employee cash advances and petty-cash custody (docs/architecture/STAFF_FUNDS.md).
// Clock: 2026-11-10 (Cairo).
const app = testApp();
let c: Clinic;
let accountant: Client;
let bank: string;
let accounts: { id: string; code: string; templateKey: string | null; balance: number }[];
let receptionistMember: string;
const url = (path: string) => `/api/v1/orgs/${c.orgId}${path}`;
const withKey = (who: Client, path: string, body: object, key: string = randomUUID()) =>
  who.agent.post(url(path)).set('X-CSRF-Token', who.csrf).set('Idempotency-Key', key).send(body);
const refresh = async () => (accounts = (await accountant.agent.get(url('/accounting/accounts'))).body.accounts);
const balance = (key: string) => accounts.find((a) => a.templateKey === key)?.balance ?? 0;
const acct = (code: string) => accounts.find((a) => a.code === code)!.id;

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('staff-funds');
  c = await buildClinic(app, 'staff-funds');
  accountant = await register(app, 'staff-funds-accountant');
  await addMember(c.owner, c.orgId, accountant, 'accountant');
  await send(c.owner, 'put', url('/finance/settings'), { currency: 'EGP' });
  await send(c.owner, 'post', url('/accounting/setup'), { cutoverDate: '2026-10-01' });
  await refresh();
  bank = (await accountant.agent.get(url('/cash/accounts'))).body.accounts.find((a: { kind: string }) => a.kind === 'bank').id;
  await withKey(accountant, '/cash/vouchers', {
    type: 'in',
    cashAccountId: bank,
    counterAccountId: acct('3100'),
    amount: 1_000_000,
    memo: 'Owner capital',
  });
  const members = await accountant.agent.get(url('/accounting/staff-funds/members'));
  expect(members.status, JSON.stringify(members.body)).toBe(200);
  receptionistMember = members.body.members.find((m: { role: string }) => m.role === 'receptionist').id;
});
afterAll(() => dropTestDatabase());

describe('employee advances', () => {
  let advance: { id: string; version: number; outstanding: number };
  it('issues an advance from the bank, once per request key', async () => {
    const key = randomUUID();
    const body = {
      kind: 'advance',
      membershipId: receptionistMember,
      cashAccountId: bank,
      amount: 300_000,
      purpose: 'Salary advance',
      dueDate: '2026-12-31',
    };
    const issued = await withKey(accountant, '/accounting/staff-funds', body, key);
    expect(issued.status, JSON.stringify(issued.body)).toBe(201);
    expect(issued.body.fund).toMatchObject({ number: 'ADV-2026-000001', outstanding: 300_000, status: 'open', overdue: false });
    advance = issued.body.fund;
    const again = await withKey(accountant, '/accounting/staff-funds', body, key);
    expect(again.body.replayed).toBe(true);
    expect((await withKey(accountant, '/accounting/staff-funds', { ...body, amount: 1 }, key)).body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    await refresh();
    expect(balance('staffAdvances')).toBe(300_000);
    expect(balance('mainBank')).toBe(700_000);
    expect((await withKey(c.receptionist, '/accounting/staff-funds', body)).status).toBe(403);
    // The sub-ledger accounts take no voucher or manual entry.
    const advancesId = accounts.find((a) => a.templateKey === 'staffAdvances')!.id;
    expect(
      (await withKey(accountant, '/cash/vouchers', { type: 'out', cashAccountId: bank, counterAccountId: advancesId, amount: 100, memo: 'Bypass' }))
        .body.error.fields,
    ).toEqual({ counterAccountId: 'account_not_allowed' });
    expect(
      (
        await withKey(accountant, '/accounting/entries', {
          date: '2026-11-10',
          journal: 'general',
          memo: 'Bypass',
          lines: [
            { accountId: advancesId, debit: 100 },
            { accountId: acct('3100'), credit: 100 },
          ],
        })
      ).body.error.code,
    ).toBe('CONTROL_ACCOUNT');
  });

  it('takes partial repayments, never more than is outstanding, and settles at zero', async () => {
    expect(
      (
        await send(accountant, 'post', url(`/accounting/staff-funds/${advance.id}/return`), {
          cashAccountId: bank,
          amount: 300_001,
          version: advance.version,
        })
      ).status,
    ).toBe(400);
    const part = await send(accountant, 'post', url(`/accounting/staff-funds/${advance.id}/return`), {
      cashAccountId: bank,
      amount: 100_000,
      version: advance.version,
    });
    expect(part.status, JSON.stringify(part.body)).toBe(200);
    expect(part.body.fund).toMatchObject({ returned: 100_000, outstanding: 200_000, status: 'open' });
    // A retried request with the old version posts nothing twice.
    expect(
      (
        await send(accountant, 'post', url(`/accounting/staff-funds/${advance.id}/return`), {
          cashAccountId: bank,
          amount: 100_000,
          version: advance.version,
        })
      ).body.error.code,
    ).toBe('VERSION_CONFLICT');
    expect(
      (
        await send(accountant, 'post', url(`/accounting/staff-funds/${advance.id}/expenses`), {
          lines: [{ accountId: acct('6500'), amount: 1 }],
          version: part.body.fund.version,
        })
      ).body.error.code,
    ).toBe('NOT_CUSTODY');
    const rest = await send(accountant, 'post', url(`/accounting/staff-funds/${advance.id}/return`), {
      cashAccountId: bank,
      amount: 200_000,
      version: part.body.fund.version,
    });
    expect(rest.body.fund).toMatchObject({ outstanding: 0, status: 'settled' });
    await refresh();
    expect(balance('staffAdvances')).toBe(0);
    expect(balance('mainBank')).toBe(1_000_000);
  });
});

describe('petty-cash custody', () => {
  let custody: { id: string; version: number };
  it('settles with receipts and returned cash; the owner writes off the rest', async () => {
    const issued = await withKey(accountant, '/accounting/staff-funds', {
      kind: 'custody',
      membershipId: receptionistMember,
      cashAccountId: bank,
      amount: 50_000,
      purpose: 'Front desk petty cash',
    });
    expect(issued.status).toBe(201);
    custody = issued.body.fund;
    expect(issued.body.fund.number).toBe('CUS-2026-000001');
    const receipts = await send(accountant, 'post', url(`/accounting/staff-funds/${custody.id}/expenses`), {
      lines: [
        { accountId: acct('6500'), amount: 12_000, memo: 'Printer paper' },
        { accountId: acct('6300'), amount: 8_000, memo: 'Water' },
      ],
      version: custody.version,
    });
    expect(receipts.status, JSON.stringify(receipts.body)).toBe(200);
    expect(receipts.body.fund).toMatchObject({ expensed: 20_000, outstanding: 30_000 });
    expect(
      (
        await send(accountant, 'post', url(`/accounting/staff-funds/${custody.id}/expenses`), {
          lines: [{ accountId: acct('1110'), amount: 1 }],
          version: receipts.body.fund.version,
        })
      ).body.error.fields,
    ).toEqual({ lines: 'not_expense_account' });
    const back = await send(accountant, 'post', url(`/accounting/staff-funds/${custody.id}/return`), {
      cashAccountId: bank,
      amount: 25_000,
      version: receipts.body.fund.version,
    });
    expect(back.body.fund.outstanding).toBe(5_000);
    expect(
      (
        await send(accountant, 'post', url(`/accounting/staff-funds/${custody.id}/write-off`), {
          reason: 'Lost receipt',
          version: back.body.fund.version,
        })
      ).status,
    ).toBe(403);
    const off = await send(c.owner, 'post', url(`/accounting/staff-funds/${custody.id}/write-off`), {
      reason: 'Lost receipt',
      version: back.body.fund.version,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.fund).toMatchObject({ writtenOff: 5_000, outstanding: 0, status: 'settled' });
    expect(off.body.fund.movements.map((m: { type: string }) => m.type)).toEqual(['issue', 'expense', 'return', 'write_off']);
    await refresh();
    expect(balance('staffCustody')).toBe(0);
    expect(balance('officeSupplies')).toBe(12_000);
    expect(balance('otherExpenses')).toBe(5_000);
  });

  it('lists open amounts with totals, and flags overdue ones in focus', async () => {
    await withKey(accountant, '/accounting/staff-funds', {
      kind: 'advance',
      membershipId: receptionistMember,
      cashAccountId: bank,
      amount: 10_000,
      purpose: 'Transport advance',
    });
    const list = await accountant.agent.get(url('/accounting/staff-funds?status=open'));
    expect(list.body.funds).toHaveLength(1);
    expect(list.body.funds[0].memberName).toBeTruthy();
    expect(list.body.totals).toEqual({ advance: 10_000, custody: 0 });
    expect((await c.owner.agent.get(url('/workspace/focus'))).body.finance.staffFundsOverdue).toBe(0);
  });

  it('creates the accounts in a chart made before they existed', async () => {
    await LedgerAccountModel.updateOne({ organizationId: c.orgId, templateKey: 'staffCustody' }, { $set: { templateKey: 'legacyCustody' } });
    const issued = await withKey(accountant, '/accounting/staff-funds', {
      kind: 'custody',
      membershipId: receptionistMember,
      cashAccountId: bank,
      amount: 1_000,
      purpose: 'New custody',
    });
    expect(issued.status, JSON.stringify(issued.body)).toBe(201);
    const created = await LedgerAccountModel.findOne({ organizationId: c.orgId, templateKey: 'staffCustody' }).lean();
    expect(created?.code).toBe('1261'); // 1260 was taken
  });
});
