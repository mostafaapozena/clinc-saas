import { expect, test, type Page } from '@playwright/test';
import { login, orgIdFromUrl, watchBrowserErrors } from './helpers';

// Specialty workspaces against the seeded synthetic data (reset every run). Uses appointments no
// other spec touches: a06 (dentistry, Dr. Hala), b08 (physiotherapy, Dr. Sami, Alexandria), c01 (ENT, Dr. Reem).
const MARK = 'E2E-SPECIALTY-SYNTHETIC';

const localToday = (zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function todaysAppointment(page: Page, orgId: string, zone: string, patientName: string) {
  const today = localToday(zone);
  const res = await page.request.get(`/api/v1/orgs/${orgId}/appointments?from=${today}&to=${today}`);
  expect(res.ok()).toBe(true);
  const { data } = (await res.json()) as { data: { id: string; version: number; status: string; patient: { id: string; fullName: string } | null }[] };
  const match = data.find((a) => a.patient?.fullName === patientName && ['scheduled', 'checked_in', 'in_progress'].includes(a.status));
  if (!match) throw new Error(`No open appointment today for ${patientName}`);
  return match;
}

/** Moves the appointment to "in progress" through the real state machine. */
async function inProgress(desk: Page, doctor: Page, orgId: string, a: { id: string; version: number; status: string }) {
  let current = a;
  const csrf = async (p: Page) => ((await (await p.request.get('/api/v1/auth/session')).json()) as { csrfToken: string }).csrfToken;
  if (current.status === 'scheduled') {
    const res = await desk.request.post(`/api/v1/orgs/${orgId}/appointments/${current.id}/status`, {
      data: { action: 'check_in', version: current.version },
      headers: { 'X-CSRF-Token': await csrf(desk) },
    });
    expect(res.ok(), await res.text()).toBe(true);
    current = (await res.json()).appointment;
  }
  if (current.status === 'checked_in') {
    const res = await doctor.request.post(`/api/v1/orgs/${orgId}/appointments/${current.id}/status`, {
      data: { action: 'start', version: current.version },
      headers: { 'X-CSRF-Token': await csrf(doctor) },
    });
    expect(res.ok(), await res.text()).toBe(true);
  }
}

async function finalizeRecord(page: Page) {
  await page.getByRole('button', { name: 'حفظ المسودة' }).click();
  await expect(page.getByTestId('save-state')).toContainText('حُفظت المسودة');
  await page.getByRole('button', { name: 'اعتماد السجل' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'نعم، اعتمد السجل' }).click();
  await expect(page.getByRole('heading', { name: 'السجل المعتمد' })).toBeVisible();
}

test('dentistry: tooth chart, findings and a plan item, then the patient’s chart', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await login(page, 'doctor.nour@demo.test');
  const orgId = orgIdFromUrl(page);
  const a = await todaysAppointment(page, orgId, 'Africa/Cairo', 'يوسف حسن');
  await inProgress(page, page, orgId, a);

  await page.goto(`/app/${orgId}/appointments/${a.id}/record`);
  await page.getByRole('button', { name: 'بدء سجل الزيارة' }).click();
  await expect(page.getByRole('heading', { name: 'زيارة أسنان' })).toBeVisible();
  await page.getByRole('button', { name: 'السن 21' }).click();
  const panel = page.getByTestId('tooth-panel');
  await panel.getByLabel('دهليزي / شفوي').check();
  await panel.getByLabel('نتيجة الفحص (بكلماتك)').fill(`${MARK} كسر`);
  await panel.getByRole('button', { name: 'إضافة نتيجة' }).click();
  await panel.getByLabel('بند في خطة العلاج').fill(`${MARK} تاج`);
  await panel.getByRole('button', { name: 'إضافة إلى الخطة' }).click();
  await expect(page.getByTestId('dental-findings')).toContainText(`${MARK} كسر`);
  await page.getByLabel('سبب الزيارة', { exact: true }).fill(`${MARK} سبب`);
  await page.getByLabel('الخطة والمتابعة', { exact: true }).fill(`${MARK} خطة`);
  await finalizeRecord(page);
  await expect(page.getByTestId('specialty-view')).toContainText(`${MARK} تاج`);

  // The patient's chart shows the tooth's history and the plan item.
  const patientId = ((await (await page.request.get(`/api/v1/orgs/${orgId}/appointments/${a.id}`)).json()) as { appointment: { patient: { id: string } } }).appointment
    .patient.id;
  await page.goto(`/app/${orgId}/patients/${patientId}`);
  const chart = page.getByTestId('dental-chart');
  await chart.getByRole('button', { name: 'السن 21' }).click();
  await expect(chart.getByTestId('tooth-history')).toContainText(`${MARK} كسر`);
  await expect(chart.getByTestId('dental-plan')).toContainText(`${MARK} تاج`);
  await expect(chart.getByTestId('dental-plan')).toContainText('مخطط');
  errors.expectNone();
});

