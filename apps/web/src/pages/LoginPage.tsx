import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuthActions } from '../auth/session';
import { Field, Notice } from '../components/ui';
import { PublicLayout } from '../layouts/PublicLayout';
import { describedBy } from '../lib/a11y';
import { errorMessage } from '../lib/errors';
import { safeNext, withNext } from '../lib/navigation';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { login } = useAuthActions();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  useDocumentTitle(t('auth.loginTitle'));

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  };

  return (
    <PublicLayout brand>
      <section className="card auth-card" aria-labelledby="login-title">
        <h1 id="login-title">{t('auth.loginTitle')}</h1>
        <p className="muted">{t('auth.loginSubtitle')}</p>
        {error !== null && <Notice kind="error">{errorMessage(t, error)}</Notice>}
        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <Field id="login-email" label={t('auth.email')}>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              dir="ltr"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              {...describedBy('login-email')}
            />
          </Field>
          <Field id="login-password" label={t('auth.password')}>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <button type="submit" className="button button--primary button--block" disabled={submitting}>
            {submitting ? t('auth.submittingLogin') : t('auth.submitLogin')}
          </button>
        </form>
        <p className="auth-switch">
          {t('auth.noAccount')} <Link to={withNext('/register', params.get('next'))}>{t('auth.registerLink')}</Link>
        </p>
      </section>
    </PublicLayout>
  );
}
