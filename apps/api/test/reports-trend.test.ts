import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { send, testApp, type Client } from './helpers/api.js';
import { buildClinic, createPatient, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// Monthly invoiced and collected amounts for the reports center (docs/REPORTS_CENTER.md).
// Clock: 2026-11-10.
const app = testApp();
let c: Clinic;
let other: Clinic;
const url = (path: string, org = c.orgId) => `/api/v1/orgs/${org}${path}`;
const withKey = (who: Client, path: string, body: object) =>
  who.agent.post(url(path)).set('X-CSRF-Token', who.csrf).set('Idempotency-Key', randomUUID()).send(body);

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('reports-trend');
  c = await buildClinic(app, 'reports-trend');
  other = await buildClinic(app, 'reports-trend-other');
  await send(c.owner, 'put', url('/finance/settings'), { currency: 'EGP' });
  const service = (await send(c.owner, 'post', url('/finance/services'), { code: 'EXAM', name: 'Consultation', price: 40_000 })).body.service.id;
  const patient = await createPatient(c.receptionist, c.orgId, c.branchA);
  const ch = await withKey(c.receptionist, '/finance/charges', { patientId: patient, branchId: c.branchA, serviceId: service, quantity: 2 });
  const draft = await send(c.receptionist, 'post', url('/finance/invoices'), {
    patientId: patient,
    branchId: c.branchA,
    chargeIds: [ch.body.charge.id],
  });
  const issued = await withKey(c.receptionist, `/finance/invoices/${draft.body.invoice.id}/issue`, { version: draft.body.invoice.version });
  await withKey(c.receptionist, '/finance/payments', {
    patientId: patient,
    branchId: c.branchA,
    amount: 30_000,
    method: 'cash',
    allocations: [{ invoiceId: issued.body.invoice.id, amount: 30_000 }],
  });
});
afterAll(() => dropTestDatabase());

describe('finance trend', () => {
  it('returns the last months with invoiced and collected amounts per currency', async () => {
    const res = await c.owner.agent.get(url('/finance/reports/trend?months=3'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.months).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(res.body.series).toEqual([
      { currency: 'EGP', invoiced: [0, 0, 80_000], invoices: [0, 0, 1], collected: [0, 0, 30_000], receipts: [0, 0, 1] },
    ]);
  });

  it('agrees with the period summary for the same month', async () => {
    const trend = (await c.owner.agent.get(url('/finance/reports/trend?months=1'))).body.series[0];
    const summary = (await c.owner.agent.get(url('/finance/reports/summary?from=2026-11-01&to=2026-11-30'))).body;
    expect(trend.invoiced[0]).toBe(summary.invoiced[0].total);
    expect(trend.collected[0]).toBe(summary.collected.reduce((s: number, r: { amount: number }) => s + r.amount, 0));
  });

  it('follows permissions, branch scope and tenancy', async () => {
    expect((await c.receptionist.agent.get(url('/finance/reports/trend'))).status).toBe(403);
    expect((await c.owner.agent.get(url(`/finance/reports/trend?branchId=${c.branchB}`))).body.series).toEqual([]);
    expect((await other.owner.agent.get(url('/finance/reports/trend'))).status).toBe(404);
    expect((await c.owner.agent.get(url('/finance/reports/trend?months=13'))).status).toBe(400);
  });
});
