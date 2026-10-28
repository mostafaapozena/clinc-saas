import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JournalEntryModel } from '../src/modules/accounting/accounting.model.js';
import { StockItemModel, StockMoveModel } from '../src/modules/inventory/inventory.model.js';
import { toBaseUnits } from '../src/modules/inventory/inventory.routes.js';
import { addMember, register, send, testApp, type Client } from './helpers/api.js';
import { TODAY, act, bookOk, buildClinic, createPatient, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// Inventory and medical consumables (docs/architecture/INVENTORY.md). Clock: 2026-11-10 (Cairo).
const MARK = 'SYNTHETIC-CLINICAL-TEXT';
const app = testApp();
let c: Clinic;
let accountant: Client;
let storeA: string;
let storeA2: string;
let storeB: string;
let gloves: string; // base unit "piece", box of 100, no lots
let anesthetic: string; // lot-tracked cartridges
const url = (path: string) => `/api/v1/orgs/${c.orgId}${path}`;
const withKey = (who: Client, path: string, body: object, key: string = randomUUID()) =>
  who.agent.post(url(path)).set('X-CSRF-Token', who.csrf).set('Idempotency-Key', key).send(body);
const op = (who: Client, body: object, key?: string) => withKey(who, '/inventory/operations', body, key);
const item = async (id: string) => (await StockItemModel.findOne({ organizationId: c.orgId, _id: id }).lean())!;
const ledger = async (code: string) => {
  const res = await accountant.agent.get(url('/accounting/accounts'));
  return (res.body.accounts as { code: string; balance: number }[]).find((a) => a.code === code)!.balance;
};

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('inventory');
  c = await buildClinic(app, 'inv');
  accountant = await register(app, 'inv-accountant');
  await addMember(c.owner, c.orgId, accountant, 'accountant');
  await send(c.owner, 'put', url('/finance/settings'), { currency: 'EGP' });
  expect((await send(c.owner, 'post', url('/accounting/setup'), { cutoverDate: '2026-11-01' })).status).toBe(201);
});
afterAll(() => dropTestDatabase());

