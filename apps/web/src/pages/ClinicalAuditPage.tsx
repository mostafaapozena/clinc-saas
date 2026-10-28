import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import { api, query } from '../lib/api';
import { CLINICAL_QUERY, type ClinicalAuditEntry } from '../lib/clinical';
import { errorMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { orgKeys, useOrg } from '../org/context';

const ACTIONS = [
  'encounter.created',
  'encounter.viewed',
  'encounter.draft_saved',
  'encounter.finalized',
  'encounter.addendum_added',
  'clinical_history.viewed',
  'clinical.access_denied',
  'coverage.granted',
  'coverage.revoked',
  'clinical_audit.viewed',
] as const;

/** Safe metadata worth showing: reason codes and the coverage route — never content. */
function details(t: (key: string) => string, entry: ClinicalAuditEntry): string {
  const parts: string[] = [];
  const m: Record<string, unknown> = entry.metadata ?? {};
  if (typeof m.reason === 'string') parts.push(t(`clinicalAudit.reasons.${m.reason}`));
  if (m.via === 'coverage') parts.push(t('clinicalAudit.viaCoverage'));
  if (typeof m.access === 'string') parts.push(t(`coverage.access.${m.access}`));
  if (typeof m.version === 'number') parts.push(`v${m.version}`);
  return parts.join(' · ');
}

/** Who did what with clinical records, when — for members holding the clinical-audit capability. */
export function ClinicalAuditPage() {
  const { t } = useTranslation();
  const { orgId, timeZone } = useOrg();
  const fmt = useFormatters();
  const [action, setAction] = useState('');
  useDocumentTitle(t('clinicalAudit.title'));
  const params = { action: action || undefined, limit: 50 };
  const events = useInfiniteQuery({
    queryKey: orgKeys.clinicalAudit(orgId, params),
    queryFn: ({ signal, pageParam }) =>
      api<{ data: ClinicalAuditEntry[]; next: string | null }>(`/orgs/${orgId}/clinical/audit${query({ ...params, before: pageParam ?? undefined })}`, {
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    ...CLINICAL_QUERY,
  });
  const rows = events.data?.pages.flatMap((p) => p.data) ?? [];
  const zone = timeZone ?? 'UTC';
  return (
    <>
      <PageHeader title={t('clinicalAudit.title')} subtitle={t('clinicalAudit.subtitle')} />
      <Notice kind="info">{t('clinicalAudit.metadataOnly')}</Notice>
      <div className="filters">
        <Field id="audit-action" label={t('clinicalAudit.action')}>
          <select id="audit-action" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">{t('clinicalAudit.allActions')}</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {t(`clinicalAudit.actions.${a}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {events.isPending && <Loading />}
      {events.isError && <ErrorState message={errorMessage(t, events.error)} onRetry={() => void events.refetch()} />}
      {events.isSuccess && rows.length === 0 && <EmptyState icon="shield">{t('clinicalAudit.empty')}</EmptyState>}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table" data-testid="clinical-audit">
            <thead>
              <tr>
                <th scope="col">{t('clinicalAudit.time')}</th>
                <th scope="col">{t('clinicalAudit.actor')}</th>
                <th scope="col">{t('clinicalAudit.action')}</th>
                <th scope="col">{t('clinicalAudit.patient')}</th>
                <th scope="col">{t('clinicalAudit.details')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>{fmt.dateTime(e.createdAt, zone)}</td>
                  <td>
                    {e.actor.displayName} <span className="muted small">({t(`roles.${e.actor.role}`)})</span>
                  </td>
                  <td>{t(`clinicalAudit.actions.${e.action}`)}</td>
                  <td>{e.patientNumber !== null ? `#${fmt.number(e.patientNumber)}` : '—'}</td>
                  <td className="muted small">{details(t, e) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {events.hasNextPage && (
        <button type="button" className="button button--secondary" disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>
          {events.isFetchingNextPage ? t('common.loading') : t('clinicalAudit.more')}
        </button>
      )}
    </>
  );
}
