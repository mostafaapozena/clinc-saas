import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { DEMO_PASSWORD, watchBrowserErrors } from './helpers';

// Subscription lifecycle in the browser: an operator offers a trial on a plan; a new owner (English)
// starts it, sees its end date, and cancels it with explicit confirmation; the operator sees the
// billing policy (unset) and previews the lifecycle pass. Synthetic data only.

async function operatorLogin(page: Page) {
  await page.goto('/operator');
  await page.locator('#operator-email').fill('operator.admin@demo.test');
  await page.locator('#operator-password').fill(DEMO_PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByRole('heading', { level: 1, name: 'نظرة عامة' })).toBeVisible();
}

test('operator offers a trial; an owner starts and cancels it; policy and lifecycle are visible', async ({ page, browser }) => {
  test.slow();
  const errors = watchBrowserErrors(page);
  const code = `trial-${Date.now().toString(36)}`;
  await operatorLogin(page);
  // Unset policy by default, and a dry run of the lifecycle pass.
  await expect(page.getByTestId('billing-policy')).toContainText('غير محدد');
  await page.getByRole('button', { name: 'فحص (تجريبي)' }).last().click();
  await expect(page.getByTestId('lifecycle-result')).toBeVisible();

  await page.getByRole('link', { name: 'الخطط' }).click();
  await page.getByRole('button', { name: 'خطة مسودة جديدة' }).click();
  const form = page.getByTestId('plan-form');
  await form.locator('#plan-code').fill(code);
  await form.locator('#plan-name-ar').fill('خطة تجربة (تجريبية)');
  await form.locator('#plan-name-en').fill('Trial plan (synthetic)');
  await form.locator('#plan-trial').fill('14');
  await form.getByRole('button', { name: 'حفظ المسودة' }).click();
  const row = page.getByTestId('plans').locator('li').filter({ hasText: code });
  await row.getByRole('button', { name: 'تفعيل' }).click();
  await expect(row).toContainText('مفعّلة');

  // A new owner, preferring English, with an organization and no subscription.
  const owner = await (await browser.newContext()).newPage();
  const ownerErrors = watchBrowserErrors(owner);
  const email = `trial.owner.${Date.now()}@example.test`;
  const reg = await owner.request.post('/api/v1/auth/register', {
    data: { email, password: 'e2e-only-password-1', displayName: 'Trial Owner', preferredLanguage: 'en' },
  });
  const csrf = (await reg.json()).csrfToken as string;
  const org = await owner.request.post('/api/v1/orgs', {
    data: { name: 'Trial Clinic (synthetic)', timeZone: 'Africa/Cairo', branch: { name: 'Main' } },
    headers: { 'X-CSRF-Token': csrf },
  });
  const orgId = (await org.json()).organization.id as string;
  await owner.goto(`/app/${orgId}/subscription`);
  // A session created through the API keeps the default language; switch with the in-app control.
  await owner.getByRole('button', { name: 'English' }).click();
  await expect(owner.getByText('No subscription is recorded for this organization.')).toBeVisible();
  await owner.getByRole('button', { name: 'Start 14-day trial' }).click();
  await expect(owner.getByTestId('trial-ends')).toContainText('Ends on');
  await expect(owner.getByTestId('subscription-current')).toContainText('Trial');
  await expect(owner.getByRole('button', { name: /Start .*trial/ })).toHaveCount(0);

  await owner.getByRole('button', { name: 'Cancel subscription…' }).click();
  const panel = owner.getByTestId('cancel-panel');
  await expect(panel).toContainText('This free access ends now.');
  await expect(panel.getByRole('button', { name: 'Yes, cancel' })).toBeDisabled();
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: 'Yes, cancel' }).click();
  await expect(owner.getByTestId('subscription-current')).toContainText('Canceled');
  // A second trial is never offered.
  await expect(owner.getByRole('button', { name: /Start .*trial/ })).toHaveCount(0);
  // Nothing was removed: the workspace still opens.
  await owner.goto(`/app/${orgId}/branches`);
  await expect(owner.getByRole('heading', { level: 1 })).toBeVisible();

  // The operator sees the trial and the cancellation in the organization's history.
  await page.goto('/operator/organizations?q=Trial%20Clinic');
  await page.getByRole('link', { name: 'Trial Clinic (synthetic)' }).first().click();
  await expect(page.getByTestId('operator-subscription')).toContainText('ملغى');
  errors.expectNone();
  ownerErrors.expectNone();
});

test('the subscription page fits a phone in English @mobile', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  const email = `mobile.owner.${Date.now()}@example.test`;
  const reg = await page.request.post('/api/v1/auth/register', {
    data: { email, password: 'e2e-only-password-1', displayName: 'Mobile Owner', preferredLanguage: 'en' },
  });
  const csrf = (await reg.json()).csrfToken as string;
  const org = await page.request.post('/api/v1/orgs', {
    data: { name: 'Mobile Clinic (synthetic)', timeZone: 'Africa/Cairo', branch: { name: 'Main' } },
    headers: { 'X-CSRF-Token': csrf },
  });
  await page.goto(`/app/${(await org.json()).organization.id}/subscription`);
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Subscription' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dir)).toBe('ltr');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  errors.expectNone();
});
