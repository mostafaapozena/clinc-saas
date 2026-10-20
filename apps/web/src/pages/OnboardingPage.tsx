import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { SESSION_KEY, useAuthActions, useSession } from '../auth/session';
import { Field, Notice } from '../components/ui';
import { PublicLayout } from '../layouts/PublicLayout';
import { describedBy } from '../lib/a11y';
import { api } from '../lib/api';
import { errorMessage, fieldErrors, fieldMessage } from '../lib/errors';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession().data;
  const { logout } = useAuthActions();
  const [form, setForm] = useState({ name: '', branchName: '', city: '' });
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  useDocumentTitle(t('onboarding.title'));

  const fields = fieldErrors(error);
  const messages = {
    name: fieldMessage(t, 'name', fields.name),
    branchName: fieldMessage(t, 'branch.name', fields['branch.name']),
    city: fieldMessage(t, 'branch.city', fields['branch.city']),
  };
  const hasMemberships = (session?.memberships.length ?? 0) > 0;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const created = await api<{ organization: { id: string } }>('/orgs', {
        method: 'POST',
        body: { name: form.name, branch: { name: form.branchName, city: form.city || undefined } },
      });
      await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      navigate(`/app/${created.organization.id}`, { replace: true });
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  };

  const signOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const update = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <PublicLayout
      actions={
        <button type="button" className="button button--ghost" onClick={() => void signOut()}>
          {t('shell.logout')}
        </button>
      }
    >
      <section className="card auth-card" aria-labelledby="onboarding-title">
        <h1 id="onboarding-title">{t('onboarding.title')}</h1>
        <p className="muted">{t('onboarding.subtitle', { name: session?.user.displayName ?? '' })}</p>
        {error !== null && (
          <Notice kind="error">
            {Object.keys(fields).length > 0 ? t('errors.VALIDATION_ERROR') : errorMessage(t, error)}
          </Notice>
        )}
        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <Field id="org-name" label={t('onboarding.orgName')} error={messages.name}>
            <input id="org-name" required value={form.name} onChange={update('name')} {...describedBy('org-name', messages.name)} />
          </Field>
          <Field id="branch-name" label={t('onboarding.branchName')} error={messages.branchName} hint={t('onboarding.branchHint')}>
            <input
              id="branch-name"
              required
              value={form.branchName}
              onChange={update('branchName')}
              {...describedBy('branch-name', messages.branchName, t('onboarding.branchHint'))}
            />
          </Field>
          <Field id="branch-city" label={`${t('onboarding.city')} ${t('common.optional')}`} error={messages.city}>
            <input id="branch-city" value={form.city} onChange={update('city')} {...describedBy('branch-city', messages.city)} />
          </Field>
          <button type="submit" className="button button--primary button--block" disabled={submitting}>
            {submitting ? t('onboarding.submitting') : t('onboarding.submit')}
          </button>
        </form>
        {hasMemberships && (
          <p className="auth-switch">
            <Link to="/app">{t('onboarding.backToWorkspace')}</Link>
          </p>
        )}
      </section>
    </PublicLayout>
  );
}
