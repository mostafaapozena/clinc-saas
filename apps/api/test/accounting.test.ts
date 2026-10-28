import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JournalEntryModel } from '../src/modules/accounting/accounting.model.js';
import { parseStatementCsv } from '../src/modules/accounting/cash.routes.js';
import { addMember, register, send, testApp, type Client } from './helpers/api.js';
import { buildClinic, createPatient, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// General ledger, periods, cash and banks (docs/architecture/ACCOUNTING.md). The clock is pinned
// to 2026-11-10 (Cairo); the ledger starts on 2026-10-01 so October can be closed.
const app = testApp();
let c: Clinic;
let accountant: Client;
let accountantA: Client; // branch A only
let patient: string;
let service: string;
const url = (path: string, org = c.orgId) => `/api/v1/orgs/${org}${path}`;
const withKey = (who: Client, path: string, body: object, key: string = randomUUID(), org = c.orgId) =>
  who.agent.post(url(path, org)).set('X-CSRF-Token', who.csrf).set('Idempotency-Key', key).send(body);
type Account = {
  id: string;
  code: string;
  templateKey: string | null;
  balance: number;
};
let accounts: Account[];
const acct = (code: string) => accounts.find((a) => a.code === code)!.id;
const balances = async () => {
  const res = await accountant.agent.get(url('/accounting/accounts'));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return new Map((res.body.accounts as Account[]).map((a) => [a.code, a.balance]));
};
const trialBalance = async (from = '2026-10-01', to = '2026-11-30') =>
  (await accountant.agent.get(url('/accounting/reports/trial-balance')).query({ from, to })).body;

async function issuedInvoice(quantity = 1, discount = 0) {
  const ch = await withKey(c.receptionist, '/finance/charges', {
    patientId: patient,
    branchId: c.branchA,
    serviceId: service,
    quantity,
  });
  expect(ch.status, JSON.stringify(ch.body)).toBe(201);
  const draft = await send(c.receptionist, 'post', url('/finance/invoices'), {
    patientId: patient,
    branchId: c.branchA,
    chargeIds: [ch.body.charge.id],
  });
  let version = draft.body.invoice.version;
  if (discount)
    version = (
      await send(c.owner, 'put', url(`/finance/invoices/${draft.body.invoice.id}/discount`), { amount: discount, reason: 'Loyalty', version })
    ).body.invoice.version;
  const key = randomUUID();
  const issued = await withKey(c.receptionist, `/finance/invoices/${draft.body.invoice.id}/issue`, { version }, key);
  expect(issued.status, JSON.stringify(issued.body)).toBe(200);
  return {
    invoice: issued.body.invoice as {
      id: string;
      total: number;
      number: string;
    },
    key,
    version,
  };
}
const pay = (who: Client, amount: number, allocations: { invoiceId: string; amount: number }[] = [], method = 'cash', key?: string) =>
  withKey(who, '/finance/payments', { patientId: patient, branchId: c.branchA, amount, method, allocations }, key);

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('accounting');
  c = await buildClinic(app, 'acct');
  accountant = await register(app, 'acct-accountant');
  accountantA = await register(app, 'acct-accountantA');
  await addMember(c.owner, c.orgId, accountant, 'accountant');
  await addMember(c.owner, c.orgId, accountantA, 'accountant', [c.branchA]);
  expect((await send(c.owner, 'put', url('/finance/settings'), { currency: 'EGP' })).status).toBe(200);
  service = (
    await send(c.owner, 'post', url('/finance/services'), {
      code: 'EXAM',
      name: 'Consultation',
      price: 30000,
    })
  ).body.service.id;
  patient = await createPatient(c.receptionist, c.orgId, c.branchA);
});
afterAll(() => dropTestDatabase());

