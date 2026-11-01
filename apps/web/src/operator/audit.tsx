import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/PageHeader';
import { ErrorState, Field, Loading } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { opApi, opKeys } from '../lib/operator';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { FilterBar } from '../components/data';

type AuditRow = {
  id: string;
  at: string;
  actor: string;
  operator: string | null;
  action: string;
  target: { type: string; id: string };
  changes: Record<string, unknown>;
};

export function OperatorAuditPage() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  useDocumentTitle(t('operator.nav.audit'));
  const [pages, setPages] = useState<string[]>(['']);
  const [hideSignIns, setHideSignIns] = useState(false);
  const [actionFilter, setActionFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const audit = useQuery({
    queryKey: [...opKeys.audit, pages],
    queryFn: async ({ signal }) => {
      const results = await Promise.all(
        pages.map((before) =>
          opApi<{ data: AuditRow[]; next: string | null }>(`/audit${before ? `?before=${encodeURIComponent(before)}` : ''}`, { signal }),
        ),
      );
      return { data: results.flatMap((r) => r.data), next: results.at(-1)?.next ?? null };
    },
  });
  return (
    <>
      <PageHeader title={t('operator.nav.audit')} subtitle={t('operator.audit.subtitle')} />
      {audit.isPending && <Loading />}
      {audit.isError && <ErrorState message={errorMessage(t, audit.error)} onRetry={() => void audit.refetch()} />}
      {audit.isSuccess && (
        <>
          <AuditFilters
            rows={audit.data.data}
            hideSignIns={hideSignIns}
            onHideSignIns={setHideSignIns}
            action={actionFilter}
            onAction={setActionFilter}
            actor={actorFilter}
            onActor={setActorFilter}
          />
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('operator.audit.time')}</th>
                  <th>{t('operator.audit.actor')}</th>
                  <th>{t('operator.audit.action')}</th>
                  <th>{t('operator.audit.target')}</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.data
                  .filter((e) => !(hideSignIns && e.action === 'operator.signed_in'))
                  .filter((e) => !actionFilter || e.action === actionFilter)
                  .filter((e) => !actorFilter || (e.operator ?? e.actor) === actorFilter)
                  .map((e) => (
                    <tr key={e.id}>
                      <td data-label={t('operator.audit.time')}>{fmt.dateTime(e.at, Intl.DateTimeFormat().resolvedOptions().timeZone)}</td>
                      <td data-label={t('operator.audit.actor')}>{e.operator ?? t(`operator.actor.${e.actor}`)}</td>
                      <td data-label={t('operator.audit.action')}>
                        {/* The code stays available as a tooltip for support staff. */}
                        <span title={e.action}>{t(`operator.audit.actions.${e.action}`, { defaultValue: e.action })}</span>
                        {e.changes.apply === false && <span className="muted small"> ({t('operator.audit.dryRun')})</span>}
                      </td>
                      <td data-label={t('operator.audit.target')}>
                        {e.target.id === 'all' ? (
                          t(`operator.audit.allTargets.${e.target.type}`, { defaultValue: t('operator.audit.all') })
                        ) : (
                          <>
                            {t(`operator.audit.targets.${e.target.type}`, { defaultValue: e.target.type })}{' '}
                            <bdi className="muted small" title={e.target.id}>
                              {e.target.id.slice(-6)}
                            </bdi>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {audit.data.next && (
            <button type="button" className="button button--secondary" onClick={() => setPages([...pages, audit.data.next!])}>
              {t('operator.audit.more')}
            </button>
          )}
        </>
      )}
    </>
  );
}

/** Filters for the platform log; they narrow the entries loaded so far ("Load more" fetches older ones). */
function AuditFilters({
  rows,
  hideSignIns,
  onHideSignIns,
  action,
  onAction,
  actor,
  onActor,
}: {
  rows: AuditRow[];
  hideSignIns: boolean;
  onHideSignIns: (value: boolean) => void;
  action: string;
  onAction: (value: string) => void;
  actor: string;
  onActor: (value: string) => void;
}) {
  const { t } = useTranslation();
  const actions = [...new Set(rows.map((r) => r.action))].sort();
  const actors = [...new Set(rows.map((r) => r.operator ?? r.actor))].sort();
  return (
    <FilterBar className="audit-filters">
      <Field id="audit-action" label={t('operator.audit.action')}>
        <select id="audit-action" value={action} onChange={(e) => onAction(e.target.value)}>
          <option value="">{t('operator.audit.allActions')}</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {t(`operator.audit.actions.${a}`, { defaultValue: a })}
            </option>
          ))}
        </select>
      </Field>
      <Field id="audit-actor" label={t('operator.audit.actor')}>
        <select id="audit-actor" value={actor} onChange={(e) => onActor(e.target.value)} dir="auto">
          <option value="">{t('operator.audit.allActors')}</option>
          {actors.map((a) => (
            <option key={a} value={a}>
              {t(`operator.actor.${a}`, { defaultValue: a })}
            </option>
          ))}
        </select>
      </Field>
      <label className="choice">
        <input type="checkbox" checked={hideSignIns} onChange={(e) => onHideSignIns(e.target.checked)} />
        {t('operator.audit.hideSignIns')}
      </label>
      <p className="field-hint">{t('operator.audit.filterHint')}</p>
    </FilterBar>
  );
}
