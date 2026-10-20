import { expect, test } from '@playwright/test';
import { login, logout, watchBrowserErrors } from './helpers';

test('registration → organization onboarding → workspace, then sign out and back in', async ({ page }) => {
  const browser = watchBrowserErrors(page);
  const email = `e2e.${Date.now()}@example.test`;
  const password = 'e2e-only-password-1';

  await page.goto('/register');
  await page.locator('#register-name').fill('مستخدم الاختبار');
  await page.locator('#register-email').fill(email);
  await page.locator('#register-password').fill(password);
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('إعداد المنشأة');
  await page.getByRole('radio', { name: /عيادة فردية/ }).check();
  await page.locator('#org-name').fill('عيادة الاختبار الآلي');
  await page.locator('#org-time-zone').selectOption('Africa/Cairo');
  await page.getByRole('button', { name: 'التالي' }).click();
  await expect(page.getByTestId('onboarding-step-specialties')).toBeVisible();

  // A reload resumes the saved setup at the same step.
  await page.reload();
  await expect(page.getByText('أنت تكمل إعدادًا بدأته من قبل.')).toBeVisible();
  await expect(page.getByTestId('onboarding-step-specialties')).toBeVisible();
  await page.getByRole('checkbox', { name: 'طب الأسنان' }).check();
  await page.getByRole('button', { name: 'التالي' }).click();
  await page.locator('#branch-name').fill('الفرع الرئيسي');
  await page.locator('#branch-city').fill('الجيزة');
  await expect(page.getByRole('checkbox', { name: 'طب الأسنان' })).toBeChecked();
  await page.getByRole('button', { name: 'التالي' }).click();
  await expect(page.getByTestId('onboarding-review')).toContainText('عيادة الاختبار الآلي');
  await page.getByRole('button', { name: 'إنشاء مساحة العمل' }).click();

  await expect(page).toHaveURL(/\/app\/[a-f\d]{24}$/);
  await expect(page.getByTestId('home-org-name')).toHaveText('عيادة الاختبار الآلي');
  await expect(page.getByTestId('home-role')).toHaveText('مالك');
  await expect(page.getByTestId('stat-members')).toHaveText(/1|١/);

  await logout(page);
  // After sign-out the workspace is no longer reachable.
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp$/);

  await login(page, email, password);
  await expect(page.getByTestId('home-org-name')).toHaveText('عيادة الاختبار الآلي');
  browser.expectNone();
});

test('wrong credentials show a generic translated error', async ({ page }) => {
  const browser = watchBrowserErrors(page, [/status of 401/]);
  await page.goto('/login');
  await page.locator('#login-email').fill('owner.nour@demo.test');
  await page.locator('#login-password').fill('definitely-wrong');
  await page.locator('form button[type="submit"]').click();

  await expect(page.getByRole('alert')).toHaveText('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
  await expect(page).toHaveURL(/\/login$/);
  browser.expectNone();
});

test('a suspended membership gives no access to the organization', async ({ page }) => {
  await login(page, 'suspended.nour@demo.test');
  // Their only membership is suspended, so they land on onboarding, not a workspace.
  await expect(page).toHaveURL(/\/onboarding$/);
  const orgs = await page.request.get('/api/v1/orgs');
  expect((await orgs.json()).data).toEqual([]);
});