test('physiotherapy: a session linked to the seeded course, counted on the patient page', async ({ page, browser }) => {
  const errors = watchBrowserErrors(page);
  await login(page, 'doctor2.nour@demo.test');
  const orgId = orgIdFromUrl(page);
  const deskContext = await browser.newContext();
  const desk = await deskContext.newPage();
  await login(desk, 'owner.nour@demo.test');
  const a = await todaysAppointment(page, orgId, 'Africa/Cairo', 'منى إبراهيم');
  await inProgress(desk, page, orgId, a);
  await deskContext.close();

  await page.goto(`/app/${orgId}/appointments/${a.id}/record`);
  await page.getByLabel('علاج طبيعي — جلسة علاج').check();
  await page.getByRole('button', { name: 'بدء سجل الزيارة' }).click();
  const course = page.getByLabel('خطة العلاج');
  await expect(course.locator('option')).toHaveCount(2);
  await course.selectOption({ index: 1 });
  await page.getByLabel('العلاج المنفّذ').fill(`${MARK} تمارين`);
  await page.getByLabel('Synthetic goal: raise the arm above the head').fill(`${MARK} 15 دقيقة`);
  await page.getByLabel('سبب الزيارة', { exact: true }).fill(`${MARK} جلسة`);
  await page.getByLabel('الخطة والمتابعة', { exact: true }).fill(`${MARK} متابعة`);
  await finalizeRecord(page);

  const patientId = ((await (await page.request.get(`/api/v1/orgs/${orgId}/appointments/${a.id}`)).json()) as { appointment: { patient: { id: string } } }).appointment
    .patient.id;
  await page.goto(`/app/${orgId}/patients/${patientId}`);
  await expect(page.getByTestId('physio-course').first()).toContainText(/وُثّقت ١ من ٦ جلسة|وُثّقت 1 من 6 جلسة/);
  errors.expectNone();
});

test('ENT: region examination recorded and shown read-only once finalized', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await login(page, 'multi@demo.test');
  const orgs = (await (await page.request.get('/api/v1/orgs')).json()) as { data: { organization: { id: string; name: string }; role: string }[] };
  const shifa = orgs.data.find((m) => m.role === 'doctor');
  if (!shifa) throw new Error('multi@demo.test has no doctor membership');
  const orgId = shifa.organization.id;
  const ownerContext = await page.context().browser()!.newContext();
  const owner = await ownerContext.newPage();
  await login(owner, 'owner.shifa@demo.test');
  const a = await todaysAppointment(owner, orgId, 'Asia/Riyadh', 'Abdullah Saleh');
  await inProgress(owner, page, orgId, a);
  await ownerContext.close();

  await page.goto(`/app/${orgId}/appointments/${a.id}/record`);
  await page.getByRole('button', { name: 'بدء سجل الزيارة' }).click();
  await expect(page.getByRole('heading', { name: 'زيارة أنف وأذن وحنجرة' })).toBeVisible();
  await page.getByLabel('الأذن اليمنى').fill(`${MARK} طبلة سليمة`);
  await page.getByLabel('تعليمات المتابعة').fill(`${MARK} مراجعة بعد أسبوع`);
  await page.getByLabel('سبب الزيارة', { exact: true }).fill(`${MARK} ألم أذن`);
  await page.getByLabel('التقييم', { exact: true }).fill(`${MARK} تقييم`);
  await finalizeRecord(page);
  const view = page.getByTestId('specialty-view');
  await expect(view).toContainText(`${MARK} طبلة سليمة`);
  await expect(page.getByLabel('الأذن اليمنى')).toHaveCount(0);
  errors.expectNone();
});