describe('items and warehouses', () => {
  it('defines items with validated unit conversions and branch warehouses', async () => {
    expect(toBaseUnits({ baseUnit: 'piece', purchaseUnits: [{ unit: 'box', factor: 100 }] }, 3, 'box')).toBe(300);
    expect(() => toBaseUnits({ baseUnit: 'piece', purchaseUnits: [] }, 3, 'carton')).toThrow();
    const created = await send(c.admin, 'post', url('/inventory/items'), {
      code: 'glv-m',
      name: 'Examination gloves M',
      category: 'Disposables',
      baseUnit: 'piece',
      purchaseUnits: [{ unit: 'box', factor: 100 }],
      reorderLevel: 50,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    gloves = created.body.item.id;
    expect((await send(c.admin, 'post', url('/inventory/items'), { code: 'GLV-M', name: 'Again', baseUnit: 'piece' })).body.error.code).toBe(
      'ITEM_CODE_TAKEN',
    );
    expect(
      (
        await send(c.admin, 'post', url('/inventory/items'), {
          code: 'X1',
          name: 'Bad',
          baseUnit: 'piece',
          purchaseUnits: [{ unit: 'box', factor: 1 }],
        })
      ).status,
    ).toBe(400);
    anesthetic = (
      await send(c.owner, 'post', url('/inventory/items'), {
        code: 'ANS-2',
        name: 'Local anesthetic cartridge',
        baseUnit: 'cartridge',
        tracking: 'lot',
        reorderLevel: 10,
      })
    ).body.item.id;
    expect((await send(c.receptionist, 'post', url('/inventory/items'), { code: 'NO', name: 'No', baseUnit: 'piece' })).status).toBe(403);

    storeA = (await send(c.admin, 'post', url('/inventory/warehouses'), { name: 'Store A', branchId: c.branchA })).body.warehouse.id;
    storeA2 = (await send(c.admin, 'post', url('/inventory/warehouses'), { name: 'Treatment room A', branchId: c.branchA })).body.warehouse.id;
    storeB = (await send(c.admin, 'post', url('/inventory/warehouses'), { name: 'Store B', branchId: c.branchB })).body.warehouse.id;
    const seenByB = await c.receptionistB.agent.get(url('/inventory/warehouses'));
    expect(seenByB.body.warehouses.map((w: { id: string }) => w.id)).toEqual([storeB]);
  });
});

describe('valuation and movements', () => {
  it('values stock at moving weighted average without rounding drift, and posts to the ledger', async () => {
    // ERPNext's published example: 10 @ 1.00 then 20 @ 1.20 → 30 worth 34.00; issue 15 → 17.00.
    expect((await op(c.admin, { type: 'opening', warehouseId: storeA, lines: [{ itemId: gloves, qty: 10, unitCost: 100 }] })).status).toBe(201);
    expect((await op(c.admin, { type: 'opening', warehouseId: storeA, lines: [{ itemId: gloves, qty: 20, unitCost: 120 }] })).status).toBe(201);
    expect(await item(gloves)).toMatchObject({ onHand: 30, stockValue: 3400 });
    const issued = await op(c.admin, { type: 'issue', warehouseId: storeA, lines: [{ itemId: gloves, qty: 15 }], reason: 'Front desk use' });
    expect(issued.status, JSON.stringify(issued.body)).toBe(201);
    expect(issued.body.document.totalValue).toBe(1700);
    // A third of the rest, then the remainder: values add up exactly to what was received.
    await op(c.admin, { type: 'issue', warehouseId: storeA, lines: [{ itemId: gloves, qty: 7 }], reason: 'Front desk use' });
    await op(c.admin, { type: 'issue', warehouseId: storeA, lines: [{ itemId: gloves, qty: 8 }], reason: 'Front desk use' });
    expect(await item(gloves)).toMatchObject({ onHand: 0, stockValue: 0 });
    const out = await StockMoveModel.find({ organizationId: c.orgId, itemId: gloves, qty: { $lt: 0 } }).lean();
    expect(out.reduce((s, m) => s + m.value, 0)).toBe(-3400);
    // Ledger: inventory back to zero; consumables used = 34.00; opening balances = 34.00.
    expect(await ledger('1300')).toBe(0);
    expect(await ledger('5100')).toBe(3400);
    expect(await ledger('3900')).toBe(3400);
  });

  it('never goes below zero, even with concurrent issues', async () => {
    await op(c.admin, { type: 'opening', warehouseId: storeA, lines: [{ itemId: gloves, qty: 1, unit: 'box', unitCost: 10000 }] }); // 100 pieces
    expect(
      (await op(c.admin, { type: 'issue', warehouseId: storeA, lines: [{ itemId: gloves, qty: 101 }], reason: 'Too many' })).body.error.code,
    ).toBe('INSUFFICIENT_STOCK');
    const results = await Promise.all([
      op(c.admin, { type: 'issue', warehouseId: storeA, lines: [{ itemId: gloves, qty: 60 }], reason: 'Race one' }),
      op(c.owner, { type: 'issue', warehouseId: storeA, lines: [{ itemId: gloves, qty: 60 }], reason: 'Race two' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await item(gloves)).onHand).toBe(40);
    // Idempotent replays.
    const key = randomUUID();
    const body = { type: 'issue', warehouseId: storeA, lines: [{ itemId: gloves, qty: 1 }], reason: 'Replay' };
    const first = await op(c.admin, body, key);
    const again = await op(c.admin, body, key);
    expect(again.body.document.id).toBe(first.body.document.id);
    expect((await item(gloves)).onHand).toBe(39);
  });

  it('tracks lots and expiry, picks first-expiring-first, and keeps expired lots for write-off only', async () => {
    expect(
      (await op(c.admin, { type: 'opening', warehouseId: storeA, lines: [{ itemId: anesthetic, qty: 5, unitCost: 2000 }] })).body.error.fields,
    ).toEqual({ lot: 'lot_and_expiry_required' });
    const opened = await op(c.admin, {
      type: 'opening',
      warehouseId: storeA,
      lines: [
        { itemId: anesthetic, qty: 4, lot: 'L-OLD', expiry: '2026-11-05', unitCost: 2000 },
        { itemId: anesthetic, qty: 5, lot: 'L-LATE', expiry: '2027-06-01', unitCost: 2000 },
        { itemId: anesthetic, qty: 3, lot: 'L-SOON', expiry: '2026-12-15', unitCost: 2000 },
      ],
    });
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    expect(
      (
        await op(c.admin, {
          type: 'opening',
          warehouseId: storeA,
          lines: [{ itemId: anesthetic, qty: 1, lot: 'L-SOON', expiry: '2027-01-01', unitCost: 2000 }],
        })
      ).body.error.code,
    ).toBe('LOT_EXPIRY_MISMATCH');
    // FEFO skips the expired lot: 3 from L-SOON, then 1 from L-LATE.
    const issued = await op(c.admin, { type: 'issue', warehouseId: storeA, lines: [{ itemId: anesthetic, qty: 4 }], reason: 'Clinic use' });
    const moves = await StockMoveModel.find({ organizationId: c.orgId, documentId: issued.body.document.id }).lean();
    expect(moves.map((m) => [m.lot, m.qty])).toEqual([
      ['L-SOON', -3],
      ['L-LATE', -1],
    ]);
    expect(
      (await op(c.admin, { type: 'issue', warehouseId: storeA, lines: [{ itemId: anesthetic, qty: 1, lot: 'L-OLD' }], reason: 'Use expired' })).body
        .error.code,
    ).toBe('LOT_EXPIRED');
    expect(
      (await op(c.admin, { type: 'write_off', warehouseId: storeA, lines: [{ itemId: anesthetic, qty: 4, lot: 'L-OLD' }], reason: 'Expired' }))
        .status,
    ).toBe(201);
    const alerts = await c.admin.agent.get(url('/inventory/alerts'));
    expect(alerts.body.expiring.map((b: { lot: string }) => b.lot)).toEqual([]);
    expect(alerts.body.reorder.map((r: { code: string }) => r.code)).toContain('ANS-2');
    expect(await ledger('5300')).toBe(8000); // the write-off
  });

  it('transfers between warehouses without a ledger entry, and adjusts to a count', async () => {
    const entriesBefore = await JournalEntryModel.countDocuments({ organizationId: c.orgId });
    const t = await op(c.admin, { type: 'transfer', warehouseId: storeA, toWarehouseId: storeA2, lines: [{ itemId: anesthetic, qty: 2 }] });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect(await JournalEntryModel.countDocuments({ organizationId: c.orgId })).toBe(entriesBefore);
    const room = await c.admin.agent.get(url('/inventory/balances')).query({ warehouseId: storeA2 });
    expect(room.body.balances).toEqual([expect.objectContaining({ lot: 'L-LATE', qty: 2, expiry: '2027-06-01' })]);
    // Branch-restricted users cannot move stock of other branches.
    expect((await op(c.receptionistB, { type: 'issue', warehouseId: storeA, lines: [{ itemId: gloves, qty: 1 }], reason: 'Nope' })).status).toBe(403);
    // Count: 30 gloves found where the system says 39 → 9 out at the average cost.
    const count = await op(c.admin, { type: 'adjustment', warehouseId: storeA, lines: [{ itemId: gloves, counted: 30 }], reason: 'Monthly count' });
    expect(count.status, JSON.stringify(count.body)).toBe(201);
    expect((await item(gloves)).onHand).toBe(30);
    expect(
      (await op(c.admin, { type: 'adjustment', warehouseId: storeA, lines: [{ itemId: gloves, counted: 30 }], reason: 'Again' })).body.error.code,
    ).toBe('NO_DIFFERENCE');
    // Inventory in the ledger equals the items' value.
    const items = await StockItemModel.find({ organizationId: c.orgId }).lean();
    expect(await ledger('1300')).toBe(items.reduce((s, i) => s + i.stockValue, 0));
  });

  it('shows values only to roles allowed to see costs', async () => {
    const asDoctor = await c.doctor.agent.get(url('/inventory/items'));
    expect(asDoctor.status).toBe(200);
    expect(asDoctor.body.items[0].stockValue).toBeUndefined();
    const asAccountant = await accountant.agent.get(url('/inventory/items'));
    expect(asAccountant.body.items[0].stockValue).toBeTypeOf('number');
    expect((await c.viewer.agent.get(url('/inventory/items'))).status).toBe(403);
  });
});

describe('consumption from a performed visit', () => {
  it('lets the treating doctor record materials once on a finalized record, and return them by a linked document', async () => {
    const patient = await createPatient(c.receptionist, c.orgId, c.branchA);
    const date = DateTime.fromISO(TODAY).plus({ days: 1 }).toISODate()!;
    vi.restoreAllMocks();
    pinClock(`${date}T05:00:00.000Z`);
    let a = await bookOk(c.owner, c.orgId, { patientId: patient, practitionerId: c.practitioner, branchId: c.branchA, date, time: '09:00' });
    for (const [action, actor] of [
      ['check_in', c.receptionist],
      ['start', c.doctor],
    ] as const)
      a = (await act(actor, c.orgId, a.id, action, a.version)).body.appointment;
    const started = await withKey(c.doctor, `/appointments/${a.id}/encounter`, {
      sections: { reason: `${MARK} reason` },
      specialtyData: {
        procedures: [{ id: 'pr-222222', tooth: '16', description: `${MARK} filling` }],
        planItems: [{ id: 'pl-222222', tooth: '17', description: `${MARK} crown` }],
      },
    });
    const encounterId = started.body.encounter.id as string;
    const body = { encounterId, recordItemId: 'pr-222222', warehouseId: storeA2, lines: [{ itemId: anesthetic, qty: 1 }], confirm: true };
    // A draft (not yet performed) consumes nothing; plan items are not procedures.
    expect((await withKey(c.doctor, '/inventory/consumptions', body)).body.error.code).toBe('RECORD_NOT_FINALIZED');
    const saved = await send(c.doctor, 'put', url(`/encounters/${encounterId}`), {
      sections: { reason: `${MARK} reason`, plan: `${MARK} plan` },
      version: started.body.encounter.version,
    });
    expect((await withKey(c.doctor, `/encounters/${encounterId}/finalize`, { version: saved.body.encounter.version })).status).toBe(201);
    expect((await withKey(c.doctor, '/inventory/consumptions', { ...body, recordItemId: 'pl-222222' })).body.error.fields).toEqual({
      recordItemId: 'invalid_reference',
    });
    expect((await withKey(c.doctor2, '/inventory/consumptions', body)).status).toBe(404);
    expect((await withKey(c.admin, '/inventory/consumptions', body)).status).toBe(403);
    expect((await withKey(c.doctor, '/inventory/consumptions', { ...body, warehouseId: storeB })).status).toBe(400);

    const [one, two] = await Promise.all([withKey(c.doctor, '/inventory/consumptions', body), withKey(c.doctor, '/inventory/consumptions', body)]);
    expect([one.status, two.status].sort()).toEqual([201, 409]);
    const doc = (one.status === 201 ? one : two).body.document;
    expect(doc.totalValue).toBeUndefined(); // doctors see no costs
    const listed = await c.doctor.agent.get(url('/inventory/consumptions')).query({ encounterId });
    expect(listed.body.consumptions).toHaveLength(1);
    expect(JSON.stringify(await StockMoveModel.find({ organizationId: c.orgId }).lean())).not.toContain(MARK);

    const ret = await withKey(c.doctor, `/inventory/consumptions/${doc.id}/return`, { reason: 'Not used after all' });
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    expect((await withKey(c.doctor, `/inventory/consumptions/${doc.id}/return`, { reason: 'Twice' })).body.error.code).toBe('ALREADY_RETURNED');
    // After the return the item can be recorded again.
    expect((await withKey(c.doctor, '/inventory/consumptions', body)).status).toBe(201);
    const entries = await JournalEntryModel.find({
      organizationId: c.orgId,
      'source.type': 'stock',
      'source.event': { $in: ['consumption', 'consumption_return'] },
    }).lean();
    expect(entries).toHaveLength(3);
    vi.restoreAllMocks();
    pinClock();
  });
});
