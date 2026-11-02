import { randomUUID } from 'node:crypto';
import { type Page } from '@playwright/test';
import { expect, test, testNow } from './fixtures';
import { login, orgIdFromUrl, watchBrowserErrors } from './helpers';

// Connected ERP journeys (docs/ERP_EXECUTION_PLAN.md, milestone G) against the seeded synthetic
// demo organization, whose ledger starts on the first day of the seed month. Documents are created
// through the API with the signed-in session (as the pages do) and checked in the pages.

async function session(page: Page) {
  const res = await page.request.get('/api/v1/auth/session');
  return ((await res.json()) as { csrfToken: string }).csrfToken;
}
async function call<T>(page: Page, method: 'post' | 'put', url: string, body: object): Promise<T> {
  const csrf = await session(page);
  const res = await page.request[method](url, { data: body, headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': randomUUID() } });
  expect(res.ok(), `${method} ${url}: ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}
async function get<T>(page: Page, url: string): Promise<T> {
  const res = await page.request.get(url);
  expect(res.ok(), `${url}: ${res.status()}`).toBe(true);
  return (await res.json()) as T;
}

test('A: a patient visit is invoiced, collected and lands in balanced books', async ({ page }) => {
  test.slow();
  const errors = watchBrowserErrors(page);
  await login(page, 'owner.nour@demo.test');
  const orgId = orgIdFromUrl(page);
  const o = `/api/v1/orgs/${orgId}`;
  // A patient of its own, so other journeys' statements are not affected.
  const branches = await get<{ data: { id: string }[] }>(page, `${o}/branches`);
  const branchId = branches.data[0]!.id;
  const created = await call<{ patient: { id: string } }>(page, 'post', `${o}/patients`, {
    fullName: `مريض رحلة الحسابات ${randomUUID().slice(0, 6)}`,
    phone: { country: 'EG', number: `010${String(Date.now()).slice(-8)}` },
    branchId,
  });
  const patient = created.patient;
  const services = await get<{ data: { id: string; status: string }[] }>(page, `${o}/finance/services`);
  const charge = await call<{ charge: { id: string } }>(page, 'post', `${o}/finance/charges`, {
    patientId: patient.id,
    branchId,
    serviceId: services.data.find((s) => s.status === 'active')!.id,
  });
  const draft = await call<{ invoice: { id: string; version: number } }>(page, 'post', `${o}/finance/invoices`, {
    patientId: patient.id,
    branchId,
    chargeIds: [charge.charge.id],
  });
  const issued = await call<{ invoice: { id: string; number: string; total: number } }>(
    page,
    'post',
    `${o}/finance/invoices/${draft.invoice.id}/issue`,
    { version: draft.invoice.version },
  );
  const receipt = await call<{ payment: { number: string } }>(page, 'post', `${o}/finance/payments`, {
    patientId: patient.id,
    branchId,
    amount: issued.invoice.total,
    method: 'cash',
    allocations: [{ invoiceId: issued.invoice.id, amount: issued.invoice.total }],
  });

  await page.goto(`/app/${orgId}/accounting/entries`);
  const journal = page.getByTestId('journal-entries');
  await expect(journal).toContainText(issued.invoice.number);
  await expect(journal).toContainText(receipt.payment.number);
  await page.goto(`/app/${orgId}/accounting/reports`);
  await expect(page.getByTestId('trial-balance')).toBeVisible();
  await expect(page.getByText('متوازن', { exact: true })).toBeVisible();
  await page.goto(`/app/${orgId}/accounting`);
  await expect(page.getByRole('heading', { name: 'مطابقة الدفاتر الفرعية' })).toBeVisible();
  errors.expectNone();
});

test('B + C: supplies are requested, ordered, received into stock, billed and paid', async ({ page }) => {
  test.slow();
  const errors = watchBrowserErrors(page);
  await login(page, 'owner.nour@demo.test');
  const orgId = orgIdFromUrl(page);
  const o = `/api/v1/orgs/${orgId}`;
  const [items, warehouses, suppliers, boxes] = await Promise.all([
    get<{ items: { id: string; code: string; onHand: number }[] }>(page, `${o}/inventory/items`),
    get<{ warehouses: { id: string; branchId: string }[] }>(page, `${o}/inventory/warehouses`),
    get<{ suppliers: { id: string; code: string }[] }>(page, `${o}/purchasing/suppliers`),
    get<{ accounts: { id: string; kind: string }[] }>(page, `${o}/cash/accounts`),
  ]);
  const gloves = items.items.find((i) => i.code === 'GLV-M')!;
  const store = warehouses.warehouses[0]!;
  const supplier = suppliers.suppliers.find((s) => s.code === 'SUP-MED')!;
  const request = await call<{ request: { id: string; status: string; version: number } }>(page, 'post', `${o}/purchasing/requests`, {
    branchId: store.branchId,
    lines: [{ itemId: gloves.id, unit: 'box', qty: 2, unitPrice: 15000 }],
  });
  // The demo policy needs approval for every request; the owner approves a colleague's in real life —
  // here the owner raised it, so the separation rule is relaxed for this journey's organization.
  const settings = await get<{ settings: { version: number } }>(page, `${o}/purchasing/settings`);
  await call(page, 'put', `${o}/purchasing/settings`, {
    approvalThreshold: 100000,
    separation: { approve: false, receive: false, pay: false },
    version: settings.settings.version,
  });
  if (request.request.status === 'submitted')
    await call(page, 'post', `${o}/purchasing/requests/${request.request.id}/approve`, { version: request.request.version });
  const order = await call<{ order: { id: string; number: string; version: number } }>(page, 'post', `${o}/purchasing/orders`, {
    supplierId: supplier.id,
    branchId: store.branchId,
    warehouseId: store.id,
    requestId: request.request.id,
  });
  await call(page, 'post', `${o}/purchasing/orders/${order.order.id}/confirm`, { version: order.order.version });
  await call(page, 'post', `${o}/purchasing/orders/${order.order.id}/receipts`, { lines: [{ lineIndex: 0, qty: 1 }] });
  const bill = await call<{ bill: { id: string; number: string; total: number } }>(page, 'post', `${o}/purchasing/bills`, {
    supplierId: supplier.id,
    supplierReference: `E2E-${randomUUID().slice(0, 8)}`,
    orderId: order.order.id,
    billDate: testNow().toISOString().slice(0, 10),
    lines: [{ orderLineIndex: 0, qty: 1, unitPrice: 15000 }],
  });
  await call(page, 'post', `${o}/purchasing/payments`, {
    supplierId: supplier.id,
    cashAccountId: boxes.accounts.find((b) => b.kind === 'bank')!.id,
    amount: 5000,
    allocations: [{ billId: bill.bill.id, amount: 5000 }],
  });

  await page.goto(`/app/${orgId}/purchasing/orders/${order.order.id}`);
  await expect(page.getByTestId('order-lines')).toContainText('Examination gloves');
  await page.goto(`/app/${orgId}/purchasing/bills/${bill.bill.id}`);
  await expect(page.getByTestId('bill-balance')).toContainText('100');
  await page.goto(`/app/${orgId}/inventory/moves`);
  await expect(page.getByTestId('stock-moves')).toContainText('استلام مشتريات');
  await page.goto(`/app/${orgId}/purchasing/bills`);
  await expect(page.getByTestId('payables-aging')).toContainText('Synthetic Medical Supplies');
  const after = await get<{ items: { id: string; onHand: number }[] }>(page, `${o}/inventory/items`);
  expect(after.items.find((i) => i.id === gloves.id)!.onHand - gloves.onHand).toBe(100);
  errors.expectNone();
});

test('D: a cashier opens a session, takes cash, and closes with a counted amount', async ({ page }) => {
  test.slow();
  const errors = watchBrowserErrors(page);
  await login(page, 'reception.nour@demo.test');
  const orgId = orgIdFromUrl(page);
  await page.goto(`/app/${orgId}/cash`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('الخزينة والبنوك');
  const opened = page.getByRole('link', { name: 'العد والإقفال' });
  if (!(await opened.isVisible())) {
    await page.locator('#session-counted').fill('0');
    // Other journeys may have put cash in this cashbox: the count note explains any difference.
    await page.locator('#session-note').fill('E2E opening count');
    await page.getByRole('button', { name: 'فتح الوردية' }).click();
  }
  await page.getByRole('link', { name: 'العد والإقفال' }).first().click();
  await expect(page.getByTestId('session-expected')).toBeVisible();
  const expected = (await page.getByTestId('session-expected').textContent()) ?? '';
  // The amount only: the currency symbol has dots of its own.
  const amount = (expected.match(/\d[\d,]*(?:\.\d{1,2})?/)?.[0] ?? '0').replace(/,/g, '');
  await page.getByLabel('النقدية المعدودة عند الإقفال').fill(amount);
  await page.getByRole('button', { name: 'إقفال الوردية' }).click();
  await expect(page.getByText('تم إقفال الوردية.')).toBeVisible();
  errors.expectNone();
});
