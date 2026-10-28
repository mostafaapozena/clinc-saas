import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, renderRoute } from '../test/render';

// Front-end audit (2026-10-27): the operator console in plain language, with stable list state.
const session = {
  operator: {
    id: 'o1',
    email: 'op@example.test',
    displayName: 'Op',
    role: 'platform_admin',
    permissions: [
      'platform.overview.read',
      'platform.organizations.read',
      'platform.plans.read',
      'platform.plans.manage',
      'platform.subscriptions.manage',
      'platform.inquiries.read',
      'platform.inquiries.manage',
      'platform.operators.read',
      'platform.audit.read',
    ],
  },
  csrfToken: 'op-csrf',
};
const overview = {
  organizations: 3,
  subscriptions: { byStatus: { active: 2, none: 1 }, byKind: { development_grant: 2 } },
  inquiries: { new: 1 },
  health: { database: { status: 'up', latencyMs: 2 }, uptimeSeconds: 10 },
  config: { billingProvider: 'none', subscriptionEnforcement: 'off', operatorIdleMinutes: 30 },
};
const base = { 'GET /api/v1/platform/auth/session': session, 'GET /api/v1/platform/overview': overview };

describe('platform audit', () => {
  it('shows actions and targets in words, marks previews, and keeps unknown codes readable', async () => {
    mockApi({
      ...base,
      'GET /api/v1/platform/audit': {
        data: [
          { id: '1', at: '2026-10-27T02:08:00.000Z', actor: 'operator', operator: 'Op', action: 'billing.reconciliation_run', target: { type: 'subscription', id: 'all' }, changes: { apply: false } },
          { id: '2', at: '2026-10-27T01:51:00.000Z', actor: 'operator', operator: 'Op', action: 'operator.signed_in', target: { type: 'operator', id: 'c4e3ec8d1234' }, changes: {} },
          { id: '3', at: '2026-10-27T01:50:00.000Z', actor: 'system', operator: null, action: 'some.new_code', target: { type: 'thing', id: 'x1234567' }, changes: {} },
        ],
        next: null,
      },
    });
    renderRoute('/operator/audit');
    const first = (await screen.findByText('فحص المطابقة مع مزوّد الدفع')).closest('tr')!;
    expect(within(first).getByText('(تجريبي)')).toBeInTheDocument();
    expect(within(first).getByText('كل الاشتراكات')).toBeInTheDocument();
    const second = screen.getByText('تسجيل دخول مشغّل').closest('tr')!;
    expect(within(second).queryByText('(تجريبي)')).not.toBeInTheDocument();
    expect(second).toHaveTextContent('مشغّل 8d1234'); // type in words, then the end of the id
    expect(screen.getByText('some.new_code')).toBeInTheDocument();
    // Mobile cards label every value.
    expect([...first.querySelectorAll('td')].map((td) => td.dataset.label)).toEqual(['الوقت', 'بواسطة', 'الإجراء', 'الهدف']);
  });
});

describe('list state in the URL', () => {
  it('restores the inquiry filter from the URL and writes changes back', async () => {
    const requests: URL[] = [];
    const { router } = renderRouteWith(
      {
        ...base,
        'GET /api/v1/platform/inquiries': (_init: RequestInit, url: URL) => {
          requests.push(url);
          return { data: [] };
        },
      },
      '/operator/inquiries?status=all',
    );
    expect(await screen.findByRole('button', { name: 'الكل', pressed: true })).toBeInTheDocument();
    await waitFor(() => expect(requests.at(-1)?.searchParams.has('status')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'تمت مراجعته' }));
    await waitFor(() => expect(router.state.location.search).toBe('?status=reviewed'));
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('status')).toBe('reviewed'));
  });

  it('says what an organization search did not find and offers to clear it', async () => {
    renderRouteWith({ ...base, 'GET /api/v1/platform/organizations': { data: [] } }, '/operator/organizations?q=zzz');
    expect(await screen.findByText(/لا توجد منشآت مطابقة لـ «zzz»/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'مسح البحث' })).toBeInTheDocument();
  });

  it('labels organization cells, shows the organization type and tells same-named ones apart', async () => {
    const row = (id: string) => ({ id, name: 'عيادة المعاينة', type: 'clinic', createdAt: '2026-10-20T00:00:00.000Z', subscription: null });
    renderRouteWith({ ...base, 'GET /api/v1/platform/organizations': { data: [row('a'.repeat(18) + '111111'), row('a'.repeat(18) + '222222')] } }, '/operator/organizations');
    const rows = (await screen.findAllByRole('link', { name: 'عيادة المعاينة' })).map((l) => l.closest('tr')!);
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('111111'), expect.stringContaining('222222')]);
    expect([...rows[0]!.querySelectorAll('td')].map((td) => td.dataset.label)).toEqual(['المنشأة', 'أُنشئت', 'نوع المنشأة', 'نوع الاشتراك', 'الحالة']);
  });
});

