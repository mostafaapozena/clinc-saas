import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scheduleState } from '../src/modules/installments/installments.model.js';
import { send, testApp, type Client } from './helpers/api.js';
import { buildClinic, createPatient, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// Installment plans, rescheduling and bad-debt write-offs (docs/architecture/INSTALLMENTS.md).
// Clock: 2026-11-10 (Cairo).
const app = testApp();
let c: Clinic;
let patient: string;
let service: string;
const url = (path: string, org = c.orgId) => `/api/v1/orgs/${org}${path}`;
const withKey = (who: Client, path: string, body: object, key: string = randomUUID()) =>
  who.agent.post(url(path)).set('X-CSRF-Token', who.csrf).set('Idempotency-Key', key).send(body);
const balance = async (key: string) =>
  ((await c.owner.agent.get(url('/accounting/accounts'))).body.accounts as { templateKey: string; balance: number }[]).find(
    (a) => a.templateKey === key,
  )?.balance ?? 0;

async function issuedInvoice(quantity: number) {
  const ch = await withKey(c.receptionist, '/finance/charges', { patientId: patient, branchId: c.branchA, serviceId: service, quantity });
  const draft = await send(c.receptionist, 'post', url('/finance/invoices'), {
    patientId: patient,
    branchId: c.branchA,
    chargeIds: [ch.body.charge.id],
  });
  const issued = await withKey(c.receptionist, `/finance/invoices/${draft.body.invoice.id}/issue`, { version: draft.body.invoice.version });
  expect(issued.status, JSON.stringify(issued.body)).toBe(200);
  return issued.body.invoice as { id: string; total: number };
}
const pay = (amount: number, invoiceId: string) =>
  withKey(c.receptionist, '/finance/payments', {
    patientId: patient,
    branchId: c.branchA,
    amount,
    method: 'card',
    allocations: [{ invoiceId, amount }],
  });

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('installments');
  c = await buildClinic(app, 'installments');
  await send(c.owner, 'put', url('/finance/settings'), { currency: 'EGP' });
  await send(c.owner, 'post', url('/accounting/setup'), { cutoverDate: '2026-11-01' });
  service = (await send(c.owner, 'post', url('/finance/services'), { code: 'IMPL', name: 'Implant (synthetic)', price: 300_000 })).body.service.id;
  patient = await createPatient(c.receptionist, c.orgId, c.branchA);
});
afterAll(() => dropTestDatabase());

describe('schedule state', () => {
  it('applies what was settled to the installments in date order', () => {
    const s = [
      { dueDate: '2026-11-01', amount: 100 },
      { dueDate: '2026-12-01', amount: 100 },
      { dueDate: '2027-01-01', amount: 100 },
    ];
    expect(scheduleState(s, 150, '2026-12-15').map((i) => i.state)).toEqual(['paid', 'overdue', 'due']);
    expect(scheduleState(s, 150, '2026-11-15').map((i) => i.state)).toEqual(['paid', 'partial', 'due']);
  });
});

