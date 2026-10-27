import { expect, test, type Page } from '@playwright/test';
import { login, watchBrowserErrors } from './helpers';

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const bodyFont = (page: Page) => page.evaluate(() => getComputedStyle(document.body).fontFamily);

test('public site to workspace: solution → registration → multi-specialty setup → workspace', async ({ page }) => {
  test.slow();
  const errors = watchBrowserErrors(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  expect(await bodyFont(page)).toMatch(/^"Alexandria Variable"/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('عيادتك منظَّمة من أول حجز حتى آخر زيارة');

  // Choose a solution and start from it.
  await page.locator('#main-content').getByRole('link', { name: 'عيادات الأسنان' }).first().click();
  await expect(page).toHaveURL(/\/solutions\/dentistry$/);
  await expect(page.getByTestId('planned-tools')).toContainText('نسخة أولى');
  await page.getByTestId('solution-create').click();
  await expect(page).toHaveURL(/\/register\?next=%2Fonboarding%3Fspecialty%3Ddentistry$/);

  const email = `public.${Date.now()}@example.test`;
  await page.locator('#register-name').fill('مالك المركز التجريبي');
  await page.locator('#register-email').fill(email);
  await page.locator('#register-password').fill('e2e-only-password-1');
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click();
  await expect(page).toHaveURL(/\/onboarding\?specialty=dentistry$/);

  // A medical center with two specialties; its first branch offers only one of them.
  await page.getByRole('radio', { name: /مركز طبي/ }).check();
  await page.locator('#org-name').fill('مركز الحلول التجريبي');
  await page.locator('#org-time-zone').selectOption('Asia/Riyadh');
  await page.getByRole('button', { name: 'التالي' }).click();
  await expect(page.getByRole('checkbox', { name: 'طب الأسنان' })).toBeChecked();
  await expect(page.getByText('تم اختياره مسبقًا من الحل الذي اخترته: طب الأسنان.')).toBeVisible();
  await page.getByRole('checkbox', { name: 'العلاج الطبيعي' }).check();
  await page.getByRole('button', { name: 'التالي' }).click();
  await page.locator('#branch-name').fill('فرع الملقا');
  await page.locator('#branch-specialties').getByRole('checkbox', { name: 'العلاج الطبيعي' }).uncheck();
  await expect(page.getByText(/يمكن للمالكين والمديرين إضافة باقي الفروع/)).toBeVisible();
  await page.getByRole('button', { name: 'التالي' }).click();
  const review = page.getByTestId('onboarding-review');
  await expect(review).toContainText('مركز طبي');
  await expect(review).toContainText('طب الأسنان والعلاج الطبيعي');
  await page.getByRole('button', { name: 'إنشاء مساحة العمل' }).click();

  await expect(page).toHaveURL(/\/app\/[a-f\d]{24}$/);
  await expect(page.getByTestId('home-org-name')).toHaveText('مركز الحلول التجريبي');
  const overview = page.getByTestId('specialty-overview');
  await expect(overview).toContainText('طب الأسنان');
  await expect(overview).toContainText('متاح في: فرع الملقا');
  await expect(overview).toContainText('غير متاح في فروعك');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  // The specialty filter offers the organization's specialties and narrows the shared views.
  await page.locator('#specialty-switcher').selectOption({ label: 'العلاج الطبيعي' });
  await page.getByRole('navigation').getByRole('link', { name: 'الأطباء وجداولهم' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  errors.expectNone();
});

test('custom-ownership request: separate path, stored with a reference, nothing readable back', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'القائمة الرئيسية' }).getByRole('link', { name: 'المشروعات المخصصة' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('المشروعات المخصصة');
  await expect(page.getByText(/لا يتضمن هذا الموقع أي التزام بموعد تسليم/)).toBeVisible();
  await page.getByTestId('custom-request').click();
  await expect(page).toHaveURL(/\/custom-solutions\/request\?interest=custom$/);

  await page.locator('#inquiry-name').fill('هالة التجربة');
  await page.locator('#inquiry-org').fill('مركز الأشعة التجريبي');
  await page.locator('#inquiry-country').selectOption('SA');
  await page.locator('#inquiry-type').selectOption('multi_branch');
  await page.locator('#inquiry-phone-country').selectOption('SA');
  await page.locator('#inquiry-phone').fill('٠٥٠١٢٣٤٥٦٧');
  await page.locator('#inquiry-description').fill('نحتاج نظامًا مخصصًا لمركز أشعة بفرعين.');
  await page.getByRole('button', { name: 'إرسال الطلب' }).click();
  await expect(page.getByTestId('inquiry-reference')).toHaveText(/^R-[A-Z0-9]{8}$/);

  for (const path of ['/api/v1/public/ownership-inquiries', '/api/v1/public']) {
    expect((await page.request.get(path)).status()).toBe(404);
  }
  errors.expectNone();
});

test('contact message: two steps, stored once with a reference, nothing readable back', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: /^الشركة/ }).click();
  await page.locator('#menu-company').getByRole('link', { name: /تواصل معنا/ }).click();
  await expect(page).toHaveURL(/\/contact$/);
  await page.getByLabel('اسمك').fill('سلمى التجربة');
  await page.getByLabel(/البريد الإلكتروني/).fill(`contact.${Date.now()}@example.test`);
  await page.getByRole('button', { name: /التالي/ }).click();
  await page.getByLabel('رسالتك').fill('نريد عرضًا توضيحيًا لمركز بفرعين.');
  await page.getByRole('button', { name: 'إرسال الرسالة' }).click();
  await expect(page.getByTestId('contact-reference')).toHaveText(/C-[A-Z0-9]{8}/);
  expect((await page.request.get('/api/v1/public/contact-messages')).status()).toBe(404);
  errors.expectNone();
});

