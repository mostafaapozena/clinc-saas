import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { AppointmentActions, StatusBadge, TimeZoneRequired } from '../components/scheduling';
import { EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import { api, query } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { addDays, datesFrom, isValidDateInput, localDateOf, todayIn } from '../lib/time';
import { APPOINTMENT_STATUSES, type Appointment, type AppointmentStatus, type Practitioner } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { orgKeys, useBranchFilter, useOrg } from '../org/context';

type View = 'day' | 'week';

export function AppointmentsPage() {
  const { t } = useTranslation();
  const { orgId, can, timeZone } = useOrg();
  const branchFilter = useBranchFilter();
  const [view, setView] = useState<View>('day');
  const [date, setDate] = useState(() => (timeZone ? todayIn(timeZone) : ''));
  const [practitionerId, setPractitionerId] = useState('');
  const [status, setStatus] = useState<AppointmentStatus | ''>('');
  useDocumentTitle(t('nav.appointments'));

  const practitioners = useQuery({
    queryKey: orgKeys.practitioners(orgId, { branchId: branchFilter }),
    queryFn: ({ signal }) =>
      api<{ data: Practitioner[] }>(`/orgs/${orgId}/practitioners${query({ branchId: branchFilter })}`, { signal }).then((r) => r.data),
    enabled: can('practitioner.read'),
  });

  if (!timeZone) {
    return (
      <>
        <PageHeader title={t('appointments.title')} />
        <TimeZoneRequired />
      </>
    );
  }
  const from = date;
  const to = view === 'day' ? date : addDays(date, 6);
  const step = view === 'day' ? 1 : 7;

  return (
    <>
      <PageHeader title={t('appointments.title')} subtitle={t('appointments.timeZoneNote', { zone: timeZone })}>
        {can('appointment.book') && (
          <Link className="button button--primary" to={`/app/${orgId}/appointments/new`}>
            <Icon name="plus" /> {t('appointments.book')}
          </Link>
        )}
      </PageHeader>

      <section className="card" aria-label={t('appointments.filters')}>
        <div className="toolbar">
          <div className="segmented" role="group" aria-label={t('appointments.view')}>
            {(['day', 'week'] as const).map((v) => (
              <button key={v} type="button" className={view === v ? 'segment segment--active' : 'segment'} aria-pressed={view === v} onClick={() => setView(v)}>
                {t(`appointments.views.${v}`)}
              </button>
            ))}
          </div>
          <div className="date-nav">
            <button type="button" className="icon-button" aria-label={t('appointments.previous')} onClick={() => setDate(addDays(date, -step))}>
              <Icon name="arrowBack" />
            </button>
            <label htmlFor="schedule-date" className="visually-hidden">
              {t('appointments.date')}
            </label>
            <input id="schedule-date" type="date" value={date} onChange={(e) => isValidDateInput(e.target.value) && setDate(e.target.value)} />
            <button type="button" className="icon-button" aria-label={t('appointments.next')} onClick={() => setDate(addDays(date, step))}>
              <Icon name="arrowForward" />
            </button>
            <button type="button" className="button button--secondary" onClick={() => setDate(todayIn(timeZone))}>
              {t('appointments.today')}
            </button>
          </div>
        </div>
        <div className="filters">
          {can('practitioner.read') && (practitioners.data?.length ?? 0) > 1 && (
            <Field id="filter-practitioner" label={t('appointments.practitioner')}>
              <select id="filter-practitioner" value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)}>
                <option value="">{t('appointments.allPractitioners')}</option>
                {practitioners.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field id="filter-status" label={t('appointments.statusLabel')}>
            <select id="filter-status" value={status} onChange={(e) => setStatus(e.target.value as AppointmentStatus | '')}>
              <option value="">{t('appointments.allStatuses')}</option>
              {APPOINTMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`appointments.status.${s}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <Schedule view={view} from={from} to={to} practitionerId={practitionerId} status={status} branchId={branchFilter} />
    </>
  );
}

function Schedule({
  view,
  from,
  to,
  practitionerId,
  status,
  branchId,
}: {
  view: View;
  from: string;
  to: string;
  practitionerId: string;
  status: string;
  branchId?: string;
}) {
  const { t } = useTranslation();
  const { orgId, timeZone } = useOrg();
  const fmt = useFormatters();
  const zone = timeZone ?? 'UTC';
  const params = { from, to, branchId, practitionerId: practitionerId || undefined, status: status || undefined };
  const list = useQuery({
    queryKey: orgKeys.appointments(orgId, params),
    queryFn: ({ signal }) =>
      api<{ data: Appointment[]; truncated: boolean }>(`/orgs/${orgId}/appointments${query(params)}`, { signal }),
  });

  if (list.isPending) return <Loading />;
  if (list.isError) return <ErrorState message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} />;

  const byDate = new Map<string, Appointment[]>();
  for (const a of list.data.data) {
    const day = localDateOf(a.startAt, zone);
    byDate.set(day, [...(byDate.get(day) ?? []), a]);
  }
  const days = view === 'day' ? [from] : datesFrom(from, 7);

  return (
    <div className={view === 'week' ? 'week-grid' : undefined}>
      {list.data.truncated && <Notice kind="info">{t('appointments.truncated')}</Notice>}
      {days.map((day) => {
        const items = byDate.get(day) ?? [];
        return (
          <section key={day} className="card day-card" aria-labelledby={`day-${day}`} data-testid="schedule-day">
            <h2 id={`day-${day}`}>
              {fmt.localDate(day, view === 'week' ? 'short' : 'long')}
              {day === todayIn(zone) && <span className="badge badge--today">{t('appointments.today')}</span>}
            </h2>
            {items.length === 0 ? (
              <EmptyState>{t('appointments.emptyDay')}</EmptyState>
            ) : view === 'day' ? (
              <table className="data-table" aria-label={t('appointments.dayTable')}>
                <thead>
                  <tr>
                    <th scope="col">{t('appointments.time')}</th>
                    <th scope="col">{t('appointments.patient')}</th>
                    <th scope="col">{t('appointments.practitioner')}</th>
                    <th scope="col">{t('appointments.statusLabel')}</th>
                    <th scope="col">{t('appointments.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id} data-testid="appointment-row">
                      <td data-label={t('appointments.time')}>
                        <Link to={`/app/${orgId}/appointments/${a.id}`}>
                          {fmt.time(a.startAt, zone)}–{fmt.time(a.endAt, zone)}
                        </Link>
                      </td>
                      <td data-label={t('appointments.patient')}>
                        {a.patient?.fullName ?? '—'}
                        <span className="muted small"> #{a.patient ? fmt.number(a.patient.patientNumber) : ''}</span>
                      </td>
                      <td data-label={t('appointments.practitioner')}>{a.practitioner?.displayName ?? '—'}</td>
                      <td data-label={t('appointments.statusLabel')}>
                        <StatusBadge status={a.status} />
                      </td>
                      <td data-label={t('appointments.actions')}>
                        <AppointmentActions appointment={a} compact />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <ul className="week-list">
                {items.map((a) => (
                  <li key={a.id} data-testid="appointment-row">
                    <Link to={`/app/${orgId}/appointments/${a.id}`}>
                      <span className="week-time">{fmt.time(a.startAt, zone)}</span> {a.patient?.fullName ?? '—'}
                    </Link>
                    <span className="muted small">{a.practitioner?.displayName}</span>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
