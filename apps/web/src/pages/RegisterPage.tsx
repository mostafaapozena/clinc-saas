import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuthActions } from '../auth/session';
import { Field, Notice } from '../components/ui';
import { PublicLayout } from '../layouts/PublicLayout';
import { describedBy } from '../lib/a11y';
import { ApiError } from '../lib/api';
import { errorMessage, fieldErrors, fieldMessage } from '../lib/errors';
import { safeNext, withNext } from '../lib/navigation';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function RegisterPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  // A solution chosen on the public site travels as ?next=/onboarding?specialty=…
  const [params] = useSearchParams();
  const next = params.get('next');
  const { register } = useAuthActions();
  const [form, setForm] = useState({ displayName: '', email: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  useDocumentTitle(t('auth.registerTitle'));

  const fields = fieldErrors(error);
  const emailTaken = error instanceof ApiError && error.code === 'EMAIL_UNAVAILABLE';
  const messages = {
    displayName: fieldMessage(t, 'displayName', fields.displayName),
    email: emailTaken ? t('errors.EMAIL_UNAVAILABLE') : fieldMessage(t, 'email', fields.email),
    password: fieldMessage(t, 'password', fields.password),
  };
  const hasFieldErrors = Object.keys(fields).length > 0 || emailTaken;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await register({ ...form, preferredLanguage: i18n.resolvedLanguage === 'en' ? 'en' : 'ar' });
      navigate(safeNext(next, '/onboarding'), { replace: true });
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  };

  const update = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <PublicLayout brand panel>
      <section className="card auth-card" aria-labelledby="register-title">
        <h1 id="register-title">{t('auth.registerTitle')}</h1>
        <p className="muted">{t('auth.registerSubtitle')}</p>
        {error !== null && (
          <Notice kind="error">{hasFieldErrors ? t('errors.VALIDATION_ERROR') : errorMessage(t, error)}</Notice>
        )}
        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <Field id="register-name" label={t('auth.displayName')} error={messages.displayName}>
            <input
              id="register-name"
              autoComplete="name"
              required
              value={form.displayName}
              onChange={update('displayName')}
              {...describedBy('register-name', messages.displayName)}
            />
          </Field>
          <Field id="register-email" label={t('auth.email')} error={messages.email}>
            <input
              id="register-email"
              type="email"
              autoComplete="email"
              dir="ltr"
              required
              value={form.email}
              onChange={update('email')}
              {...describedBy('register-email', messages.email)}
            />
          </Field>
          <Field id="register-password" label={t('auth.password')} error={messages.password} hint={t('auth.passwordHint')}>
            <input
              id="register-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={form.password}
              onChange={update('password')}
              {...describedBy('register-password', messages.password, t('auth.passwordHint'))}
            />
          </Field>
          <p className="muted small">{t('auth.verificationNote')}</p>
          <button type="submit" className="button button--primary button--block" disabled={submitting}>
            {submitting ? t('auth.submittingRegister') : t('auth.submitRegister')}
          </button>
        </form>
        <p className="auth-switch">
          {t('auth.haveAccount')} <Link to={withNext('/login', next)}>{t('auth.loginLink')}</Link>
        </p>
      </section>
    </PublicLayout>
  );
}
