import { expect, test, type Page } from '@playwright/test';
import { login, logout, orgIdFromUrl, watchBrowserErrors } from './helpers';

// Clinical visit records against the seeded synthetic demo data (reset on every run):
// - doctor2.nour (Dr. Sami): b04 in progress without a record, b03 completed without a record;
// - doctor.nour (Dr. Hala): a05 completed with a draft record.
// All clinical text here is synthetic and carries MARK so leaks are easy to detect.
const MARK = 'E2E-SYNTHETIC';

const cairoToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Today's appointment of the signed-in user for a patient, found through the API the page itself uses. */
async function todaysAppointment(page: Page, orgId: string, patientName: string, status: string): Promise<string> {
  const today = cairoToday();
  const res = await page.request.get(`/api/v1/orgs/${orgId}/appointments?from=${today}&to=${today}&status=${status}`);
  expect(res.ok()).toBe(true);
  const { data } = (await res.json()) as { data: { id: string; patient: { fullName: string } | null }[] };
  const match = data.find((a) => a.patient?.fullName === patientName);
  if (!match) throw new Error(`No ${status} appointment today for ${patientName}`);
  return match.id;
}

async function noClinicalTextStored(page: Page) {
  const stored = await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage }));
  expect(stored).not.toContain(MARK);
  expect(page.url()).not.toContain(MARK);
  expect(await page.title()).not.toContain(MARK);
}

test('treating doctor writes, finalizes and corrects a record; other roles see the status only', async ({ page, browser }) => {
  test.slow();
  const errors = watchBrowserErrors(page);
  await login(page, 'doctor2.nour@demo.test');
  const orgId = orgIdFromUrl(page);

  await page.goto(`/app/${orgId}/queue`);
  const inProgress = page.getByTestId('queue-in-progress');
  await expect(inProgress.getByTestId('documentation-status')).toHaveText('سجل الزيارة: لم يبدأ');
  await inProgress.getByRole('link', { name: 'Karim Nabil' }).click();
  const appointmentUrl = page.url();
  await page.getByRole('link', { name: 'بدء سجل الزيارة' }).click();
  await expect(page).toHaveURL(/\/record$/);

  await page.getByRole('button', { name: 'بدء سجل الزيارة' }).click();
  await page.getByLabel('سبب الزيارة', { exact: true }).fill(`${MARK} سبب`);
  await page.getByLabel('نتائج الفحص', { exact: true }).fill(`${MARK} فحص`);
  // Dr. Sami is a physiotherapist: the record is an initial assessment, which needs planned sessions.
  await page.getByLabel('عدد الجلسات المخطط', { exact: true }).fill('6');
  await expect(page.getByTestId('save-state')).toHaveText('تغييرات غير محفوظة');
  await expect(page.getByRole('button', { name: 'اعتماد السجل' })).toBeDisabled();
  await page.getByRole('button', { name: 'حفظ المسودة' }).click();
  await expect(page.getByTestId('save-state')).toContainText('حُفظت المسودة');

  // Resume: the draft is read back from the server.
  await page.reload();
  await expect(page.getByLabel('نتائج الفحص', { exact: true })).toHaveValue(`${MARK} فحص`);
  await noClinicalTextStored(page);

  await page.getByRole('button', { name: 'اعتماد السجل' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'اعتماد سجل الزيارة؟' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'نعم، اعتمد السجل' }).click();
  await expect(page.getByRole('heading', { name: 'السجل المعتمد' })).toBeVisible();
  await expect(page.getByLabel('سبب الزيارة', { exact: true })).toHaveCount(0);

  await page.getByLabel('سبب الملحق').fill('توضيح بعد المراجعة');
  await page.getByLabel('نص الملحق').fill(`${MARK} ملحق`);
  await page.getByRole('button', { name: 'إضافة ملحق' }).click();
  await expect(page.getByText('أُضيف الملحق.')).toBeVisible();
  await expect(page.getByTestId('record-timeline').getByTestId('addendum')).toContainText(`${MARK} ملحق`);
  // The original finalized text is unchanged next to the addendum.
  await expect(page.getByText(`${MARK} فحص`)).toBeVisible();
  await noClinicalTextStored(page);
  const recordUrl = page.url();

  // Owner: documentation status only; the record page and API are closed.
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await login(owner, 'owner.nour@demo.test');
  await owner.goto(appointmentUrl);
  await expect(owner.getByTestId('documentation-status')).toHaveText('سجل الزيارة: معتمد');
  await expect(owner.getByText('تظهر لك حالة التوثيق فقط', { exact: false })).toBeVisible();
  await expect(owner.locator('body')).not.toContainText(MARK);
  await owner.goto(recordUrl);
  await expect(owner.getByRole('heading', { name: 'لا يمكنك الوصول إلى هذه الصفحة' })).toBeVisible();
  const appointmentId = /appointments\/([a-f\d]{24})/.exec(recordUrl)?.[1];
  expect((await owner.request.get(`/api/v1/orgs/${orgId}/appointments/${appointmentId}/encounter`)).status()).toBe(403);
  await ownerContext.close();

  // Receptionist: not even the status. Another doctor: the generic "not found".
  const deskContext = await browser.newContext();
  const desk = await deskContext.newPage();
  await login(desk, 'reception.nour@demo.test');
  await desk.goto(appointmentUrl);
  await expect(desk.getByTestId('appointment-status')).toBeVisible();
  await expect(desk.getByTestId('documentation-status')).toHaveCount(0);
  expect((await desk.request.get(`/api/v1/orgs/${orgId}/appointments/${appointmentId}/encounter`)).status()).toBe(403);
  await deskContext.close();

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await login(other, 'doctor.nour@demo.test');
  const denied = await other.request.get(`/api/v1/orgs/${orgId}/appointments/${appointmentId}/encounter`);
  expect(denied.status()).toBe(404);
  expect(await denied.text()).not.toContain(MARK);
  await otherContext.close();

  // Signing out clears the session; going back does not show the record.
  await logout(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('body')).not.toContainText(MARK);
  errors.expectNone();
});

