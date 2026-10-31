import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login, orgIdFromUrl } from './helpers';

// Automated accessibility checks (WCAG 2.1 A/AA rules axe can decide) on the main workspace pages,
// in Arabic, light theme. They complement, not replace, keyboard and screen-reader review: axe
// finds missing names, empty headings, contrast and ARIA misuse, not whether a flow makes sense.

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function audit(page: Page, path: string) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes
        .map((n) => n.target.join(' '))
        .slice(0, 4)
        .join(' | ')}`,
  );
  // Soft: one run reports every page, not only the first one with a violation.
  expect.soft(summary, `${path}\n${summary.join('\n')}`).toEqual([]);
}

async function visit(page: Page, org: string, path: string) {
  await page.goto(`/app/${org}${path}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

const OWNER_PAGES = [
  '',
  '/appointments',
  '/queue',
  '/patients',
  '/finance',
  '/inventory',
  '/inventory/items',
  '/inventory/moves',
  '/purchasing',
  '/assets',
  '/reports',
  '/accounting',
  '/cash',
  '/compensation',
  '/team',
  '/settings',
  '/profile',
];

test('owner pages have no automatically detectable accessibility violations', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await login(page, 'owner.nour@demo.test');
  const org = orgIdFromUrl(page);
  for (const path of OWNER_PAGES) {
    await visit(page, org, path);
    await audit(page, path || '/');
  }
});

test('inventory pilot on a phone has no automatically detectable accessibility violations @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'owner.nour@demo.test');
  const org = orgIdFromUrl(page);
  for (const path of ['/inventory', '/inventory/items', '/inventory/moves']) {
    await visit(page, org, path);
    await audit(page, path);
  }
});
