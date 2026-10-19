import { expect, type Page } from '@playwright/test';

export const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? '';

/** Collects browser console errors and uncaught exceptions for the whole test. */
export function watchBrowserErrors(page: Page, allowed: RegExp[] = []) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !allowed.some((re) => re.test(message.text()))) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return {
    expectNone: () => expect(errors).toEqual([]),
  };
}

export async function login(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto('/login');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/(app\/[a-f\d]{24}|onboarding)/);
}

export function orgIdFromUrl(page: Page): string {
  const match = /\/app\/([a-f\d]{24})/.exec(page.url());
  if (!match?.[1]) throw new Error(`No organization id in ${page.url()}`);
  return match[1];
}

export async function logout(page: Page) {
  await page.locator('.user-menu-button').click();
  await page.locator('#user-menu-panel button').click();
  await page.waitForURL(/\/login/);
}
