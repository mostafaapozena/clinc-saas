import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { showToast } from '../lib/toast';
import { orgKeys, useOrg } from '../org/context';
import { Field, Notice } from './ui';

// Safe reset of organization settings (docs/architecture/SETTINGS_RESET.md): preview, confirm with
// the organization's name, snapshot, apply; every reset can be restored once from its snapshot.

type Section = 'modules' | 'accounting';
type Change = { section: Section; key: string; from: unknown; to: unknown };
type Preview = { sections: Section[]; changes: Change[]; skipped: string[]; token: string };
type Snapshot = { id: string; kind: 'reset' | 'restore'; sections: Section[]; changes: number; restoredAt: string | null; createdAt: string };

function ChangeLabel({ change }: { change: Change }) {
  const { t } = useTranslation();
  if (change.key === 'enabledModules') return <>{t('settingsReset.keys.modules')}</>;
  if (change.key === 'requireCashSession') return <>{t('accounting.requireCashSession')}</>;
  return (
    <>
      {t('settingsReset.keys.mapping')} <bdi dir="ltr">{change.key.replace('mappings.', '')}</bdi>
    </>
  );
}

export function SettingsReset() {
  const { t } = useTranslation();
  const { orgId, can, detail } = useOrg();
  const queryClient = useQueryClient();
  const [sections, setSections] = useState<Section[]>(['modules']);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState('');
  const snapshots = useQuery({
    queryKey: [...orgKeys.all(orgId), 'settingsSnapshots'],
    queryFn: ({ signal }) => api<{ snapshots: Snapshot[] }>(`/orgs/${orgId}/settings-reset/snapshots`, { signal }),
  });
  const load = useMutation({
    mutationFn: () => api<Preview>(`/orgs/${orgId}/settings-reset/preview?sections=${sections.join(',')}`),
    onSuccess: (p) => setPreview(p),
  });
  const done = (message: string) => {
    showToast(message);
    setPreview(null);
    setName('');
    return queryClient.invalidateQueries({ queryKey: orgKeys.all(orgId) });
  };
  const reset = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/settings-reset`, { method: 'POST', body: { sections: preview!.sections, token: preview!.token, confirmName: name } }),
    onSuccess: () => done(t('settingsReset.done')),
  });
  const restore = useMutation({
    mutationFn: (id: string) => api(`/orgs/${orgId}/settings-reset/snapshots/${id}/restore`, { method: 'POST', body: { confirmName: name } }),
    onSuccess: () => done(t('settingsReset.restored')),
  });
  const nameOk = name.trim() === detail.organization.name;
  const available: Section[] = can('accounting.settings.manage') ? ['modules', 'accounting'] : ['modules'];
  return (
    <section className="card" aria-labelledby="reset-title" data-testid="settings-reset">
      <h2 id="reset-title">{t('settingsReset.title')}</h2>
      <p className="muted">{t('settingsReset.intro')}</p>
      <fieldset className="choice-group">
        <legend>{t('settingsReset.sections')}</legend>
        {available.map((s) => (
          <label key={s} className="choice">
            <input
              type="checkbox"
              checked={sections.includes(s)}
              onChange={(e) => (setPreview(null), setSections((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s))))}
            />
            <span>
              <strong>{t(`settingsReset.section.${s}`)}</strong> <span className="muted small">{t(`settingsReset.sectionHint.${s}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="form-actions">
        <button type="button" className="button button--secondary" disabled={sections.length === 0 || load.isPending} onClick={() => load.mutate()}>
          {t('settingsReset.preview')}
        </button>
      </div>
      {load.isError && <Notice kind="error">{errorMessage(t, load.error)}</Notice>}
      {preview && (
        <div className="stack" data-testid="reset-preview">
          {preview.changes.length === 0 ? (
            <Notice kind="info">{t('settingsReset.nothing')}</Notice>
          ) : (
            <>
              <p>{t('settingsReset.willChange', { count: preview.changes.length })}</p>
              <ul className="link-list">
                {preview.changes.map((c) => (
                  <li key={c.key}>
                    <ChangeLabel change={c} />
                  </li>
                ))}
              </ul>
              {preview.skipped.length > 0 && <Notice kind="warning">{t('settingsReset.skipped', { count: preview.skipped.length })}</Notice>}
              <Notice kind="warning">{t('settingsReset.warning')}</Notice>
            </>
          )}
        </div>
      )}
      {(preview?.changes.length || snapshots.data?.snapshots.some((s) => !s.restoredAt)) && (
        <Field id="reset-name" label={t('settingsReset.typeName', { name: detail.organization.name })}>
          <input id="reset-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
      )}
      {preview && preview.changes.length > 0 && (
        <div className="form-actions">
          <button type="button" className="button button--danger" disabled={!nameOk || reset.isPending} onClick={() => reset.mutate()}>
            {t('settingsReset.confirm')}
          </button>
        </div>
      )}
      {reset.isError && <Notice kind="error">{errorMessage(t, reset.error)}</Notice>}
      {snapshots.data && snapshots.data.snapshots.length > 0 && (
        <>
          <h3>{t('settingsReset.history')}</h3>
          <ul className="data-list" data-testid="reset-snapshots">
            {snapshots.data.snapshots.map((s) => (
              <li key={s.id} className="data-row">
                <div className="data-main">
                  <p>
                    {t(`settingsReset.kind.${s.kind}`)} · {s.sections.map((x) => t(`settingsReset.section.${x}`)).join('، ')} ·{' '}
                    {t('settingsReset.changes', { count: s.changes })}
                  </p>
                  <p className="muted small">
                    <bdi dir="ltr">{s.createdAt.slice(0, 16).replace('T', ' ')}</bdi>
                  </p>
                </div>
                {s.kind === 'reset' && !s.restoredAt && (
                  <button
                    type="button"
                    className="button button--secondary"
                    disabled={!nameOk || restore.isPending}
                    onClick={() => restore.mutate(s.id)}
                  >
                    {t('settingsReset.restore')}
                  </button>
                )}
                {s.restoredAt && <span className="badge">{t('settingsReset.wasRestored')}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {restore.isError && <Notice kind="error">{errorMessage(t, restore.error)}</Notice>}
    </section>
  );
}
