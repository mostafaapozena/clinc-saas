import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

// Subscription lifecycle UI: trials, plan-change and cancellation requests (local intent vs provider).
const ORG = 'c'.repeat(24);
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
const shell = () => ({
  'GET /api/v1/auth/session': { user, csrfToken: 'csrf', memberships: [{ organization: { id: ORG, name: 'Clinic' }, role: 'owner' }] },
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
    membership: {
      id: 'm1',
      role: 'owner',
      branchScope: { type: 'all', branchIds: [] },
      permissions: OWNER,
      capabilities: [],
      practitionerId: null,
    },
    stats: { accessibleBranches: 1 },
  },
  [`GET /api/v1/orgs/${ORG}/branches`]: { data: [] },
  [`GET /api/v1/orgs/${ORG}/practitioners`]: { data: [] },
});
const plans = {
  data: [
    {
      id: 'pt',
      code: 'trial-plan',
      version: 1,
      name: { ar: 'خطة تجربة', en: 'Trial plan' },
      status: 'active',
      prices: [],
      limits: { branches: null, practitioners: null, members: null },
      trialDays: 14,
    },
    {
      id: 'pa',
      code: 'paid-a',
      version: 1,
      name: { ar: 'مدفوعة أ', en: 'Paid A' },
      status: 'active',
      prices: [{ currency: 'EGP', interval: 'month', amountMinor: 100 }],
      limits: { branches: null, practitioners: null, members: null },
      trialDays: null,
    },
    {
      id: 'pb',
      code: 'paid-b',
      version: 1,
      name: { ar: 'مدفوعة ب', en: 'Paid B' },
      status: 'active',
      prices: [{ currency: 'EGP', interval: 'month', amountMinor: 200 }],
      limits: { branches: null, practitioners: null, members: null },
      trialDays: null,
    },
  ],
};
const base = {
  limits: null,
  restriction: null,
  provider: null,
  price: null,
  currentPeriodEnd: null,
  trialUsed: false,
  trialEndsAt: null,
  pastDueSince: null,
  cancelRequest: null,
  pendingChange: null,
  updatedAt: '2026-11-10T08:00:00.000Z',
};
const commercial = (extra: object = {}) => ({
  ...base,
  id: 's1',
  kind: 'commercial',
  status: 'active',
  effectiveStatus: 'active',
  plan: { id: 'pa', code: 'paid-a', version: 1, name: { ar: 'مدفوعة أ', en: 'Paid A' } },
  price: { currency: 'EGP', interval: 'month', amountMinor: 100 },
  provider: 'simulator',
  currentPeriodEnd: '2026-12-10T08:00:00.000Z',
  trialUsed: true,
  version: 3,
  ...extra,
});
const view = (sub: unknown) => ({
  subscription: sub,
  usage: { branches: 1, practitioners: 0, members: 1 },
  enforcement: 'off',
  billingProvider: 'simulator',
  policy: { graceDays: null, afterGrace: 'none', restrictedAccess: 'growth_only' },
});
const bodies = (fetchMock: ReturnType<typeof mockApi>, suffix: string) =>
  fetchMock.mock.calls
    .filter(([url, init]) => String(url).endsWith(suffix) && (init as RequestInit | undefined)?.method === 'POST')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body ?? '{}')));