test('existing customers sign in directly and land in their workspace', async ({ page }) => {
  await page.goto('/solutions');
  await page.getByRole('link', { name: 'تسجيل الدخول' }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, 'owner.nour@demo.test');
  await expect(page).toHaveURL(/\/app\/[a-f\d]{24}$/);
  await expect(page.getByTestId('home-org-name')).toHaveText('عيادات النور (تجريبي)');
  // Visiting the public site while signed in offers the workspace, never sign-up.
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'الانتقال إلى مساحة العمل' }).first()).toHaveAttribute('href', '/app');
  await expect(page.getByRole('link', { name: 'أنشئ مساحة عمل لعيادتك' }).first()).toBeVisible();
});

test('an organization created before specialties: prompt, explicit setup, nothing blocked', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await login(page, 'owner.legacy@demo.test');
  await expect(page.getByTestId('specialty-setup-notice')).toBeVisible();
  await page.getByTestId('specialty-setup-notice').getByRole('link', { name: 'فتح الإعدادات' }).click();
  const settings = page.getByTestId('specialty-settings');
  await settings.locator('#settings-specialties').getByRole('checkbox', { name: 'الأنف والأذن والحنجرة' }).check();
  await expect(settings.locator('[id^="settings-branch-"]').first().getByRole('checkbox', { name: 'الأنف والأذن والحنجرة' })).toBeChecked();
  await settings.getByRole('button', { name: 'حفظ التخصصات' }).click();
  await expect(settings.getByText('تم حفظ التخصصات.')).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'الرئيسية' }).click();
  await expect(page.getByTestId('specialty-setup-notice')).toHaveCount(0);
  await expect(page.getByTestId('specialty-overview')).toContainText('الأنف والأذن والحنجرة');
  errors.expectNone();
});

