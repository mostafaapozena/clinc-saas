import { useMutation, useQuery } from '@tanstack/react-query';
import { useDeferredValue, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api, query } from '../lib/api';
import { conflictAppointments, errorMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { availableActions, useInvalidateOrg } from '../lib/scheduling';
import { showToast } from '../lib/toast';
import type { Appointment, AppointmentStatus, Page, PatientSummary, Slot, StatusAction } from '../lib/types';
import { orgKeys, useOrg } from '../org/context';
import { EmptyState, ErrorState, Field, Loading, Notice } from './ui';

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const { t } = useTranslation();
  return (
    <span className={`badge badge--status-${status}`} data-testid="appointment-status">
      {t(`appointments.status.${status}`)}
    </span>
  );
}

/** Shown wherever scheduling needs the organization's time zone and it is not set yet. */
export function TimeZoneRequired() {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  return (
    <Notice kind="info">
      {t('scheduling.timeZoneRequired')}{' '}
      {can('organization.update') && <Link to={`/app/${orgId}/settings`}>{t('scheduling.openSettings')}</Link>}
    </Notice>
  );
}

/** Buttons for the permitted next steps of one appointment, with a reason form for cancelling. */
export function AppointmentActions({ appointment, compact = false }: { appointment: Appointment; compact?: boolean }) {
  const { t } = useTranslation();
  const org = useOrg();
  const invalidate = useInvalidateOrg();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const run = useMutation({
    mutationFn: (input: { action: StatusAction; reason?: string }) =>
      api<{ appointment: Appointment }>(`/orgs/${org.orgId}/appointments/${appointment.id}/status`, {
        method: 'POST',
        body: { ...input, version: appointment.version },
      }),
    onSuccess: async (_result, input) => {
      setCancelling(false);
      setReason('');
      // Announced once, and still visible after the entry moves to another list (UX-023).
      showToast(t(`appointments.done.${input.action}`, { name }));
      await invalidate();
    },
    onError: async () => {
      // Someone else may have changed it: show the current state next to the message.
      await invalidate();
    },
  });
  const actions = availableActions(appointment, org);
  const name = appointment.patient?.fullName ?? '';
  const reasonRequired = appointment.status === 'checked_in';
  // The treating doctor's next step during a visit is the record; completing it comes after (UX-031).
  const treating =
    appointment.status === 'in_progress' && org.can('clinical.encounter.own') && Boolean(appointment.practitioner) && org.detail.membership.practitionerId === appointment.practitioner?.id;
  if (actions.length === 0 && !run.isError && !treating) return null;

  const submitCancel = (event: FormEvent) => {
    event.preventDefault();
    run.mutate({ action: 'cancel', reason: reason.trim() || undefined });
  };

  return (
    <div className={compact ? 'row-actions' : 'stack-sm'}>
      {run.isError && <Notice kind="error">{errorMessage(t, run.error)}</Notice>}
      {cancelling ? (
        <form className="inline-form" onSubmit={submitCancel} noValidate aria-label={t('appointments.cancelLabel', { name })}>
          <Field
            id={`cancel-reason-${appointment.id}`}
            label={reasonRequired ? t('appointments.cancelReasonRequired') : `${t('appointments.cancelReason')} ${t('common.optional')}`}
          >
            <input
              id={`cancel-reason-${appointment.id}`}
              maxLength={200}
              required={reasonRequired}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="form-actions">
            <button type="submit" className="button button--danger" disabled={run.isPending || (reasonRequired && !reason.trim())}>
              {t('appointments.confirmCancel')}
            </button>
            <button type="button" className="button button--secondary" onClick={() => setCancelling(false)}>
              {t('common.back')}
            </button>
          </div>
        </form>
      ) : (
        <div className="row-actions">
          {treating && (
            <Link
              className="button button--primary"
              to={`/app/${org.orgId}/appointments/${appointment.id}/record`}
              state={{ startRecord: true }}
              aria-label={t('clinical.openRecordLabel', { name })}
            >
              {t('clinical.openRecord')}
            </Link>
          )}
          {actions.map((action) =>
            action === 'cancel' ? (
              <button
                key={action}
                type="button"
                className="button button--danger-outline"
                onClick={() => setCancelling(true)}
                aria-label={t('appointments.actionLabel.cancel', { name })}
              >
                {t('appointments.action.cancel')}
              </button>
            ) : (
              <button
                key={action}
                type="button"
                className={action === 'no_show' || (treating && action === 'complete') ? 'button button--secondary' : 'button button--primary'}
                disabled={run.isPending}
                onClick={() => run.mutate({ action })}
                aria-label={t(`appointments.actionLabel.${action}`, { name })}
              >
                {t(`appointments.action.${action}`)}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** Lists appointments named by a conflict error so the user can resolve them explicitly. */
export function ConflictList({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const { orgId, timeZone, branches } = useOrg();
  const fmt = useFormatters();
  const items = conflictAppointments(error);
  if (items.length === 0 || !timeZone) return null;
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  return (
    <div className="notice notice--error" role="alert">
      <p>{errorMessage(t, error)}</p>
      <p>{t('scheduling.resolveFirst')}</p>
      <ul className="conflict-list">
        {items.map((a) => (
          <li key={a.id}>
            <Link to={`/app/${orgId}/appointments/${a.id}`}>
              {fmt.dateTime(a.startAt, timeZone)} — {branchName.get(a.branchId) ?? '—'}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Server-computed available start times; the API re-checks everything on booking. */
export function SlotPicker({
  practitionerId,
  branchId,
  date,
  durationMinutes,
  excludeAppointmentId,
  currentStartAt,
  value,
  onChange,
}: {
  practitionerId: string;
  branchId: string;
  date: string;
  durationMinutes?: number;
  excludeAppointmentId?: string;
  /** When rescheduling: the appointment's present start, marked among the times (UX-030). */
  currentStartAt?: string;
  value: Slot | null;
  onChange: (slot: Slot | null) => void;
}) {
  const { t } = useTranslation();
  const { orgId, timeZone } = useOrg();
  const fmt = useFormatters();
  const params = { practitionerId, branchId, date, durationMinutes, excludeAppointmentId };
  const slots = useQuery({
    queryKey: orgKeys.availability(orgId, params),
    queryFn: ({ signal }) => api<{ slots: Slot[] }>(`/orgs/${orgId}/appointments/availability${query(params)}`, { signal }).then((r) => r.slots),
    enabled: Boolean(practitionerId && branchId && date),
  });
  if (!practitionerId || !branchId || !date) return <p className="muted">{t('booking.chooseFirst')}</p>;
  if (slots.isPending) return <Loading />;
  if (slots.isError) return <ErrorState message={errorMessage(t, slots.error)} onRetry={() => void slots.refetch()} />;
  if (slots.data.length === 0) return <EmptyState icon="clock">{t('booking.noSlots')}</EmptyState>;
  return (
    <fieldset className="fieldset">
      <legend>{t('booking.availableTimes')}</legend>
      {/* Grouped before and after noon (local time), so a long list is quicker to scan (UX-030). */}
      {(['morning', 'afternoon'] as const).map((part) => {
        const group = slots.data.filter((slot) => (Number(slot.localTime.slice(0, 2)) < 12) === (part === 'morning'));
        if (group.length === 0) return null;
        return (
          <div key={part} className="slot-group">
            <p className="slot-group-title" id={`slots-${part}`}>
              {t(`booking.${part}`)}
            </p>
            <div className="slot-grid" role="group" aria-labelledby={`slots-${part}`}>
              {group.map((slot) => {
                const selected = value?.startAt === slot.startAt;
                const current = currentStartAt === slot.startAt;
                const label = `${fmt.time(slot.startAt, timeZone ?? 'UTC')}${slot.repeatedTime ? ` (${fmt.offset(slot.utcOffsetMinutes)})` : ''}`;
                return (
                  <button
                    key={slot.startAt}
                    type="button"
                    className={`slot${selected ? ' slot--selected' : ''}${current ? ' slot--current' : ''}`}
                    aria-pressed={selected}
                    data-testid="slot"
                    onClick={() => onChange(selected ? null : slot)}
                  >
                    {label}
                    {current && <span className="slot-current">{t('booking.currentSlot')}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {slots.data.some((s) => s.repeatedTime) && <p className="field-hint">{t('booking.repeatedHourHint')}</p>}
    </fieldset>
  );
}

/** Scoped patient search for booking (only patients the caller may see are ever returned). */
export function PatientPicker({ value, onChange }: { value: PatientSummary | null; onChange: (p: PatientSummary | null) => void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const results = useQuery({
    queryKey: orgKeys.patients(orgId, { q, picker: true }),
    queryFn: ({ signal }) => api<Page<PatientSummary>>(`/orgs/${orgId}/patients${query({ q, pageSize: 8 })}`, { signal }).then((r) => r.data),
    enabled: q.length >= 2,
  });

  if (value) {
    return (
      <div className="selected-patient" data-testid="selected-patient">
        <div>
          <strong>{value.fullName}</strong>
          <span className="muted small">
            {' '}
            <bdi dir="ltr">#{value.patientNumber}</bdi> · <span dir="ltr">{value.phone.e164}</span>
          </span>
        </div>
        <button type="button" className="button button--secondary" onClick={() => onChange(null)}>
          {t('booking.changePatient')}
        </button>
      </div>
    );
  }
  return (
    <div className="field">
      <label htmlFor="patient-picker">{t('booking.patient')}</label>
      <input
        id="patient-picker"
        type="search"
        placeholder={t('patients.searchPlaceholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoComplete="off"
      />
      {q.length >= 2 && results.isPending && <Loading />}
      {results.isSuccess && results.data.length === 0 && <EmptyState icon="search">{t('patients.noMatches')}</EmptyState>}
      {results.isSuccess && results.data.length > 0 && (
        <ul className="pick-list" aria-label={t('booking.searchResults')}>
          {results.data.map((p) => (
            <li key={p.id}>
              <button type="button" className="pick-item" onClick={() => onChange(p)}>
                <strong>{p.fullName}</strong>
                <span className="muted small">
                  <bdi dir="ltr">#{p.patientNumber}</bdi> · <span dir="ltr">{p.phone.e164}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
