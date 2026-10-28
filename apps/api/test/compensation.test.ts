import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { addMember, register, send, testApp, type Client } from './helpers/api.js';
import { bookOk, buildClinic, createPatient, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// Practitioner compensation (docs/architecture/COMPENSATION.md): agreements, settlements on the
// performed and invoiced bases, approval (frozen, never settled twice) and payment. Synthetic data.
const app = testApp();
let c: Clinic;
let accountant: Client;
let patient: string;
let exam: string;
const url = (path: string) => `/api/v1/orgs/${c.orgId}${path}`;
const withKey = (who: Client, path: string, body: object, key: string = randomUUID()) =>
  who.agent.post(url(path)).set('X-CSRF-Token', who.csrf).set('Idempotency-Key', key).send(body);
const at = (iso: string) => {
  vi.restoreAllMocks();
  pinClock(iso);
};
const ledger = async (code: string) =>
  ((await accountant.agent.get(url('/accounting/accounts'))).body.accounts as { code: string; balance: number }[]).find((a) => a.code === code)!
    .balance;

/** A charge for an appointment with the given practitioner (booked a day ahead). */
async function chargeFor(practitionerId: string, date: string, quantity = 1) {
  const appointment = await bookOk(c.owner, c.orgId, { patientId: patient, practitionerId, branchId: c.branchA, date, time: '10:00' });
  const res = await withKey(c.receptionist, '/finance/charges', {
    patientId: patient,
    branchId: c.branchA,
    serviceId: exam,
    quantity,
    appointmentId: appointment.id,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.charge as { id: string; amount: number };
}

beforeAll(async () => {
  pinClock('2026-11-05T06:00:00.000Z');
  await connectTestDatabase('compensation');
  c = await buildClinic(app, 'comp');
  accountant = await register(app, 'comp-accountant');
  await addMember(c.owner, c.orgId, accountant, 'accountant');
  await send(c.owner, 'put', url('/finance/settings'), { currency: 'EGP' });
  await send(c.owner, 'post', url('/accounting/setup'), { cutoverDate: '2026-10-01' });
  exam = (await send(c.owner, 'post', url('/finance/services'), { code: 'EXAM', name: 'Consultation', price: 30000 })).body.service.id;
  patient = await createPatient(c.receptionist, c.orgId, c.branchA);
});
afterAll(() => dropTestDatabase());

describe('agreements and settlements', () => {
  let draft: { id: string; version: number };
  let other: { id: string; version: number };
  it('computes fees on performed services under an effective-dated agreement', async () => {
    const terms = { practitionerId: c.practitioner, effectiveFrom: '2026-11-01', basis: 'performed', percentBp: 3000, fixedPerUnit: 1000 };
    expect((await send(c.admin, 'post', url('/compensation/agreements'), terms)).status).toBe(403);
    expect((await send(accountant, 'post', url('/compensation/agreements'), { ...terms, percentBp: 0, fixedPerUnit: 0 })).status).toBe(400);
    expect((await send(accountant, 'post', url('/compensation/agreements'), terms)).status).toBe(201);
    await chargeFor(c.practitioner, '2026-11-06');
    await chargeFor(c.practitioner, '2026-11-07', 2);
    await chargeFor(c.practitioner2, '2026-11-08'); // another practitioner's work

    at('2026-12-01T08:00:00.000Z');
    expect(
      (await send(accountant, 'post', url('/compensation/settlements'), { practitionerId: c.practitioner, from: '2026-11-01', to: '2026-12-01' }))
        .status,
    ).toBe(400);
    const created = await send(accountant, 'post', url('/compensation/settlements'), {
      practitionerId: c.practitioner,
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.settlement.lines.map((l: { amount: number }) => l.amount)).toEqual([10000, 20000]); // 30% + 10.00 per unit
    expect(created.body.settlement.total).toBe(30000);
    const adjusted = await send(accountant, 'post', url(`/compensation/settlements/${created.body.settlement.id}/adjustments`), {
      amount: 500,
      reason: 'Late extra visit',
      version: 0,
    });
    draft = adjusted.body.settlement;
    expect(draft).toMatchObject({ total: 30500 });
    other = (
      await send(accountant, 'post', url('/compensation/settlements'), { practitionerId: c.practitioner, from: '2026-11-01', to: '2026-11-30' })
    ).body.settlement;
  });

  it('approves once: items are never settled twice, approved settlements never change', async () => {
    expect((await send(accountant, 'post', url(`/compensation/settlements/${draft.id}/approve`), { version: draft.version })).status).toBe(403);
    const approved = await send(c.owner, 'post', url(`/compensation/settlements/${draft.id}/approve`), { version: draft.version });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.settlement.status).toBe('approved');
    expect(await ledger('5200')).toBe(30500);
    expect(await ledger('2300')).toBe(30500);
    expect((await send(c.owner, 'post', url(`/compensation/settlements/${other.id}/approve`), { version: other.version })).body.error.code).toBe(
      'ITEMS_ALREADY_SETTLED',
    );
    expect((await send(accountant, 'post', url(`/compensation/settlements/${draft.id}/recompute`), {})).body.error.code).toBe('SETTLEMENT_NOT_DRAFT');
    const again = await send(accountant, 'post', url(`/compensation/settlements/${other.id}/recompute`), {});
    expect(again.body.settlement.lines).toEqual([]);
    // A new agreement cannot re-price the settled period; from the next day it can.
    const later = { practitionerId: c.practitioner, basis: 'invoiced', percentBp: 2000 };
    expect((await send(accountant, 'post', url('/compensation/agreements'), { ...later, effectiveFrom: '2026-11-15' })).body.error.code).toBe(
      'PERIOD_SETTLED',
    );
    expect((await send(accountant, 'post', url('/compensation/agreements'), { ...later, effectiveFrom: '2026-12-01' })).status).toBe(201);
    const list = await accountant.agent.get(url('/compensation/agreements')).query({ practitionerId: c.practitioner });
    expect(list.body.agreements.map((a: { effectiveFrom: string; effectiveTo: string | null }) => [a.effectiveFrom, a.effectiveTo])).toEqual([
      ['2026-12-01', null],
      ['2026-11-01', '2026-11-30'],
    ]);
  });

  it('pays partly from the bank, idempotently, never more than owed', async () => {
    const bank = (await accountant.agent.get(url('/cash/accounts'))).body.accounts.find((a: { kind: string }) => a.kind === 'bank').id;
    const key = randomUUID();
    const first = await withKey(accountant, `/compensation/settlements/${draft.id}/payments`, { cashAccountId: bank, amount: 10000 }, key);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.settlement).toMatchObject({ paid: 10000, remaining: 20500, status: 'approved' });
    expect(
      (await withKey(accountant, `/compensation/settlements/${draft.id}/payments`, { cashAccountId: bank, amount: 10000 }, key)).body.settlement.paid,
    ).toBe(10000);
    expect(
      (await withKey(accountant, `/compensation/settlements/${draft.id}/payments`, { cashAccountId: bank, amount: 99999 })).body.error.code,
    ).toBe('OVER_PAYMENT');
    const rest = await withKey(c.owner, `/compensation/settlements/${draft.id}/payments`, { cashAccountId: bank, amount: 20500 });
    expect(rest.body.settlement.status).toBe('paid');
    expect(await ledger('2300')).toBe(0);
    // The doctor sees their own statement; others see nothing of it; the full list is for finance.
    expect((await c.doctor.agent.get(url('/compensation/my-settlements'))).body.settlements.map((s: { id: string }) => s.id)).toEqual([draft.id]);
    expect((await c.doctor2.agent.get(url('/compensation/my-settlements'))).body.settlements).toEqual([]);
    expect((await c.doctor.agent.get(url('/compensation/settlements'))).status).toBe(403);
  });

  it('on the invoiced basis, applies the discount and credit notes of the period pro rata', async () => {
    at('2026-12-10T06:00:00.000Z');
    const ch = await chargeFor(c.practitioner, '2026-12-11');
    const draftInv = await send(c.receptionist, 'post', url('/finance/invoices'), { patientId: patient, branchId: c.branchA, chargeIds: [ch.id] });
    const discounted = await send(c.owner, 'put', url(`/finance/invoices/${draftInv.body.invoice.id}/discount`), {
      amount: 3000,
      reason: 'Loyalty',
      version: draftInv.body.invoice.version,
    });
    const issued = await withKey(c.receptionist, `/finance/invoices/${draftInv.body.invoice.id}/issue`, { version: discounted.body.invoice.version });
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    expect(
      (await withKey(accountant, `/finance/invoices/${draftInv.body.invoice.id}/credit-notes`, { amount: 5000, reason: 'Goodwill' })).status,
    ).toBe(201);
    at('2027-01-02T08:00:00.000Z');
    const dec = await send(accountant, 'post', url('/compensation/settlements'), {
      practitionerId: c.practitioner,
      from: '2026-12-01',
      to: '2026-12-31',
    });
    expect(dec.status, JSON.stringify(dec.body)).toBe(201);
    // 20% of 270.00 (after the 10% discount) = 54.00, minus 20% of the 50.00 credit = 10.00.
    expect(dec.body.settlement.lines.map((l: { sourceType: string; amount: number }) => [l.sourceType, l.amount])).toEqual([
      ['invoice_line', 5400],
      ['credit_note', -1000],
    ]);
    expect(dec.body.settlement.total).toBe(4400);
  });
});
