import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { VisitRecordCard } from '../components/clinical';
import { AppointmentActions, StatusBadge, TimeZoneRequired } from '../components/scheduling';
import { ErrorState, Loading, Notice } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import type { Appointment } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { orgKeys, useOrg } from '../org/context';

export function AppointmentDetailPage() {
  const { t } = useTranslation();
  const { appointmentId = '' } = useParams();
  const location = useLocation();
  const { orgId, can, timeZone, branches } = useOrg();
  const fmt = useFormatters();
  useDocumentTitle(t('appointments.detailTitle'));
  const appointment = useQuery({
    queryKey: orgKeys.appointment(orgId, appointmentId),
    queryFn: ({ signal }) => api<{ appointment: Appointment }>(`/orgs/${orgId}/appointments/${appointmentId}`, { signal }).then((r) => r.appointment),
  });

  if (!timeZone) return <TimeZoneRequired />;
  if (appointment.isPending) return <Loading />;
  if (appointment.isError) {
    if (appointment.error instanceof ApiError && appointment.error.status === 404) {
      return (
        <section className="card state-card">
          <h1>{t('appointments.notFoundTitle')}</h1>
          <p>{t('errors.NOT_FOUND')}</p>
          <Link className="button button--secondary" to={`/app/${orgId}/appointments`}>
            {t('appointments.backToSchedule')}
          </Link>
        </section>
      );
    }
    return <ErrorState message={errorMessage(t, appointment.error)} onRetry={() => void appointment.refetch()} />;
  }
  const a = appointment.data;
  const state = location.state as { booked?: boolean; rescheduled?: boolean } | null;
  const stamp = (label: string, value: string | null) =>
    value && (
      <div>
        <dt>{label}</dt>
        <dd>{fmt.dateTime(value, timeZone)}</dd>
      </div>
    );

  return (
    <>
      <PageHeader title={t('appointments.detailTitle')} subtitle={fmt.dateTime(a.startAt, timeZone)}>
        <StatusBadge status={a.status} />
      </PageHeader>
      {state?.booked && <Notice kind="success">{t('booking.booked')}</Notice>}
      {state?.rescheduled && <Notice kind="success">{t('booking.rescheduled')}</Notice>}
      <div className="card-grid card-grid--wide">
        <section className="card" aria-labelledby="appointment-info-title">
          <h2 id="appointment-info-title">{t('appointments.information')}</h2>
          <dl className="details">
            <div>
              <dt>{t('appointments.patient')}</dt>
              <dd>
                {a.patient ? (
                  <Link to={`/app/${orgId}/patients/${a.patient.id}`}>
                    {a.patient.fullName} (#{fmt.number(a.patient.patientNumber)})
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            {a.patient && (
              <div>
                <dt>{t('patients.phone')}</dt>
                <dd dir="ltr">{a.patient.phone}</dd>
              </div>
            )}
            <div>
              <dt>{t('appointments.practitioner')}</dt>
              <dd>{a.practitioner?.displayName ?? '—'}</dd>
            </div>
            <div>
              <dt>{t('booking.branch')}</dt>
              <dd>{branches.find((b) => b.id === a.branchId)?.name ?? '—'}</dd>
            </div>
            <div>
              <dt>{t('appointments.time')}</dt>
              <dd>
                <bdi dir="ltr">
                  {fmt.time(a.startAt, timeZone)}–{fmt.time(a.endAt, timeZone)}
                </bdi>{' '}
                ({t('booking.minutes', { n: a.durationMinutes })})
              </dd>
            </div>
            <div>
              <dt>{t('booking.type')}</dt>
              <dd>{t(`appointments.types.${a.type}`)}</dd>
            </div>
            {stamp(t('appointments.checkedInAt'), a.checkedInAt)}
            {stamp(t('appointments.startedAt'), a.startedAt)}
            {stamp(t('appointments.completedAt'), a.completedAt)}
            {stamp(t('appointments.cancelledAt'), a.cancelledAt)}
            {stamp(t('appointments.noShowAt'), a.noShowAt)}
            {a.cancellationReason && (
              <div>
                <dt>{t('appointments.cancelReason')}</dt>
                <dd>{a.cancellationReason}</dd>
              </div>
            )}
          </dl>
        </section>
        <section className="card" aria-labelledby="appointment-actions-title">
          <h2 id="appointment-actions-title">{t('appointments.actions')}</h2>
          <AppointmentActions appointment={a} />
          {a.status === 'scheduled' && can('appointment.book') && (
            <Link className="button button--secondary" to={`/app/${orgId}/appointments/${a.id}/reschedule`}>
              {t('appointments.reschedule')}
            </Link>
          )}
          {!['scheduled', 'checked_in', 'in_progress'].includes(a.status) && <p className="muted">{t('appointments.finalState')}</p>}
        </section>
        <VisitRecordCard appointment={a} />
      </div>
    </>
  );
}