test('late entry for a completed visit, listed in the doctor’s timeline for the patient', async ({ page }) => {
  // The first attempt without a reason is rejected by the API on purpose.
  const errors = watchBrowserErrors(page, [/status of 400/]);
  await login(page, 'doctor2.nour@demo.test');
  const orgId = orgIdFromUrl(page);
  const appointmentId = await todaysAppointment(page, orgId, 'أحمد محمود علي', 'completed');

  await page.goto(`/app/${orgId}/appointments/${appointmentId}/record`);
  await expect(page.getByRole('heading', { name: 'توثيق متأخر' })).toBeVisible();
  await page.getByRole('button', { name: 'بدء سجل الزيارة' }).click();
  await expect(page.locator('#late-entry-reason-error')).toBeVisible();
  await page.getByLabel('سبب التوثيق المتأخر').fill('كُتب بعد انتهاء العيادة');
  await page.getByRole('button', { name: 'بدء سجل الزيارة' }).click();
  await expect(page.getByLabel('سبب الزيارة', { exact: true })).toBeVisible();
  await expect(page.getByText('توثيق متأخر', { exact: true })).toBeVisible();

  const patientId = ((await (await page.request.get(`/api/v1/orgs/${orgId}/appointments/${appointmentId}`)).json()) as { appointment: { patient: { id: string } } })
    .appointment.patient.id;
  await page.goto(`/app/${orgId}/patients/${patientId}`);
  const history = page.getByTestId('clinical-history');
  // The seeded finalized record of yesterday, plus today's late entry.
  await expect(history.getByTestId('clinical-history-item')).toHaveCount(2);
  await expect(history.getByText('توثيق متأخر', { exact: true })).toHaveCount(1);
  errors.expectNone();
});

test('two tabs: the stale save gets a conflict and nothing is overwritten (English)', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await login(page, 'doctor.nour@demo.test');
  const orgId = orgIdFromUrl(page);
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  const appointmentId = await todaysAppointment(page, orgId, 'Sara Adel', 'completed');
  const url = `/app/${orgId}/appointments/${appointmentId}/record`;

  const second = await page.context().newPage();
  await page.goto(url);
  await second.goto(url);
  await expect(second.getByLabel('Plan and follow-up', { exact: true })).toBeVisible();

  await page.getByLabel('Relevant history', { exact: true }).fill(`${MARK} tab A`);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByTestId('save-state')).toContainText('Draft saved');

  await second.getByLabel('Plan and follow-up', { exact: true }).fill(`${MARK} tab B`);
  await second.getByRole('button', { name: 'Save draft' }).click();
  await expect(second.getByTestId('conflict')).toContainText('This record changed in another tab or window');
  await expect(second.getByLabel('Plan and follow-up', { exact: true })).toHaveValue(`${MARK} tab B`);

  await second.getByRole('button', { name: 'Load the latest saved version (discard my changes here)' }).click();
  await expect(second.getByLabel('Relevant history', { exact: true })).toHaveValue(`${MARK} tab A`);
  await expect(second.getByTestId('conflict')).toHaveCount(0);
  await second.close();
  // The language choice is saved to the account: restore Arabic for the other tests.
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  errors.expectNone();
});

test('mobile: the visit record editor fits the screen @mobile', async ({ page }) => {
  const errors = watchBrowserErrors(page);
  await login(page, 'doctor.nour@demo.test');
  const orgId = orgIdFromUrl(page);
  const appointmentId = await todaysAppointment(page, orgId, 'Sara Adel', 'completed');
  await page.goto(`/app/${orgId}/appointments/${appointmentId}/record`);
  const arabic = page.getByRole('button', { name: 'العربية' });
  if (await arabic.isVisible()) await arabic.click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByLabel('سبب الزيارة', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expect(page.getByRole('button', { name: 'حفظ المسودة' })).toBeVisible();
  errors.expectNone();
});
