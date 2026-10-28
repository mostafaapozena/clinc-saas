import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { CLINICAL_QUERY, useIsTreating, type ClinicalHistoryItem, type DocumentationStatus } from '../lib/clinical';
import { errorMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import type { Appointment } from '../lib/types';
import { orgKeys, useOrg } from '../org/context';
import { EmptyState, ErrorState, Loading } from './ui';

/** Documentation status only — never clinical content. */
export function DocumentationBadge({ status }: { status: DocumentationStatus }) {
  const { t } = useTranslation();
  return (
    <span className={`badge badge--record-${status}`} data-testid="documentation-status">
      {t('clinical.documentationLabel', { status: t(`clinical.status.${status}`) })}
    </span>
  );
}

/** Appointment page card: the treating doctor opens the record; owners and admins see the status only. */
export function VisitRecordCard({ appointment }: { appointment: Appointment }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const treating = useIsTreating(appointment);
  const status = appointment.documentation;
  if (!treating && !status) return null;
  const documentable = appointment.status === 'in_progress' || appointment.status === 'completed';
  return (
    <section className="card" aria-labelledby="visit-record-title">
      <h2 id="visit-record-title">{t('clinical.title')}</h2>
      {status && <DocumentationBadge status={status} />}
      {treating ? (
        documentable || (status && status !== 'none') ? (
          <p>
            <Link className="button button--primary" to={`/app/${orgId}/appointments/${appointment.id}/record`}>
              {status === 'none' ? t('clinical.start') : t('clinical.open')}
            </Link>
          </p>
        ) : (
          <p className="muted">{t(appointment.status === 'cancelled' || appointment.status === 'no_show' ? 'clinical.cannotStart.closed' : 'clinical.cannotStart.notStarted')}</p>
        )
      ) : (
        <p className="muted small">{t('clinical.statusOnlyNote')}</p>
      )}
    </section>
  );
}

/** Patient page: the caller's own visit records for this patient, newest first. */
export function ClinicalHistoryCard({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const { orgId, can, timeZone } = useOrg();
  const fmt = useFormatters();
  const allowed = can('clinical.encounter.own');
  const history = useQuery({
    queryKey: orgKeys.clinicalHistory(orgId, patientId),
    queryFn: ({ signal }) => api<{ data: ClinicalHistoryItem[] }>(`/orgs/${orgId}/patients/${patientId}/clinical-history`, { signal }).then((r) => r.data),
    enabled: allowed,
    ...CLINICAL_QUERY,
  });
  if (!allowed) return null;
  return (
    <section className="card" aria-labelledby="clinical-history-title">
      <h2 id="clinical-history-title">{t('clinical.patientHistory')}</h2>
      <p className="muted small">{t('clinical.patientHistoryNote')}</p>
      {history.isPending && <Loading />}
      {history.isError && <ErrorState message={errorMessage(t, history.error)} onRetry={() => void history.refetch()} />}
      {history.isSuccess && history.data.length === 0 && <EmptyState>{t('clinical.noHistory')}</EmptyState>}
      {history.isSuccess && history.data.length > 0 && (
        <ol className="timeline" data-testid="clinical-history">
          {history.data.map((item) => (
            <li key={item.id} className="timeline-item" data-testid="clinical-history-item">
              <div className="timeline-head">
                <Link to={item.covered ? `/app/${orgId}/records/${item.id}` : `/app/${orgId}/appointments/${item.appointmentId}/record`}>
                  {item.appointmentStartAt && timeZone ? fmt.dateTime(item.appointmentStartAt, timeZone) : t('clinical.title')}
                </Link>
                <DocumentationBadge status={item.status} />
                {item.lateEntry && <span className="badge badge--late-entry">{t('clinical.lateEntryBadge')}</span>}
                {item.covered && <span className="badge badge--capability">{t('coverage.viaCoverageBadge')}</span>}
              </div>
              {item.reason && <p className="record-text record-excerpt">{item.reason}</p>}
              {item.addendaCount > 0 && <p className="muted small">{t('clinical.addendaCount', { n: fmt.number(item.addendaCount) })}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
