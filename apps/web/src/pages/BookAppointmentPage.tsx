import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { PatientPicker, SlotPicker, TimeZoneRequired } from '../components/scheduling';
import { useInvalidateOrg } from '../lib/scheduling';
import { ErrorState, Field, Loading, Notice } from '../components/ui';
import { api, query } from '../lib/api';
import { errorMessage, isApiError } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { isValidDateInput, newIdempotencyKey, todayIn } from '../lib/time';
import type { Appointment, AppointmentType, Patient, PatientSummary, Practitioner, Slot } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { orgKeys, useOrg } from '../org/context';

const DURATIONS = [10, 15, 20, 30, 45, 60, 90];

/** New booking: patient → branch → practitioner → date → server-provided slot → confirm. */
export function BookAppointmentPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const { orgId, branches, selectedBranchId, timeZone } = useOrg();
  const invalidate = useInvalidateOrg();
  useDocumentTitle(t('booking.title'));

  const presetPatient = params.get('patientId') ?? '';
  const preset = useQuery({
    queryKey: orgKeys.patient(orgId, presetPatient),
    queryFn: ({ signal }) => api<{ patient: Patient }>(`/orgs/${orgId}/patients/${presetPatient}`, { signal }).then((r) => r.patient),
    enabled: Boolean(presetPatient),
  });
  const [chosenPatient, setPatient] = useState<PatientSummary | null>(null);
  const patient = chosenPatient ?? (presetPatient && preset.data ? preset.data : null);

  const activeBranches = branches.filter((b) => b.status === 'active');
  // Derived on every render: the branch list may still be loading when the page opens.
  const [branchChoice, setBranchId] = useState('');
  const defaultBranch = activeBranches.some((b) => b.id === selectedBranchId) ? selectedBranchId : (activeBranches[0]?.id ?? '');
  const branchId = activeBranches.some((b) => b.id === branchChoice) ? branchChoice : defaultBranch;
  const [practitionerId, setPractitionerId] = useState('');
  const [date, setDate] = useState(() => (timeZone ? todayIn(timeZone) : ''));
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const [type, setType] = useState<AppointmentType>('new_visit');
  const [slot, setSlot] = useState<Slot | null>(null);
  // One key per booking attempt: a retried submit of the same choice cannot double-book.
  const attemptKey = useRef(newIdempotencyKey());
  const resetAttempt = () => {
    attemptKey.current = newIdempotencyKey();
    setSlot(null);
  };

  const practitioners = useQuery({
    queryKey: orgKeys.practitioners(orgId, { branchId, status: 'active' }),
    queryFn: ({ signal }) =>
      api<{ data: Practitioner[] }>(`/orgs/${orgId}/practitioners${query({ branchId, status: 'active' })}`, { signal }).then((r) => r.data),
    enabled: Boolean(branchId),
  });
  const practitioner = practitioners.data?.find((p) => p.id === practitionerId);

  const book = useMutation({
    mutationFn: () =>
      api<{ appointment: Appointment }>(`/orgs/${orgId}/appointments`, {
        method: 'POST',
        headers: { 'Idempotency-Key': attemptKey.current },
        body: {
          patientId: patient?.id,
          practitionerId,
          branchId,
          date: slot?.localDate,
          time: slot?.localTime,
          utcOffsetMinutes: slot?.utcOffsetMinutes,
          durationMinutes: duration,
          type,
        },
      }),
    onSuccess: async ({ appointment }) => {
      await invalidate();
      navigate(`/app/${orgId}/appointments/${appointment.id}`, { state: { booked: true } });
    },
    onError: async (error) => {
      if (isApiError(error, 'SLOT_UNAVAILABLE')) {
        resetAttempt();
        await queryClient.invalidateQueries({ queryKey: ['org', orgId, 'availability'] });
      }
    },
  });

  if (!timeZone) {
    return (
      <>
        <PageHeader title={t('booking.title')} />
        <TimeZoneRequired />
      </>
    );
  }
  if (presetPatient && preset.isPending && !chosenPatient) return <Loading />;

  const ready = Boolean(patient && branchId && practitionerId && slot);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) book.mutate();
  };
  const registeredHere = patient?.registrations.some((r) => r.branchId === branchId && r.status === 'active');

  return (
    <>
      <PageHeader title={t('booking.title')} subtitle={t('appointments.timeZoneNote', { zone: timeZone })} />
      <form className="card booking-form" onSubmit={onSubmit} noValidate aria-label={t('booking.title')}>
        {book.isError && <Notice kind="error">{errorMessage(t, book.error)}</Notice>}
        <PatientPicker
          value={patient}
          onChange={(p) => {
            setPatient(p);
            resetAttempt();
          }}
        />
        {patient && !registeredHere && <Notice kind="info">{t('booking.notRegisteredHere')}</Notice>}
        <div className="form-grid">
          <Field id="booking-branch" label={t('booking.branch')}>
            <select
              id="booking-branch"
              value={branchId}
              onChange={(e) => {
                setBranchId(e.target.value);
                setPractitionerId('');
                resetAttempt();
              }}
            >
              {activeBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="booking-practitioner" label={t('booking.practitioner')}>
            <select
              id="booking-practitioner"
              value={practitionerId}
              onChange={(e) => {
                setPractitionerId(e.target.value);
                setDuration(undefined);
                resetAttempt();
              }}
            >
              <option value="">{t('common.choose')}</option>
              {practitioners.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </Field>
          <Field id="booking-date" label={t('booking.date')}>
            <input
              id="booking-date"
              type="date"
              min={todayIn(timeZone)}
              value={date}
              onChange={(e) => {
                if (isValidDateInput(e.target.value)) setDate(e.target.value);
                resetAttempt();
              }}
            />
          </Field>
          <Field id="booking-duration" label={t('booking.duration')}>
            <select
              id="booking-duration"
              value={duration ?? practitioner?.defaultDurationMinutes ?? ''}
              disabled={!practitioner}
              onChange={(e) => {
                setDuration(Number(e.target.value));
                resetAttempt();
              }}
            >
              {[...new Set([...(practitioner ? [practitioner.defaultDurationMinutes] : []), ...DURATIONS])]
                .sort((a, b) => a - b)
                .map((d) => (
                  <option key={d} value={d}>
                    {t('booking.minutes', { n: d })}
                  </option>
                ))}
            </select>
          </Field>
          <Field id="booking-type" label={t('booking.type')}>
            <select id="booking-type" value={type} onChange={(e) => setType(e.target.value as AppointmentType)}>
              <option value="new_visit">{t('appointments.types.new_visit')}</option>
              <option value="follow_up">{t('appointments.types.follow_up')}</option>
            </select>
          </Field>
        </div>
        <SlotPicker
          practitionerId={practitionerId}
          branchId={branchId}
          date={date}
          durationMinutes={duration}
          value={slot}
          onChange={setSlot}
        />
        <div className="form-actions">
          <button type="submit" className="button button--primary" disabled={!ready || book.isPending}>
            {book.isPending ? t('common.saving') : t('booking.confirm')}
          </button>
          <Link className="button button--secondary" to={`/app/${orgId}/appointments`}>
            {t('common.cancel')}
          </Link>
        </div>
      </form>
    </>
  );
}

/** Moves a scheduled appointment to another server-provided slot (same practitioner and branch). */
export function RescheduleAppointmentPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { appointmentId = '' } = useParams();
  const { orgId, timeZone, branches } = useOrg();
  const fmt = useFormatters();
  const invalidate = useInvalidateOrg();
  useDocumentTitle(t('booking.rescheduleTitle'));
  const appointment = useQuery({
    queryKey: orgKeys.appointment(orgId, appointmentId),
    queryFn: ({ signal }) => api<{ appointment: Appointment }>(`/orgs/${orgId}/appointments/${appointmentId}`, { signal }).then((r) => r.appointment),
  });
  const [date, setDate] = useState(() => (timeZone ? todayIn(timeZone) : ''));
  const [slot, setSlot] = useState<Slot | null>(null);
  const save = useMutation({
    mutationFn: (current: Appointment) =>
      api<{ appointment: Appointment }>(`/orgs/${orgId}/appointments/${current.id}/reschedule`, {
        method: 'POST',
        body: {
          date: slot?.localDate,
          time: slot?.localTime,
          utcOffsetMinutes: slot?.utcOffsetMinutes,
          durationMinutes: current.durationMinutes,
          version: current.version,
        },
      }),
    onSuccess: async ({ appointment: saved }) => {
      await invalidate();
      navigate(`/app/${orgId}/appointments/${saved.id}`, { state: { rescheduled: true } });
    },
    onError: () => invalidate(),
  });

  if (!timeZone) return <TimeZoneRequired />;
  if (appointment.isPending) return <Loading />;
  if (appointment.isError) return <ErrorState message={errorMessage(t, appointment.error)} onRetry={() => void appointment.refetch()} />;
  const a = appointment.data;
  if (a.status !== 'scheduled') return <Notice kind="info">{t('errors.INVALID_TRANSITION')}</Notice>;
  const branchName = branches.find((b) => b.id === a.branchId)?.name ?? '—';

  return (
    <>
      <PageHeader title={t('booking.rescheduleTitle')} subtitle={`${a.patient?.fullName ?? ''} · ${a.practitioner?.displayName ?? ''} · ${branchName}`} />
      <form
        className="card booking-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (slot) save.mutate(a);
        }}
        noValidate
      >
        <p>{t('booking.currentTime', { time: fmt.dateTime(a.startAt, timeZone) })}</p>
        {save.isError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
        <Field id="reschedule-date" label={t('booking.date')}>
          <input
            id="reschedule-date"
            type="date"
            min={todayIn(timeZone)}
            value={date}
            onChange={(e) => {
              if (isValidDateInput(e.target.value)) setDate(e.target.value);
              setSlot(null);
            }}
          />
        </Field>
        <SlotPicker
          practitionerId={a.practitioner?.id ?? ''}
          branchId={a.branchId}
          date={date}
          durationMinutes={a.durationMinutes}
          excludeAppointmentId={a.id}
          value={slot}
          onChange={setSlot}
        />
        <div className="form-actions">
          <button type="submit" className="button button--primary" disabled={!slot || save.isPending}>
            {save.isPending ? t('common.saving') : t('booking.confirmReschedule')}
          </button>
          <Link className="button button--secondary" to={`/app/${orgId}/appointments/${a.id}`}>
            {t('common.cancel')}
          </Link>
        </div>
      </form>
    </>
  );
}
