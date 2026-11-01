import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
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
  // UI-08: every category is visible without sideways scrolling (a grid of at most two rows here).
  const strip = await page.locator('.report-categories').evaluate((e) => ({
    overflow: e.scrollWidth - e.clientWidth,
    rows: new Set([...e.children].map((c) => Math.round(c.getBoundingClientRect().top))).size,
  }));
  expect(strip.overflow).toBeLessThanOrEqual(1);
  expect(strip.rows).toBeLessThanOrEqual(2);
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

test('inventory pilot: filters live in the address, numbers end-aligned, cash cards readable (UX-001, UX-011)', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await login(page, 'owner.nour@demo.test');
  const org = orgIdFromUrl(page);
  await page.goto(`/app/${org}/inventory/moves`);
  const item = page.locator('#moves-item');
  const value = await item.locator('option').nth(1).getAttribute('value');
  await item.selectOption(value!);
  await expect(page).toHaveURL(new RegExp(`item=${value}`));
  await page.reload();
  await expect(page.locator('#moves-item')).toHaveValue(value!);
  // Quantities are end-aligned with tabular figures; dates are formatted, not ISO.
  const qty = page.getByTestId('stock-moves').locator('td.num').first();
  await expect(qty).toHaveCSS('text-align', 'end');
  await expect(page.getByTestId('stock-moves').locator('time').first()).not.toHaveText(/^\d{4}-\d{2}-\d{2}$/);
  await page.getByRole('button', { name: 'إعادة ضبط التصفية' }).click();
  await expect(page).not.toHaveURL(/item=/);
  // UX-001: every account card on the cash page keeps a readable title column (not a sliver).
  await page.goto(`/app/${org}/cash`);
  await expect(page.locator('.data-list .data-row .data-main').first()).toBeVisible();
  const widths = await page.locator('.data-list .data-row .data-main').evaluateAll((m) => m.map((e) => Math.round(e.getBoundingClientRect().width)));
  expect(widths.length).toBeGreaterThan(0);
  for (const w of widths) expect(w).toBeGreaterThan(160);
  errors.expectNone();
});

test('small phones: appointments and statements do not overflow the page at 360px (F-09, F-10) @mobile', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await login(page, 'owner.nour@demo.test');
  const org = orgIdFromUrl(page);
  for (const path of ['/appointments', '/accounting/reports?report=balanceSheet', '/accounting/reports?report=trialBalance', '/reports']) {
    await page.goto(`/app/${org}${path}`);
    await page.waitForLoadState('networkidle');
    expect(await noOverflow(page), path).toBeLessThanOrEqual(1);
    // Statements and ledgers keep real table columns on phones and scroll inside their card; only
    // record lists stack into labelled cards.
    const scrollCells = await page
      .locator('.data-table--scroll :is(th, td)')
      .evaluateAll((cells) => cells.filter((c) => getComputedStyle(c).display !== 'table-cell').length);
    expect(scrollCells, `${path}: statement cells that are not table cells`).toBe(0);
    if (path.endsWith('trialBalance')) expect(await page.locator('.data-table--scroll tbody td').count()).toBeGreaterThan(0);
  }
  errors.expectNone();
});

