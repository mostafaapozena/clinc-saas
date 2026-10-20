import { expect, test, type Page } from '@playwright/test';
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
  expect(arabic.family).toMatch(/^"Alexandria Variable"/);

  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
  const english = await typography(page);
  expect(english).toMatchObject({ lang: 'en', dir: 'ltr', inter: true });
  expect(english.family).toMatch(/^"Inter Variable"/);

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
  await expect(page.getByTestId('home-role')).toHaveText('مشاهد');
  await expect(page.getByTestId('stat-branches')).toHaveText(new Intl.NumberFormat('ar').format(3));

  // A new browser context (no local preference) gets the saved account preference.
  const fresh = await page.context().browser()?.newPage();
  if (!fresh) throw new Error('no browser');
  await login(fresh, 'viewer.nour@demo.test');
  await expect(fresh.locator('html')).toHaveAttribute('dir', 'rtl');
  await fresh.close();
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
