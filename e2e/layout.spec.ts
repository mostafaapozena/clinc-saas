import { expect, test, type Page } from '@playwright/test';
import { login, orgIdFromUrl, watchBrowserErrors } from './helpers';

// Layout contracts of the design system (docs/DESIGN_SYSTEM.md, docs/DESIGN_SYSTEM_REMEDIATION.md).
// Geometry checks, not pixel snapshots: each one guards a finding of the 2026-10 UI review so the
// same defect cannot come back in a new module.

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test('reports center: icons keep their gap, cards start at the top, categories stay on one row', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await login(page, 'owner.nour@demo.test');
  const org = orgIdFromUrl(page);
  await page.goto(`/app/${org}/reports`);
  await expect(page.getByTestId('report-kpis')).toBeVisible();
  // F-03: every report link has its icon box a fixed 12px from the text, top-aligned.
  const gaps = await page.locator('.report-link .icon-label').evaluateAll((labels) =>
    labels.map((l) => {
      const box = l.querySelector('.icon-box')!.getBoundingClientRect();
      const text = l.querySelector('.icon-label-text')!.getBoundingClientRect();
      return Math.round(document.dir === 'rtl' ? box.left - text.right : text.left - box.right);
    }),
  );
  expect(gaps.length).toBeGreaterThan(3);
  for (const g of gaps) expect(Math.abs(g - 12)).toBeLessThanOrEqual(1);
  // F-05: the category tabs are a single row.
  const tops = await page.locator('.report-category').evaluateAll((tabs) => new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top))).size);
  expect(tops).toBe(1);
  // F-04: four key figures sit on one row at this width.
  const kpiTops = await page.locator('[data-testid="report-kpis"] .metric').evaluateAll((m) => new Set(m.map((e) => Math.round(e.getBoundingClientRect().top))).size);
  expect(kpiTops).toBe(1);
  expect(await noOverflow(page)).toBeLessThanOrEqual(1);
  errors.expectNone();
});

test('home and accounting: no stretched cards, metrics in columns, module tabs on one row', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await login(page, 'owner.nour@demo.test');
  const org = orgIdFromUrl(page);
  await page.getByTestId('home-context').locator('summary').click();
  // F-01: in a default card row, no card ends in more than 24px of empty space.
  const trailing = await page.locator('.card-grid:not(.card-grid--equal) > .card').evaluateAll((cards) =>
    cards.map((c) => {
      const last = c.lastElementChild?.getBoundingClientRect();
      const box = c.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(c).paddingBlockEnd);
      return last ? Math.round(box.bottom - pad - last.bottom) : 0;
    }),
  );
  for (const space of trailing) expect(space).toBeLessThanOrEqual(24);
  await page.goto(`/app/${org}/accounting`);
  // F-04: the four ledger metrics are columns, not one full-width stack.
  const cols = await page.getByTestId('accounting-metrics').evaluate((dl) => getComputedStyle(dl).gridTemplateColumns.split(' ').length);
  expect(cols).toBeGreaterThan(1);
  // F-05: the module tabs never wrap.
  const rows = await page.locator('.module-nav .module-nav-link').evaluateAll((links) => new Set(links.map((l) => Math.round(l.getBoundingClientRect().top))).size);
  expect(rows).toBe(1);
  errors.expectNone();
});

test('compensation: buttons of the same size match in height (F-02) @mobile', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await login(page, 'owner.nour@demo.test');
  const org = orgIdFromUrl(page);
  await page.goto(`/app/${org}/compensation`);
  await expect(page.locator('form .button--primary').first()).toBeVisible();
  const heights = await page.locator('form .form-actions .button--primary').evaluateAll((b) => b.map((e) => Math.round(e.getBoundingClientRect().height)));
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
  expect(await noOverflow(page)).toBeLessThanOrEqual(1);
  errors.expectNone();
});

test('small phones: appointments and statements do not overflow the page at 360px (F-09, F-10) @mobile', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await login(page, 'owner.nour@demo.test');
  const org = orgIdFromUrl(page);
  for (const path of ['/appointments', '/accounting/reports?report=balanceSheet', '/reports']) {
    await page.goto(`/app/${org}${path}`);
    await page.waitForLoadState('networkidle');
    expect(await noOverflow(page), path).toBeLessThanOrEqual(1);
  }
  errors.expectNone();
});
