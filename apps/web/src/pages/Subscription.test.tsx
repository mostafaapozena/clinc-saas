import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Permission } from '../lib/types';
import { apiError, mockApi, renderRoute } from '../test/render';

const ORG = 'f'.repeat(24);
const user = { id: 'u1', email: 'owner@example.test', displayName: 'Owner', preferredLanguage: 'ar', emailVerified: false };
const OWNER: Permission[] = [
  'organization.read',
  'organization.update',
  'branch.read',
  'dashboard.read',
  'member.read',
  'subscription.read',
  'subscription.manage',
];
const ADMIN: Permission[] = ['organization.read', 'branch.read', 'dashboard.read', 'member.read', 'subscription.read'];

function shell(role: string, permissions: Permission[]) {
  return {
    'GET /api/v1/auth/session': { user, csrfToken: 'csrf', memberships: [{ organization: { id: ORG, name: 'Clinic' }, role }] },
    [`GET /api/v1/orgs/${ORG}`]: {
      organization: {
        id: ORG,
        name: 'Clinic',
        timeZone: 'Africa/Cairo',
        type: null,
        specialtyCodes: [],
        configVersion: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      membership: { id: 'm1', role, branchScope: { type: 'all', branchIds: [] }, permissions, capabilities: [], practitionerId: null },
      stats: { accessibleBranches: 1 },
    },
    [`GET /api/v1/orgs/${ORG}/branches`]: { data: [] },
    [`GET /api/v1/orgs/${ORG}/practitioners`]: { data: [] },
  };
}
const grant = {
  id: 's1',
  kind: 'development_grant',
  status: 'active',
  effectiveStatus: 'active',
  plan: { id: 'p0', code: 'development', version: 1, name: { ar: 'وصول التطوير', en: 'Development access' } },
  limits: { branches: null, practitioners: null, members: null },
  currentPeriodEnd: null,
  price: null,
  provider: null,
  restriction: null,
  version: 0,
  updatedAt: '2026-11-10T08:00:00.000Z',
};
const plans = {
  data: [
    {
      id: 'p0',
      code: 'development',
      version: 1,
      name: { ar: 'وصول التطوير', en: 'Development access' },
      status: 'active',
      prices: [],
      limits: { branches: null, practitioners: null, members: null },
    },
    {
      id: 'p1',
      code: 'simulator-test',
      version: 1,
      name: { ar: 'خطة اختبار', en: 'Test plan' },
      status: 'active',
      prices: [{ currency: 'EGP', interval: 'month', amountMinor: 100 }],
      limits: { branches: 2, practitioners: null, members: null },
    },
  ],
};
const subscriptionView = (sub: unknown = grant) => ({
  subscription: sub,
  usage: { branches: 1, practitioners: 0, members: 1 },
  enforcement: 'off',
  billingProvider: 'simulator',
});
const checkout = (status = 'open') => ({
  checkout: {
    id: 'c1',
    plan: { code: 'simulator-test', version: 1 },
    price: { currency: 'EGP', interval: 'month', amountMinor: 100 },
    status,
    provider: 'simulator',
    simulated: true,
    expiresAt: '2026-11-10T09:00:00.000Z',
  },
});
const bodies = (fetchMock: ReturnType<typeof mockApi>, method: string, suffix: string) =>
  fetchMock.mock.calls
    .filter(([url, init]) => String(url).endsWith(suffix) && ((init as RequestInit | undefined)?.method ?? 'GET') === method)
    .map(([, init]) => JSON.parse(String((init as RequestInit).body ?? '{}')) as Record<string, unknown>);

describe('clinic subscription page', () => {
  it('labels a development grant as not commercial, and the owner subscribes through the simulator by plan, never by amount', async () => {
    const fetchMock = mockApi({
      ...shell('owner', OWNER),
      [`GET /api/v1/orgs/${ORG}/subscription`]: subscriptionView(),
      [`GET /api/v1/orgs/${ORG}/subscription/plans`]: plans,
      [`POST /api/v1/orgs/${ORG}/subscription/checkouts`]: checkout(),
      [`GET /api/v1/orgs/${ORG}/subscription/checkouts/c1`]: checkout(),
    });
    renderRoute(`/app/${ORG}/subscription`);
    const current = await screen.findByTestId('subscription-current');
    expect(within(current).getByText('منحة تطوير')).toBeInTheDocument();
    expect(within(current).getByText(/ليس اشتراكًا تجاريًا/)).toBeInTheDocument();
    expect(screen.getByText(/محاكي دفع/)).toBeInTheDocument();
    expect(screen.getByText(/غير مطبَّقة في هذه البيئة/)).toBeInTheDocument();
    expect(screen.getByText('لا سعر محدد — متاحة كمنحة تطوير فقط.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'الاشتراك' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'اشترك (محاكي)' }));
    expect(await screen.findByTestId('simulator-checkout')).toBeInTheDocument();
    expect(bodies(fetchMock, 'POST', '/subscription/checkouts')).toEqual([{ planId: 'p1', currency: 'EGP', interval: 'month' }]);
  });

  it('admins see the subscription but cannot start a checkout', async () => {
    mockApi({
      ...shell('admin', ADMIN),
      [`GET /api/v1/orgs/${ORG}/subscription`]: subscriptionView(null),
      [`GET /api/v1/orgs/${ORG}/subscription/plans`]: plans,
    });
    renderRoute(`/app/${ORG}/subscription`);
    expect(await screen.findByText('لا يوجد اشتراك مسجّل لهذه المنشأة.')).toBeInTheDocument();
    await screen.findByText('خطة اختبار');
    expect(screen.queryByRole('button', { name: 'اشترك (محاكي)' })).not.toBeInTheDocument();
  });

  it('the simulated checkout is clearly labelled and reports the outcome', async () => {
    const fetchMock = mockApi({
      ...shell('owner', OWNER),
      [`GET /api/v1/orgs/${ORG}/subscription/checkouts/c1`]: checkout(),
      [`POST /api/v1/orgs/${ORG}/subscription/checkouts/c1/simulate`]: checkout('completed'),
      [`GET /api/v1/orgs/${ORG}/subscription`]: subscriptionView(),
    });
    renderRoute(`/app/${ORG}/subscription/checkout/c1`);
    expect(await screen.findByText(/لا يتم أي دفع حقيقي/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'محاكاة دفع ناجح' }));
    expect(await screen.findByText(/نجح الدفع المحاكى/)).toBeInTheDocument();
    expect(bodies(fetchMock, 'POST', '/simulate')).toEqual([{ outcome: 'succeeded' }]);
  });
});

const operatorSession = (role: 'platform_admin' | 'support') => ({
  operator: {
    id: 'o1',
    email: 'op@example.test',
    displayName: 'Op',
    role,
    permissions:
      role === 'platform_admin'
        ? [
            'platform.overview.read',
            'platform.organizations.read',
            'platform.plans.read',
            'platform.plans.manage',
            'platform.subscriptions.manage',
            'platform.inquiries.read',
            'platform.inquiries.manage',
            'platform.operators.read',
            'platform.audit.read',
          ]
        : [
            'platform.overview.read',
            'platform.organizations.read',
            'platform.plans.read',
            'platform.inquiries.read',
            'platform.inquiries.manage',
          ],
  },
  csrfToken: 'op-csrf',
});
const overview = {
  organizations: 3,
  subscriptions: { byStatus: { active: 2, none: 1 }, byKind: { development_grant: 2 } },
  inquiries: { new: 1 },
  health: { database: { status: 'up', latencyMs: 2 }, uptimeSeconds: 10 },
  config: { billingProvider: 'simulator', subscriptionEnforcement: 'off', operatorIdleMinutes: 30 },
};

describe('platform operator console', () => {
  it('has its own sign-in, sends the operator CSRF header, and never touches the clinic session', async () => {
    let signedIn = false;
    const fetchMock = mockApi({
      'GET /api/v1/platform/auth/session': () => (signedIn ? operatorSession('support') : { operator: null }),
      'POST /api/v1/platform/auth/login': () => {
        signedIn = true;
        return operatorSession('support');
      },
      'GET /api/v1/platform/overview': overview,
      'POST /api/v1/platform/auth/logout': () => new Response(null, { status: 204 }),
    });
    renderRoute('/operator');
    expect(await screen.findByRole('heading', { name: 'دخول المشغّل' })).toBeInTheDocument();
    expect(screen.getByText(/لا يوجد تسجيل/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('البريد الإلكتروني'), { target: { value: 'op@example.test' } });
    fireEvent.change(screen.getByLabelText('كلمة المرور'), { target: { value: 'secret-password' } });
    fireEvent.click(screen.getByRole('button', { name: /دخول|تسجيل الدخول/ }));
    expect(await screen.findByRole('heading', { name: 'نظرة عامة' })).toBeInTheDocument();
    expect(screen.getByText(/لا يمكن الوصول هنا إلى المرضى/)).toBeInTheDocument();
    // Support: no operators or audit navigation.
    expect(screen.queryByRole('link', { name: 'المشغّلون' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'سجل المنصة' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الخروج' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/platform/auth/logout'))).toBe(true));
    const logout = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/platform/auth/logout'))!;
    expect((logout[1] as RequestInit).headers).toMatchObject({ 'X-Operator-CSRF': 'op-csrf' });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/v1/auth/'))).toBe(false);
  });

  it('a platform admin grants a development grant from the organization page', async () => {
    const fetchMock = mockApi({
      'GET /api/v1/platform/auth/session': operatorSession('platform_admin'),
      'GET /api/v1/platform/organizations/org1': {
        organization: {
          id: 'org1',
          name: 'Synthetic Clinic',
          type: 'clinic',
          specialtyCodes: [],
          timeZone: 'Africa/Cairo',
          currency: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          branches: [{ id: 'b1', name: 'North', status: 'active' }],
          owners: [{ displayName: 'Owner', email: 'o•••@example.test' }],
        },
        usage: { branches: 1, practitioners: 0, members: 1 },
        subscription: null,
        history: [],
        billingEvents: [],
      },
      'GET /api/v1/platform/plans': plans,
      'POST /api/v1/platform/organizations/org1/subscription/grant': { subscription: grant },
    });
    renderRoute('/operator/organizations/org1');
    expect(await screen.findByRole('heading', { name: 'Synthetic Clinic' })).toBeInTheDocument();
    expect(screen.getByText('o•••@example.test')).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('الخطة'), { target: { value: 'p0' } });
    fireEvent.change(screen.getByLabelText('ملاحظة'), { target: { value: 'Pilot clinic' } });
    fireEvent.click(screen.getByRole('button', { name: 'منح' }));
    await waitFor(() =>
      expect(bodies(fetchMock, 'POST', '/subscription/grant')).toEqual([{ planId: 'p0', endsAt: null, note: 'Pilot clinic' }]),
    );
  });

  it('plan prices are parsed from text into minor units', async () => {
    const fetchMock = mockApi({
      'GET /api/v1/platform/auth/session': operatorSession('platform_admin'),
      'GET /api/v1/platform/plans': { data: [] },
      'POST /api/v1/platform/plans': { plan: plans.data[1] },
    });
    renderRoute('/operator/plans');
    fireEvent.click(await screen.findByRole('button', { name: 'خطة مسودة جديدة' }));
    const form = screen.getByTestId('plan-form');
    fireEvent.change(within(form).getByLabelText('الرمز'), { target: { value: 'basic' } });
    fireEvent.change(within(form).getByLabelText('الاسم (عربي)'), { target: { value: 'أساسية' } });
    fireEvent.change(within(form).getByLabelText('الاسم (إنجليزي)'), { target: { value: 'Basic' } });
    fireEvent.click(within(form).getByRole('button', { name: 'إضافة سعر' }));
    fireEvent.change(within(form).getByLabelText('المبلغ'), { target: { value: '١٥٠.٥٠' } });
    fireEvent.change(within(form).getByLabelText('الفروع النشطة'), { target: { value: '2' } });
    fireEvent.click(within(form).getByRole('button', { name: 'حفظ المسودة' }));
    await waitFor(() =>
      expect(bodies(fetchMock, 'POST', '/platform/plans')).toEqual([
        {
          code: 'basic',
          name: { ar: 'أساسية', en: 'Basic' },
          prices: [{ currency: 'EGP', interval: 'month', amountMinor: 15050 }],
          limits: { branches: 2, practitioners: null, members: null },
          note: '', trialDays: null,
        },
      ]),
    );
  });

  it('inquiry contacts stay masked until explicitly revealed', async () => {
    const fetchMock = mockApi({
      'GET /api/v1/platform/auth/session': operatorSession('support'),
      'GET /api/v1/platform/inquiries/R-TEST0001': {
        inquiry: {
          reference: 'R-TEST0001',
          createdAt: '2026-11-01T00:00:00.000Z',
          status: 'new',
          country: 'EG',
          organizationType: 'clinic',
          interest: 'custom',
          organizationName: 'Synthetic Center',
          language: 'ar',
          contactName: 'ه…',
          phone: '+201••••••09',
          email: null,
          description: 'Synthetic description',
        },
      },
      'POST /api/v1/platform/inquiries/R-TEST0001/reveal-contact': { contact: { name: 'هالة', phone: '+201000000009', email: null } },
    });
    renderRoute('/operator/inquiries/R-TEST0001');
    const contact = await screen.findByTestId('inquiry-contact');
    expect(within(contact).getByText('+201••••••09')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'كشف بيانات التواصل' }));
    expect(await within(contact).findByText('+201000000009')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/reveal-contact'))).toHaveLength(1);
  });

  it('an expired operator session returns to the operator sign-in', async () => {
    mockApi({ 'GET /api/v1/platform/auth/session': { operator: null }, 'GET /api/v1/platform/overview': apiError(401, 'UNAUTHENTICATED') });
    renderRoute('/operator/organizations');
    expect(await screen.findByRole('heading', { name: 'دخول المشغّل' })).toBeInTheDocument();
  });
});
