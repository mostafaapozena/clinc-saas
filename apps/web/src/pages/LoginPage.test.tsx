import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderRoute } from '../test/render';

const signedOut = { user: null, csrfToken: null, memberships: [] };
const user = { id: 'u1', email: 'mona@example.test', displayName: 'Mona', preferredLanguage: 'en', emailVerified: false };

async function fillAndSubmit() {
  fireEvent.change(await screen.findByLabelText('البريد الإلكتروني'), { target: { value: 'mona@example.test' } });
  fireEvent.change(screen.getByLabelText('كلمة المرور'), { target: { value: 'secret-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'دخول' }));
}

describe('login', () => {
  it('shows a translated, generic error for wrong credentials', async () => {
    mockApi({
      'GET /api/v1/auth/session': signedOut,
      'POST /api/v1/auth/login': apiError(401, 'INVALID_CREDENTIALS'),
    });
    renderRoute('/login');

    await fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
  });

  it('redirects a protected page to login and back after signing in', async () => {
    let signedIn = false;
    mockApi({
      'GET /api/v1/auth/session': () =>
        signedIn ? { user, csrfToken: 'csrf-1', memberships: [] } : signedOut,
      'POST /api/v1/auth/login': () => {
        signedIn = true;
        return { user, csrfToken: 'csrf-1', memberships: [] };
      },
    });
    const { router } = renderRoute('/app');

    await screen.findByRole('heading', { name: 'تسجيل الدخول' });
    expect(router.state.location.search).toBe('?next=%2Fapp');

    await fillAndSubmit();

    // No organization yet → onboarding, in the account's preferred language (English, LTR).
    expect(await screen.findByRole('heading', { name: 'Set up your organization' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('sends the CSRF token on mutations and never stores it in browser storage', async () => {
    const fetchMock = mockApi({
      'GET /api/v1/auth/session': signedOut,
      'POST /api/v1/auth/login': { user, csrfToken: 'csrf-xyz', memberships: [] },
      'GET /api/v1/onboarding': { draft: null },
      'GET /api/v1/specialties': { data: [] },
      'PUT /api/v1/onboarding': apiError(400, 'VALIDATION_ERROR'),
    });
    renderRoute('/login');
    await fillAndSubmit();
    await screen.findByRole('heading', { name: 'Set up your organization' });

    // First onboarding step, saved as a draft.
    fireEvent.click(await screen.findByRole('radio', { name: /Individual clinic/ }));
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Clinic' } });
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Africa/Cairo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    const isSave = ([url, init]: [unknown, RequestInit?]) => String(url) === '/api/v1/onboarding' && init?.method === 'PUT';
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => isSave(call as [unknown, RequestInit?]))).toBe(true));
    const [, init] = fetchMock.mock.calls.find((call) => isSave(call as [unknown, RequestInit?])) as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-xyz');
    const stored = JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage });
    expect(stored).not.toContain('csrf-xyz');
  });
});
