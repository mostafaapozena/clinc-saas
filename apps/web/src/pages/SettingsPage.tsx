import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { SESSION_KEY } from '../auth/session';
import { PageHeader } from '../components/PageHeader';
import { Field, Notice } from '../components/ui';
import { describedBy } from '../lib/a11y';
import { api } from '../lib/api';
import { errorMessage, fieldErrors, fieldMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { orgKeys, useOrg } from '../org/context';

export function SettingsPage() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const { orgId, detail } = useOrg();
  const queryClient = useQueryClient();
  const [name, setName] = useState(detail.organization.name);
  useDocumentTitle(t('nav.settings'));

  const save = useMutation({
    mutationFn: () => api(`/orgs/${orgId}`, { method: 'PATCH', body: { name } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orgKeys.detail(orgId) }),
        queryClient.invalidateQueries({ queryKey: SESSION_KEY }),
      ]);
    },
  });
  const nameError = fieldMessage(t, 'name', fieldErrors(save.error).name);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <>
      <PageHeader title={t('settings.title')} subtitle={t('settings.createdOn', { date: fmt.date(detail.organization.createdAt) })} />
      <section className="card" aria-labelledby="org-settings-title">
        <h2 id="org-settings-title">{t('settings.general')}</h2>
        {save.isSuccess && <Notice kind="success">{t('settings.saved')}</Notice>}
        {save.isError && !nameError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
        <form onSubmit={onSubmit} noValidate>
          <Field id="settings-org-name" label={t('settings.orgName')} error={nameError}>
            <input
              id="settings-org-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              {...describedBy('settings-org-name', nameError)}
            />
          </Field>
          <button type="submit" className="button button--primary" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </button>
        </form>
      </section>
    </>
  );
}
