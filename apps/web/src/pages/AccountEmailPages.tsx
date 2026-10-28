import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { SESSION_KEY, useSession } from '../auth/session';
import { Field, Loading, Notice } from '../components/ui';
import { PublicLayout } from '../layouts/PublicLayout';
import { api } from '../lib/api';
import { errorMessage, fieldErrors, fieldMessage } from '../lib/errors';
import { withNext } from '../lib/navigation';
import { useDocumentTitle } from '../lib/useDocumentTitle';

// Password recovery, email verification and invitation acceptance (docs/architecture/ACCOUNT_EMAIL.md).
// Links carry a single-use token; pages that spend it drop it from the address bar right away so
// it does not linger in history or leak through a later referrer.

function useLinkToken(path: string) {
  const [params] = useSearchParams();
  const [token] = useState(() => params.get('token') ?? '');
  useEffect(() => {
    if (window.location.search) window.history.replaceState(window.history.state, '', path);
  }, [path]);
  return token;
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  useDocumentTitle(t('account.forgotTitle'));
  const request = useMutation({
    mutationFn: () => api<{ accepted: boolean }>('/auth/password-reset/request', { method: 'POST', body: { email } }),
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    request.mutate();
  };
  return (
    <PublicLayout brand>
      <section className="card auth-card" aria-labelledby="forgot-title">
        <h1 id="forgot-title">{t('account.forgotTitle')}</h1>
        {request.isSuccess ? (
          <Notice kind="success">{t('account.forgotSent')}</Notice>
        ) : (
          <>
            <p className="muted">{t('account.forgotHint')}</p>
            {request.isError && <Notice kind="error">{errorMessage(t, request.error)}</Notice>}
            <form onSubmit={onSubmit} noValidate>
              <Field id="forgot-email" label={t('auth.email')} error={fieldMessage(t, 'email', fieldErrors(request.error).email)}>
                <input
                  id="forgot-email"
                  type="email"
                  dir="ltr"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <button type="submit" className="button button--primary button--block" disabled={request.isPending}>
                {t('account.forgotSubmit')}
              </button>
            </form>
          </>
        )}
        <p className="auth-switch">
          <Link to="/login">{t('account.backToLogin')}</Link>
        </p>
      </section>
    </PublicLayout>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const token = useLinkToken('/reset-password');
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  useDocumentTitle(t('account.resetTitle'));
  const reset = useMutation({
    mutationFn: () => api<{ reset: boolean }>('/auth/password-reset/confirm', { method: 'POST', body: { token, password } }),
    // Every session ended, this device's too.
    onSuccess: () => queryClient.setQueryData(SESSION_KEY, null),
  });
  const passwordError = fieldMessage(t, 'password', fieldErrors(reset.error).password);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    reset.mutate();
  };
  return (
    <PublicLayout brand>
      <section className="card auth-card" aria-labelledby="reset-title">
        <h1 id="reset-title">{t('account.resetTitle')}</h1>
        {reset.isSuccess ? (
          <>
            <Notice kind="success">{t('account.resetDone')}</Notice>
            <Link className="button button--primary button--block" to="/login">
              {t('auth.submitLogin')}
            </Link>
          </>
        ) : !token ? (
          <Notice kind="error">{t('errors.TOKEN_INVALID')}</Notice>
        ) : (
          <>
            {reset.isError && !passwordError && <Notice kind="error">{errorMessage(t, reset.error)}</Notice>}
            <form onSubmit={onSubmit} noValidate>
              <Field id="reset-password" label={t('account.newPassword')} hint={t('account.passwordHint')} error={passwordError}>
                <input
                  id="reset-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <button type="submit" className="button button--primary button--block" disabled={reset.isPending}>
                {t('account.resetSubmit')}
              </button>
            </form>
            <p className="muted small">{t('account.resetSignsOut')}</p>
          </>
        )}
      </section>
    </PublicLayout>
  );
}

export function VerifyEmailPage() {
  const { t } = useTranslation();
  const token = useLinkToken('/verify-email');
  const queryClient = useQueryClient();
  useDocumentTitle(t('account.verifyTitle'));
  const verify = useMutation({
    mutationFn: () => api<{ verified: boolean }>('/auth/email-verification/confirm', { method: 'POST', body: { token } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSION_KEY }),
  });
  return (
    <PublicLayout brand>
      <section className="card auth-card" aria-labelledby="verify-title">
        <h1 id="verify-title">{t('account.verifyTitle')}</h1>
        {verify.isSuccess ? (
          <Notice kind="success">{t('account.verifyDone')}</Notice>
        ) : !token ? (
          <Notice kind="error">{t('errors.TOKEN_INVALID')}</Notice>
        ) : (
          <>
            {verify.isError && <Notice kind="error">{errorMessage(t, verify.error)}</Notice>}
            <p className="muted">{t('account.verifyHint')}</p>
            <button
              type="button"
              className="button button--primary button--block"
              disabled={verify.isPending}
              onClick={() => verify.mutate()}
            >
              {t('account.verifySubmit')}
            </button>
          </>
        )}
        <p className="auth-switch">
          <Link to="/app">{t('account.toWorkspace')}</Link>
        </p>
      </section>
    </PublicLayout>
  );
}

type InvitationPreview = { organizationName: string; role: string; email: string; expiresAt: string };

/** Invitation links keep the token in the URL until accepted: signing in or registering returns here. */
export function AcceptInvitationPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();
  useDocumentTitle(t('account.invitationTitle'));
  const preview = useQuery({
    queryKey: ['invitation-preview', token],
    queryFn: () => api<InvitationPreview>('/invitations/preview', { method: 'POST', body: { token } }),
    enabled: token.length > 0,
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () => api<{ organizationId: string }>('/invitations/accept', { method: 'POST', body: { token } }),
    onSuccess: async ({ organizationId }) => {
      await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      navigate(`/app/${organizationId}`, { replace: true });
    },
  });
  const here = `/invitations/accept?token=${encodeURIComponent(token)}`;
  const user = session.data?.user ?? null;
  return (
    <PublicLayout brand>
      <section className="card auth-card" aria-labelledby="invitation-title">
        <h1 id="invitation-title">{t('account.invitationTitle')}</h1>
        {!token || preview.isError ? (
          <Notice kind="error">{t('errors.TOKEN_INVALID')}</Notice>
        ) : preview.isPending || session.isPending ? (
          <Loading />
        ) : (
          <>
            <p data-testid="invitation-summary">
              {t('account.invitationSummary', { organization: preview.data.organizationName, role: t(`roles.${preview.data.role}`) })}
            </p>
            <p className="muted small">
              {t('account.invitationFor')} <span dir="ltr">{preview.data.email}</span>
            </p>
            {accept.isError && <Notice kind="error">{errorMessage(t, accept.error)}</Notice>}
            {!user ? (
              <div className="form-actions">
                <Link className="button button--primary" to={withNext('/login', here)}>
                  {t('auth.submitLogin')}
                </Link>
                <Link className="button button--secondary" to={withNext('/register', here)}>
                  {t('account.createAccount')}
                </Link>
              </div>
            ) : user.email !== preview.data.email ? (
              <Notice kind="error">{t('errors.INVITATION_EMAIL_MISMATCH')}</Notice>
            ) : (
              <button
                type="button"
                className="button button--primary button--block"
                disabled={accept.isPending}
                onClick={() => accept.mutate()}
              >
                {t('account.invitationAccept')}
              </button>
            )}
          </>
        )}
      </section>
    </PublicLayout>
  );
}
