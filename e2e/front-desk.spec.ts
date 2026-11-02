import { type APIRequestContext, type Page } from '@playwright/test';
import { expect, test, testNow } from './fixtures';
import { login, orgIdFromUrl, watchBrowserErrors } from './helpers';

/** The supported zone with the most time left today, so "book today" always has free slots. */
function zoneWithMostTimeLeft(): string {
  const left = (zone: string) => {
    const [h = 0, m = 0] = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .format(testNow())
      .split(':')
      .map(Number);
    return 24 * 60 - (h * 60 + m);
  };
  return ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai'].sort((a, b) => left(b) - left(a))[0] ?? 'Africa/Cairo';
}

function localDate(zone: string, offsetDays = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(testNow());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function registerViaApi(request: APIRequestContext, label: string, displayName: string) {
  const email = `${label}.${Date.now()}@example.test`;
  const res = await request.post('/api/v1/auth/register', {
    data: { email, password: 'e2e-only-password-1', displayName, preferredLanguage: 'ar' },
  });
  expect(res.status()).toBe(201);
  return { email, csrf: (await res.json()).csrfToken as string };
}

async function post(request: APIRequestContext, csrf: string, url: string, data: object, method: 'post' | 'put' = 'post') {
  const res = await request[method](url, { data, headers: { 'X-CSRF-Token': csrf } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return res.json();
}

test('front desk to doctor: create patient → book → check in → doctor starts → doctor completes', async ({ page, browser }) => {
  test.slow();
  const ownerErrors = watchBrowserErrors(page);
  const zone = zoneWithMostTimeLeft();

  // Setup through the API: a fresh organization, a doctor member, and a scheduling profile
  // working all day, so the test does not depend on the time of day it runs.
  const owner = await registerViaApi(page.request, 'fd-owner', 'مالك التجربة');
  const org = await post(page.request, owner.csrf, '/api/v1/orgs', { name: 'عيادة مسار الاستقبال', timeZone: zone, branch: { name: 'فرع التجربة' } });
  const orgId = org.organization.id as string;
  const branchId = org.branch.id as string;

  const doctorContext = await browser.newContext();
  const doctorPage = await doctorContext.newPage();
  const doctorErrors = watchBrowserErrors(doctorPage);
  const doctor = await registerViaApi(doctorPage.request, 'fd-doctor', 'د. تجربة');
  const member = await post(page.request, owner.csrf, `/api/v1/orgs/${orgId}/members`, { email: doctor.email, role: 'doctor', branchScope: { type: 'all' } });
  const profile = await post(page.request, owner.csrf, `/api/v1/orgs/${orgId}/practitioners`, {
    membershipId: member.member.id,
    specialtyCode: 'dentistry',
    branchIds: [branchId],
    defaultDurationMinutes: 15,
  });
  await post(
    page.request,
    owner.csrf,
    `/api/v1/orgs/${orgId}/practitioners/${profile.practitioner.id}/schedule`,
    {
      weeklySchedule: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ branchId, weekday, start: '00:00', end: '24:00' })),
      version: profile.practitioner.version,
    },
    'put',
  );

  // 1. Create the patient (Arabic digits in the phone number).
  await page.goto(`/app/${orgId}`);
  await page.getByRole('navigation').getByRole('link', { name: 'المرضى', exact: true }).click();
  await page.getByRole('button', { name: 'مريض جديد' }).click();
  await page.locator('#new-patient-name').fill('مريم التجربة');
  await page.locator('#new-patient-phone').fill('٠١٠٠١١١٢٢٣٣');
  await page.getByRole('button', { name: 'تسجيل المريض' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('مريم التجربة');
  await expect(page.getByText('+201001112233')).toBeVisible();

  // 2. Book with the first available slot today.
  await page.getByRole('link', { name: 'حجز موعد' }).click();
  await expect(page.getByTestId('selected-patient')).toContainText('مريم التجربة');
  await page.locator('#booking-practitioner').selectOption({ label: 'د. تجربة' });
  await page.getByTestId('slot').first().click();
  await page.getByRole('button', { name: 'تأكيد الحجز' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'تم حجز الموعد.' })).toBeVisible();
  await expect(page.getByTestId('appointment-status')).toHaveText('محجوز');

  // 3. Check the patient in.
  await page.getByRole('button', { name: 'تسجيل وصول مريم التجربة' }).click();
  await expect(page.getByTestId('appointment-status')).toHaveText('وصل — ينتظر');

  // 4–5. The doctor sees them waiting, starts and completes the visit.
  await doctorPage.goto('/app');
  await doctorPage.getByRole('navigation').getByRole('link', { name: 'قائمة الانتظار' }).click();
  const waiting = doctorPage.getByTestId('queue-waiting');
  await expect(waiting.getByTestId('queue-entry')).toHaveCount(1);
  await expect(waiting).toContainText('مريم التجربة');
  await doctorPage.getByRole('button', { name: 'بدء كشف مريم التجربة' }).click();
  await expect(doctorPage.getByTestId('queue-in-progress')).toContainText('مريم التجربة');
  await expect(waiting.getByTestId('queue-entry')).toHaveCount(0);
  await doctorPage.getByRole('button', { name: 'إنهاء زيارة مريم التجربة' }).click();
  await expect(doctorPage.getByTestId('queue-in-progress').getByTestId('queue-entry')).toHaveCount(0);
  await doctorPage.getByRole('navigation').getByRole('link', { name: 'الرئيسية' }).click();
  await expect(doctorPage.getByTestId('today-completed')).toHaveText(new Intl.NumberFormat('ar').format(1));
  // The doctor cannot browse the registry.
  expect((await doctorPage.request.get(`/api/v1/orgs/${orgId}/patients`)).status()).toBe(403);

  await page.reload();
  await expect(page.getByTestId('appointment-status')).toHaveText('مكتمل');
  ownerErrors.expectNone();
  doctorErrors.expectNone();
  await doctorContext.close();
});

async function openBookingForSeededPatient(page: Page, date: string) {
  await page.getByRole('navigation').getByRole('link', { name: 'المواعيد' }).click();
  await page.getByRole('link', { name: 'حجز موعد' }).click();
  await page.locator('#patient-picker').fill('ليلى');
  await page.getByRole('button', { name: /ليلى مصطفى/ }).click();
  await page.locator('#booking-branch').selectOption({ label: 'فرع مدينة نصر' });
  await page.locator('#booking-practitioner').selectOption({ label: 'د. سامي' });
  await page.locator('#booking-date').fill(date);
}

test('reschedule and cancel an appointment', async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  await login(page, 'admin.nour@demo.test');
  const nextWeek = localDate('Africa/Cairo', 6);

  await openBookingForSeededPatient(page, nextWeek);
  const slots = page.getByTestId('slot');
  await expect(slots.first()).toBeVisible();
  const firstTime = await slots.first().textContent();
  await slots.first().click();
  await page.getByRole('button', { name: 'تأكيد الحجز' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'تم حجز الموعد.' })).toBeVisible();

  await page.getByRole('link', { name: 'تغيير الموعد' }).click();
  await page.locator('#reschedule-date').fill(nextWeek);
  // The appointment's own time is offered again; pick a different one.
  await page.getByTestId('slot').nth(3).click();
  await page.getByRole('button', { name: 'تأكيد الموعد الجديد' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'تم تغيير الموعد.' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('تفاصيل الموعد');
  expect(await page.locator('.page-header .muted').textContent()).not.toContain(firstTime ?? '###');

  await page.getByRole('button', { name: 'إلغاء موعد ليلى مصطفى' }).click();
  await page.locator('[id^="cancel-reason-"]').fill('طلب المريض تأجيلًا');
  await page.getByRole('button', { name: 'تأكيد الإلغاء' }).click();
  await expect(page.getByTestId('appointment-status')).toHaveText('ملغى');
  await expect(page.getByText('طلب المريض تأجيلًا')).toBeVisible();
  await expect(page.getByRole('link', { name: 'تغيير الموعد' })).toHaveCount(0);
  browserErrors.expectNone();
});

test('restricted roles only see what their role and branches allow', async ({ page }) => {
  // Viewer: aggregate counts only.
  await login(page, 'viewer.nour@demo.test');
  const orgId = orgIdFromUrl(page);
  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Patients' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Appointments' })).toHaveCount(0);
  await expect(page.getByTestId('today-waiting')).toBeVisible();
  await page.goto(`/app/${orgId}/patients`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("You can't open this page");
  for (const path of ['patients', 'appointments', 'queue']) {
    expect((await page.request.get(`/api/v1/orgs/${orgId}/${path}`)).status()).toBe(403);
  }
  await page.context().clearCookies();

  // Branch-restricted receptionist: an Alexandria-only patient does not exist for them.
  await login(page, 'reception.nour@demo.test');
  await page.getByRole('navigation').getByRole('link', { name: 'المرضى', exact: true }).click();
  await page.locator('#patient-search').fill('منى إبراهيم');
  await expect(page.getByText('لا يوجد مرضى مطابقون للبحث.')).toBeVisible();
  await page.locator('#patient-search').fill('يوسف حسن');
  await expect(page.getByTestId('patient-row')).toHaveCount(1);
  await page.getByRole('link', { name: 'يوسف حسن' }).click();
  // Registered at Nasr City and Maadi; only Nasr City is named.
  await expect(page.getByTestId('registration-row')).toHaveText([/فرع مدينة نصر/]);
  await expect(page.locator('#main-content')).not.toContainText('فرع المعادي');
  await page.context().clearCookies();

  // Doctor: own schedule and appointments, no registry.
  await login(page, 'doctor.nour@demo.test');
  await page.getByRole('navigation').getByRole('link', { name: 'المواعيد' }).click();
  const rows = page.getByTestId('appointment-row');
  await expect(rows.first()).toBeVisible();
  for (const text of await rows.allTextContents()) expect(text).toContain('د. هالة');
  await page.getByRole('navigation').getByRole('link', { name: 'جدولي' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('د. هالة');
  await expect(page.getByRole('button', { name: 'تعديل' })).toHaveCount(0);
});

test('appointments in English are LTR with Inter; Arabic is RTL with Alexandria', async ({ page, restoreLanguage }) => {
  restoreLanguage('owner.nour@demo.test', 'ar');
  const browserErrors = watchBrowserErrors(page);
  await login(page, 'owner.nour@demo.test');
  await page.getByRole('navigation').getByRole('link', { name: 'المواعيد' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('المواعيد');
  const font = () => page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(await font()).toMatch(/^"?Alexandria Variable"?,/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Appointments');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  expect(await font()).toMatch(/^"?Inter Variable"?,/);
  await expect(page.getByRole('button', { name: '7 days' })).toBeVisible();
  await page.getByRole('button', { name: '7 days' }).click();
  await expect(page.getByTestId('schedule-day')).toHaveCount(7);
  await page.getByRole('navigation').getByRole('link', { name: 'Queue' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Today's queue");
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('قائمة الانتظار اليوم');
  browserErrors.expectNone();
});

test('switching branch and organization never shows the previous scope’s data', async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  await login(page, 'multi@demo.test');
  if ((await page.getByTestId('home-org-name').textContent()) !== 'عيادات النور (تجريبي)') {
    await page.locator('#org-switcher').selectOption({ label: 'عيادات النور (تجريبي)' });
  }
  await page.getByRole('navigation').getByRole('link', { name: 'قائمة الانتظار' }).click();
  await page.locator('#branch-switcher').selectOption({ label: 'فرع مدينة نصر' });
  await expect(page.getByTestId('queue-waiting')).toContainText('فاطمة حسن');
  await page.locator('#branch-switcher').selectOption({ label: 'فرع المعادي' });
  await expect(page.getByTestId('queue-waiting')).toContainText('يوسف حسن');
  await expect(page.locator('#main-content')).not.toContainText('فاطمة حسن');

  await page.locator('#org-switcher').selectOption({ label: 'مركز الشفاء (تجريبي)' });
  await expect(page.getByTestId('home-org-name')).toHaveText('مركز الشفاء (تجريبي)');
  await page.getByRole('navigation').getByRole('link', { name: 'قائمة الانتظار' }).click();
  await expect(page.getByTestId('queue-waiting')).toContainText('Abdullah Saleh');
  for (const leftover of ['فاطمة حسن', 'يوسف حسن', 'د. سامي', 'فرع المعادي']) {
    await expect(page.locator('#main-content')).not.toContainText(leftover);
  }
  browserErrors.expectNone();
});

test('mobile front desk: open the queue, check a patient in, no horizontal scroll @mobile', async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  await login(page, 'reception.nour@demo.test');
  const noHorizontalScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  await page.getByRole('button', { name: 'فتح القائمة' }).click();
  await page.locator('#app-sidebar').getByRole('link', { name: 'قائمة الانتظار' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('قائمة الانتظار اليوم');
  await expect(page.getByTestId('queue-waiting').getByTestId('queue-entry')).toHaveText([/فاطمة حسن/, /ليلى مصطفى/]);
  expect(await noHorizontalScroll()).toBe(true);

  const expected = page.getByTestId('queue-expected');
  await expected.getByRole('button', { name: 'تسجيل وصول أحمد محمود علي' }).click();
  await expect(page.getByTestId('queue-waiting')).toContainText('أحمد محمود علي');
  expect(await noHorizontalScroll()).toBe(true);

  await page.getByRole('button', { name: 'فتح القائمة' }).click();
  await page.locator('#app-sidebar').getByRole('link', { name: 'المواعيد' }).click();
  await expect(page.getByTestId('appointment-row').first()).toBeVisible();
  expect(await noHorizontalScroll()).toBe(true);
  browserErrors.expectNone();
});