describe('subscription lifecycle (owner)', () => {
  it('offers a trial only on plans that have one, and shows when it ends', async () => {
    const trialing = {
      ...base,
      id: 's1',
      kind: 'development_grant',
      status: 'trialing',
      effectiveStatus: 'trialing',
      plan: { id: 'pt', code: 'trial-plan', version: 1, name: { ar: 'خطة تجربة', en: 'Trial plan' } },
      trialUsed: true,
      trialEndsAt: '2026-11-24T08:00:00.000Z',
      currentPeriodEnd: '2026-11-24T08:00:00.000Z',
      version: 1,
    };
    const fetchMock = mockApi({
      ...shell(),
      [`GET /api/v1/orgs/${ORG}/subscription`]: view(null),
      [`GET /api/v1/orgs/${ORG}/subscription/plans`]: plans,
      [`POST /api/v1/orgs/${ORG}/subscription/trial`]: view(trialing),
    });
    renderRoute(`/app/${ORG}/subscription`);
    const start = await screen.findByRole('button', { name: 'ابدأ تجربة 14 يومًا' });
    expect(screen.getAllByRole('button', { name: /ابدأ تجربة/ })).toHaveLength(1);
    fireEvent.click(start);
    expect(await screen.findByTestId('trial-ends')).toHaveTextContent('تنتهي في');
    expect(bodies(fetchMock, '/subscription/trial')).toEqual([{ planId: 'pt' }]);
    expect(screen.queryByRole('button', { name: /ابدأ تجربة/ })).not.toBeInTheDocument();
  });

  it('requests a plan change for a commercial subscription and labels it as simulator-acknowledged; it can be withdrawn', async () => {
    const pending = commercial({
      version: 4,
      pendingChange: {
        plan: { id: 'pb', code: 'paid-b', version: 1 },
        price: { currency: 'EGP', interval: 'month', amountMinor: 200 },
        effectiveAt: '2026-12-10T08:00:00.000Z',
        requestedAt: '2026-11-10T08:00:00.000Z',
        providerAcknowledged: true,
      },
    });
    const fetchMock = mockApi({
      ...shell(),
      [`GET /api/v1/orgs/${ORG}/subscription`]: view(commercial()),
      [`GET /api/v1/orgs/${ORG}/subscription/plans`]: plans,
      [`POST /api/v1/orgs/${ORG}/subscription/plan-change`]: { ...view(pending), replayed: false },
      [`POST /api/v1/orgs/${ORG}/subscription/plan-change/withdraw`]: view(commercial({ version: 5 })),
    });
    renderRoute(`/app/${ORG}/subscription`);
    // No checkout for an existing commercial subscription; a plan-change request instead (never on the current price).
    await screen.findByText('مدفوعة ب');
    expect(screen.queryByRole('button', { name: 'اشترك (محاكي)' })).not.toBeInTheDocument();
    const requests = screen.getAllByRole('button', { name: 'اطلب هذه الخطة' });
    expect(requests).toHaveLength(1);
    fireEvent.click(requests[0]!);
    const box = await screen.findByTestId('pending-change');
    expect(box).toHaveTextContent('paid-b');
    expect(box).toHaveTextContent('سُجّل لدى محاكي الدفع');
    expect(bodies(fetchMock, '/subscription/plan-change')).toEqual([{ planId: 'pb', currency: 'EGP', interval: 'month', version: 3 }]);
    fireEvent.click(within(box).getByRole('button', { name: 'سحب تغيير الخطة' }));
    await waitFor(() => expect(screen.queryByTestId('pending-change')).not.toBeInTheDocument());
    expect(bodies(fetchMock, '/plan-change/withdraw')).toEqual([{ version: 4 }]);
  });

  it('cancellation needs an explicit confirmation and shows a local, unconfirmed request honestly', async () => {
    const requested = commercial({
      version: 4,
      cancelRequest: { requestedAt: '2026-11-10T08:00:00.000Z', reason: '', providerAcknowledged: false },
    });
    const fetchMock = mockApi({
      ...shell(),
      [`GET /api/v1/orgs/${ORG}/subscription`]: view(commercial()),
      [`GET /api/v1/orgs/${ORG}/subscription/plans`]: plans,
      [`POST /api/v1/orgs/${ORG}/subscription/cancel`]: { ...view(requested), replayed: false },
    });
    renderRoute(`/app/${ORG}/subscription`);
    fireEvent.click(await screen.findByRole('button', { name: 'إلغاء الاشتراك…' }));
    const panel = screen.getByTestId('cancel-panel');
    expect(panel).toHaveTextContent('ينتهي الاشتراك في نهاية الفترة المدفوعة');
    const confirm = within(panel).getByRole('button', { name: 'نعم، ألغِ' });
    expect(confirm).toBeDisabled();
    fireEvent.click(within(panel).getByRole('checkbox'));
    fireEvent.click(confirm);
    const request = await screen.findByTestId('cancel-request');
    expect(request).toHaveTextContent('مسجّل هنا فقط — لم يؤكده مزوّد دفع بعد');
    expect(bodies(fetchMock, '/subscription/cancel')).toEqual([{ version: 3, confirm: true, reason: '' }]);
  });
});

describe('billing policy and lifecycle (operator)', () => {
  it('shows the unset policy, saves an explicit one, and previews the lifecycle pass', async () => {
    const operator = {
      id: 'o1',
      email: 'op@example.test',
      displayName: 'Op',
      role: 'platform_admin',
      permissions: ['platform.overview.read', 'platform.plans.read', 'platform.subscriptions.manage'],
    };
    const fetchMock = mockApi({
      'GET /api/v1/platform/auth/session': { operator, csrfToken: 'op' },
      'GET /api/v1/platform/overview': {
        organizations: 1,
        subscriptions: { byStatus: {}, byKind: {} },
        inquiries: { new: 0 },
        support: { open: 0 },
        health: { database: { status: 'up', latencyMs: 1 }, uptimeSeconds: 1 },
        config: { billingProvider: 'none', subscriptionEnforcement: 'off', operatorIdleMinutes: 30 },
      },
      'GET /api/v1/platform/billing/policy': {
        policy: { graceDays: null, afterGrace: 'none', restrictedAccess: 'growth_only', revision: 0 },
      },
      'PUT /api/v1/platform/billing/policy': (init: RequestInit) => ({ policy: { ...JSON.parse(String(init.body)), revision: 1 } }),
      'POST /api/v1/platform/billing/lifecycle': {
        actions: [{ organizationId: 'a'.repeat(24), from: 'trialing', to: 'expired', reason: 'trial_ended', applied: false }],
      },
    });
    renderRoute('/operator');
    const card = await screen.findByTestId('billing-policy');
    expect(within(card).getAllByText('غير محدد').length).toBeGreaterThan(0);
    fireEvent.click(within(card).getByRole('button', { name: 'تعديل السياسة' }));
    fireEvent.change(within(card).getByLabelText('فترة السماح'), { target: { value: '7' } });
    fireEvent.change(within(card).getByLabelText('بعد فترة السماح'), { target: { value: 'restricted' } });
    fireEvent.click(within(card).getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(within(screen.getByTestId('billing-policy')).getByText('7 يوم')).toBeInTheDocument());
    const put = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith('/billing/policy') && (i as RequestInit).method === 'PUT')!;
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({
      graceDays: 7,
      afterGrace: 'restricted',
      restrictedAccess: 'growth_only',
      revision: 0,
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'فحص (تجريبي)' }).at(-1)!);
    expect(await screen.findByTestId('lifecycle-result')).toHaveTextContent('انتهت التجربة');
  });
});
