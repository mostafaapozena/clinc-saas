import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StockItemModel } from '../src/modules/inventory/inventory.model.js';
import { SupplierBillModel } from '../src/modules/purchasing/purchasing.model.js';
import { addMember, register, send, testApp, type Client } from './helpers/api.js';
import { buildClinic, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// Suppliers, purchasing and payables (docs/architecture/PURCHASING.md): the whole chain from a
// request to a payment, with 3-way matching, segregation of duties and the ledger. Synthetic data.
const app = testApp();
let c: Clinic;
let accountant: Client;
let store: string;
let gloves: string;
let s1: string;
let s2: string;
let bigRequest: string;
let order: { id: string; version: number; lines: { qty: number }[] };
let bill: { id: string; total: number };
const url = (path: string) => `/api/v1/orgs/${c.orgId}${path}`;
const post = (who: Client, path: string, body: object, key: string = randomUUID()) =>
  who.agent.post(url(path)).set('X-CSRF-Token', who.csrf).set('Idempotency-Key', key).send(body);
const balances = async () =>
  new Map(
    ((await accountant.agent.get(url('/accounting/accounts'))).body.accounts as { code: string; balance: number }[]).map((a) => [a.code, a.balance]),
  );
let acct: Map<string, string>;

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('purchasing');
  c = await buildClinic(app, 'pur');
  accountant = await register(app, 'pur-accountant');
  await addMember(c.owner, c.orgId, accountant, 'accountant');
  await send(c.owner, 'put', url('/finance/settings'), { currency: 'EGP' });
  await send(c.owner, 'post', url('/accounting/setup'), { cutoverDate: '2026-11-01' });
  acct = new Map(
    ((await accountant.agent.get(url('/accounting/accounts'))).body.accounts as { id: string; code: string }[]).map((a) => [a.code, a.id]),
  );
  store = (await send(c.admin, 'post', url('/inventory/warehouses'), { name: 'Store A', branchId: c.branchA })).body.warehouse.id;
  gloves = (
    await send(c.admin, 'post', url('/inventory/items'), {
      code: 'GLV',
      name: 'Gloves',
      baseUnit: 'piece',
      purchaseUnits: [{ unit: 'box', factor: 100 }],
    })
  ).body.item.id;
  // Approval above 1,000.00; the requester may not approve their own request (default).
  const s = (await c.owner.agent.get(url('/purchasing/settings'))).body.settings;
  expect(
    (
      await send(c.owner, 'put', url('/purchasing/settings'), {
        approvalThreshold: 100000,
        separation: { approve: true, receive: false, pay: true },
        version: s.version,
      })
    ).status,
  ).toBe(200);
});
afterAll(() => dropTestDatabase());

