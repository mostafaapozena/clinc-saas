import { expect, test, type Page } from '@playwright/test';
import { login, orgIdFromUrl, watchBrowserErrors } from './helpers';

// Clinic finances against the seeded synthetic data (EGP catalog in demo-nour). Prices are examples.

async function patientId(page: Page, orgId: string, name: string) {
  const res = await page.request.get(`/api/v1/orgs/${orgId}/patients?q=${encodeURIComponent(name)}&status=active`);
  expect(res.ok()).toBe(true);
  const match = ((await res.json()) as { data: { id: string; fullName: string }[] }).data.find((p) => p.fullName === name);
  if (!match) throw new Error(`No patient ${name}`);
  return match.id;
}

async function chooseService(page: Page, selectId: string, text: string) {
  const value = await page.locator(`#${selectId} option`, { hasText: text }).first().getAttribute('value');
  if (!value) throw new Error(`No service ${text}`);
  await page.locator(`#${selectId}`).selectOption(value);
}

test('front desk: charge → invoice → issue → partial and full payment → statement → receipt', async ({ page }) => {
  test.slow();
  const errors = watchBrowserErrors(page);
  await login(page, 'reception.nour@demo.test');
  const orgId = orgIdFromUrl(page);
  const id = await patientId(page, orgId, 'فاطمة حسن');
  await page.goto(`/app/${orgId}/finance/patients/${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('فاطمة حسن');

  await chooseService(page, 'charge-service', 'جلسة علاج طبيعي');
  await page.getByRole('form', { name: 'إضافة رسم' }).getByRole('button', { name: 'إضافة رسم' }).click();
  const pending = page.getByTestId('pending-charges');
  await expect(pending).toContainText('جلسة علاج طبيعي');
  await pending.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'إنشاء فاتورة من المحدد' }).click();
  await page.getByTestId('invoice-list').getByRole('link', { name: 'مسودة فاتورة' }).click();

  await page.getByRole('button', { name: 'إصدار الفاتورة' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'نعم، أصدرها' }).click();
  await expect(page.getByTestId('invoice-status')).toHaveText('صادرة');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^INV-\d{4}-\d{6}$/);
  const total = await page.getByTestId('invoice-total').textContent();
  expect(total).toContain('400'); // Latin digits in the Arabic UI too

  await page.getByRole('link', { name: 'العودة إلى الحساب' }).click();
  const recordPayment = async (amount: string) => {
    await page.locator('#payment-amount').fill(amount);
    await page.getByRole('form', { name: 'تسجيل دفعة' }).getByRole('button', { name: 'تسجيل دفعة' }).click();
    await expect(page.getByText('سُجّلت الدفعة.')).toBeVisible();
  };
  await recordPayment('250');
  await expect(page.getByTestId('balance-outstanding')).toContainText('150');
  await recordPayment('١٥٠');
  await expect(page.getByTestId('balance-outstanding')).toContainText('0.00');
  await expect(page.getByTestId('statement').locator('tbody tr')).toHaveCount(3);

  await page.getByRole('link', { name: 'طباعة الإيصال' }).click();
  const receipt = page.getByTestId('print-document');
  await expect(receipt).toContainText('ليست فاتورة ضريبية ولا فاتورة إلكترونية.');
  await expect(receipt).toContainText(/RCPT-\d{4}-\d{6}/);
  errors.expectNone();
});

test('a doctor charges a recorded procedure; the accountant bills it without seeing clinical text', async ({ page, browser }) => {
  const errors = watchBrowserErrors(page);
  await login(page, 'doctor.nour@demo.test');
  const orgId = orgIdFromUrl(page);
  // Yesterday's finalized dental visit of Sara Adel (seeded with a procedure on tooth 26).
  const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - 86_400_000));
  const list = (await (await page.request.get(`/api/v1/orgs/${orgId}/appointments?from=${yesterday}&to=${yesterday}&status=completed`)).json()) as {
    data: { id: string; patient: { id: string; fullName: string } | null }[];
  };
  const visit = list.data.find((a) => a.patient?.fullName === 'Sara Adel');
  if (!visit) throw new Error('No completed visit for Sara Adel yesterday');
  await page.goto(`/app/${orgId}/appointments/${visit.id}/record`);
  const panel = page.getByTestId('clinical-charges');
  await panel.getByRole('button', { name: /إنشاء رسم لـ .*حشو تجميلي \(إجراء تجريبي\)/ }).click();
  const select = panel.locator('select').first();
  const value = await select.locator('option', { hasText: 'حشو تجميلي (سعر تجريبي)' }).getAttribute('value');
  await select.selectOption(value!);
  await panel.getByLabel('أؤكد أن هذا يجب أن يُحصَّل.').check();
  await panel.getByRole('button', { name: 'إنشاء الرسم' }).click();
  await expect(panel.getByText('رُسِّم: حشو تجميلي (سعر تجريبي)')).toBeVisible();

  const accountantContext = await browser.newContext();
  const accountant = await accountantContext.newPage();
  await login(accountant, 'accountant.nour@demo.test');
  await accountant.goto(`/app/${orgId}/finance/patients/${visit.patient!.id}`);
  await expect(accountant.getByTestId('pending-charges')).toContainText('حشو تجميلي (سعر تجريبي)');
  await expect(accountant.getByTestId('pending-charges')).toContainText('من إجراء مسجّل');
  await expect(accountant.locator('body')).not.toContainText('إجراء تجريبي');
  await accountant.goto(`/app/${orgId}/finance`);
  await expect(accountant.getByTestId('finance-report')).toContainText('المستحق حاليًا');
  expect((await accountant.request.get(`/api/v1/orgs/${orgId}/appointments/${visit.id}/encounter`)).status()).toBe(403);
  await accountantContext.close();

  // A Nasr City receptionist does not see a Maadi-only patient's account.
  const deskContext = await browser.newContext();
  const desk = await deskContext.newPage();
  await login(desk, 'reception.nour@demo.test');
  expect((await desk.request.get(`/api/v1/orgs/${orgId}/finance/patients/${visit.patient!.id}/account`)).status()).toBe(404);
  await deskContext.close();
  errors.expectNone();
});

test('mobile: the patient account fits the screen @mobile', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await login(page, 'reception.nour@demo.test');
  const orgId = orgIdFromUrl(page);
  const id = await patientId(page, orgId, 'ليلى مصطفى');
  await page.goto(`/app/${orgId}/finance/patients/${id}`);
  await expect(page.getByTestId('account-balance')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  errors.expectNone();
});
