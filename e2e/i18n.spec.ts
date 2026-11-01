import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { login, watchBrowserErrors } from './helpers';

async function typography(page: Page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    return {
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      family: getComputedStyle(document.body).fontFamily,
      alexandria: document.fonts.check('16px "Alexandria Variable"'),
      inter: document.fonts.check('16px "Inter Variable"'),
    };
  });
}

test('Arabic uses RTL and Alexandria; English uses LTR and Inter; fonts are self-hosted', async ({ page }) => {
  const browser = watchBrowserErrors(page);
  const fontRequests: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'font') fontRequests.push(request.url());
  });

  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('تسجيل الدخول');
  const arabic = await typography(page);
  expect(arabic).toMatchObject({ lang: 'ar', dir: 'rtl', alexandria: true });
  expect(arabic.family).toMatch(/^"?Alexandria Variable"?,/);

  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
  const english = await typography(page);
  expect(english).toMatchObject({ lang: 'en', dir: 'ltr', inter: true });
  expect(english.family).toMatch(/^"?Inter Variable"?,/);

  // The choice persists across reloads.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');

  expect(fontRequests.length).toBeGreaterThan(0);
  const origin = new URL(page.url()).origin;
  expect(fontRequests.every((url) => url.startsWith(origin))).toBe(true);
  browser.expectNone();
});

test('the language preference is saved to the account and localized formatting follows it', async ({ page }) => {
  // The seeded viewer prefers English.
  await login(page, 'viewer.nour@demo.test');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByTestId('home-role')).toHaveText('Viewer');
  await expect(page.getByTestId('stat-branches')).toHaveText('3');

  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('home-role')).toHaveText('مطّلع');
  await expect(page.getByTestId('stat-branches')).toHaveText(new Intl.NumberFormat('ar').format(3));

  // A new browser context (no local preference) gets the saved account preference.
  const fresh = await page.context().browser()?.newPage();
  if (!fresh) throw new Error('no browser');
  await login(fresh, 'viewer.nour@demo.test');
  await expect(fresh.locator('html')).toHaveAttribute('dir', 'rtl');
  await fresh.close();
});

test('English from the public site carries through sign-up and onboarding; ?lang= works on any page', async ({ page, browser }) => {
  const errors = watchBrowserErrors(page);
  await page.goto('/solutions/dentistry?lang=en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByTestId('solution-create').click();
  await expect(page).toHaveURL(/\/register\?/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create an account');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.locator('#register-name').fill('English owner');
  await page.locator('#register-email').fill(`lang.${Date.now()}@example.test`);
  await page.locator('#register-password').fill('e2e-only-password-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Set up your organization');
  // The account was created with English as its saved preference: a reload keeps it.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Set up your organization');
  errors.expectNone();

  // A direct link in a browser with no saved choice; the choice then persists without the parameter.
  const context = await browser.newContext();
  const fresh = await context.newPage();
  await fresh.goto('/register?lang=en');
  await expect(fresh.getByRole('heading', { level: 1 })).toHaveText('Create an account');
  await fresh.goto('/login');
  await expect(fresh.getByRole('heading', { level: 1 })).toHaveText('Sign in');
  await fresh.goto('/login?lang=ar');
  await expect(fresh.getByRole('heading', { level: 1 })).toHaveText('تسجيل الدخول');
  await expect(fresh.locator('html')).toHaveAttribute('dir', 'rtl');
  await context.close();
});

test('mobile layout works in both languages @mobile', async ({ page }) => {
  const browser = watchBrowserErrors(page);
  await login(page, 'reception.nour@demo.test');

  const noHorizontalScroll = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(await noHorizontalScroll()).toBe(true);

  const sidebar = page.locator('#app-sidebar');
  await expect(sidebar).toBeHidden();
  await page.getByRole('button', { name: 'فتح القائمة' }).click();
  await expect(sidebar).toBeVisible();
  await sidebar.getByRole('link', { name: 'الفروع' }).click();
  await expect(sidebar).toBeHidden();
  await expect(page.getByTestId('branch-row')).toHaveText([/فرع مدينة نصر/]);

  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Branches');
  expect(await noHorizontalScroll()).toBe(true);
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(sidebar.getByRole('link', { name: 'Home' })).toBeVisible();
  browser.expectNone();
});