test('English public pages are LTR with Inter and the choice persists', async ({ page }) => {
  await page.goto('/solutions?lang=en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Solutions');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  expect(await bodyFont(page)).toMatch(/^"Inter Variable"/);
  await page.goto('/custom-solutions');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Custom projects');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('المشروعات المخصصة');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});

test('keyboard: skip link first, then the main navigation', async ({ page }) => {
  await page.goto('/');
  // The page code loads lazily: wait for it before pressing keys.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  // The solution cards are reachable and announce their destination.
  const card = page.locator('#main-content').getByRole('link', { name: 'مراكز العلاج الطبيعي' }).first();
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/solutions\/physiotherapy$/);
});

test('the preview is not indexable: robots.txt, no sitemap, noindex headers', async ({ page }) => {
  const robots = await page.request.get('/robots.txt');
  expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n');
  expect(robots.headers()['x-robots-tag']).toBe('noindex, nofollow');
  expect((await page.request.get('/sitemap.xml')).status()).toBe(404);
  const home = await page.request.get('/');
  expect(home.headers()['x-robots-tag']).toBe('noindex, nofollow');
  expect(await home.text()).toContain('<meta name="robots" content="noindex, nofollow" />');
});

test('mobile public site: menu, journeys and no horizontal scroll @mobile', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  for (const path of ['/', '/solutions', '/solutions/medical-centers', '/custom-solutions', '/custom-solutions/request', '/tour', '/about', '/contact', '/faq', '/security', '/privacy']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await noHorizontalScroll(page), path).toBe(true);
  }
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'فتح القائمة' });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  const drawer = page.getByRole('navigation', { name: 'قائمة التنقل' });
  await drawer.getByText('الحلول', { exact: true }).click();
  await drawer.getByRole('link', { name: 'كل الحلول' }).click();
  await expect(page).toHaveURL(/\/solutions$/);
  await expect(page.getByRole('button', { name: 'فتح القائمة' })).toHaveAttribute('aria-expanded', 'false');
  errors.expectNone();
});

test('raclinic branding: supplied logos load everywhere, favicon and manifest, dark and reduced-motion behavior', async ({ page, browser }) => {
  const errors = watchBrowserErrors(page);
  const loaded = (selector: string) =>
    page.locator(selector).first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0 && img.alt === 'raclinic');

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await loaded('.site-header img.brand-logo--wordmark')).toBe(true);
  // Height is set, width follows the artwork: the rendered ratio equals the file's ratio.
  const ratio = await page.locator('.site-header img.brand-logo').evaluate((img: HTMLImageElement) => [img.getBoundingClientRect().width / img.getBoundingClientRect().height, img.naturalWidth / img.naturalHeight]);
  expect(Math.abs((ratio[0] ?? 0) - (ratio[1] ?? 0))).toBeLessThan(0.05);
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon.svg');
  expect((await page.request.get('/favicon.svg')).headers()['content-type']).toContain('svg');
  expect((await (await page.request.get('/site.webmanifest')).json()).name).toBe('raclinic');
  await expect(page).toHaveTitle(/ · raclinic$/);

  await page.goto('/login');
  expect(await loaded('.auth-brand img.brand-logo--lockup')).toBe(true);
  await expect(page.locator('.brand-tagline')).toHaveText('مساعدك الذكي في كل تفاصيل العيادة');
  await login(page, 'owner.nour@demo.test');
  expect(await loaded('.sidebar img.brand-logo--wordmark')).toBe(true);
  errors.expectNone();

  // Dark scheme: the logo keeps its colors on a light container; reduced motion: no animation.
  const dark = await browser.newContext({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const darkPage = await dark.newPage();
  await darkPage.goto('/');
  await expect(darkPage.getByRole('heading', { level: 1 })).toBeVisible();
  const style = await darkPage.locator('.site-header img.brand-logo').evaluate((img) => getComputedStyle(img).backgroundColor);
  expect(style).toBe('rgb(255, 255, 255)');
  expect(await darkPage.locator('.site-hero-text').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await dark.close();
});
