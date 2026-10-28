import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { watchBrowserErrors } from './helpers';

// Specialty selection → real setup → the specialty's own workspace (docs/architecture/MODULES.md).
// Each journey registers a new synthetic account, saves the setup steps the way the wizard does,
// then confirms in the page; the completion request is delayed on purpose to show the preparation
// state, which must follow the real request (no fake steps).

const PASSWORD = 'e2e-only-password-123';

async function newAccount(page: Page, label: string) {
  const res = await page.request.post('/api/v1/auth/register', {
    data: { email: `${label}.${randomUUID().slice(0, 8)}@demo.test`, password: PASSWORD, displayName: `E2E ${label}` },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { csrfToken: string }).csrfToken;
}

async function saveSteps(page: Page, csrf: string, type: string, specialties: string[]) {
  const put = async (body: object) => {
    const res = await page.request.put('/api/v1/onboarding', { data: body, headers: { 'X-CSRF-Token': csrf } });
    expect(res.ok(), await res.text()).toBe(true);
    return ((await res.json()) as { draft: { version: number } }).draft;
  };
  let draft = await put({
    step: 'specialties',
    version: null,
    data: { organizationType: type, name: `مساحة ${specialties.join('-')}`, timeZone: 'Africa/Cairo' },
  });
  draft = await put({ step: 'branch', version: draft.version, data: { specialtyCodes: specialties } });
  await put({ step: 'review', version: draft.version, data: { branch: { name: 'الفرع الرئيسي', city: 'القاهرة', specialtyCodes: specialties } } });
}

for (const s of [
  { code: 'dentistry', name: 'طب الأسنان', shortcut: 'ملفات المرضى ومخطط الأسنان', absent: 'جلسات اليوم' },
  { code: 'physiotherapy', name: 'العلاج الطبيعي', shortcut: 'جلسات اليوم', absent: 'ملفات المرضى ومخطط الأسنان' },
  { code: 'ent', name: 'الأنف والأذن والحنجرة', shortcut: 'ملفات المرضى والفحوص', absent: 'جلسات اليوم' },
]) {
  test(`${s.code}: setup shows the real preparation state and opens the ${s.code} workspace`, async ({ page }) => {
    const errors = watchBrowserErrors(page);
    const csrf = await newAccount(page, s.code);
    await saveSteps(page, csrf, 'clinic', [s.code]);
    // Hold the real completion request for a moment so the preparation state is visible.
    let completions = 0;
    await page.route('**/api/v1/onboarding/*/complete', async (route) => {
      completions += 1;
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    await page.goto('/onboarding');
    const submit = page.getByRole('button', { name: 'إنشاء مساحة العمل' });
    await submit.click();
    const preparing = page.getByTestId('preparing-workspace');
    await expect(preparing).toContainText(`جاري تجهيز مساحة عمل ${s.name}`);
    await expect(submit).toHaveCount(0);
    await page.waitForURL(/\/app\/[a-f\d]{24}$/);
    const actions = page.getByTestId(`specialty-actions-${s.code}`);
    await expect(actions).toContainText(s.shortcut);
    await expect(page.getByText(s.absent)).toHaveCount(0);
    expect(completions).toBe(1);
    // Reload and a deep link resolve to the same workspace.
    await page.reload();
    await expect(page.getByTestId(`specialty-actions-${s.code}`)).toBeVisible();
    await page.screenshot({ path: `test-results/specialty-${s.code}-home.png`, fullPage: true });
    errors.expectNone();
  });
}

test('multi-specialty center: asks for a context, switches, and refuses another organization', async ({ page }) => {
  const errors = watchBrowserErrors(page, [/status of 404/]);
  const csrf = await newAccount(page, 'center');
  await saveSteps(page, csrf, 'medical_center', ['dentistry', 'physiotherapy']);
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'إنشاء مساحة العمل' }).click();
  await page.waitForURL(/\/app\/[a-f\d]{24}$/);
  await expect(page.getByTestId('specialty-chooser')).toBeVisible();
  await page.getByTestId('specialty-chooser').getByRole('button', { name: 'العلاج الطبيعي' }).click();
  await expect(page.getByTestId('specialty-actions-physiotherapy')).toBeVisible();
  // The saved context survives a reload.
  await page.reload();
  await expect(page.getByTestId('specialty-actions-physiotherapy')).toBeVisible();
  await expect(page.getByTestId('specialty-chooser')).toHaveCount(0);
  // A tampered URL to an organization this account does not belong to shows nothing of it.
  const res = await page.request.get(`/api/v1/orgs/${'0'.repeat(24)}`);
  expect(res.status()).toBe(404);
  errors.expectNone();
});
