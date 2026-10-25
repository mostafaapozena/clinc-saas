import { expect, test, type Page } from '@playwright/test';
import { DEMO_PASSWORD, login, orgIdFromUrl, watchBrowserErrors } from './helpers';

// Platform subscriptions and the operator console against the seeded synthetic data. Payments go
// through the clearly labelled SIMULATOR only (BILLING_PROVIDER=simulator in playwright.config.ts).

async function operatorLogin(page: Page, email: string) {
  await page.goto('/operator');
  await expect(page.getByRole('heading', { name: 'دخول المشغّل' })).toBeVisible();
  await page.locator('#operator-email').fill(email);
  await page.locator('#operator-password').fill(DEMO_PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByRole('heading', { level: 1, name: 'نظرة عامة' })).toBeVisible();
}

test('operator grant → owner subscribes through the simulator → signed webhook → lost webhook found by reconciliation', async ({
  page,
}) => {
  test.slow();
  const errors = watchBrowserErrors(page);
  await operatorLogin(page, 'operator.admin@demo.test');
  await expect(page.getByText(/لا يمكن الوصول هنا إلى المرضى/)).toBeVisible();
  await page.getByRole('link', { name: 'المنشآت' }).click();
  await page.getByRole('link', { name: 'مركز الشفاء (تجريبي)' }).click();
  const opSub = page.getByTestId('operator-subscription');
  await expect(opSub).toContainText('منحة تطوير');
  const opOrgUrl = page.url();

  // The clinic owner (separate session, same browser; this demo owner prefers English, so the rest
  // of the journey — console included — runs in English).
  await login(page, 'owner.shifa@demo.test');
  const orgId = orgIdFromUrl(page);
  await page.getByRole('link', { name: 'Subscription' }).click();
  await expect(page.getByTestId('subscription-current')).toContainText('Development grant');
  await expect(page.getByTestId('subscription-current')).toContainText('not a commercial subscription');
  await expect(page.getByText(/No real money is taken/)).toBeVisible();
  await page.getByRole('button', { name: 'Subscribe (simulator)' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/app/${orgId}/subscription/checkout/[0-9a-f]{24}$`));
  await expect(page.getByText(/No real payment is made/)).toBeVisible();
  await page.getByRole('button', { name: 'Simulate a successful payment' }).click();
  await expect(page.getByText(/The simulated payment succeeded/)).toBeVisible();
  await page.getByRole('link', { name: 'Back to subscription' }).click();
  await expect(page.getByTestId('subscription-current')).toContainText('Commercial subscription');
  await expect(page.getByTestId('subscription-current')).toContainText('simulated payment');

  // Back in the console: commercial subscription and the applied provider event.
  await page.goto(opOrgUrl);
  await expect(opSub).toContainText('Commercial subscription');
  await expect(page.getByText('checkout.completed', { exact: true })).toBeVisible();

  // A payment-failure webhook that never arrives: only reconciliation can find it.
  await page.getByLabel('Deliver the webhook').uncheck();
  await page.getByRole('button', { name: 'Fail a payment' }).click();
  await expect(opSub).toContainText('Active');
  await page.getByRole('link', { name: 'Overview' }).click();
  await page.getByRole('button', { name: 'Check (dry run)' }).click();
  await expect(page.getByTestId('reconcile-result')).toContainText('Status differs: active → past_due · not applied');
  await page.getByRole('button', { name: 'Apply provider state' }).click();
  await expect(page.getByTestId('reconcile-result')).toContainText('Status differs: active → past_due · applied');
  await page.goto(opOrgUrl);
  await expect(opSub).toContainText('Payment overdue');

  await page.getByRole('link', { name: 'Platform audit' }).click();
  await expect(page.getByText('subscription.commercial_started').first()).toBeVisible();
  await expect(page.getByText('subscription.reconciled').first()).toBeVisible();
  errors.expectNone();
});

test('support operator on a phone: metadata and inquiries, no plan management or audit @mobile', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await operatorLogin(page, 'operator.support@demo.test');
  await expect(page.getByRole('link', { name: 'المشغّلون' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'سجل المنصة' })).toHaveCount(0);
  await page.getByRole('link', { name: 'الخطط' }).click();
  await expect(page.getByText('خطة اختبار المحاكي (سعر وهمي)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'خطة مسودة جديدة' })).toHaveCount(0);
  await page.getByRole('link', { name: 'الطلبات' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'الطلبات' })).toBeVisible();
  // The console never opens the clinic workspace.
  const res = await page.request.get('/api/v1/orgs');
  expect(res.status()).toBe(401);
  errors.expectNone();
});
