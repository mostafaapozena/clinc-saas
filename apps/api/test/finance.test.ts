import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditEventModel } from '../src/modules/audit/audit-event.model.js';
import { ChargeModel, InvoiceModel, PaymentModel } from '../src/modules/finance/finance.model.js';
import { addMember, register, send, testApp, type Client } from './helpers/api.js';
import { TODAY, act, bookOk, buildClinic, createPatient, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// Clinic finances. Synthetic data; MARK detects clinical text leaking into financial records.
const MARK = 'SYNTHETIC-CLINICAL-TEXT';
const app = testApp();
let c: Clinic;
let accountant: Client;
let exam: string; // service id
let filling: string;
let patient: string;
const orgUrl = (path: string) => `/api/v1/orgs/${c.orgId}${path}`;
const withKey = (who: Client, path: string, body: object, key: string = randomUUID()) =>
  who.agent.post(orgUrl(path)).set('X-CSRF-Token', who.csrf).set('Idempotency-Key', key).send(body);

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('finance');
  c = await buildClinic(app, 'fin');
  accountant = await register(app, 'fin-accountant');
  await addMember(c.owner, c.orgId, accountant, 'accountant', [c.branchA]);
  patient = await createPatient(c.receptionist, c.orgId, c.branchA);
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => dropTestDatabase());

const charge = (who: Client, serviceId = exam, quantity = 1, patientId = patient, branchId = c.branchA, key?: string) =>
  withKey(who, '/finance/charges', { patientId, branchId, serviceId, quantity }, key);
async function chargeOk(serviceId = exam, quantity = 1) {
  const res = await charge(c.receptionist, serviceId, quantity);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.charge as { id: string; amount: number };
}
async function issuedInvoice(amountService = exam, quantity = 1) {
  const ch = await chargeOk(amountService, quantity);
  const draft = await send(c.receptionist, 'post', orgUrl('/finance/invoices'), {
    patientId: patient,
    branchId: c.branchA,
    chargeIds: [ch.id],
  });
  expect(draft.status, JSON.stringify(draft.body)).toBe(201);
  const issued = await withKey(c.receptionist, `/finance/invoices/${draft.body.invoice.id}/issue`, { version: draft.body.invoice.version });
  expect(issued.status, JSON.stringify(issued.body)).toBe(200);
  return issued.body.invoice as { id: string; total: number; number: string; balance: number };
}
const pay = (who: Client, amount: number, allocations: { invoiceId: string; amount: number }[] = [], key?: string) =>
  withKey(who, '/finance/payments', { patientId: patient, branchId: c.branchA, amount, method: 'cash', allocations }, key);
const invoiceOf = async (id: string) => (await accountant.agent.get(orgUrl(`/finance/invoices/${id}`))).body.invoice;

describe('setup and catalog', () => {
  it('requires the owner to choose the currency first, then locks it once prices exist', async () => {
    const noCurrency = await send(c.owner, 'post', orgUrl('/finance/services'), { code: 'EXAM', name: 'Consultation', price: 30000 });
    expect(noCurrency.status).toBe(409);
    expect(noCurrency.body.error.code).toBe('CURRENCY_REQUIRED');
    expect((await send(c.admin, 'put', orgUrl('/finance/settings'), { currency: 'EGP' })).status).toBe(403);
    expect((await send(c.owner, 'put', orgUrl('/finance/settings'), { currency: 'USD' })).status).toBe(400);
    expect((await send(c.owner, 'put', orgUrl('/finance/settings'), { currency: 'EGP' })).status).toBe(200);

    const created = await send(c.owner, 'post', orgUrl('/finance/services'), {
      code: 'exam',
      name: 'Consultation',
      price: 30000,
      branchPrices: [{ branchId: c.branchB, price: 35000 }],
    });
    expect(created.status).toBe(201);
    expect(created.body.service).toMatchObject({ code: 'EXAM', price: 30000, currency: 'EGP' });
    exam = created.body.service.id;
    filling = (await send(c.admin, 'post', orgUrl('/finance/services'), { code: 'FILL', name: 'Filling', price: 75050 })).body.service.id;
    expect((await send(c.owner, 'post', orgUrl('/finance/services'), { code: 'EXAM', name: 'Again', price: 1 })).body.error.code).toBe(
      'SERVICE_CODE_TAKEN',
    );
    expect((await send(c.receptionist, 'post', orgUrl('/finance/services'), { code: 'X', name: 'Nope', price: 1 })).status).toBe(403);
    // Fractions and floats are refused: money is integer minor units.
    expect((await send(c.owner, 'post', orgUrl('/finance/services'), { code: 'FLOAT', name: 'Float', price: 10.5 })).status).toBe(400);
    expect((await send(c.owner, 'put', orgUrl('/finance/settings'), { currency: 'SAR' })).body.error.code).toBe('CURRENCY_LOCKED');

    // Branch price applies at branch B; version conflicts are reported.
    const atB = await c.owner.agent.get(orgUrl('/finance/services')).query({ branchId: c.branchB });
    expect(atB.body.data.find((s: { id: string }) => s.id === exam).effectivePrice).toBe(35000);
    expect((await send(c.owner, 'patch', orgUrl(`/finance/services/${exam}`), { price: 31000, version: 5 })).body.error.code).toBe(
      'VERSION_CONFLICT',
    );
  });
});

