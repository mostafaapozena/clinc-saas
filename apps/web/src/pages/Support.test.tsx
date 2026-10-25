import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

const ORG = 'a'.repeat(24);
const user = (emailVerified = false) => ({
  id: 'u1',
  email: 'sara@example.test',
  displayName: 'Sara',
  preferredLanguage: 'ar',
  emailVerified,
});
const RECEPTION: Permission[] = ['organization.read', 'branch.read', 'dashboard.read', 'support.request'];

function shell(permissions: Permission[] = RECEPTION, verified = false) {
  return {
    'GET /api/v1/auth/session': {
      user: user(verified),
      csrfToken: 'csrf',
      memberships: [{ organization: { id: ORG, name: 'Clinic' }, role: 'receptionist' }],
    },
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
        role: 'receptionist',
        branchScope: { type: 'all', branchIds: [] },
        permissions,
        capabilities: [],
        practitionerId: null,
      },
      stats: { accessibleBranches: 1 },
    },
    [`GET /api/v1/orgs/${ORG}/branches`]: { data: [] },
    [`GET /api/v1/orgs/${ORG}/practitioners`]: { data: [] },
  };
}
const bodies = (fetchMock: ReturnType<typeof mockApi>, method: string, suffix: string) =>
  fetchMock.mock.calls
    .filter(([url, init]) => String(url).endsWith(suffix) && ((init as RequestInit | undefined)?.method ?? 'GET') === method)
    .map(([, init]) => ({
      body: JSON.parse(String((init as RequestInit).body ?? '{}')) as Record<string, unknown>,
      headers: (init as RequestInit).headers as Record<string, string>,
    }));
const detail = {
  id: 'r1',
  reference: 'S-ABCD2345',
  subject: 'Printing',
  category: 'finance',
  status: 'answered',
  messageCount: 2,
  lastActivityAt: '2026-11-10T09:00:00.000Z',
  createdAt: '2026-11-10T08:00:00.000Z',
  version: 1,
  messages: [
    { author: 'customer', displayName: 'Sara', body: 'Synthetic problem.', at: '2026-11-10T08:00:00.000Z' },
    { author: 'operator', displayName: 'raclinic', body: 'Synthetic answer.', at: '2026-11-10T09:00:00.000Z' },
  ],
};

