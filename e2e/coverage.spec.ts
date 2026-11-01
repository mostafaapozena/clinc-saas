import { randomUUID } from 'node:crypto';
import { type APIRequestContext, type Browser } from '@playwright/test';
import { expect, test } from './fixtures';
import { watchBrowserErrors } from './helpers';

// Clinical coverage end to end, in a fresh organization created through the API (synthetic data):
// doctor A shares a finalized record with doctor B → B reads it and adds an addendum under B's
// name → A revokes → B loses access at once; the owner never reads it; an admin given the
// clinical-audit capability sees the events, without clinical text.
const MARK = 'E2E-COVERAGE-SYNTHETIC';

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
const todayIn = (zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function person(browser: Browser, label: string, displayName: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = `${label}.${Date.now()}@example.test`;
  const res = await page.request.post('/api/v1/auth/register', { data: { email, password: 'e2e-only-password-1', displayName, preferredLanguage: 'ar' } });
  expect(res.status()).toBe(201);
  return { context, page, email, csrf: (await res.json()).csrfToken as string };
}

async function call(request: APIRequestContext, csrf: string, method: 'post' | 'put' | 'patch', url: string, data: object, key?: string) {
  const res = await request[method](url, { data, headers: { 'X-CSRF-Token': csrf, ...(key ? { 'Idempotency-Key': key } : {}) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return res.json();
}

test('coverage: share → covered access and addendum → revoke; owner never reads; audit shows metadata only', async ({ browser }) => {
  test.slow();
  const zone = zoneWithMostTimeLeft();
  const owner = await person(browser, 'cov-owner', 'مالك التغطية');
  const doctorA = await person(browser, 'cov-doctor-a', 'د. أمل التجربة');
  const doctorB = await person(browser, 'cov-doctor-b', 'د. باسم التجربة');
  const admin = await person(browser, 'cov-admin', 'مدير التغطية');
  // B's visit after the revocation is refused on purpose (404); nothing else may fail.
  const errors = [watchBrowserErrors(doctorA.page), watchBrowserErrors(doctorB.page, [/status of 404/]), watchBrowserErrors(admin.page)];

  const org = await call(owner.page.request, owner.csrf, 'post', '/api/v1/orgs', { name: 'عيادة التغطية', timeZone: zone, branch: { name: 'فرع التغطية' } });
  const orgId = org.organization.id as string;
  const branchId = org.branch.id as string;
  const base = `/api/v1/orgs/${orgId}`;
  const profiles: string[] = [];
  for (const doctor of [doctorA, doctorB]) {
    const member = await call(owner.page.request, owner.csrf, 'post', `${base}/members`, { email: doctor.email, role: 'doctor', branchScope: { type: 'all' } });
    const profile = await call(owner.page.request, owner.csrf, 'post', `${base}/practitioners`, {
      membershipId: member.member.id,
      specialtyCode: 'dentistry',
      branchIds: [branchId],
      defaultDurationMinutes: 15,
    });
    await call(owner.page.request, owner.csrf, 'put', `${base}/practitioners/${profile.practitioner.id}/schedule`, {
      weeklySchedule: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ branchId, weekday, start: '00:00', end: '24:00' })),
      version: profile.practitioner.version,
    });
    profiles.push(profile.practitioner.id);
  }
  const adminMember = await call(owner.page.request, owner.csrf, 'post', `${base}/members`, { email: admin.email, role: 'admin' });

  // A visit with doctor A, finalized by doctor A (the record UI itself is covered elsewhere).
  const patient = await call(owner.page.request, owner.csrf, 'post', `${base}/patients`, {
    fullName: 'مريض التغطية',
    phone: { country: 'EG', number: `0100${String(Date.now()).slice(-7)}` },
    branchId,
  });
  const date = todayIn(zone);
  const slots = await (await owner.page.request.get(`${base}/appointments/availability?practitionerId=${profiles[0]}&branchId=${branchId}&date=${date}`)).json();
  const slot = slots.slots[0];
  let appointment = (
    await call(
      owner.page.request,
      owner.csrf,
      'post',
      `${base}/appointments`,
      { patientId: patient.patient.id, practitionerId: profiles[0], branchId, date, time: slot.localTime, utcOffsetMinutes: slot.utcOffsetMinutes, type: 'new_visit' },
      randomUUID(),
    )
  ).appointment;
  appointment = (await call(owner.page.request, owner.csrf, 'post', `${base}/appointments/${appointment.id}/status`, { action: 'check_in', version: appointment.version })).appointment;
  await call(doctorA.page.request, doctorA.csrf, 'post', `${base}/appointments/${appointment.id}/status`, { action: 'start', version: appointment.version });
  const started = await call(doctorA.page.request, doctorA.csrf, 'post', `${base}/appointments/${appointment.id}/encounter`, { sections: { reason: `${MARK} reason`, plan: `${MARK} plan` } }, randomUUID());
  const encounter = (
    await call(doctorA.page.request, doctorA.csrf, 'post', `${base}/encounters/${started.encounter.id}/finalize`, { version: started.encounter.version }, randomUUID())
  ).encounter;

  // Doctor A shares all of A's records for this patient with B, with addenda allowed.
  const a = doctorA.page;
  await a.goto(`/app/${orgId}/appointments/${appointment.id}/record`);
  await a.getByRole('button', { name: 'مشاركة…' }).click();
  await a.getByLabel('الزميل').selectOption({ label: 'د. باسم التجربة' });
  await a.getByLabel('كل سجلاتي لهذا المريض').check();
  await a.getByLabel('قراءة وإضافة ملاحق').check();
  await a.getByLabel(/^السبب/).fill('تغطية أثناء الإجازة');
  await a.getByRole('button', { name: 'مشاركة', exact: true }).click();
  await expect(a.getByText(/تمت المشاركة/)).toBeVisible();

  // Doctor B finds it, reads it and adds an addendum under B's own name.
  const b = doctorB.page;
  await b.goto(`/app/${orgId}`);
  await b.getByRole('navigation').getByRole('link', { name: 'التغطية السريرية' }).click();
  await b.getByTestId('coverage-received').getByRole('link', { name: 'فتح السجلات' }).click();
  await b.getByTestId('covered-record').getByRole('link').click();
  await expect(b.getByText(/عبر التغطية/).first()).toBeVisible();
  await expect(b.getByText(`${MARK} plan`)).toBeVisible();
  await b.getByLabel('سبب الملحق').fill('ملاحظة التغطية');
  await b.getByLabel('نص الملحق').fill(`${MARK} addendum by B`);
  await b.getByRole('button', { name: 'إضافة ملحق' }).click();
  await expect(b.getByTestId('addendum')).toContainText('د. باسم التجربة');
  const recordUrl = b.url();

  // The owner never reads the record, coverage or not.
  expect((await owner.page.request.get(`${base}/encounters/${encounter.id}`)).status()).toBe(403);

  // Doctor A revokes; B loses access on the next request.
  await a.goto(`/app/${orgId}/coverage`);
  const granted = a.getByTestId('coverage-granted');
  await granted.getByRole('button', { name: 'سحب' }).click();
  await granted.getByLabel('سبب السحب').fill('انتهت الإجازة');
  await granted.getByRole('button', { name: 'اسحب الآن' }).click();
  await expect(granted.getByTestId('coverage-status')).toHaveText('مسحوبة');
  await b.goto(recordUrl);
  await expect(b.getByText(/غير متاحين لك/)).toBeVisible();
  await expect(b.locator('body')).not.toContainText(MARK);

  // The owner gives the admin clinical-audit access in the Team page; the admin sees the events.
  const o = owner.page;
  await o.goto(`/app/${orgId}/team`);
  await o.getByRole('button', { name: 'منح مدير التغطية صلاحية التدقيق السريري' }).click();
  await expect(o.getByText(/يستطيع مدير التغطية الآن قراءة سجل التدقيق السريري/)).toBeVisible();
  expect(adminMember.member.id).toBeTruthy();
  const ad = admin.page;
  await ad.goto(`/app/${orgId}`);
  await ad.getByRole('navigation').getByRole('link', { name: 'سجل التدقيق السريري' }).click();
  const table = ad.getByTestId('clinical-audit');
  await expect(table).toContainText('منح تغطية');
  await expect(table).toContainText('سحب تغطية');
  await expect(table).toContainText('عبر التغطية');
  await expect(ad.locator('body')).not.toContainText(MARK);
  // …and still cannot open the record.
  expect((await ad.request.get(`${base}/encounters/${encounter.id}`)).status()).toBe(403);

  for (const e of errors) e.expectNone();
  for (const p of [owner, doctorA, doctorB, admin]) await p.context.close();
});
