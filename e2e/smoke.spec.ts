import { expect, test } from './fixtures';
import { watchBrowserErrors } from './helpers';

test('status page shows a live API and database connection in Arabic RTL', async ({ page }) => {
  const browser = watchBrowserErrors(page);
  const healthResponse = page.waitForResponse((response) => response.url().endsWith('/api/health'));

  await page.goto('/status');

  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', 'ar');
  await expect(html).toHaveAttribute('dir', 'rtl');
  const logo = page.locator('.public-brand img.brand-logo');
  await expect(logo).toHaveAttribute('alt', 'raclinic');
  expect(await logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  // The browser itself called the API through the web server's /api proxy.
  expect((await healthResponse).status()).toBe(200);
  await expect(page.getByTestId('api-status')).toHaveAttribute('data-state', 'connected');
  await expect(page.getByTestId('db-status')).toHaveText('متصلة');

  // Seeded reference data made the round trip MongoDB → API → browser.
  const specialties = page.getByTestId('specialty-item');
  await expect(specialties).toHaveCount(3);
  await expect(specialties.first()).toHaveText('طب الأسنان');
  browser.expectNone();
});