describe('help and support', () => {
  it('shows static FAQ (labelled, filterable), no invented contact details, and sends a request without patient data', async () => {
    const fetchMock = mockApi({
      ...shell(),
      'GET /api/v1/public/support-contact': { contact: { email: null, phone: null, hours: null } },
      [`GET /api/v1/orgs/${ORG}/support`]: { data: [] },
      [`POST /api/v1/orgs/${ORG}/support`]: { request: { ...detail, status: 'open', messageCount: 1 } },
    });
    renderRoute(`/app/${ORG}/support`);
    expect(await screen.findByText(/وليست مساعدًا ذكيًا/)).toBeInTheDocument();
    expect(await screen.findByTestId('contact-none')).toBeInTheDocument();
    const faq = screen.getByTestId('faq');
    expect(within(faq).getAllByRole('group').length).toBeGreaterThan(3);
    fireEvent.change(screen.getByLabelText('تصفية الأسئلة'), { target: { value: 'ضريبية' } });
    expect(within(screen.getByTestId('faq')).getAllByRole('group')).toHaveLength(1);
    expect(screen.getByText(/لا تكتب أسماء المرضى/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('الموضوع'), { target: { value: 'Printing' } });
    fireEvent.change(screen.getByLabelText('المجال'), { target: { value: 'finance' } });
    fireEvent.change(screen.getByLabelText('الرسالة'), { target: { value: 'Synthetic problem.' } });
    fireEvent.click(screen.getByRole('button', { name: 'إرسال الطلب' }));
    expect(await screen.findByText('تم إرسال الطلب S-ABCD2345.')).toBeInTheDocument();
    expect(bodies(fetchMock, 'POST', `/orgs/${ORG}/support`).map((c) => c.body)).toEqual([
      { subject: 'Printing', category: 'finance', body: 'Synthetic problem.' },
    ]);
  });

  it('shows the conversation with the raclinic team and sends a reply', async () => {
    const fetchMock = mockApi({
      ...shell(),
      [`GET /api/v1/orgs/${ORG}/support/r1`]: { request: detail },
      [`POST /api/v1/orgs/${ORG}/support/r1/messages`]: { request: { ...detail, status: 'open' } },
    });
    renderRoute(`/app/${ORG}/support/r1`);
    const messages = await screen.findByTestId('support-messages');
    expect(within(messages).getByText('فريق raclinic')).toBeInTheDocument();
    expect(screen.getByTestId('support-status')).toHaveTextContent('تم الرد');
    fireEvent.change(screen.getByRole('textbox', { name: 'الرد' }), { target: { value: 'Thanks' } });
    fireEvent.click(screen.getByRole('button', { name: 'إرسال الرد' }));
    await waitFor(() => expect(bodies(fetchMock, 'POST', '/support/r1/messages').map((c) => c.body)).toEqual([{ body: 'Thanks' }]));
    expect(await screen.findByTestId('support-status')).toHaveTextContent('بانتظار raclinic');
  });
});

describe('account email flows', () => {
  it('forgot password answers generically', async () => {
    const fetchMock = mockApi({
      'GET /api/v1/auth/session': { user: null, csrfToken: null, memberships: [] },
      'POST /api/v1/auth/password-reset/request': { accepted: true },
    });
    renderRoute('/forgot-password');
    fireEvent.change(await screen.findByLabelText('البريد الإلكتروني'), { target: { value: 'someone@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'إرسال رابط إعادة التعيين' }));
    expect(await screen.findByText(/رابط إعادة التعيين في الطريق/)).toBeInTheDocument();
    expect(bodies(fetchMock, 'POST', '/password-reset/request').map((c) => c.body)).toEqual([{ email: 'someone@example.test' }]);
  });

  it('reset password sends the link token once and confirms that every session ended', async () => {
    const fetchMock = mockApi({
      'GET /api/v1/auth/session': { user: null, csrfToken: null, memberships: [] },
      'POST /api/v1/auth/password-reset/confirm': { reset: true },
    });
    renderRoute('/reset-password?token=synthetic-token-1234567890');
    fireEvent.change(await screen.findByLabelText('كلمة المرور الجديدة'), { target: { value: 'a-new-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ كلمة المرور الجديدة' }));
    expect(await screen.findByText(/وإنهاء كل الجلسات/)).toBeInTheDocument();
    expect(bodies(fetchMock, 'POST', '/password-reset/confirm').map((c) => c.body)).toEqual([
      { token: 'synthetic-token-1234567890', password: 'a-new-password-1' },
    ]);
  });

  it('an invitation asks a signed-out visitor to sign in and returns them to the invitation', async () => {
    mockApi({
      'GET /api/v1/auth/session': { user: null, csrfToken: null, memberships: [] },
      'POST /api/v1/invitations/preview': {
        organizationName: 'Synthetic Clinic',
        role: 'receptionist',
        email: 'sara@example.test',
        expiresAt: '2026-11-17T00:00:00.000Z',
      },
    });
    renderRoute('/invitations/accept?token=synthetic-invite-123456789');
    expect(await screen.findByTestId('invitation-summary')).toHaveTextContent('Synthetic Clinic');
    expect(screen.getByRole('link', { name: 'دخول' })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent(`/invitations/accept?token=synthetic-invite-123456789`)}`,
    );
  });

  it('a signed-in invitee with the invited address accepts and lands in the workspace', async () => {
    const fetchMock = mockApi({
      ...shell(),
      'POST /api/v1/invitations/preview': {
        organizationName: 'Clinic',
        role: 'receptionist',
        email: 'sara@example.test',
        expiresAt: '2026-11-17T00:00:00.000Z',
      },
      'POST /api/v1/invitations/accept': { organizationId: ORG },
      [`GET /api/v1/orgs/${ORG}/dashboard`]: { data: null },
    });
    const { router } = renderRoute('/invitations/accept?token=synthetic-invite-123456789');
    fireEvent.click(await screen.findByRole('button', { name: 'قبول الدعوة' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/${ORG}`));
    expect(bodies(fetchMock, 'POST', '/invitations/accept')[0]?.headers).toMatchObject({ 'X-CSRF-Token': 'csrf' });
  });

  it('profile lists sessions, signs out another device and offers email verification', async () => {
    const fetchMock = mockApi({
      ...shell(),
      'GET /api/v1/me/sessions': {
        data: [
          {
            id: 's1',
            current: true,
            device: 'Chrome · Windows',
            createdAt: '2026-11-10T08:00:00.000Z',
            lastSeenAt: '2026-11-10T09:00:00.000Z',
            expiresAt: '2026-11-17T08:00:00.000Z',
          },
          {
            id: 's2',
            current: false,
            device: 'Safari · iOS',
            createdAt: '2026-11-09T08:00:00.000Z',
            lastSeenAt: '2026-11-09T09:00:00.000Z',
            expiresAt: '2026-11-16T08:00:00.000Z',
          },
        ],
      },
      'DELETE /api/v1/me/sessions/s2': () => new Response(null, { status: 204 }),
      'POST /api/v1/auth/email-verification/request': { accepted: true, mailer: 'dev_sink' },
    });
    renderRoute(`/app/${ORG}/profile`);
    const list = await screen.findByTestId('sessions');
    expect(within(list).getByText('هذا الجهاز')).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: 'تسجيل الخروج' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, i]) => String(u).endsWith('/me/sessions/s2') && (i as RequestInit).method === 'DELETE')).toBe(
        true,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'إرسال رابط التأكيد' }));
    expect(await screen.findByText(/رابط التأكيد في الطريق/)).toBeInTheDocument();
  });
});

describe('operator support queue', () => {
  it('lists requests across organizations and replies with the operator CSRF header', async () => {
    const fetchMock = mockApi({
      'GET /api/v1/platform/auth/session': {
        operator: {
          id: 'o1',
          email: 'op@example.test',
          displayName: 'Op',
          role: 'support',
          permissions: ['platform.overview.read', 'platform.support.read', 'platform.support.manage'],
        },
        csrfToken: 'op-csrf',
      },
      'GET /api/v1/platform/support/S-ABCD2345': {
        request: { ...detail, organization: { id: ORG, name: 'Clinic' }, requester: { displayName: 'Sara', email: 's•••@example.test' } },
      },
      'POST /api/v1/platform/support/S-ABCD2345/messages': { request: detail },
    });
    renderRoute('/operator/support/S-ABCD2345');
    expect(await screen.findByText('s•••@example.test')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'الرد' }), { target: { value: 'Synthetic operator reply' } });
    fireEvent.click(screen.getByRole('button', { name: 'إرسال الرد' }));
    await waitFor(() =>
      expect(bodies(fetchMock, 'POST', '/support/S-ABCD2345/messages')[0]?.headers).toMatchObject({ 'X-Operator-CSRF': 'op-csrf' }),
    );
  });
});