describe('overview and plans', () => {
  it('shows the database latency in the UI language', async () => {
    renderRouteWith(base, '/operator');
    expect(await screen.findByText(/2 مللي ثانية/)).toBeInTheDocument();
  });

  it('accepts Arabic-Indic digits in plan limits', async () => {
    const bodies: unknown[] = [];
    renderRouteWith(
      {
        ...base,
        'GET /api/v1/platform/plans': { data: [] },
        'POST /api/v1/platform/plans': (init: RequestInit) => {
          bodies.push(JSON.parse(String(init.body)));
          return Response.json({ plan: { id: 'p1' } }, { status: 201 });
        },
      },
      '/operator/plans',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'خطة مسودة جديدة' }));
    fireEvent.change(screen.getByLabelText('الرمز'), { target: { value: 'basic' } });
    fireEvent.change(screen.getByLabelText('الاسم (عربي)'), { target: { value: 'أساسية' } });
    fireEvent.change(screen.getByLabelText('الاسم (إنجليزي)'), { target: { value: 'Basic' } });
    fireEvent.change(screen.getByLabelText('الفروع النشطة'), { target: { value: '٣٥' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ المسودة' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ code: 'basic', limits: { branches: 35, practitioners: null, members: null } });
  });
});

describe('contact messages', () => {
  it('lists public contact messages with masked details and reveals one with the operator CSRF header', async () => {
    const row = {
      reference: 'C-ABCDEFGH',
      createdAt: '2026-10-27T08:00:00.000Z',
      status: 'new',
      intent: 'demo',
      organizationName: 'عيادة الاختبار',
      specialty: 'dentistry',
      language: 'ar',
      contactName: 'س•••',
      phone: null,
      email: 's•••@example.test',
    };
    const fetchMock = mockApi({
      ...base,
      'GET /api/v1/platform/contact-messages': { data: [row] },
      'GET /api/v1/platform/contact-messages/C-ABCDEFGH': { message: { ...row, message: 'نريد عرضًا توضيحيًا.' } },
      'POST /api/v1/platform/contact-messages/C-ABCDEFGH/reveal-contact': { contact: { name: 'سلمى', phone: null, email: 'salma@example.test' } },
    });
    const { router } = renderRoute('/operator/contact-messages');
    fireEvent.click(await screen.findByRole('link', { name: 'عرض توضيحي' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/operator/contact-messages/C-ABCDEFGH'));
    expect(await screen.findByText('نريد عرضًا توضيحيًا.')).toBeInTheDocument();
    expect(screen.getByTestId('contact-message-contact')).toHaveTextContent('s•••@example.test');
    fireEvent.click(screen.getByRole('button', { name: 'كشف بيانات التواصل' }));
    await waitFor(() => expect(screen.getByTestId('contact-message-contact')).toHaveTextContent('salma@example.test'));
    const reveal = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/reveal-contact'))!;
    expect((reveal[1] as RequestInit).headers).toMatchObject({ 'X-Operator-CSRF': 'op-csrf' });
  });
});

function renderRouteWith(table: Parameters<typeof mockApi>[0], path: string) {
  mockApi(table);
  return renderRoute(path);
}
