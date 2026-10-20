import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { AppointmentActions, StatusBadge, TimeZoneRequired } from '../components/scheduling';
import { EmptyState, ErrorState, Field, Loading } from '../components/ui';
import { api, query } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { todayIn } from '../lib/time';
import type { Appointment, Practitioner } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { orgKeys, useBranchFilter, useOrg } from '../org/context';

const REFRESH_MS = 30_000;

/**
 * Today's arrivals. Waiting patients are ordered by actual arrival time (then appointment time),
 * exactly as the API returns them — there is no manual reordering or priority.
 */
export function QueuePage() {
  const { t } = useTranslation();
  const { orgId, can, timeZone } = useOrg();
  const branchId = useBranchFilter();
  const [practitionerId, setPractitionerId] = useState('');
  useDocumentTitle(t('nav.queue'));

  const practitioners = useQuery({
    queryKey: orgKeys.practitioners(orgId, { branchId }),
    queryFn: ({ signal }) => api<{ data: Practitioner[] }>(`/orgs/${orgId}/practitioners${query({ branchId })}`, { signal }).then((r) => r.data),
    enabled: can('practitioner.read'),
  });
  const params = { branchId, practitionerId: practitionerId || undefined };
  const queue = useQuery({
    queryKey: orgKeys.queue(orgId, params),
    queryFn: ({ signal }) =>
      api<{ date: string; waiting: Appointment[]; inProgress: Appointment[] }>(`/orgs/${orgId}/queue${query(params)}`, { signal }),
    refetchInterval: REFRESH_MS,
    enabled: Boolean(timeZone),
  });
  const today = timeZone ? todayIn(timeZone) : '';
  const expectedParams = { from: today, to: today, branchId, practitionerId: practitionerId || undefined, status: 'scheduled' };
  const expected = useQuery({
    queryKey: orgKeys.appointments(orgId, expectedParams),
    queryFn: ({ signal }) => api<{ data: Appointment[] }>(`/orgs/${orgId}/appointments${query(expectedParams)}`, { signal }).then((r) => r.data),
    enabled: Boolean(timeZone) && can('appointment.front_desk'),
    refetchInterval: REFRESH_MS,
  });

  if (!timeZone) {
    return (
      <>
        <PageHeader title={t('queue.title')} />
        <TimeZoneRequired />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('queue.title')} subtitle={t('queue.subtitle')} />
      {(practitioners.data?.length ?? 0) > 1 && (
        <div className="filters">
          <Field id="queue-practitioner" label={t('appointments.practitioner')}>
            <select id="queue-practitioner" value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)}>
              <option value="">{t('appointments.allPractitioners')}</option>
              {practitioners.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {queue.isPending && <Loading />}
      {queue.isError && <ErrorState message={errorMessage(t, queue.error)} onRetry={() => void queue.refetch()} />}
      {queue.isSuccess && (
        <div className="card-grid card-grid--wide">
          <QueueSection id="waiting" title={t('queue.waiting')} empty={t('queue.noneWaiting')} items={queue.data.waiting} timeLabel="arrival" />
          <QueueSection id="in-progress" title={t('queue.inProgress')} empty={t('queue.noneInProgress')} items={queue.data.inProgress} timeLabel="started" />
        </div>
      )}
      {can('appointment.front_desk') && expected.isSuccess && (
        <QueueSection id="expected" title={t('queue.expected')} empty={t('queue.noneExpected')} items={expected.data} timeLabel="scheduled" />
      )}
    </>
  );
}

function QueueSection({
  id,
  title,
  empty,
  items,
  timeLabel,
}: {
  id: string;
  title: string;
  empty: string;
  items: Appointment[];
  timeLabel: 'arrival' | 'started' | 'scheduled';
}) {
  const { t } = useTranslation();
  const { orgId, timeZone, branches } = useOrg();
  const fmt = useFormatters();
  const zone = timeZone ?? 'UTC';
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  return (
    <section className="card" aria-labelledby={`queue-${id}-title`} data-testid={`queue-${id}`}>
      <h2 id={`queue-${id}-title`}>
        {title} <span className="count-pill">{fmt.number(items.length)}</span>
      </h2>
      {items.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <ol className="queue-list">
          {items.map((a, index) => {
            const when = timeLabel === 'arrival' ? a.checkedInAt : timeLabel === 'started' ? a.startedAt : a.startAt;
            return (
              <li key={a.id} className="queue-item" data-testid="queue-entry">
                <span className="queue-position" aria-hidden="true">
                  {fmt.number(index + 1)}
                </span>
                <div className="queue-main">
                  <Link to={`/app/${orgId}/appointments/${a.id}`}>
                    <strong>{a.patient?.fullName ?? '—'}</strong>
                  </Link>
                  <span className="muted small">
                    {t(`queue.timeLabel.${timeLabel}`, { time: when ? fmt.time(when, zone) : '—' })} ·{' '}
                    {t('queue.appointmentAt', { time: fmt.time(a.startAt, zone) })} · {a.practitioner?.displayName} ·{' '}
                    {branchName.get(a.branchId) ?? '—'}
                  </span>
                  <StatusBadge status={a.status} />
                </div>
                <AppointmentActions appointment={a} compact />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
