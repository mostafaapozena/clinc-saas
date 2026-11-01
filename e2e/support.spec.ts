import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { DEMO_PASSWORD, login, orgIdFromUrl, watchBrowserErrors } from './helpers';

// Support requests and account recovery against the seeded synthetic data. Email goes to the
// development mail sink (MAIL_PROVIDER=dev_sink in playwright.config.ts); nothing is sent.

async function operatorLogin(page: Page, email: string) {
  await page.goto('/operator');
  await page.locator('#operator-email').fill(email);
  await page.locator('#operator-password').fill(DEMO_PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByRole('heading', { level: 1, name: 'نظرة عامة' })).toBeVisible();
}

test('password recovery through the development mail sink', async ({ page }) => {
  // The second use of the link is refused with 400 on purpose.
  const errors = watchBrowserErrors(page, [/status of 400/]);
  await page.goto('/login');
  await page.getByRole('link', { name: 'نسيت كلمة المرور؟' }).click();
  await page.locator('#forgot-email').fill('owner.legacy@demo.test');
  await page.getByRole('button', { name: 'إرسال رابط إعادة التعيين' }).click();
  await expect(page.getByText(/رابط إعادة التعيين في الطريق/)).toBeVisible();

  await operatorLogin(page, 'operator.admin@demo.test');
  await page.getByRole('link', { name: 'بريد التطوير' }).click();
  const mail = page.getByTestId('dev-mail').locator('li').filter({ hasText: 'owner.legacy@demo.test' }).first();
  const text = (await mail.locator('pre').textContent()) ?? '';
  const token = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(text)?.[1];
  expect(token).toBeTruthy();

  await page.goto(`/reset-password?token=${token}`);
  await expect(page).toHaveURL(/\/reset-password$/); // the token leaves the address bar
  await page.locator('#reset-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'حفظ كلمة المرور الجديدة' }).click();
  await expect(page.getByText(/تم تغيير كلمة المرور/)).toBeVisible();
  // The link works once.
  await page.goto(`/reset-password?token=${token}`);
  await page.locator('#reset-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'حفظ كلمة المرور الجديدة' }).click();
  await expect(page.getByText(/غير صالح أو انتهت صلاحيته/)).toBeVisible();
  await login(page, 'owner.legacy@demo.test');
  errors.expectNone();
});

test('a receptionist asks for help and a support operator answers', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await login(page, 'reception.nour@demo.test');
  const orgId = orgIdFromUrl(page);
  await page.goto(`/app/${orgId}/support`);
  await expect(page.getByText(/وليست مساعدًا ذكيًا/)).toBeVisible();
  await expect(page.getByTestId('contact-none')).toBeVisible();
  await page.locator('#support-subject').fill('Receipt printing (synthetic)');
  await page.locator('#support-category').selectOption('finance');
  await page.locator('#support-body').fill('Synthetic: the receipt page prints blank.');
  await page.getByRole('button', { name: 'إرسال الطلب' }).click();
  const created = page.getByText(/تم إرسال الطلب S-[A-Z2-9]{8}/);
  await expect(created).toBeVisible();
  const reference = /S-[A-Z2-9]{8}/.exec((await created.textContent()) ?? '')?.[0] ?? '';

  await operatorLogin(page, 'operator.support@demo.test');
  await page.getByRole('link', { name: 'الدعم' }).click();
  await page.getByTestId('support-queue').getByRole('link', { name: 'Receipt printing (synthetic)' }).click();
  await expect(page.getByText(reference)).toBeVisible();
  await page.getByRole('textbox', { name: 'الرد' }).fill('Synthetic answer: please try again now.');
  await page.getByRole('button', { name: 'إرسال الرد' }).click();
  await expect(page.getByTestId('support-status')).toHaveText('تم الرد');

  await page.goto(`/app/${orgId}/support`);
  await page.getByTestId('support-requests').getByRole('link', { name: 'Receipt printing (synthetic)' }).click();
  await expect(page.getByTestId('support-messages')).toContainText('فريق raclinic');
  await expect(page.getByTestId('support-messages')).toContainText('Synthetic answer: please try again now.');
  errors.expectNone();
});

test('help and support on a phone @mobile', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await login(page, 'doctor.nour@demo.test');
  const orgId = orgIdFromUrl(page);
  await page.goto(`/app/${orgId}/support`);
  await expect(page.getByRole('heading', { level: 1, name: 'المساعدة والدعم' })).toBeVisible();
  await page.getByLabel('تصفية الأسئلة').fill('ضريبية');
  await expect(page.getByTestId('faq').locator('details')).toHaveCount(1);
  const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(width).toBeLessThanOrEqual(1);
  errors.expectNone();
});
