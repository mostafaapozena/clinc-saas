import { expect, test } from '@playwright/test';
import { login, orgIdFromUrl, watchBrowserErrors } from './helpers';

const NOUR = 'عيادات النور (تجريبي)';
const SHIFA = 'مركز الشفاء (تجريبي)';

test('a member of two organizations switches scope without leftovers from the previous one', async ({ page }) => {
  const browser = watchBrowserErrors(page);
  await login(page, 'multi@demo.test');

  const orgSelect = page.locator('#org-switcher');
  if ((await page.getByTestId('home-org-name').textContent()) !== NOUR) {
    await orgSelect.selectOption({ label: NOUR });
  }
  await expect(page.getByTestId('home-org-name')).toHaveText(NOUR);
  await expect(page.getByTestId('home-role')).toHaveText('مدير');
  await expect(page.getByRole('navigation').getByRole('link', { name: 'الفريق' })).toBeVisible();
  const nourBranches = await page.locator('#branch-switcher option').allTextContents();
  expect(nourBranches).toEqual(['كل الفروع', 'فرع الإسكندرية', 'فرع المعادي', 'فرع مدينة نصر']);

  await orgSelect.selectOption({ label: SHIFA });

  await expect(page.getByTestId('home-org-name')).toHaveText(SHIFA);
  await expect(page.getByTestId('home-role')).toHaveText('طبيب');
  // One branch: shown as text, not as a one-option list.
  await expect(page.locator('#branch-current')).toHaveText('فرع جدة');
  await expect(page.getByRole('navigation').getByRole('link', { name: 'الفريق' })).toHaveCount(0);
  // Nothing from the previous organization remains on screen.
  const main = page.locator('#main-content');
  for (const leftover of [NOUR, 'فرع المعادي', 'فرع مدينة نصر', 'مدير']) {
    await expect(main).not.toContainText(leftover);
  }
  await page.getByRole('navigation').getByRole('link', { name: 'الفروع' }).click();
  await expect(page.getByTestId('branch-row')).toHaveCount(1);
  await expect(page.getByTestId('branch-row')).toContainText('فرع جدة');
  browser.expectNone();
});

test('a branch-restricted doctor only sees permitted pages and branches', async ({ page }) => {
  await login(page, 'doctor.nour@demo.test');
  const orgId = orgIdFromUrl(page);

  const nav = page.getByRole('navigation');
  // Phase 3: a doctor also gets their appointments, the queue and their own schedule — not the registry or team;
  // milestone 1 adds clinical coverage (records shared between doctors); milestone 5 adds help & support;
  // ERP milestone B adds the stock pages (read-only: doctors record materials used on their records);
  // milestone D adds their own practitioner-fee statements; milestone E their specialty worklist (a dentist: plans).
  await expect(nav.getByRole('link')).toHaveText(['الرئيسية', 'المواعيد', 'قائمة الانتظار', 'جدولي', 'خطط العلاج', 'التغطية السريرية', 'المخزون والمستلزمات', 'الأجهزة والصيانة', 'مستحقات الأطباء', 'الفروع', 'المساعدة والدعم', 'الملف الشخصي']);
  await expect(page.getByTestId('stat-members')).toHaveCount(0);
  await expect(page.locator('#branch-current')).toHaveText('فرع المعادي');

  await page.goto(`/app/${orgId}/team`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('لا يمكنك الوصول إلى هذه الصفحة');

  await page.goto(`/app/${orgId}/branches`);
  await expect(page.getByTestId('branch-row')).toHaveText([/فرع المعادي/]);
  await expect(page.getByRole('button', { name: 'إضافة الفرع' })).toHaveCount(0);

  // Hidden controls are not the protection: the API refuses on its own.
  expect((await page.request.get(`/api/v1/orgs/${orgId}/members`)).status()).toBe(403);
});

test('an owner manages the team: add an existing user, change role and branches, suspend and reactivate', async ({ page }) => {
  const browser = watchBrowserErrors(page, [/status of 404/]);
  await login(page, 'owner.nour@demo.test');
  await page.getByRole('navigation').getByRole('link', { name: 'الفريق' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('الفريق');

  // Unknown email: explain that the person must register first.
  await page.locator('#member-email').fill('not.registered@example.test');
  await page.getByRole('button', { name: 'إضافة العضو' }).click();
  await expect(page.getByRole('alert')).toContainText('اطلب من الشخص إنشاء حساب أولاً');

  await page.locator('#member-email').fill('newcomer@demo.test');
  await page.locator('#member-role').selectOption('receptionist');
  // The team page also has the invitation form (milestone 5); scope to "add a registered member".
  const addForm = page.getByRole('region', { name: 'إضافة عضو مسجَّل' });
  await addForm.getByLabel('فروع محددة').check();
  await addForm.getByLabel('فرع الإسكندرية').check();
  await page.getByRole('button', { name: 'إضافة العضو' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'تمت إضافة' })).toBeVisible();

  const row = page.getByTestId('member-row').filter({ hasText: 'newcomer@demo.test' });
  await expect(row.getByTestId('member-role')).toHaveText('موظف استقبال');
  await expect(row).toContainText('فرع الإسكندرية');

  await row.getByRole('button', { name: /^تعديل عضوية/ }).click();
  const editor = page.locator('.data-row--editing');
  await editor.getByLabel('الدور').selectOption('viewer');
  await editor.getByLabel('كل الفروع').check();
  await editor.getByRole('button', { name: 'حفظ' }).click();
  await expect(row.getByTestId('member-role')).toHaveText('مطّلع');
  await expect(row).toContainText('كل الفروع');

  await row.getByRole('button', { name: /^إيقاف عضوية/ }).click();
  await expect(row.getByTestId('member-status')).toHaveText('موقوف');
  await row.getByRole('button', { name: /^إعادة تفعيل عضوية/ }).click();
  await expect(row.getByTestId('member-status')).toHaveText('نشط');

  // The owner's own row offers no actions (self-modification is not allowed).
  const self = page.getByTestId('member-row').filter({ hasText: 'owner.nour@demo.test' });
  await expect(self.getByRole('button')).toHaveCount(0);
  browser.expectNone();
});

test('owners and admins manage branches; search stays within the organization', async ({ page }) => {
  const browser = watchBrowserErrors(page);
  await login(page, 'admin.nour@demo.test');
  await page.getByRole('navigation').getByRole('link', { name: 'الفروع' }).click();

  await page.locator('#new-branch-name').fill('فرع التجمع');
  await page.locator('#new-branch-city').fill('القاهرة الجديدة');
  await page.getByRole('button', { name: 'إضافة الفرع' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'فرع التجمع' })).toBeVisible();

  await page.locator('#branch-search').fill('جدة');
  await expect(page.getByText('لا توجد فروع مطابقة للبحث.')).toBeVisible();
  await page.locator('#branch-search').fill('التجمع');
  await expect(page.getByTestId('branch-row')).toHaveCount(1);
  browser.expectNone();
});
