import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, register, send, testApp, type Client } from './helpers/api.js';
import { buildClinic, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// Equipment register and maintenance (docs/architecture/ASSETS.md). Clock: 2026-11-10 (Cairo).
const app = testApp();
let c: Clinic;
let accountant: Client;
let chair: { id: string; version: number };
const url = (path: string) => `/api/v1/orgs/${c.orgId}${path}`;
const ledger = async (code: string) =>
  ((await accountant.agent.get(url('/accounting/accounts'))).body.accounts as { code: string; balance: number }[]).find((a) => a.code === code)!
    .balance;

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('assets');
  c = await buildClinic(app, 'assets');
  accountant = await register(app, 'assets-accountant');
  await addMember(c.owner, c.orgId, accountant, 'accountant');
  await send(c.owner, 'put', url('/finance/settings'), { currency: 'EGP' });
  await send(c.owner, 'post', url('/accounting/setup'), { cutoverDate: '2026-10-01' });
});
afterAll(() => dropTestDatabase());

describe('equipment', () => {
  it('registers equipment bought through a supplier bill as a capitalized asset', async () => {
    const accounts = (await accountant.agent.get(url('/accounting/accounts'))).body.accounts as { id: string; code: string }[];
    const equipment = accounts.find((a) => a.code === '1510')!.id;
    const supplier = (await send(accountant, 'post', url('/purchasing/suppliers'), { code: 'EQ-1', name: 'Synthetic Equipment Co.' })).body.supplier
      .id;
    const bill = await accountant.agent
      .post(url('/purchasing/bills'))
      .set('X-CSRF-Token', accountant.csrf)
      .set('Idempotency-Key', randomUUID())
      .send({
        supplierId: supplier,
        supplierReference: 'EQ-INV-1',
        branchId: c.branchA,
        billDate: '2026-11-02',
        lines: [{ description: 'Dental chair', qty: 1, unitPrice: 4500000, expenseAccountId: equipment }],
      });
    expect(bill.status, JSON.stringify(bill.body)).toBe(201);
    // Every direct bill needs approval by default (threshold 0).
    expect((await send(c.owner, 'post', url(`/purchasing/bills/${bill.body.bill.id}/approve`), { decision: 'approve' })).status).toBe(200);
    expect(await ledger('1510')).toBe(4500000);

    const created = await send(c.admin, 'post', url('/assets'), {
      code: 'chair-1',
      name: 'Dental chair',
      category: 'Dental units',
      serialNumber: 'SN-0001',
      branchId: c.branchA,
      location: 'Room 1',
      purchase: { date: '2026-11-02', cost: 4500000, supplierId: supplier, billId: bill.body.bill.id },
      maintenanceIntervalDays: 180,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.asset).toMatchObject({ code: 'CHAIR-1', capitalized: true, nextMaintenanceDue: '2027-05-01', status: 'active' });
    chair = created.body.asset;
    expect((await send(c.admin, 'post', url('/assets'), { code: 'CHAIR-1', name: 'Again', branchId: c.branchA })).body.error.code).toBe(
      'ASSET_CODE_TAKEN',
    );
    expect((await send(c.doctor, 'post', url('/assets'), { code: 'X', name: 'Nope', branchId: c.branchA })).status).toBe(403);
    expect((await c.doctor.agent.get(url('/assets'))).body.assets).toHaveLength(1);
    expect((await c.receptionistB.agent.get(url(`/assets/${chair.id}`))).status).toBe(404);
  });

  it('keeps a maintenance log that drives the status and the next due date', async () => {
    const broken = await send(c.receptionist, 'post', url(`/assets/${chair.id}/maintenance`), {
      date: '2026-11-09',
      kind: 'corrective',
      description: 'Hydraulic pump fault',
      outOfService: true,
    });
    expect(broken.status, JSON.stringify(broken.body)).toBe(201);
    expect((await c.receptionist.agent.get(url(`/assets/${chair.id}`))).body.asset.status).toBe('out_of_service');
    const owner = await c.owner.agent.get(url('/workspace/focus'));
    expect(owner.body.equipment).toEqual({ maintenanceDue: 0, outOfService: 1 });
    expect(
      (await send(c.receptionist, 'post', url(`/assets/${chair.id}/maintenance`), { date: '2026-12-01', kind: 'preventive', description: 'Future' }))
        .status,
    ).toBe(400);
    await send(c.receptionist, 'post', url(`/assets/${chair.id}/maintenance`), {
      date: '2026-11-10',
      kind: 'corrective',
      description: 'Pump replaced',
      performedBy: 'Synthetic Equipment Co.',
    });
    const detail = await c.receptionist.agent.get(url(`/assets/${chair.id}`));
    expect(detail.body.asset).toMatchObject({ status: 'active', nextMaintenanceDue: '2027-05-09' });
    expect(detail.body.maintenance.map((m: { kind: string }) => m.kind)).toEqual(['corrective', 'corrective']);
    expect(
      (await send(c.doctor, 'post', url(`/assets/${chair.id}/maintenance`), { date: '2026-11-10', kind: 'inspection', description: 'No' })).status,
    ).toBe(403);
  });

  it('writes off the capitalized cost on disposal, never twice', async () => {
    const current = (await c.admin.agent.get(url(`/assets/${chair.id}`))).body.asset;
    const disposed = await send(c.admin, 'post', url(`/assets/${chair.id}/retire`), {
      disposal: true,
      reason: 'Beyond repair',
      version: current.version,
    });
    expect(disposed.status, JSON.stringify(disposed.body)).toBe(200);
    expect(disposed.body.asset.status).toBe('disposed');
    expect(await ledger('1510')).toBe(0);
    expect(await ledger('6990')).toBe(4500000);
    expect(
      (await send(c.admin, 'post', url(`/assets/${chair.id}/retire`), { disposal: true, reason: 'Again', version: disposed.body.asset.version })).body
        .error.code,
    ).toBe('ASSET_RETIRED');
    expect(
      (
        await send(c.receptionist, 'post', url(`/assets/${chair.id}/maintenance`), {
          date: '2026-11-10',
          kind: 'inspection',
          description: 'After disposal',
        })
      ).body.error.code,
    ).toBe('ASSET_RETIRED');
  });
});