describe('setup', () => {
  it('lets only the owner set up the template chart once, after the currency and time zone', async () => {
    expect(
      (
        await send(accountant, 'post', url('/accounting/setup'), {
          cutoverDate: '2026-10-01',
        })
      ).status,
    ).toBe(403);
    expect((await c.receptionist.agent.get(url('/accounting/accounts'))).status).toBe(403);
    // Before setup: nothing is posted and the ledger says so.
    expect((await accountant.agent.get(url('/accounting/accounts'))).body.error.code).toBe('ACCOUNTING_NOT_SET_UP');
    const created = await send(c.owner, 'post', url('/accounting/setup'), {
      cutoverDate: '2026-10-01',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.settings).toMatchObject({
      currency: 'EGP',
      cutoverDate: '2026-10-01',
      lockedThrough: null,
      template: 'raclinic.clinic@1',
    });
    expect(
      (
        await send(c.owner, 'post', url('/accounting/setup'), {
          cutoverDate: '2026-10-01',
        })
      ).body.error.code,
    ).toBe('ACCOUNTING_ALREADY_SET_UP');
    accounts = (await accountant.agent.get(url('/accounting/accounts'))).body.accounts;
    expect(accounts.find((a) => a.code === '1200')?.templateKey).toBe('patientReceivables');
  });

  it('needs organization-wide scope for the ledger', async () => {
    const res = await accountantA.agent.get(url('/accounting/accounts'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORG_WIDE_SCOPE_REQUIRED');
    // Branch-level views stay available to them.
    expect((await accountantA.agent.get(url('/accounting/reports/receivables-aging'))).status).toBe(200);
  });
});

describe('patient finance postings', () => {
  it('posts invoices, receipts, allocations, credit notes, refunds and reversals as balanced accrual entries', async () => {
    const { invoice, key, version } = await issuedInvoice(2, 5000); // 600.00 − 50.00
    expect(invoice.total).toBe(55000);
    let b = await balances();
    expect(b.get('1200')).toBe(55000); // receivable
    expect(b.get('4100')).toBe(60000); // revenue (credit-normal, shown positive)
    expect(b.get('4900')).toBe(-5000); // discount reduces income
    // Replaying the issue posts nothing new.
    await withKey(c.receptionist, `/finance/invoices/${invoice.id}/issue`, { version }, key);
    expect(
      await JournalEntryModel.countDocuments({
        organizationId: c.orgId,
        sourceKey: `invoice:${invoice.id}:issued`,
      }),
    ).toBe(1);

    // A receipt is a patient advance until allocated: no revenue from money received.
    const receipt = await pay(c.receptionist, 40000, [{ invoiceId: invoice.id, amount: 30000 }]);
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
    b = await balances();
    expect(b.get('1110')).toBe(40000); // cash
    expect(b.get('1200')).toBe(25000);
    expect(b.get('2200')).toBe(10000); // unallocated advance
    expect(b.get('4100')).toBe(60000);

    const paymentId = receipt.body.payment.id;
    expect(
      (await send(c.receptionist, 'post', url(`/finance/payments/${paymentId}/allocations`), { invoiceId: invoice.id, amount: 5000 })).status,
    ).toBe(200);
    expect((await withKey(accountant, `/finance/invoices/${invoice.id}/credit-notes`, { amount: 2000, reason: 'Goodwill' })).status).toBe(201);
    expect(
      (
        await withKey(accountant, `/finance/payments/${paymentId}/refunds`, {
          amount: 3000,
          reason: 'Returned change',
        })
      ).status,
    ).toBe(201);
    b = await balances();
    expect(b.get('1200')).toBe(55000 - 35000 - 2000);
    expect(b.get('2200')).toBe(40000 - 35000 - 3000);
    expect(b.get('1110')).toBe(37000);
    expect(b.get('4910')).toBe(-2000);

    // Reversal of a bounced transfer gives back the receivable and removes the money.
    const transfer = await pay(c.receptionist, 10000, [{ invoiceId: invoice.id, amount: 10000 }], 'bank_transfer');
    expect((await send(accountant, 'post', url(`/finance/payments/${transfer.body.payment.id}/reverse`), { reason: 'Bounced' })).status).toBe(200);
    b = await balances();
    expect(b.get('1120')).toBe(0);
    expect(b.get('1200')).toBe(18000);

    const tb = await trialBalance();
    expect(tb.balanced).toBe(true);
    expect(tb.totals.debit).toBe(tb.totals.credit);
    // Sub-ledgers agree with the ledger (everything happened after the cutover).
    const rec = await accountant.agent.get(url('/accounting/reports/reconciliation'));
    for (const row of rec.body.rows) expect(row.difference, row.key).toBe(0);
    // No clinical or patient text in entries: memos carry document numbers only.
    const entries = await JournalEntryModel.find({
      organizationId: c.orgId,
    }).lean();
    expect(entries.every((e) => /^(INV|RCPT|CN|REF)-/.test(e.memo))).toBe(true);
  });

  it('shows statements that add up and a result per ledger, never a certified profit', async () => {
    const pl = await accountant.agent.get(url('/accounting/reports/profit-loss')).query({ from: '2026-11-01', to: '2026-11-30' });
    expect(pl.status).toBe(200);
    expect(pl.body.result).toBe(pl.body.income.total - pl.body.expense.total);
    const bs = await accountant.agent.get(url('/accounting/reports/balance-sheet')).query({ asOf: '2026-11-30' });
    expect(bs.body.balanced).toBe(true);
    expect(bs.body.equity.accumulatedResult).toBe(pl.body.result);
    const byBranchB = await accountant.agent
      .get(url('/accounting/reports/profit-loss'))
      .query({ from: '2026-11-01', to: '2026-11-30', branchId: c.branchB });
    expect(byBranchB.body.result).toBe(0);
    const ledger = await accountant.agent
      .get(url('/accounting/reports/ledger'))
      .query({ accountId: acct('1200'), from: '2026-11-01', to: '2026-11-30' });
    expect(ledger.body.closing).toBe(18000);
    expect(ledger.body.lines.at(-1).balance).toBe(18000);
    expect(
      (await accountant.agent.get(url('/accounting/reports/trial-balance')).query({ from: '2026-01-01', to: '2027-06-01' })).body.error.code,
    ).toBe('VALIDATION_ERROR');
  });
});

describe('manual entries and periods', () => {
  it('posts balanced manual entries once, keeps control accounts to their documents, and reverses by link', async () => {
    const body = {
      date: '2026-10-15',
      journal: 'general',
      memo: 'October rent',
      lines: [
        { accountId: acct('6100'), debit: 500000, branchId: c.branchA },
        { accountId: acct('3100'), credit: 500000 },
      ],
    };
    const unbalanced = await withKey(accountant, '/accounting/entries', {
      ...body,
      lines: [body.lines[0], { accountId: acct('3100'), credit: 1 }],
    });
    expect(unbalanced.body.error.code).toBe('UNBALANCED_ENTRY');
    const control = await withKey(accountant, '/accounting/entries', {
      ...body,
      lines: [body.lines[0], { accountId: acct('1200'), credit: 500000 }],
    });
    expect(control.body.error.code).toBe('CONTROL_ACCOUNT');
    const group = await withKey(accountant, '/accounting/entries', {
      ...body,
      lines: [body.lines[0], { accountId: acct('3000'), credit: 500000 }],
    });
    expect(group.body.error.code).toBe('ACCOUNT_NOT_POSTABLE');
    expect(
      (
        await withKey(accountant, '/accounting/entries', {
          ...body,
          date: '2026-09-30',
        })
      ).body.error.code,
    ).toBe('BEFORE_CUTOVER');
    expect((await withKey(c.admin, '/accounting/entries', body)).status).toBe(403);

    const key = randomUUID();
    const posted = await withKey(accountant, '/accounting/entries', body, key);
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    expect(posted.body.entry.number).toMatch(/^JE-2026-\d{6}$/);
    const replay = await withKey(accountant, '/accounting/entries', body, key);
    expect(replay.body.entry.id).toBe(posted.body.entry.id);
    expect((await withKey(accountant, '/accounting/entries', { ...body, memo: 'Other' }, key)).body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // Posted entries are immutable at the database level too.
    await expect(JournalEntryModel.updateOne({ organizationId: c.orgId, _id: posted.body.entry.id }, { $set: { memo: 'edited' } })).rejects.toThrow();
    await expect(
      JournalEntryModel.deleteOne({
        organizationId: c.orgId,
        _id: posted.body.entry.id,
      }),
    ).rejects.toThrow();

    const reversed = await send(accountant, 'post', url(`/accounting/entries/${posted.body.entry.id}/reverse`), {
      date: '2026-10-20',
      reason: 'Wrong month',
    });
    expect(reversed.status, JSON.stringify(reversed.body)).toBe(201);
    expect(reversed.body.entry.reversalOf).toBe(posted.body.entry.id);
    expect(
      (await send(accountant, 'post', url(`/accounting/entries/${posted.body.entry.id}/reverse`), { reason: 'Again please' })).body.error.code,
    ).toBe('ENTRY_ALREADY_REVERSED');
    const invoiceEntry = await JournalEntryModel.findOne({
      organizationId: c.orgId,
      'source.type': 'invoice',
    }).lean();
    expect((await send(accountant, 'post', url(`/accounting/entries/${invoiceEntry!._id}/reverse`), { reason: 'Not allowed' })).body.error.code).toBe(
      'DOCUMENT_POSTING',
    );
    // The rent stays as an October expense after correction: zero.
    const pl = await accountant.agent.get(url('/accounting/reports/profit-loss')).query({ from: '2026-10-01', to: '2026-10-31' });
    expect(pl.body.expense.total).toBe(0);
  });

  it('closes months in order once ended, refuses postings into them, and lets only the owner reopen the latest', async () => {
    expect(
      (
        await send(accountant, 'post', url('/accounting/periods/close'), {
          month: '2026-11',
        })
      ).body.error.code,
    ).toBe('PERIOD_ORDER');
    const closed = await send(accountant, 'post', url('/accounting/periods/close'), { month: '2026-10' });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.lockedThrough).toBe('2026-10-31');
    expect(
      (
        await send(accountant, 'post', url('/accounting/periods/close'), {
          month: '2026-11',
        })
      ).body.error.code,
    ).toBe('PERIOD_NOT_ENDED');
    const late = await withKey(accountant, '/accounting/entries', {
      date: '2026-10-30',
      journal: 'general',
      memo: 'Late bill',
      lines: [
        { accountId: acct('6300'), debit: 100 },
        { accountId: acct('3100'), credit: 100 },
      ],
    });
    expect(late.body.error.code).toBe('PERIOD_CLOSED');
    expect(
      (
        await send(accountant, 'post', url('/accounting/periods/reopen'), {
          month: '2026-10',
          reason: 'Missing utility bill',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send(c.owner, 'post', url('/accounting/periods/reopen'), {
          month: '2026-10',
          reason: 'short',
        })
      ).status,
    ).toBe(400);
    const reopened = await send(c.owner, 'post', url('/accounting/periods/reopen'), { month: '2026-10', reason: 'Missing utility bill' });
    expect(reopened.body.lockedThrough).toBeNull();
    const periods = await accountant.agent.get(url('/accounting/periods'));
    expect(periods.body.history.map((h: { action: string }) => h.action)).toEqual(['reopened', 'closed']);
    expect(periods.body.months[0]).toMatchObject({
      month: '2026-11',
      status: 'open',
      ended: false,
    });
  });
});

describe('cash and banks', () => {
  let cashbox: string;
  let bank: string;
  let depositEntry: string;
  it('runs cashier sessions: receipts land in the session, the closing count posts the difference', async () => {
    const created = await send(accountant, 'post', url('/cash/accounts'), {
      name: 'Front desk A',
      kind: 'cash',
      branchId: c.branchA,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    cashbox = created.body.account.id;
    expect(
      (
        await send(accountant, 'post', url('/cash/accounts'), {
          name: 'No branch',
          kind: 'cash',
        })
      ).status,
    ).toBe(400);
    // Branch B staff do not see branch A's cashbox.
    const seenByB = await c.receptionistB.agent.get(url('/cash/accounts'));
    expect(seenByB.body.accounts.some((a: { id: string }) => a.id === cashbox)).toBe(false);
    expect(
      (
        await send(c.receptionistB, 'post', url('/cash/sessions'), {
          cashAccountId: cashbox,
          openingCounted: 0,
        })
      ).status,
    ).toBe(404);

    // Two cashiers racing for the same cashbox: one session.
    const [one, two] = await Promise.all([
      send(c.receptionist, 'post', url('/cash/sessions'), {
        cashAccountId: cashbox,
        openingCounted: 0,
      }),
      send(c.admin, 'post', url('/cash/sessions'), {
        cashAccountId: cashbox,
        openingCounted: 0,
      }),
    ]);
    expect([one.status, two.status].sort()).toEqual([201, 409]);
    const winner = one.status === 201 ? c.receptionist : c.admin;
    const session = (one.status === 201 ? one : two).body.session;

    const r = await pay(winner, 20000);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const detail = await winner.agent.get(url(`/cash/sessions/${session.id}`));
    expect(detail.body.expectedNow).toBe(20000);
    expect(detail.body.movements).toHaveLength(1);
    // Other cashiers cannot see it; reviewers can.
    const other = winner === c.admin ? c.receptionist : c.admin;
    if (other === c.receptionist) expect((await other.agent.get(url(`/cash/sessions/${session.id}`))).status).toBe(404);
    expect((await accountant.agent.get(url(`/cash/sessions/${session.id}`))).status).toBe(200);

    expect(
      (
        await send(winner, 'post', url(`/cash/sessions/${session.id}/close`), {
          counted: 19500,
        })
      ).status,
    ).toBe(400); // note required
    const closed = await send(winner, 'post', url(`/cash/sessions/${session.id}/close`), { counted: 19500, note: 'Short by 5' });
    expect(closed.body.session).toMatchObject({
      status: 'closed',
      closingExpected: 20000,
      closingCounted: 19500,
      difference: -500,
    });
    expect(
      (
        await send(winner, 'post', url(`/cash/sessions/${session.id}/close`), {
          counted: 0,
        })
      ).body.error.code,
    ).toBe('SESSION_CLOSED');
    const b = await balances();
    expect(b.get('6900')).toBe(500);
    const boxes = (await accountant.agent.get(url('/cash/accounts'))).body.accounts;
    expect(boxes.find((a: { id: string }) => a.id === cashbox).balance).toBe(19500);
  });

  it('requires a session for cash when configured', async () => {
    const s = (await c.owner.agent.get(url('/accounting/settings'))).body.settings;
    expect(
      (
        await send(c.owner, 'patch', url('/accounting/settings'), {
          requireCashSession: true,
          version: s.version,
        })
      ).status,
    ).toBe(200);
    expect((await pay(c.receptionist, 1000)).body.error.code).toBe('CASH_SESSION_REQUIRED');
    expect((await pay(c.receptionist, 1000, [], 'card')).status).toBe(201);
    const again = (await c.owner.agent.get(url('/accounting/settings'))).body.settings;
    await send(c.owner, 'patch', url('/accounting/settings'), {
      requireCashSession: false,
      version: again.version,
    });
    // Mappings must point at a fitting account type.
    expect(
      (
        await send(c.owner, 'patch', url('/accounting/settings'), {
          mappings: { receivable: acct('4100') },
          version: again.version + 1,
        })
      ).status,
    ).toBe(400);
  });

  it('records vouchers and two-sided transfers, never taking a cashbox below zero', async () => {
    bank = (await accountant.agent.get(url('/cash/accounts'))).body.accounts.find((a: { kind: string }) => a.kind === 'bank').id;
    expect(
      (
        await withKey(accountant, '/cash/vouchers', {
          type: 'out',
          cashAccountId: cashbox,
          counterAccountId: acct('6500'),
          amount: 999999,
          memo: 'Paper',
        })
      ).body.error.code,
    ).toBe('INSUFFICIENT_CASH');
    expect(
      (
        await withKey(accountant, '/cash/vouchers', {
          type: 'in',
          cashAccountId: cashbox,
          counterAccountId: acct('1200'),
          amount: 100,
          memo: 'Bad',
        })
      ).status,
    ).toBe(400);
    const out = await withKey(accountant, '/cash/vouchers', {
      type: 'out',
      cashAccountId: cashbox,
      counterAccountId: acct('6500'),
      amount: 1500,
      memo: 'Printer paper',
    });
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    const transfer = await withKey(accountant, '/cash/vouchers', {
      type: 'transfer',
      cashAccountId: cashbox,
      toCashAccountId: bank,
      amount: 10000,
      memo: 'Deposit',
    });
    expect(transfer.status).toBe(201);
    depositEntry = transfer.body.voucher.entryId;
    const entry = await JournalEntryModel.findOne({
      organizationId: c.orgId,
      _id: transfer.body.voucher.entryId,
    }).lean();
    expect(entry!.lines).toHaveLength(2);
    expect(entry!.lines[0]!.debit).toBe(entry!.lines[1]!.credit);
    expect(
      (
        await withKey(c.receptionist, '/cash/vouchers', {
          type: 'out',
          cashAccountId: cashbox,
          counterAccountId: acct('6500'),
          amount: 1,
          memo: 'Nope',
        })
      ).status,
    ).toBe(403);
  });

  it('imports bank statements, matches by amount, and protects matched entries', async () => {
    expect(() => parseStatementCsv('2026-11-31,10,x')).toThrow();
    expect(parseStatementCsv('2026-11-05,100.5,Deposit,D1\n2026-11-06,-2.25,Fee')).toEqual([
      {
        date: '2026-11-05',
        amount: 10050,
        description: 'Deposit',
        reference: 'D1',
      },
      { date: '2026-11-06', amount: -225, description: 'Fee', reference: '' },
    ]);
    expect((await send(accountant, 'post', url(`/cash/accounts/${bank}/statement`), { csv: '2026-11-10,100.00,Cash deposit,DEP1' })).status).toBe(
      201,
    );
    const st = await accountant.agent.get(url(`/cash/accounts/${bank}/statement`));
    const line = st.body.lines[0];
    const deposit = st.body.unmatchedEntries.find((e: { entryId: string }) => e.entryId === depositEntry);
    expect(deposit).toBeTruthy();
    const wrong = st.body.unmatchedEntries.find((e: { amount: number }) => e.amount !== line.amount);
    if (wrong)
      expect((await send(accountant, 'post', url(`/cash/statement-lines/${line.id}/match`), { entryId: wrong.entryId })).body.error.code).toBe(
        'AMOUNT_MISMATCH',
      );
    expect((await send(accountant, 'post', url(`/cash/statement-lines/${line.id}/match`), { entryId: deposit.entryId })).status).toBe(200);
    expect((await send(accountant, 'post', url(`/accounting/entries/${deposit.entryId}/reverse`), { reason: 'Mistake here' })).body.error.code).toBe(
      'ENTRY_RECONCILED',
    );
    expect((await send(accountant, 'post', url(`/cash/statement-lines/${line.id}/unmatch`), {})).status).toBe(200);
  });
});

describe('cutover and isolation', () => {
  it('refuses a ledger start date before documents that were never posted', async () => {
    const e = await buildClinic(app, 'acct3');
    const o = (p: string) => `/api/v1/orgs/${e.orgId}${p}`;
    await send(e.owner, 'put', o('/finance/settings'), { currency: 'EGP' });
    const svc = (await send(e.owner, 'post', o('/finance/services'), { code: 'EXAM', name: 'Consultation', price: 10000 })).body.service.id;
    const pat = await createPatient(e.receptionist, e.orgId, e.branchA);
    const ch = await withKey(e.receptionist, '/finance/charges', { patientId: pat, branchId: e.branchA, serviceId: svc }, randomUUID(), e.orgId);
    const draft = await send(e.receptionist, 'post', o('/finance/invoices'), { patientId: pat, branchId: e.branchA, chargeIds: [ch.body.charge.id] });
    await withKey(e.receptionist, `/finance/invoices/${draft.body.invoice.id}/issue`, { version: draft.body.invoice.version }, randomUUID(), e.orgId);
    const early = await send(e.owner, 'post', o('/accounting/setup'), { cutoverDate: '2026-11-01' });
    expect(early.body.error.code).toBe('DOCUMENTS_AFTER_CUTOVER');
    expect((await send(e.owner, 'post', o('/accounting/setup'), { cutoverDate: '2026-11-11' })).status).toBe(201);
  });

  it('posts nothing before the cutover and proposes opening balances from the documents', async () => {
    const d = await buildClinic(app, 'acct2');
    const o = (p: string) => `/api/v1/orgs/${d.orgId}${p}`;
    await send(d.owner, 'put', o('/finance/settings'), { currency: 'EGP' });
    const svc = (
      await send(d.owner, 'post', o('/finance/services'), {
        code: 'EXAM',
        name: 'Consultation',
        price: 10000,
      })
    ).body.service.id;
    const pat = await createPatient(d.receptionist, d.orgId, d.branchA);
    // Ledger starts tomorrow: today's documents are history.
    expect(
      (
        await send(d.owner, 'post', o('/accounting/setup'), {
          cutoverDate: '2026-11-11',
        })
      ).status,
    ).toBe(201);
    const ch = await withKey(
      d.receptionist,
      '/finance/charges',
      { patientId: pat, branchId: d.branchA, serviceId: svc, quantity: 3 },
      randomUUID(),
      d.orgId,
    );
    const draft = await send(d.receptionist, 'post', o('/finance/invoices'), {
      patientId: pat,
      branchId: d.branchA,
      chargeIds: [ch.body.charge.id],
    });
    const inv = await withKey(
      d.receptionist,
      `/finance/invoices/${draft.body.invoice.id}/issue`,
      { version: draft.body.invoice.version },
      randomUUID(),
      d.orgId,
    );
    await withKey(
      d.receptionist,
      '/finance/payments',
      {
        patientId: pat,
        branchId: d.branchA,
        amount: 12000,
        method: 'cash',
        allocations: [{ invoiceId: inv.body.invoice.id, amount: 10000 }],
      },
      randomUUID(),
      d.orgId,
    );
    expect(await JournalEntryModel.countDocuments({ organizationId: d.orgId })).toBe(0);

    vi.restoreAllMocks();
    pinClock('2026-11-11T08:00:00.000Z');
    const preview = await d.owner.agent.get(o('/accounting/migration/preview'));
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const byKey = Object.fromEntries(preview.body.proposal.map((p: { key: string; debit: number; credit: number }) => [p.key, p]));
    expect(byKey.receivable.debit).toBe(20000);
    expect(byKey.patientAdvances.credit).toBe(2000);
    expect(byKey.openingEquity.credit).toBe(18000);
    // Opening entries may use control accounts, on the cutover date only.
    const lines = preview.body.proposal.map((p: { accountId: string; debit: number; credit: number }) => ({
      accountId: p.accountId,
      debit: p.debit,
      credit: p.credit,
    }));
    expect(
      (
        await withKey(
          d.owner,
          '/accounting/entries',
          {
            date: '2026-11-12',
            journal: 'opening',
            memo: 'Opening balances',
            lines,
          },
          randomUUID(),
          d.orgId,
        )
      ).body.error.code,
    ).toBe('VALIDATION_ERROR');
    expect(
      (
        await withKey(
          d.owner,
          '/accounting/entries',
          {
            date: '2026-11-11',
            journal: 'opening',
            memo: 'Opening balances',
            lines,
          },
          randomUUID(),
          d.orgId,
        )
      ).status,
    ).toBe(201);
    // Paying the old invoice after the cutover clears the opening receivable; the sub-ledgers agree.
    await withKey(
      d.receptionist,
      '/finance/payments',
      {
        patientId: pat,
        branchId: d.branchA,
        amount: 20000,
        method: 'cash',
        allocations: [{ invoiceId: inv.body.invoice.id, amount: 20000 }],
      },
      randomUUID(),
      d.orgId,
    );
    const rec = await d.owner.agent.get(o('/accounting/reports/reconciliation'));
    for (const row of rec.body.rows) expect(row.difference, row.key).toBe(0);

    // Another organization's ids are unknown here.
    const foreign = await JournalEntryModel.findOne({
      organizationId: d.orgId,
    }).lean();
    expect((await accountant.agent.get(url(`/accounting/entries/${foreign!._id}`))).status).toBe(404);
    expect((await send(accountant, 'post', url(`/accounting/entries/${foreign!._id}/reverse`), { reason: 'Cross tenant' })).status).toBe(404);
    expect((await d.owner.agent.get(url('/accounting/accounts'))).status).toBe(404);
    vi.restoreAllMocks();
    pinClock();
  });
});