describe('suppliers and requests', () => {
  it('keeps a supplier list and approves requests by threshold with segregation of duties', async () => {
    s1 = (await send(accountant, 'post', url('/purchasing/suppliers'), { code: 'med-1', name: 'Medical Supplies One', paymentTermsDays: 30 })).body
      .supplier.id;
    s2 = (await send(c.admin, 'post', url('/purchasing/suppliers'), { code: 'MED-2', name: 'Medical Supplies Two' })).body.supplier.id;
    expect((await send(c.admin, 'post', url('/purchasing/suppliers'), { code: 'MED-1', name: 'Again' })).body.error.code).toBe('SUPPLIER_CODE_TAKEN');
    expect((await send(c.receptionist, 'post', url('/purchasing/suppliers'), { code: 'X', name: 'Nope' })).status).toBe(403);

    // Small request by a doctor: approved by policy, visible to the doctor only among their own.
    const small = await post(c.doctor, '/purchasing/requests', {
      branchId: c.branchA,
      reason: 'Running low',
      lines: [{ itemId: gloves, unit: 'box', qty: 2, unitPrice: 15000 }],
    });
    expect(small.status, JSON.stringify(small.body)).toBe(201);
    expect(small.body.request).toMatchObject({ status: 'approved', estimatedTotal: 30000, decision: { automatic: true } });
    const big = await post(c.receptionist, '/purchasing/requests', {
      branchId: c.branchA,
      lines: [{ itemId: gloves, unit: 'box', qty: 10, unitPrice: 15000 }],
    });
    expect(big.body.request.status).toBe('submitted');
    bigRequest = big.body.request.id;
    const mine = await c.doctor.agent.get(url('/purchasing/requests'));
    expect(mine.body.requests.map((r: { id: string }) => r.id)).toEqual([small.body.request.id]);

    expect((await send(c.receptionist, 'post', url(`/purchasing/requests/${bigRequest}/approve`), { version: 0 })).status).toBe(403);
    const own = await post(c.admin, '/purchasing/requests', {
      branchId: c.branchA,
      lines: [{ description: 'Autoclave service', qty: 1, unitPrice: 200000 }],
    });
    expect((await send(c.admin, 'post', url(`/purchasing/requests/${own.body.request.id}/approve`), { version: 0 })).body.error.code).toBe(
      'SEPARATION_OF_DUTIES',
    );
    expect(
      (await send(c.owner, 'post', url(`/purchasing/requests/${own.body.request.id}/reject`), { version: 0, reason: 'Not this month' })).body.request
        .status,
    ).toBe('rejected');
    expect((await send(c.admin, 'post', url(`/purchasing/requests/${bigRequest}/approve`), { version: 0 })).body.request.status).toBe('approved');
    // Branch B staff do not see branch A requests.
    expect((await c.receptionistB.agent.get(url('/purchasing/requests'))).body.requests).toEqual([]);
  });
});

describe('quotations and orders', () => {
  it('compares supplier quotations and orders from the chosen one', async () => {
    const rfq = await post(c.admin, '/purchasing/rfqs', { requestId: bigRequest, supplierIds: [s1, s2] });
    expect(rfq.status, JSON.stringify(rfq.body)).toBe(201);
    const rfqId = rfq.body.rfq.id;
    const quote = (supplierId: string, unitPrice: number, leadTimeDays: number) =>
      send(c.admin, 'put', url(`/purchasing/rfqs/${rfqId}/quotations`), { supplierId, lines: [{ lineIndex: 0, unitPrice, qty: 10, leadTimeDays }] });
    expect((await quote(s1, 14000, 7)).status).toBe(200);
    expect((await quote(s2, 15000, 2)).status).toBe(200);
    const other = (await send(c.admin, 'post', url('/purchasing/suppliers'), { code: 'MED-3', name: 'Not invited' })).body.supplier.id;
    expect((await quote(other, 1, 1)).status).toBe(400);
    const detail = await c.admin.agent.get(url(`/purchasing/rfqs/${rfqId}`));
    expect(detail.body.comparison[0]).toMatchObject({ bestPrice: s1, fastest: s2 });
    expect(detail.body.totals.find((t: { supplierId: string }) => t.supplierId === s1).total).toBe(140000);

    // A direct order above the threshold needs an approved request.
    expect(
      (
        await post(accountant, '/purchasing/orders', {
          supplierId: s2,
          branchId: c.branchA,
          warehouseId: store,
          lines: [{ itemId: gloves, unit: 'box', qty: 10, unitPrice: 15000 }],
        })
      ).body.error.code,
    ).toBe('APPROVAL_REQUIRED');
    const quotationId = detail.body.quotations.find((q: { supplierId: string }) => q.supplierId === s1).id;
    expect((await post(accountant, '/purchasing/orders', { supplierId: s1, branchId: c.branchA, quotationId })).body.error.fields).toEqual({
      warehouseId: 'required',
    });
    const created = await post(accountant, '/purchasing/orders', { supplierId: s1, branchId: c.branchA, warehouseId: store, quotationId });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.order).toMatchObject({ status: 'draft', total: 140000, source: { requestId: bigRequest, rfqId } });
    expect(
      (await post(accountant, '/purchasing/orders', { supplierId: s1, branchId: c.branchA, warehouseId: store, quotationId })).body.error.code,
    ).toBe('RFQ_CLOSED');
    const confirmed = await send(accountant, 'post', url(`/purchasing/orders/${created.body.order.id}/confirm`), {
      version: created.body.order.version,
    });
    order = confirmed.body.order;
    expect(order).toMatchObject({ status: 'confirmed' });
    expect((await c.receptionistB.agent.get(url(`/purchasing/orders/${order.id}`))).status).toBe(404);
  });
});