describe('charges', () => {
  it('prices by quantity in integer minor units, idempotently, within the caller’s branches', async () => {
    const key = randomUUID();
    const first = await charge(c.receptionist, filling, 3, patient, c.branchA, key);
    expect(first.status).toBe(201);
    expect(first.body.charge).toMatchObject({
      unitPrice: 75050,
      amount: 225150,
      currency: 'EGP',
      status: 'pending',
      description: 'Filling',
    });
    const replay = await charge(c.receptionist, filling, 3, patient, c.branchA, key);
    expect(replay.status).toBe(200);
    expect(replay.body.charge.id).toBe(first.body.charge.id);
    expect((await charge(c.receptionist, filling, 2, patient, c.branchA, key)).body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    // Branch B receptionist cannot charge at branch A; a patient not registered at B is unknown there.
    expect((await charge(c.receptionistB, exam, 1, patient, c.branchA)).status).toBe(404);
    expect((await charge(c.owner, exam, 1, patient, c.branchB)).status).toBe(404);
    // Doctors and viewers record no manual charges.
    expect((await charge(c.doctor)).status).toBe(403);
    expect((await charge(c.viewer)).status).toBe(403);
    // Voiding: only pending charges, with a reason.
    const voided = await send(c.receptionist, 'post', orgUrl(`/finance/charges/${first.body.charge.id}/void`), { reason: 'Entered twice' });
    expect(voided.body.charge.status).toBe('voided');
    expect((await send(c.receptionist, 'post', orgUrl(`/finance/charges/${first.body.charge.id}/void`), { reason: 'Again' })).status).toBe(
      409,
    );
  });

  it('lets the treating doctor charge a procedure of their own record once, with confirmation and without clinical text', async () => {
    // A dental visit with a procedure item.
    const date = DateTime.fromISO(TODAY).plus({ days: 1 }).toISODate() ?? TODAY;
    vi.restoreAllMocks();
    pinClock(`${date}T05:00:00.000Z`);
    let a = await bookOk(c.owner, c.orgId, {
      patientId: patient,
      practitionerId: c.practitioner,
      branchId: c.branchA,
      date,
      time: '09:00',
    });
    for (const [action, actor] of [
      ['check_in', c.receptionist],
      ['start', c.doctor],
    ] as const)
      a = (await act(actor, c.orgId, a.id, action, a.version)).body.appointment;
    const started = await withKey(c.doctor, `/appointments/${a.id}/encounter`, {
      sections: { reason: `${MARK} reason` },
      specialtyData: {
        procedures: [{ id: 'pr-111111', tooth: '16', description: `${MARK} composite filling` }],
        planItems: [{ id: 'pl-111111', tooth: '17', description: `${MARK} crown` }],
      },
    });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const encounterId = started.body.encounter.id as string;
    const body = { encounterId, itemId: 'pr-111111', kind: 'procedure', serviceId: filling, confirm: true };

    expect((await withKey(c.doctor, '/finance/charges/clinical', { ...body, confirm: false })).status).toBe(400);
    expect((await withKey(c.doctor2, '/finance/charges/clinical', body)).status).toBe(404);
    expect((await withKey(c.receptionist, '/finance/charges/clinical', body)).status).toBe(403);
    expect((await withKey(c.doctor, '/finance/charges/clinical', { ...body, itemId: 'pr-999999' })).body.error.fields).toEqual({
      itemId: 'invalid_reference',
    });
    // A plan item becomes chargeable only once the visit is finalized.
    expect(
      (await withKey(c.doctor, '/finance/charges/clinical', { ...body, kind: 'plan_item', itemId: 'pl-111111' })).body.error.fields,
    ).toEqual({ itemId: 'invalid_reference' });

    const ok = await withKey(c.doctor, '/finance/charges/clinical', body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.charge).toMatchObject({
      description: 'Filling',
      amount: 75050,
      source: { type: 'clinical_procedure', encounterId, itemId: 'pr-111111' },
    });
    // The same item can never be charged twice, even concurrently.
    const again = await Promise.all([
      withKey(c.doctor, '/finance/charges/clinical', body),
      withKey(c.doctor, '/finance/charges/clinical', body),
    ]);
    for (const r of again) expect(r.body.error.code).toBe('CHARGE_EXISTS');
    const status = await c.doctor.agent.get(orgUrl('/finance/clinical-charges')).query({ encounterId });
    expect(status.body.data).toEqual([expect.objectContaining({ itemId: 'pr-111111', status: 'pending' })]);
    // Finance staff see the charge, never the clinical text.
    const account = await accountant.agent.get(orgUrl(`/finance/patients/${patient}/account`));
    expect(account.status).toBe(200);
    expect(JSON.stringify(account.body)).not.toContain(MARK);
    expect(JSON.stringify(await ChargeModel.find({ organizationId: c.orgId }).lean())).not.toContain(MARK);
    expect((await accountant.agent.get(orgUrl(`/encounters/${encounterId}`))).status).toBe(403);
  });
});

describe('invoices', () => {
  it('drafts claim charges exactly once, even concurrently; issued invoices are numbered and immutable', async () => {
    const ch = await chargeOk(exam);
    const create = () =>
      send(c.receptionist, 'post', orgUrl('/finance/invoices'), { patientId: patient, branchId: c.branchA, chargeIds: [ch.id] });
    const results = await Promise.all([create(), create(), create()]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 201)) expect(r.body.error.code).toBe('CHARGES_UNAVAILABLE');
    const draft = results.find((r) => r.status === 201)!.body.invoice;

    // Discounts: permitted roles only, bounded, with a reason.
    expect(
      (
        await send(c.receptionist, 'put', orgUrl(`/finance/invoices/${draft.id}/discount`), {
          amount: 100,
          reason: 'Loyalty',
          version: draft.version,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send(accountant, 'put', orgUrl(`/finance/invoices/${draft.id}/discount`), {
          amount: 99999999,
          reason: 'Too much',
          version: draft.version,
        })
      ).status,
    ).toBe(400);
    expect(
      (await send(accountant, 'put', orgUrl(`/finance/invoices/${draft.id}/discount`), { amount: 100, reason: '', version: draft.version }))
        .status,
    ).toBe(400);
    const discounted = await send(accountant, 'put', orgUrl(`/finance/invoices/${draft.id}/discount`), {
      amount: 5000,
      reason: 'Agreed courtesy',
      version: draft.version,
    });
    expect(discounted.body.invoice).toMatchObject({ subtotal: 30000, total: 25000, discount: { amount: 5000 } });

    const issued = await withKey(c.receptionist, `/finance/invoices/${draft.id}/issue`, { version: discounted.body.invoice.version });
    expect(issued.body.invoice).toMatchObject({ status: 'issued', number: `INV-2026-000001`, balance: 25000 });
    expect(
      (await send(accountant, 'put', orgUrl(`/finance/invoices/${draft.id}/discount`), { amount: 0, version: issued.body.invoice.version }))
        .status,
    ).toBe(409);
    expect((await send(c.receptionist, 'post', orgUrl(`/finance/invoices/${draft.id}/discard`), {})).status).toBe(409);
    await expect(InvoiceModel.updateOne({ organizationId: c.orgId, _id: draft.id }, { $set: { total: 1 } })).rejects.toThrow();
    await expect(InvoiceModel.deleteOne({ organizationId: c.orgId, _id: draft.id })).rejects.toThrow();
  });

  it('numbers concurrently issued invoices uniquely and without gaps', async () => {
    const drafts = [];
    for (let i = 0; i < 5; i++) {
      const ch = await chargeOk(exam);
      drafts.push(
        (await send(c.receptionist, 'post', orgUrl('/finance/invoices'), { patientId: patient, branchId: c.branchA, chargeIds: [ch.id] }))
          .body.invoice,
      );
    }
    const issued = await Promise.all(drafts.map((d) => withKey(c.receptionist, `/finance/invoices/${d.id}/issue`, { version: d.version })));
    for (const r of issued) expect(r.status, JSON.stringify(r.body)).toBe(200);
    const numbers = issued.map((r) => r.body.invoice.number as string).sort();
    expect(new Set(numbers).size).toBe(5);
    const seqs = numbers.map((n) => Number(n.split('-').at(-1)));
    expect(seqs.at(-1)! - seqs[0]!).toBe(4);
  });

  it('a discarded draft releases its charges', async () => {
    const ch = await chargeOk(exam);
    const draft = (
      await send(c.receptionist, 'post', orgUrl('/finance/invoices'), { patientId: patient, branchId: c.branchA, chargeIds: [ch.id] })
    ).body.invoice;
    expect((await send(c.receptionist, 'post', orgUrl(`/finance/invoices/${draft.id}/discard`), {})).body.invoice.status).toBe('discarded');
    expect((await ChargeModel.findOne({ organizationId: c.orgId, _id: ch.id }).lean())?.status).toBe('pending');
  });
});

describe('payments, credit notes and refunds', () => {
  it('allocates partial and full payments without ever exceeding the balance', async () => {
    const invoice = await issuedInvoice(exam); // 30000
    const partial = await pay(c.receptionist, 10000, [{ invoiceId: invoice.id, amount: 10000 }]);
    expect(partial.status, JSON.stringify(partial.body)).toBe(201);
    expect(partial.body.payment).toMatchObject({ number: expect.stringMatching(/^RCPT-2026-\d{6}$/), allocated: 10000, unallocated: 0 });
    expect((await invoiceOf(invoice.id)).balance).toBe(20000);
    expect((await pay(c.receptionist, 30000, [{ invoiceId: invoice.id, amount: 30000 }])).body.error.code).toBe('OVER_ALLOCATION');
    expect((await pay(c.receptionist, 100, [{ invoiceId: invoice.id, amount: 200 }])).status).toBe(400);

    // Two cashiers racing for the remaining 20000 with 15000 each: one wins, the balance stays ≥ 0.
    const race = await Promise.all([
      pay(c.receptionist, 15000, [{ invoiceId: invoice.id, amount: 15000 }]),
      pay(accountant, 15000, [{ invoiceId: invoice.id, amount: 15000 }]),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    const after = await invoiceOf(invoice.id);
    expect(after.balance).toBe(5000);
    expect(after.paid + after.credited).toBeLessThanOrEqual(after.total);
    // The losing request created no receipt at all (the transaction rolled back).
    expect(await PaymentModel.countDocuments({ organizationId: c.orgId, patientId: patient, amount: 15000 })).toBe(1);

    const full = await pay(c.receptionist, 5000, [{ invoiceId: invoice.id, amount: 5000 }]);
    expect(full.status).toBe(201);
    expect((await invoiceOf(invoice.id)).balance).toBe(0);
  });

  it('keeps unallocated credit, allocates it later, refunds only what is unallocated, and reverses with history kept', async () => {
    const invoice = await issuedInvoice(filling); // 75050
    const key = randomUUID();
    const credit = await pay(c.receptionist, 50000, [], key);
    expect(credit.body.payment.unallocated).toBe(50000);
    expect((await pay(c.receptionist, 50000, [], key)).body.replayed).toBe(true);
    expect((await pay(c.receptionist, 40000, [], key)).body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const id = credit.body.payment.id as string;
    const allocated = await send(c.receptionist, 'post', orgUrl(`/finance/payments/${id}/allocations`), {
      invoiceId: invoice.id,
      amount: 30000,
    });
    expect(allocated.body.payment).toMatchObject({ allocated: 30000, unallocated: 20000 });

    expect((await withKey(c.receptionist, `/finance/payments/${id}/refunds`, { amount: 100, reason: 'Change' })).status).toBe(403);
    expect((await withKey(accountant, `/finance/payments/${id}/refunds`, { amount: 25000, reason: 'Too much' })).body.error.code).toBe(
      'OVER_REFUND',
    );
    const refund = await withKey(accountant, `/finance/payments/${id}/refunds`, { amount: 5000, reason: 'Overpaid, returned in cash' });
    expect(refund.status).toBe(201);
    expect(refund.body.refund.number).toMatch(/^REF-2026-\d{6}$/);
    // A refunded receipt cannot be reversed (it would double-count).
    expect((await send(accountant, 'post', orgUrl(`/finance/payments/${id}/reverse`), { reason: 'Bounced' })).body.error.code).toBe(
      'PAYMENT_REFUNDED',
    );

    const other = await pay(c.receptionist, 20000, [{ invoiceId: invoice.id, amount: 20000 }]);
    expect((await invoiceOf(invoice.id)).balance).toBe(75050 - 30000 - 20000);
    const reversed = await send(accountant, 'post', orgUrl(`/finance/payments/${other.body.payment.id}/reverse`), {
      reason: 'Card payment disputed',
    });
    expect(reversed.body.payment).toMatchObject({ status: 'reversed', reversal: { reason: 'Card payment disputed' } });
    expect((await invoiceOf(invoice.id)).balance).toBe(75050 - 30000);
    expect(
      (await send(accountant, 'post', orgUrl(`/finance/payments/${other.body.payment.id}/reverse`), { reason: 'Again' })).body.error.code,
    ).toBe('PAYMENT_REVERSED');
  });

  it('credit notes reduce the open balance only, also under concurrency', async () => {
    const invoice = await issuedInvoice(exam); // 30000
    expect(
      (await withKey(c.receptionist, `/finance/invoices/${invoice.id}/credit-notes`, { amount: 100, reason: 'Goodwill' })).status,
    ).toBe(403);
    const race = await Promise.all([
      withKey(accountant, `/finance/invoices/${invoice.id}/credit-notes`, { amount: 20000, reason: 'Service not delivered' }),
      withKey(c.admin, `/finance/invoices/${invoice.id}/credit-notes`, { amount: 20000, reason: 'Service not delivered' }),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await invoiceOf(invoice.id)).toMatchObject({ credited: 20000, balance: 10000, total: 30000 });
  });
});

describe('account, statement and reports', () => {
  it('shows a coherent account and running statement; reports group by currency', async () => {
    const account = await accountant.agent.get(orgUrl(`/finance/patients/${patient}/account`));
    expect(account.status).toBe(200);
    const { outstanding, unallocatedCredit, net } = account.body.balance;
    expect(net).toBe(outstanding - unallocatedCredit);
    const statement = await c.receptionist.agent.get(orgUrl(`/finance/patients/${patient}/statement`));
    expect(statement.status).toBe(200);
    const final = statement.body.balances.find((b: { currency: string }) => b.currency === 'EGP').balance;
    expect(final).toBe(net);
    // Each line's balance is the previous plus debit minus credit.
    let running = 0;
    for (const e of statement.body.entries) {
      running += e.debit - e.credit;
      expect(e.balance).toBe(running);
    }

    const report = await accountant.agent.get(orgUrl('/finance/reports/summary')).query({ from: '2026-01-01', to: '2026-12-31' });
    expect(report.status).toBe(200);
    expect(report.body.invoiced.every((g: { currency: string }) => g.currency === 'EGP')).toBe(true);
    expect(report.body.outstanding[0].amount).toBe(outstanding);
    expect(
      (await c.receptionist.agent.get(orgUrl('/finance/reports/summary')).query({ from: '2026-01-01', to: '2026-12-31' })).status,
    ).toBe(403);
    expect((await c.doctor.agent.get(orgUrl('/finance/reports/summary')).query({ from: '2026-01-01', to: '2026-12-31' })).status).toBe(403);
    // Branch B staff see nothing of branch A's patient.
    expect((await c.receptionistB.agent.get(orgUrl(`/finance/patients/${patient}/account`))).status).toBe(404);
    // Every money change is in the administrative audit log, with amounts but no clinical text.
    const events = await AuditEventModel.find({
      organizationId: c.orgId,
      action: { $in: ['invoice.issued', 'payment.recorded', 'refund.recorded', 'credit_note.issued', 'payment.reversed'] },
    }).lean();
    expect(new Set(events.map((e) => e.action)).size).toBe(5);
    expect(JSON.stringify(events)).not.toContain(MARK);
  });

  it('never mixes currencies in one invoice, and refuses other organizations’ ids', async () => {
    const ch = await chargeOk(exam);
    await ChargeModel.updateOne({ organizationId: c.orgId, _id: ch.id }, { $set: { currency: 'SAR' } });
    const ch2 = await chargeOk(exam);
    const mixed = await send(c.receptionist, 'post', orgUrl('/finance/invoices'), {
      patientId: patient,
      branchId: c.branchA,
      chargeIds: [ch.id, ch2.id],
    });
    expect(mixed.body.error.code).toBe('MIXED_CURRENCIES');

    const other = await buildClinic(app, 'fin-other');
    expect((await send(other.owner, 'put', `/api/v1/orgs/${other.orgId}/finance/settings`, { currency: 'SAR' })).status).toBe(200);
    const invoice = await issuedInvoice(exam);
    expect((await other.owner.agent.get(`/api/v1/orgs/${other.orgId}/finance/invoices/${invoice.id}`)).status).toBe(404);
    expect((await other.owner.agent.get(`/api/v1/orgs/${other.orgId}/finance/patients/${patient}/account`)).status).toBe(404);
    expect(
      (
        await other.owner.agent
          .post(`/api/v1/orgs/${other.orgId}/finance/payments`)
          .set('X-CSRF-Token', other.owner.csrf)
          .set('Idempotency-Key', randomUUID())
          .send({ patientId: patient, branchId: c.branchA, amount: 100, method: 'cash' })
      ).status,
    ).toBe(404);
  });
});
