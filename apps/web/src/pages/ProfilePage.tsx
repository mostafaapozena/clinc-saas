import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { SESSION_KEY, useSession } from '../auth/session';
import { PageHeader } from '../components/PageHeader';
import { EmailVerificationCard, SessionsCard } from '../components/account';
import { Field, Notice } from '../components/ui';
import { setLanguage } from '../i18n';
import { describedBy } from '../lib/a11y';
import { api } from '../lib/api';
import { errorMessage, fieldErrors, fieldMessage } from '../lib/errors';
import type { Language, SessionData, User } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function ProfilePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const user = useSession().data?.user;
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [language, setLanguageChoice] = useState<Language>(user?.preferredLanguage ?? 'ar');
  useDocumentTitle(t('nav.profile'));

  const save = useMutation({
    mutationFn: () => api<{ user: User }>('/me', { method: 'PATCH', body: { displayName, preferredLanguage: language } }),
    onSuccess: async ({ user: saved }) => {
      queryClient.setQueryData<SessionData | null>(SESSION_KEY, (s) => (s ? { ...s, user: saved } : s));
      await setLanguage(saved.preferredLanguage);
    },
  });
  const nameError = fieldMessage(t, 'displayName', fieldErrors(save.error).displayName);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <>
      <PageHeader title={t('profile.title')} />
      <section className="card" aria-labelledby="profile-form-title">
        <h2 id="profile-form-title">{t('profile.details')}</h2>
        {save.isSuccess && <Notice kind="success">{t('profile.saved')}</Notice>}
        {save.isError && !nameError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
        <dl className="details">
          <div>
            <dt>{t('auth.email')}</dt>
            <dd dir="ltr">{user?.email}</dd>
          </div>
          <div>
            <dt>{t('profile.emailStatus')}</dt>
            <dd>{user?.emailVerified ? t('profile.emailVerified') : t('profile.emailUnverified')}</dd>
          </div>
        </dl>
        <form onSubmit={onSubmit} noValidate>
          <Field id="profile-name" label={t('auth.displayName')} error={nameError}>
            <input
              id="profile-name"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              {...describedBy('profile-name', nameError)}
            />
          </Field>
          <Field id="profile-language" label={t('profile.language')}>
            <select id="profile-language" value={language} onChange={(e) => setLanguageChoice(e.target.value as Language)}>
              <option value="ar" lang="ar">العربية</option>
              <option value="en" lang="en">English</option>
            </select>
          </Field>
          <button type="submit" className="button button--primary" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </button>
        </form>
      </section>
      <EmailVerificationCard />
      <SessionsCard />
    </>
  );
}