describe('receipts, bills, payments, returns and credits', () => {
  it('receives in parts into stock at order price and bills only what was received', async () => {
    const r1 = await post(c.receptionist, `/purchasing/orders/${order.id}/receipts`, { lines: [{ lineIndex: 0, qty: 4 }] });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(await StockItemModel.findOne({ organizationId: c.orgId, _id: gloves }).lean()).toMatchObject({ onHand: 400, stockValue: 56000 });
    expect((await post(c.receptionist, `/purchasing/orders/${order.id}/receipts`, { lines: [{ lineIndex: 0, qty: 7 }] })).body.error.code).toBe(
      'OVER_RECEIPT',
    );
    let b = await balances();
    expect(b.get('1300')).toBe(56000);
    expect(b.get('2150')).toBe(56000); // goods received, not billed

    const billBody = {
      supplierId: s1,
      supplierReference: 'S1-INV-77',
      orderId: order.id,
      billDate: '2026-11-10',
      lines: [{ orderLineIndex: 0, qty: 5, unitPrice: 14500 }],
    };
    expect((await post(accountant, '/purchasing/bills', billBody)).body.error.code).toBe('OVER_BILLING');
    const billed = await post(accountant, '/purchasing/bills', { ...billBody, lines: [{ orderLineIndex: 0, qty: 4, unitPrice: 14500 }] });
    expect(billed.status, JSON.stringify(billed.body)).toBe(201);
    bill = billed.body.bill;
    expect(billed.body.bill).toMatchObject({ status: 'posted', total: 58000, dueDate: '2026-12-10' });
    expect(
      (await post(accountant, '/purchasing/bills', { ...billBody, lines: [{ orderLineIndex: 0, qty: 1, unitPrice: 14500 }] })).body.error.code,
    ).toBe('OVER_BILLING');
    b = await balances();
    expect(b.get('2150')).toBe(0);
    expect(b.get('2100')).toBe(58000); // supplier payables
    expect(b.get('5400')).toBe(2000); // price difference 5.00 × 4
  });

  it('returns unbilled goods at average cost and credits billed goods sent back', async () => {
    expect((await post(c.receptionist, `/purchasing/orders/${order.id}/receipts`, { lines: [{ lineIndex: 0, qty: 6 }] })).status).toBe(201);
    expect(
      (await post(c.receptionist, `/purchasing/orders/${order.id}/returns`, { lines: [{ lineIndex: 0, qty: 7 }], note: 'Too many' })).body.error.code,
    ).toBe('RETURN_EXCEEDS_UNBILLED');
    const ret = await post(c.receptionist, `/purchasing/orders/${order.id}/returns`, { lines: [{ lineIndex: 0, qty: 1 }], note: 'Damaged box' });
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    expect((await StockItemModel.findOne({ organizationId: c.orgId, _id: gloves }).lean())!.onHand).toBe(900);
    const credit = await post(accountant, `/purchasing/bills/${bill.id}/credits`, {
      supplierReference: 'S1-CN-1',
      lines: [{ billLineIndex: 0, qty: 1 }],
      reason: 'Wrong size box',
    });
    expect(credit.status, JSON.stringify(credit.body)).toBe(201);
    expect(credit.body.credit.amount).toBe(14500);
    expect((await StockItemModel.findOne({ organizationId: c.orgId, _id: gloves }).lean())!.onHand).toBe(800);
    const detail = await accountant.agent.get(url(`/purchasing/bills/${bill.id}`));
    expect(detail.body.bill.balance).toBe(58000 - 14500);
  });

  it('pays bills partly from cash or bank, never over the balance, with segregation of duties', async () => {
    const bank = (await accountant.agent.get(url('/cash/accounts'))).body.accounts.find((a: { kind: string }) => a.kind === 'bank').id;
    const cashbox = (await accountant.agent.get(url('/cash/accounts'))).body.accounts.find((a: { kind: string }) => a.kind === 'cash').id;
    const pay = (who: Client, amount: number, cashAccountId = bank) =>
      post(who, '/purchasing/payments', { supplierId: s1, cashAccountId, amount, allocations: [{ billId: bill.id, amount }] });
    // The accountant recorded the bill and the policy separates paying.
    expect((await pay(accountant, 30000)).body.error.code).toBe('SEPARATION_OF_DUTIES');
    expect((await pay(c.owner, 30000, cashbox)).body.error.code).toBe('INSUFFICIENT_CASH');
    expect((await pay(c.owner, 99999)).body.error.code).toBe('OVER_PAYMENT');
    const paid = await pay(c.owner, 30000);
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    const b = await balances();
    expect(b.get('2100')).toBe(58000 - 14500 - 30000);
    expect(b.get('1120')).toBe(-30000);
    expect((await pay(c.admin, 1000)).status).toBe(403);
  });

  it('routes direct expense bills above the threshold through approval', async () => {
    const rent = {
      supplierId: s2,
      supplierReference: 'RENT-NOV',
      branchId: c.branchA,
      billDate: '2026-11-05',
      lines: [{ description: 'November rent', qty: 1, unitPrice: 500000, expenseAccountId: acct.get('6100') }],
    };
    const created = await post(accountant, '/purchasing/bills', rent);
    expect(created.body.bill.status).toBe('awaiting_approval');
    expect((await balances()).get('6100')).toBe(0);
    expect((await send(accountant, 'post', url(`/purchasing/bills/${created.body.bill.id}/approve`), { decision: 'approve' })).status).toBe(403);
    expect((await send(c.admin, 'post', url(`/purchasing/bills/${created.body.bill.id}/approve`), { decision: 'approve' })).body.bill.status).toBe(
      'posted',
    );
    expect((await balances()).get('6100')).toBe(500000);
    const small = await post(accountant, '/purchasing/bills', {
      ...rent,
      supplierReference: 'WATER-NOV',
      lines: [{ description: 'Water', qty: 1, unitPrice: 5000, expenseAccountId: acct.get('6300') }],
    });
    expect(small.body.bill.status).toBe('posted');
    expect((await post(accountant, '/purchasing/bills', { ...rent, lines: [{ description: 'No account', qty: 1, unitPrice: 100 }] })).status).toBe(
      400,
    );
  });

  it('agrees the payables ledger with open bills, and the books balance', async () => {
    const aging = await accountant.agent.get(url('/purchasing/reports/payables-aging'));
    expect(aging.status).toBe(200);
    const open = (await SupplierBillModel.find({ organizationId: c.orgId, status: 'posted' }).lean()).reduce(
      (s, b) => s + b.total - b.paid - b.credited,
      0,
    );
    expect(aging.body.total).toBe(open);
    expect((await balances()).get('2100')).toBe(open);
    const tb = await accountant.agent.get(url('/accounting/reports/trial-balance')).query({ from: '2026-11-01', to: '2026-11-30' });
    expect(tb.body.balanced).toBe(true);
    // Ledger inventory equals the items' value after receipts, returns and credits.
    const items = await StockItemModel.find({ organizationId: c.orgId }).lean();
    expect((await balances()).get('1300')).toBe(items.reduce((s, i) => s + i.stockValue, 0));
    // Another organization cannot reach these documents.
    const other = await register(app, 'pur-other');
    const org2 = (await send(other, 'post', '/api/v1/orgs', { name: 'Other', timeZone: 'Africa/Cairo', branch: { name: 'Main' } })).body.organization
      .id;
    expect((await other.agent.get(`/api/v1/orgs/${org2}/purchasing/orders/${order.id}`)).status).toBe(404);
  });
});