test('small laptops: the one-row header never pushes the page sideways, in either language (UI-11)', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await login(page, 'owner.nour@demo.test');
  const home = page.url();
  for (const lang of ['ar', 'en']) {
    await page.goto(`${home}?lang=${lang}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    for (const width of [1024, 1100, 1180, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      expect(await noOverflow(page), `${lang} ${width}px`).toBeLessThanOrEqual(1);
    }
  }
});

test('detail pages keep their place: patient context tabs, back links, booking says what is missing (UX-017, UX-018)', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await login(page, 'owner.nour@demo.test');
  const org = orgIdFromUrl(page);
  await page.goto(`/app/${org}/patients`);
  await page.getByTestId('patient-row').first().getByRole('link').click();
  const tabs = page.getByRole('navigation', { name: 'صفحات المريض' });
  await expect(tabs.getByRole('link', { name: 'ملف المريض' })).toHaveClass(/active/);
  await tabs.getByRole('link', { name: 'الحساب المالي' }).click();
  await expect(page).toHaveURL(/\/finance\/patients\//);
  // The same patient header on the account, with the way back to the list.
  await expect(page.getByRole('navigation', { name: 'صفحات المريض' }).getByRole('link', { name: 'الحساب المالي' })).toHaveClass(/active/);
  await page.locator('.page-back').click();
  await expect(page).toHaveURL(new RegExp(`/app/${org}/patients$`));
  // Booking: a disabled confirm button says what is missing.
  await page.goto(`/app/${org}/appointments/new`);
  const confirm = page.locator('form.booking-form button[type="submit"]');
  await expect(confirm).toBeDisabled();
  await expect(page.getByTestId('booking-missing')).toHaveText('اختر المريض أولًا.');
  await expect(confirm).toHaveAttribute('aria-describedby', 'booking-missing');
  errors.expectNone();
});

test('settings mark unsaved sections and ask before leaving; policy notes are help, not banners (UX-016, UX-021)', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await login(page, 'owner.nour@demo.test');
  const org = orgIdFromUrl(page);
  await page.goto(`/app/${org}/settings`);
  const name = page.locator('#settings-org-name');
  const original = await name.inputValue();
  await name.focus();
  await name.fill('عيادات النور (تعديل غير محفوظ)');
  await expect(page.getByTestId('settings-unsaved')).toContainText('البيانات الأساسية');
  await expect(page.locator('section[aria-labelledby="org-settings-title"]')).toHaveAttribute('data-dirty', 'true');
  // Leaving asks first; staying keeps the edit.
  await page.getByRole('navigation').getByRole('link', { name: 'الرئيسية' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'البقاء في الصفحة' }).click();
  await expect(name).toHaveValue('عيادات النور (تعديل غير محفوظ)');
  // Back to the saved value: nothing is dirty any more.
  await name.fill(original);
  await expect(page.getByTestId('settings-unsaved')).toHaveCount(0);
  // Finance: the "not a tax invoice" note sits under the title, folded, so content starts right away.
  await page.goto(`/app/${org}/finance`);
  await expect(page.locator('.page-help summary')).toBeVisible();
  await expect(page.locator('main > .notice--info')).toHaveCount(0);
  errors.expectNone();
});

test('the design-system gallery is not part of the production build', async ({ page }) => {
  await page.goto('/dev/gallery');
  await expect(page.getByText('Design system gallery')).toHaveCount(0);
});

test('phones: every control in the page is at least 44px tall (UX-025) @mobile', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'owner.nour@demo.test');
  const org = orgIdFromUrl(page);
  for (const path of ['/appointments', '/patients', '/team', '/inventory']) {
    await page.goto(`/app/${org}${path}`);
    await page.waitForLoadState('networkidle');
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('main :is(button, a.button, input, select, textarea, .module-nav-link, summary)')]
        .filter((e) => (e as HTMLElement).offsetParent !== null && !['checkbox', 'radio', 'hidden'].includes((e as HTMLInputElement).type))
        .filter((e) => e.getBoundingClientRect().height < 43.5)
        .map((e) => `${e.tagName} "${(e.textContent ?? '').trim().slice(0, 20)}"`),
    );
    expect(small, path).toEqual([]);
  }
  errors.expectNone();
});

test('the first HTML paints a loading mark instead of a blank page (UX-029)', async ({ request }) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain('class="boot"');
});

test('module tabs stay where the viewer scrolls them, and grouped pages get a second row (UI-08) @mobile', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'owner.nour@demo.test');
  const org = orgIdFromUrl(page);
  for (const lang of ['ar', 'en']) {
    await page.goto(`/app/${org}/accounting/entries?lang=${lang}`);
    const nav = page.locator('.module-nav');
    await expect(nav.locator('.module-nav-link.active')).toBeVisible();
    // The previous version re-centred the active tab on every render, so a manual scroll snapped back.
    const before = await nav.evaluate((e) => e.scrollLeft);
    await nav.evaluate((e) => e.scrollBy({ left: document.dir === 'rtl' ? -120 : 120, behavior: 'instant' }));
    const moved = await nav.evaluate((e) => e.scrollLeft);
    expect(Math.abs(moved - before)).toBeGreaterThan(20);
    await page.waitForTimeout(600);
    expect(await nav.evaluate((e) => e.scrollLeft)).toBe(moved);
    // Journal and chart of accounts share the "Books" tab; their own row names the current page.
    await expect(page.locator('.module-subnav .module-subnav-link.active')).toHaveAttribute('href', new RegExp('/accounting/entries$'));
    await expect(page.locator('.module-subnav .module-subnav-link')).toHaveCount(2);
  }
  errors.expectNone();
});
