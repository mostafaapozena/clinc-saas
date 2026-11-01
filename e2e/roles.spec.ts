import AxeBuilder from '@axe-core/playwright';
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { login, watchBrowserErrors } from './helpers';

// Every destination each role can open (Phase 1, UI-11): at 1366px, axe (WCAG 2.1 A/AA plus empty
// headings) and a page title; at 683 CSS px — the layout of a 1366px window at 200% zoom — no
// page-level horizontal scroll. Browser zoom itself cannot be set from Playwright, so the zoomed
// layout is reproduced by the CSS viewport. The operator console is covered for both operator roles.

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function check(page: Page, path: string, problems: string[]) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  // Pages are lazy chunks: wait for the title instead of sampling once after network idle.
  const title = await page
    .locator('h1')
    .first()
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  if (!title) problems.push(`${path}: no visible h1`);
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const structure = await new AxeBuilder({ page }).withRules(['empty-heading']).analyze();
  for (const v of [...wcag.violations, ...structure.violations]) problems.push(`${path}: ${v.id} ${v.nodes[0]?.target.join(' ')}`);
  await page.setViewportSize({ width: 683, height: 450 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) problems.push(`${path}: ${overflow}px horizontal scroll at 200% zoom`);
}

for (const role of ['owner.nour', 'admin.nour', 'doctor.nour', 'reception.nour', 'accountant.nour', 'viewer.nour']) {
  test(`${role}: every destination is accessible and fits at 200% zoom`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = watchBrowserErrors(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await login(page, `${role}@demo.test`);
    await page.locator('#app-sidebar a[href^="/app/"]').first().waitFor();
    const links = await page.locator('#app-sidebar a[href^="/app/"]').evaluateAll((a) => [...new Set(a.map((x) => x.getAttribute('href')!))]);
    expect(links.length).toBeGreaterThan(3);
    const problems: string[] = [];
    for (const href of links) await check(page, href, problems);
    expect(problems).toEqual([]);
    errors.expectNone();
  });
}

for (const operator of ['operator.admin', 'operator.support']) {
  test(`${operator}: every operator page is accessible and fits at 200% zoom`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/operator');
    await page.locator('#operator-email').fill(`${operator}@demo.test`);
    await page.locator('#operator-password').fill(process.env.E2E_DEMO_PASSWORD!);
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator('#operator-email')).toHaveCount(0);
    const links = await page.locator('nav a[href^="/operator"]').evaluateAll((a) => [...new Set(a.map((x) => x.getAttribute('href')!))]);
    expect(links.length).toBeGreaterThan(2);
    const problems: string[] = [];
    for (const href of links) await check(page, href, problems);
    expect(problems).toEqual([]);
  });
}
