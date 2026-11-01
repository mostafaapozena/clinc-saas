import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { BrandLogo } from '../components/BrandLogo';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { ToastRegion } from '../components/Toasts';
import { ErrorState, Field, Loading, Notice } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { OPERATOR_SESSION_KEY, opApi, opKeys, setOperatorCsrf, type OperatorSession } from '../lib/operator';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { OperatorContext, useOperator, fetchOperatorSession } from './shared';
import type { Overview } from './overview';

export function OperatorRoot() {
  const { t } = useTranslation();
  const session = useQuery({ queryKey: OPERATOR_SESSION_KEY, queryFn: fetchOperatorSession, staleTime: 30_000, retry: false });
  if (session.isPending) return <Loading />;
  if (session.isError) return <ErrorState message={errorMessage(t, session.error)} onRetry={() => void session.refetch()} />;
  if (!session.data) return <OperatorLogin />;
  return (
    <OperatorContext.Provider value={session.data}>
      <OperatorLayout>
        <Outlet />
      </OperatorLayout>
    </OperatorContext.Provider>
  );
}

function OperatorShellFrame({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="public-layout operator-layout">
      <a className="skip-link" href="#main-content">
        {t('shell.skipToContent')}
      </a>
      <header className="public-header operator-header">
        <span className="operator-brand">
          <BrandLogo variant="wordmark" />
          <span className="badge badge--operator">{t('operator.consoleLabel')}</span>
        </span>
        <div className="public-header-actions operator-header-actions">
          {actions}
          <ThemeSwitcher />
          <LanguageSwitcher />
        </div>
      </header>
      <main id="main-content" className="public-main operator-main" tabIndex={-1}>
        {children}
      </main>
      <ToastRegion />
      <footer className="app-footer">{t('operator.footer')}</footer>
    </div>
  );
}

function OperatorLogin() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  useDocumentTitle(t('operator.loginTitle'));
  const login = useMutation({
    mutationFn: () => opApi<{ operator: OperatorSession; csrfToken: string }>('/auth/login', { method: 'POST', body: { email, password } }),
    onSuccess: (res) => {
      setOperatorCsrf(res.csrfToken);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] === 'operator' && q.queryKey[1] !== 'session' });
      queryClient.setQueryData(OPERATOR_SESSION_KEY, res.operator);
    },
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate();
  };
  return (
    <OperatorShellFrame>
      <section className="card auth-card" aria-labelledby="operator-login-title">
        <h1 id="operator-login-title">{t('operator.loginTitle')}</h1>
        <p className="muted">{t('operator.loginSubtitle')}</p>
        {login.isError && <Notice kind="error">{errorMessage(t, login.error)}</Notice>}
        <form onSubmit={onSubmit} noValidate>
          <Field id="operator-email" label={t('auth.email')}>
            <input
              id="operator-email"
              type="email"
              autoComplete="username"
              dir="ltr"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field id="operator-password" label={t('auth.password')}>
            <input
              id="operator-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <button type="submit" className="button button--primary button--block" disabled={login.isPending}>
            {login.isPending ? t('auth.submittingLogin') : t('auth.submitLogin')}
          </button>
        </form>
        <p className="muted small">{t('operator.noRegistration')}</p>
      </section>
    </OperatorShellFrame>
  );
}

function OperatorLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const operator = useOperator();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: () => opApi<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      setOperatorCsrf(null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] === 'operator' && q.queryKey[1] !== 'session' });
      queryClient.setQueryData(OPERATOR_SESSION_KEY, null);
    },
  });
  // The development mail sink is linked only where it exists (never in production).
  const overview = useQuery({
    queryKey: opKeys.overview,
    queryFn: ({ signal }) => opApi<Overview>('/overview', { signal }),
    // Shared with the overview page: one request, not one per component that mounts.
    staleTime: 30_000,
    enabled: operator.can('platform.audit.read'),
  });
  const devMail = overview.data?.config.mailProvider === 'dev_sink';
  const nav = [
    { to: '/operator', label: t('operator.nav.overview'), end: true },
    { to: '/operator/organizations', label: t('operator.nav.organizations') },
    { to: '/operator/plans', label: t('operator.nav.plans') },
    { to: '/operator/inquiries', label: t('operator.nav.inquiries') },
    { to: '/operator/contact-messages', label: t('operator.nav.contactMessages') },
    { to: '/operator/support', label: t('operator.nav.support') },
    ...(operator.can('platform.operators.read') ? [{ to: '/operator/operators', label: t('operator.nav.operators') }] : []),
    ...(operator.can('platform.audit.read') ? [{ to: '/operator/audit', label: t('operator.nav.audit') }] : []),
    ...(devMail ? [{ to: '/operator/dev-mail', label: t('operator.nav.devMail') }] : []),
  ];
  return (
    <OperatorShellFrame
      actions={
        <>
          <span className="small operator-user">
            {operator.displayName} · {t(`operator.roles.${operator.role}`)}
          </span>
          <button type="button" className="button button--ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
            {t('shell.logout')}
          </button>
        </>
      }
    >
      <nav aria-label={t('operator.navLabel')} className="operator-nav">
        {nav.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
            {item.label}
          </NavLink>
        ))}
      </nav>
      {children}
    </OperatorShellFrame>
  );
}