describe('installment plans', () => {
  let invoice: { id: string; total: number };
  let plan: { id: string; version: number };
  it('schedules exactly the open balance of an issued invoice, once', async () => {
    invoice = await issuedInvoice(3); // 9,000.00
    await pay(100_000, invoice.id);
    const bad = await send(c.receptionist, 'post', url('/finance/installment-plans'), {
      invoiceId: invoice.id,
      schedule: [
        { dueDate: '2026-11-20', amount: 400_000 },
        { dueDate: '2026-12-20', amount: 300_000 },
      ],
    });
    expect(bad.body.error.fields).toEqual({ schedule: 'must_equal_open_balance' });
    const backwards = await send(c.receptionist, 'post', url('/finance/installment-plans'), {
      invoiceId: invoice.id,
      schedule: [
        { dueDate: '2026-12-20', amount: 400_000 },
        { dueDate: '2026-11-20', amount: 400_000 },
      ],
    });
    expect(backwards.body.error.fields).toEqual({ schedule: 'dates_not_increasing_from_today' });
    const created = await send(c.receptionist, 'post', url('/finance/installment-plans'), {
      invoiceId: invoice.id,
      schedule: [
        { dueDate: '2026-11-20', amount: 400_000 },
        { dueDate: '2026-12-20', amount: 400_000 },
      ],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.plan).toMatchObject({ total: 800_000, settled: 0, remaining: 800_000, status: 'active' });
    plan = created.body.plan;
    expect(
      (
        await send(c.receptionist, 'post', url('/finance/installment-plans'), {
          invoiceId: invoice.id,
          schedule: [{ dueDate: '2026-11-20', amount: 800_000 }],
        })
      ).body.error.code,
    ).toBe('PLAN_EXISTS');
    expect((await c.receptionistB.agent.get(url(`/finance/installment-plans/${plan.id}`))).status).toBe(404);
  });

  it('follows the receipts allocated to the invoice', async () => {
    await pay(500_000, invoice.id);
    const view = await c.receptionist.agent.get(url(`/finance/installment-plans/${plan.id}`));
    expect(view.body.plan).toMatchObject({ settled: 500_000, remaining: 300_000 });
    expect(view.body.plan.schedule.map((i: { state: string }) => i.state)).toEqual(['paid', 'partial']);
    expect(view.body.plan.nextDue).toMatchObject({ dueDate: '2026-12-20', covered: 100_000 });
  });

  it('reschedules what is left and keeps the replaced schedule', async () => {
    const current = (await c.receptionist.agent.get(url(`/finance/installment-plans/${plan.id}`))).body.plan;
    const moved = await send(c.receptionist, 'post', url(`/finance/installment-plans/${plan.id}/reschedule`), {
      schedule: [
        { dueDate: '2027-01-15', amount: 150_000 },
        { dueDate: '2027-02-15', amount: 150_000 },
      ],
      reason: 'Patient asked for more time',
      version: current.version,
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.plan.schedule.map((i: { dueDate: string; state: string }) => [i.dueDate, i.state])).toEqual([
      ['2026-11-20', 'paid'],
      ['2026-12-20', 'paid'],
      ['2027-01-15', 'due'],
      ['2027-02-15', 'due'],
    ]);
    expect(moved.body.plan.revisions).toHaveLength(1);
    expect(moved.body.plan.remaining).toBe(300_000);
    plan = moved.body.plan;
  });

  it('lets only the owner write off what is left, posting it to bad debts once', async () => {
    const body = { amount: 300_000, reason: 'Patient relocated; agreed loss' };
    expect((await withKey(c.receptionist, `/finance/invoices/${invoice.id}/write-offs`, body)).status).toBe(403);
    expect((await withKey(c.owner, `/finance/invoices/${invoice.id}/write-offs`, { ...body, amount: 300_001 })).body.error.code).toBe('OVER_CREDIT');
    const key = randomUUID();
    const done = await withKey(c.owner, `/finance/invoices/${invoice.id}/write-offs`, body, key);
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body.writeOff.number).toBe('WO-2026-000001');
    expect((await withKey(c.owner, `/finance/invoices/${invoice.id}/write-offs`, body, key)).body.replayed).toBe(true);
    expect(await balance('badDebts')).toBe(300_000);
    const view = await c.receptionist.agent.get(url(`/finance/installment-plans/${plan.id}`));
    expect(view.body.plan).toMatchObject({ status: 'completed', remaining: 0 });
    const statement = await c.receptionist.agent.get(url(`/finance/patients/${patient}/statement`));
    expect(statement.body.entries.find((e: { type: string }) => e.type === 'write_off')).toMatchObject({ credit: 300_000, balance: 0 });
  });

  it('counts plans with a missed installment in Today’s focus', async () => {
    const other = await issuedInvoice(1);
    await send(c.receptionist, 'post', url('/finance/installment-plans'), {
      invoiceId: other.id,
      schedule: [{ dueDate: '2026-11-10', amount: 300_000 }],
    });
    expect((await c.receptionist.agent.get(url('/workspace/focus'))).body.installmentsOverdue).toBe(0);
    const list = await c.receptionist.agent.get(url('/finance/installment-plans?status=completed'));
    expect(list.body.plans).toHaveLength(1);
  });
});
