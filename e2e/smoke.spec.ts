import { expect, test, type Page } from '@playwright/test';

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('home page renders Arabic RTL and shows a live API and database connection', async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  const healthResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/health'),
  );

  await page.goto('/');

  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', 'ar');
  await expect(html).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('منصة العيادات');

  // The browser itself called the API through the web server's /api proxy.
  expect((await healthResponse).status()).toBe(200);
  await expect(page.getByTestId('api-status')).toHaveAttribute('data-state', 'connected');
  await expect(page.getByTestId('db-status')).toHaveText('متصلة');

  // Seeded reference data made the round trip MongoDB → API → browser.
  const specialties = page.getByTestId('specialty-item');
  await expect(specialties).toHaveCount(3);
  await expect(specialties.first()).toHaveText('طب الأسنان');

  expect(errors).toEqual([]);
});

test('switching to English flips the document to LTR', async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'English' }).click();

  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', 'en');
  await expect(html).toHaveAttribute('dir', 'ltr');
  await expect(page.getByTestId('specialty-item').first()).toHaveText('Dentistry');

  expect(errors).toEqual([]);
});
