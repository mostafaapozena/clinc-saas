import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { monthlyAmount } from '../src/modules/assets/depreciation.routes.js';
import { addMember, register, send, testApp, type Client } from './helpers/api.js';
import { buildClinic, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// Straight-line depreciation (docs/architecture/ASSETS.md, milestone H4). Clock: 2026-11-10 (Cairo).
const app = testApp();
let c: Clinic;
let accountant: Client;
let unit: { id: string; version: number };
const url = (path: string) => `/api/v1/orgs/${c.orgId}${path}`;
const ledger = async (key: string) =>
  ((await accountant.agent.get(url('/accounting/accounts'))).body.accounts as { templateKey: string; balance: number }[]).find(
    (a) => a.templateKey === key,
  )?.balance ?? 0;

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('depreciation');
  c = await buildClinic(app, 'depreciation');
  accountant = await register(app, 'depreciation-accountant');
  await addMember(c.owner, c.orgId, accountant, 'accountant');
  await send(c.owner, 'put', url('/finance/settings'), { currency: 'EGP' });
  await send(c.owner, 'post', url('/accounting/setup'), { cutoverDate: '2026-10-01' });
  const accounts = (await accountant.agent.get(url('/accounting/accounts'))).body.accounts as { id: string; code: string }[];
  const supplier = (await send(accountant, 'post', url('/purchasing/suppliers'), { code: 'EQ-1', name: 'Synthetic Equipment Co.' })).body.supplier.id;
  const bill = await accountant.agent
    .post(url('/purchasing/bills'))
    .set('X-CSRF-Token', accountant.csrf)
    .set('Idempotency-Key', randomUUID())
    .send({
      supplierId: supplier,
      supplierReference: 'EQ-INV-9',
      branchId: c.branchA,
      billDate: '2026-10-02',
      lines: [{ description: 'Dental unit', qty: 1, unitPrice: 1_200_000, expenseAccountId: accounts.find((a) => a.code === '1510')!.id }],
    });
  await send(c.owner, 'post', url(`/purchasing/bills/${bill.body.bill.id}/approve`), { decision: 'approve' });
  unit = (
    await send(c.admin, 'post', url('/assets'), {
      code: 'UNIT-1',
      name: 'Dental unit',
      branchId: c.branchA,
      purchase: { date: '2026-10-02', cost: 1_200_000, supplierId: supplier, billId: bill.body.bill.id },
    })
  ).body.asset;
});
afterAll(() => dropTestDatabase());

describe('depreciation amounts', () => {
  it('splits evenly and puts the rounding in the last month', () => {
    expect([0, 1, 2].map((i) => monthlyAmount(1_000_000, 3, i))).toEqual([333_333, 333_333, 333_334]);
  });
});

describe('straight-line depreciation', () => {
  it('takes the accountant’s method inputs for capitalized equipment only', async () => {
    expect(
      (
        await send(c.admin, 'put', url(`/assets/${unit.id}/depreciation`), {
          usefulLifeMonths: 12,
          residualValue: 0,
          startMonth: '2026-10',
          version: unit.version,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send(accountant, 'put', url(`/assets/${unit.id}/depreciation`), {
          usefulLifeMonths: 12,
          residualValue: 1_200_000,
          startMonth: '2026-10',
          version: unit.version,
        })
      ).body.error.fields,
    ).toEqual({ residualValue: 'not_below_cost' });
    expect(
      (
        await send(accountant, 'put', url(`/assets/${unit.id}/depreciation`), {
          usefulLifeMonths: 12,
          residualValue: 0,
          startMonth: '2026-09',
          version: unit.version,
        })
      ).body.error.fields,
    ).toEqual({ startMonth: 'before_ledger' });
    const set = await send(accountant, 'put', url(`/assets/${unit.id}/depreciation`), {
      usefulLifeMonths: 12,
      residualValue: 0,
      startMonth: '2026-10',
      version: unit.version,
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.depreciation).toMatchObject({ monthly: 100_000, accumulated: 0, bookValue: 1_200_000, monthsPosted: 0 });
    const other = await send(c.admin, 'post', url('/assets'), { code: 'CHAIR-X', name: 'Not capitalized', branchId: c.branchA });
    expect(
      (
        await send(accountant, 'put', url(`/assets/${other.body.asset.id}/depreciation`), {
          usefulLifeMonths: 12,
          residualValue: 0,
          startMonth: '2026-10',
          version: 0,
        })
      ).body.error.code,
    ).toBe('ASSET_NOT_CAPITALIZED');
  });

  it('posts each ended month once, and never a month that has not ended', async () => {
    expect((await send(accountant, 'post', url('/assets/depreciation/run'), { month: '2026-11' })).body.error.fields).toEqual({ month: 'not_ended' });
    const schedule = await accountant.agent.get(url('/assets/depreciation/schedule'));
    expect(schedule.body.through).toBe('2026-10');
    expect(schedule.body.assets[0].due).toEqual([{ month: '2026-10', amount: 100_000 }]);
    const run = await send(accountant, 'post', url('/assets/depreciation/run'), { month: '2026-10' });
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ total: 100_000, results: [{ code: 'UNIT-1', months: 1, amount: 100_000 }] });
    expect((await send(accountant, 'post', url('/assets/depreciation/run'), { month: '2026-10' })).body.total).toBe(0);
    expect(await ledger('depreciationExpense')).toBe(100_000);
    expect(await ledger('accumulatedDepreciation')).toBe(-100_000);
    const detail = await c.admin.agent.get(url(`/assets/${unit.id}`));
    expect(detail.body.asset.depreciation).toMatchObject({ accumulated: 100_000, bookValue: 1_100_000, lastMonth: '2026-10', monthsPosted: 1 });
    // Once posted, the method is fixed.
    expect(
      (
        await send(accountant, 'put', url(`/assets/${unit.id}/depreciation`), {
          usefulLifeMonths: 24,
          residualValue: 0,
          startMonth: '2026-10',
          version: detail.body.asset.version,
        })
      ).body.error.code,
    ).toBe('DEPRECIATION_STARTED');
  });

  it('writes off the book value on disposal and clears the accumulated depreciation', async () => {
    const current = (await c.admin.agent.get(url(`/assets/${unit.id}`))).body.asset;
    const disposed = await send(c.admin, 'post', url(`/assets/${unit.id}/retire`), { disposal: true, reason: 'Replaced', version: current.version });
    expect(disposed.status, JSON.stringify(disposed.body)).toBe(200);
    expect(await ledger('medicalEquipment')).toBe(0);
    expect(await ledger('accumulatedDepreciation')).toBe(0);
    expect(await ledger('otherExpenses')).toBe(1_100_000);
    expect((await send(accountant, 'post', url('/assets/depreciation/run'), { month: '2026-10' })).body.total).toBe(0);
  });
});
