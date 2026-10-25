import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { DocumentationBadge } from '../components/clinical';
import { CoverageItem } from '../components/coverage';
import { EmptyState, ErrorState, Loading, Notice } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { CLINICAL_QUERY, type Coverage, type CoveredRecord, type PatientRef } from '../lib/clinical';
import { errorMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { orgKeys, useOrg } from '../org/context';

/** Coverage the doctor gave (with revoke) and received (with the records it opens). */
export function CoveragePage() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  useDocumentTitle(t('coverage.title'));
  const list = useQuery({
    queryKey: orgKeys.coverage(orgId),
    queryFn: ({ signal }) => api<{ granted: Coverage[]; received: Coverage[]; canGrantAsLead: boolean }>(`/orgs/${orgId}/clinical/coverage`, { signal }),
    ...CLINICAL_QUERY,
  });
  return (
    <>
      <PageHeader title={t('coverage.title')} subtitle={t('coverage.subtitle')} />
      <Notice kind="info">{t('coverage.rules')}</Notice>
      {list.isPending && <Loading />}
      {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} />}
      {list.isSuccess && (
        <div className="card-grid card-grid--wide">
          <section className="card" aria-labelledby="coverage-received-title">
            <h2 id="coverage-received-title">{t('coverage.received')}</h2>
            {list.data.received.length === 0 ? (
              <EmptyState>{t('coverage.noneReceived')}</EmptyState>
            ) : (
              <ul className="data-list">
                {list.data.received.map((c) => (
                  <CoverageItem key={c.id} coverage={c} direction="received" />
                ))}
              </ul>
            )}
          </section>
          <section className="card" aria-labelledby="coverage-granted-title">
            <h2 id="coverage-granted-title">{t('coverage.granted')}</h2>
            <p className="muted small">{t('coverage.grantedHint')}</p>
            {list.data.granted.length === 0 ? (
              <EmptyState>{t('coverage.noneGranted')}</EmptyState>
            ) : (
              <ul className="data-list">
                {list.data.granted.map((c) => (
                  <CoverageItem key={c.id} coverage={c} direction="granted" />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}

/** The records one received, active grant opens. */
export function CoverageRecordsPage() {
  const { t } = useTranslation();
  const { coverageId = '' } = useParams();
  const { orgId, timeZone } = useOrg();
  const fmt = useFormatters();
  useDocumentTitle(t('coverage.title'));
  const records = useQuery({
    queryKey: orgKeys.coverageRecords(orgId, coverageId),
    queryFn: ({ signal }) =>
      api<{ coverage: Coverage; patient: PatientRef | null; data: CoveredRecord[] }>(`/orgs/${orgId}/clinical/coverage/${coverageId}/records`, { signal }),
    ...CLINICAL_QUERY,
  });
  if (records.isPending) return <Loading />;
  if (records.isError) {
    if (records.error instanceof ApiError && records.error.status === 404) {
      return (
        <section className="card state-card">
          <h1>{t('coverage.title')}</h1>
          <p>{t('coverage.unavailable')}</p>
          <Link className="button button--secondary" to={`/app/${orgId}/coverage`}>
            {t('coverage.backToCoverage')}
          </Link>
        </section>
      );
    }
    return <ErrorState message={errorMessage(t, records.error)} onRetry={() => void records.refetch()} />;
  }
  const { coverage, patient, data } = records.data;
  const zone = timeZone ?? 'UTC';
  return (
    <>
      <PageHeader
        title={patient ? patient.fullName : t('coverage.title')}
        subtitle={t('coverage.recordsSubtitle', { name: coverage.source.displayName, time: fmt.dateTime(coverage.expiresAt, zone) })}
      />
      <p className="muted small">
        <Link to={`/app/${orgId}/coverage`}>{t('coverage.backToCoverage')}</Link>
      </p>
      <section className="card" aria-labelledby="covered-records-title">
        <h2 id="covered-records-title">{t('coverage.records')}</h2>
        {data.length === 0 ? (
          <EmptyState>{t('coverage.noRecords')}</EmptyState>
        ) : (
          <ol className="timeline" data-testid="covered-records">
            {data.map((r) => (
              <li key={r.id} className="timeline-item" data-testid="covered-record">
                <div className="timeline-head">
                  <Link to={`/app/${orgId}/records/${r.id}`}>{r.appointmentStartAt ? fmt.dateTime(r.appointmentStartAt, zone) : t('clinical.title')}</Link>
                  <DocumentationBadge status={r.status} />
                </div>
                {r.reason && <p className="record-text record-excerpt">{r.reason}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
