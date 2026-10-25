import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { DEMO_PASSWORD, login, orgIdFromUrl, watchBrowserErrors } from './helpers';

// Milestone 6 — integrated acceptance (docs/ACCEPTANCE.md). Connected journeys that cross module
// boundaries, as the right roles, with synthetic data only. Journeys already covered end to end by
// other specs are mapped in docs/ACCEPTANCE.md rather than repeated here.

const MARK = 'E2E-ACCEPTANCE-SYNTHETIC';

function zoneWithMostTimeLeft(): string {
  const left = (zone: string) => {
    const [h = 0, m = 0] = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .format(new Date())
      .split(':')
      .map(Number);
    return 24 * 60 - (h * 60 + m);
  };
  return ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai'].sort((a, b) => left(b) - left(a))[0] ?? 'Africa/Cairo';
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

async function operatorLogin(page: Page, email: string) {
  await page.goto('/operator');
  await page.locator('#operator-email').fill(email);
  await page.locator('#operator-password').fill(DEMO_PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByRole('heading', { level: 1, name: 'نظرة عامة' })).toBeVisible();
}

test('J2: new patient → booking → arrival → dentistry consultation → finalized record; the desk sees status only', async ({
  page,
  browser,
}) => {
  test.slow();
  const deskErrors = watchBrowserErrors(page);
  const zone = zoneWithMostTimeLeft();
  const owner = await registerViaApi(page.request, 'acc-owner', 'مالك القبول');
  const org = await post(page.request, owner.csrf, '/api/v1/orgs', {
    name: 'عيادة القبول المتكامل',
    timeZone: zone,
    branch: { name: 'فرع القبول' },
  });
  const orgId = org.organization.id as string;
  const branchId = org.branch.id as string;

  const doctorContext = await browser.newContext();
  const doctorPage = await doctorContext.newPage();
  const doctorErrors = watchBrowserErrors(doctorPage);
  const doctor = await registerViaApi(doctorPage.request, 'acc-doctor', 'د. قبول');
  const member = await post(page.request, owner.csrf, `/api/v1/orgs/${orgId}/members`, {
    email: doctor.email,
    role: 'doctor',
    branchScope: { type: 'all' },
  });
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

  // Front desk (the owner here): patient, booking, arrival.
  await page.goto(`/app/${orgId}`);
  await page.getByRole('navigation').getByRole('link', { name: 'المرضى' }).click();
  await page.getByRole('button', { name: 'مريض جديد' }).click();
  await page.locator('#new-patient-name').fill('سلمى القبول');
  await page.locator('#new-patient-phone').fill('٠١٠٠٢٢٢٣٣٤٤');
  await page.getByRole('button', { name: 'تسجيل المريض' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('سلمى القبول');
  await page.getByRole('link', { name: 'حجز موعد' }).click();
  await page.locator('#booking-practitioner').selectOption({ label: 'د. قبول' });
  await page.getByTestId('slot').first().click();
  await page.getByRole('button', { name: 'تأكيد الحجز' }).click();
  await expect(page.getByTestId('appointment-status')).toHaveText('محجوز');
  const appointmentId = /appointments\/([a-f\d]{24})/.exec(page.url())?.[1] ?? '';
  expect(appointmentId).toMatch(/^[a-f\d]{24}$/);
  await page.getByRole('button', { name: 'تسجيل وصول سلمى القبول' }).click();
  await expect(page.getByTestId('appointment-status')).toHaveText('وصل — ينتظر');

  // Doctor: queue → start → dentistry record → finalize.
  await doctorPage.goto('/app');
  await doctorPage.getByRole('navigation').getByRole('link', { name: 'قائمة الانتظار' }).click();
  await doctorPage.getByRole('button', { name: 'بدء كشف سلمى القبول' }).click();
  await expect(doctorPage.getByTestId('queue-in-progress')).toContainText('سلمى القبول');
  await doctorPage.goto(`/app/${orgId}/appointments/${appointmentId}/record`);
  await doctorPage.getByRole('button', { name: 'بدء سجل الزيارة' }).click();
  await expect(doctorPage.getByRole('heading', { name: 'زيارة أسنان' })).toBeVisible();
  await doctorPage.getByRole('button', { name: 'السن 36' }).click();
  const panel = doctorPage.getByTestId('tooth-panel');
  await panel.getByLabel('نتيجة الفحص (بكلماتك)').fill(`${MARK} تسوس`);
  await panel.getByRole('button', { name: 'إضافة نتيجة' }).click();
  await doctorPage.getByLabel('سبب الزيارة', { exact: true }).fill(`${MARK} ألم`);
  await doctorPage.getByLabel('الخطة والمتابعة', { exact: true }).fill(`${MARK} متابعة`);
  await doctorPage.getByRole('button', { name: 'حفظ المسودة' }).click();
  await expect(doctorPage.getByTestId('save-state')).toContainText('حُفظت المسودة');
  await doctorPage.getByRole('button', { name: 'اعتماد السجل' }).click();
  await doctorPage.getByRole('alertdialog').getByRole('button', { name: 'نعم، اعتمد السجل' }).click();
  await expect(doctorPage.getByRole('heading', { name: 'السجل المعتمد' })).toBeVisible();
  await expect(doctorPage.getByTestId('specialty-view')).toContainText(`${MARK} تسوس`);

  // The owner administers the organization but never reads clinical text: documentation status only.
  await page.reload();
  await expect(page.locator('#main-content')).toContainText('معتمد');
  await expect(page.locator('#main-content')).not.toContainText(MARK);
  expect((await page.request.get(`/api/v1/orgs/${orgId}/appointments/${appointmentId}/encounter`)).status()).toBeGreaterThanOrEqual(403);
  deskErrors.expectNone();
  doctorErrors.expectNone();
  await doctorContext.close();
});

test('J6: an operator handles a public inquiry with masked contact, audited reveal, and no clinical access', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  const org = `مركز القبول ${Date.now()}`;
  await page.goto('/custom-solutions/request?interest=custom');
  await page.locator('#inquiry-name').fill('هالة القبول');
  await page.locator('#inquiry-org').fill(org);
  await page.locator('#inquiry-country').selectOption('EG');
  await page.locator('#inquiry-type').selectOption('clinic');
  await page.locator('#inquiry-phone-country').selectOption('EG');
  await page.locator('#inquiry-phone').fill('01000000077');
  await page.locator('#inquiry-description').fill('طلب تجريبي لاختبار لوحة المشغّل.');
  await page.getByRole('button', { name: 'إرسال الطلب' }).click();
  const reference = (await page.getByTestId('inquiry-reference').textContent()) ?? '';
  expect(reference).toMatch(/^R-[A-Z0-9]{8}$/);

  await operatorLogin(page, 'operator.support@demo.test');
  await page.getByRole('link', { name: 'الطلبات' }).click();
  await page.getByRole('link', { name: org }).click();
  const contact = page.getByTestId('inquiry-contact');
  await expect(contact).not.toContainText('+201000000077');
  await expect(contact).toContainText('•');
  await page.getByRole('button', { name: 'كشف بيانات التواصل' }).click();
  await expect(contact).toContainText('+201000000077');
  await page.getByRole('button', { name: 'تعليم كمُراجَع' }).click();
  await expect(page.locator('#main-content')).toContainText('تمت مراجعته');

  // The console has no route into clinic data, and an operator session is not a tenant session.
  const orgs = (await (await page.request.get('/api/v1/platform/organizations')).json()) as { data: { id: string }[] };
  const someOrg = orgs.data[0]?.id ?? '';
  for (const path of ['patients', 'appointments', 'encounters']) {
    expect((await page.request.get(`/api/v1/platform/organizations/${someOrg}/${path}`)).status()).toBe(404);
  }
  expect((await page.request.get(`/api/v1/orgs/${someOrg}/patients`)).status()).toBe(401);
  errors.expectNone();

  // The reveal is in the platform audit (platform administrators only).
  await page.context().clearCookies();
  await operatorLogin(page, 'operator.admin@demo.test');
  await page.getByRole('link', { name: 'سجل المنصة' }).click();
  await expect(page.getByText('inquiry.contact_revealed').first()).toBeVisible();
});

test('J7: an owner invites by email; the invitee registers from the dev-mail link and joins with the invited role', async ({
  page,
  browser,
}) => {
  test.slow();
  const errors = watchBrowserErrors(page);
  const email = `invitee.${Date.now()}@example.test`;
  await login(page, 'owner.nour@demo.test');
  const orgId = orgIdFromUrl(page);
  await page.goto(`/app/${orgId}/team`);
  const form = page.getByRole('form', { name: 'دعوة عبر البريد الإلكتروني' });
  await form.locator('#invite-email').fill(email);
  await form.locator('#invite-role').selectOption('receptionist');
  await form.getByRole('button', { name: 'إرسال الدعوة' }).click();
  await expect(page.getByText(`أُرسلت الدعوة إلى ${email}.`)).toBeVisible();
  await expect(page.getByTestId('invitations')).toContainText(email);

  await operatorLogin(page, 'operator.admin@demo.test');
  await page.getByRole('link', { name: 'بريد التطوير' }).click();
  const text = (await page.getByTestId('dev-mail').locator('li').filter({ hasText: email }).first().locator('pre').textContent()) ?? '';
  const token = /invitations\/accept\?token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';
  expect(token.length).toBeGreaterThan(20);

  // The invitee, in a fresh browser: open the link, create the account, come back, accept.
  const invitee = await (await browser.newContext()).newPage();
  // Re-opening the spent link is refused with 400 on purpose.
  const inviteeErrors = watchBrowserErrors(invitee, [/status of 400/]);
  await invitee.goto(`/invitations/accept?token=${token}`);
  await expect(invitee.getByTestId('invitation-summary')).toContainText('عيادات النور (تجريبي)');
  await invitee.getByRole('link', { name: 'إنشاء حساب' }).click();
  await invitee.locator('#register-name').fill('موظف مدعو');
  await invitee.locator('#register-email').fill(email);
  await invitee.locator('#register-password').fill('e2e-only-password-1');
  await invitee.getByRole('button', { name: 'إنشاء الحساب' }).click();
  await expect(invitee).toHaveURL(/\/invitations\/accept\?token=/);
  await invitee.getByRole('button', { name: 'قبول الدعوة' }).click();
  await expect(invitee).toHaveURL(new RegExp(`/app/${orgId}$`));
  await expect(invitee.getByRole('navigation').getByRole('link', { name: 'المرضى' })).toBeVisible();
  await expect(invitee.getByRole('navigation').getByRole('link', { name: 'الفريق' })).toHaveCount(0);
  // The link works once.
  await invitee.goto(`/invitations/accept?token=${token}`);
  await expect(invitee.getByText(/غير صالح أو انتهت صلاحيته/)).toBeVisible();
  errors.expectNone();
  inviteeErrors.expectNone();
});

test('J10: unauthorized organization, branch, role and console attempts are refused (English)', async ({ page }) => {
  // owner.shifa prefers English; the Nour organization is not theirs.
  await login(page, 'owner.nour@demo.test');
  const nourOrg = orgIdFromUrl(page);
  const nourPatients = (await (
    await page.request.get(`/api/v1/orgs/${nourOrg}/patients?q=${encodeURIComponent('منى إبراهيم')}`)
  ).json()) as { data: { id: string }[] };
  const alexPatient = nourPatients.data[0]?.id ?? '';
  await page.context().clearCookies();

  await login(page, 'owner.shifa@demo.test');
  await page.goto(`/app/${nourOrg}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Organization unavailable');
  for (const path of ['', '/patients', '/appointments', '/finance/reports/summary', '/support', '/subscription']) {
    expect([403, 404]).toContain((await page.request.get(`/api/v1/orgs/${nourOrg}${path}`)).status());
  }
  expect((await page.request.get('/api/v1/platform/overview')).status()).toBe(401);
  await page.context().clearCookies();

  // Branch: the Nasr City receptionist cannot open an Alexandria-only patient.
  await login(page, 'reception.nour@demo.test');
  expect((await page.request.get(`/api/v1/orgs/${nourOrg}/patients/${alexPatient}`)).status()).toBe(404);
  await page.context().clearCookies();

  // Role: the viewer gets no finance, team or clinical pages (English UI).
  await login(page, 'viewer.nour@demo.test');
  await page.goto(`/app/${nourOrg}/finance`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("You can't open this page");
  await page.goto(`/app/${nourOrg}/team`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("You can't open this page");
  for (const path of ['/finance/reports/summary', '/members', '/clinical/audit', '/invitations']) {
    expect((await page.request.get(`/api/v1/orgs/${nourOrg}${path}`)).status()).toBe(403);
  }
  await page.context().clearCookies();

  // The accountant bills but reads no clinical records; the doctor gets no financial reports.
  await login(page, 'accountant.nour@demo.test');
  expect((await page.request.get(`/api/v1/orgs/${nourOrg}/clinical/audit`)).status()).toBe(403);
  await page.context().clearCookies();
  await login(page, 'doctor.nour@demo.test');
  expect((await page.request.get(`/api/v1/orgs/${nourOrg}/finance/reports/summary`)).status()).toBe(403);
  expect((await page.request.get(`/api/v1/orgs/${nourOrg}/clinical/audit`)).status()).toBe(403);
});

test('J9: invitation, sign-in recovery and operator inquiry pages fit a phone @mobile', async ({ page }) => {
  // The invalid invitation link is refused with 400 on purpose.
  const errors = watchBrowserErrors(page, [/status of 400/]);
  for (const path of ['/forgot-password', '/invitations/accept?token=nothing-valid-here-000000', '/operator']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
  errors.expectNone();
});
