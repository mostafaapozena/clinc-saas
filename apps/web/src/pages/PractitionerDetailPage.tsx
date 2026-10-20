import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { ConflictList, TimeZoneRequired } from '../components/scheduling';
import { useInvalidateOrg } from '../lib/scheduling';
import { EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import { api } from '../lib/api';
import { conflictAppointments, errorMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { useSpecialtyNames } from '../lib/specialties';
import { todayIn } from '../lib/time';
import type { Practitioner, ScheduleException, WeeklyInterval } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { orgKeys, useOrg } from '../org/context';

const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5]; // Saturday first, as in Egypt and Saudi Arabia

export function PractitionerDetailPage() {
  const { t } = useTranslation();
  const { practitionerId = '' } = useParams();
  const { orgId, can, timeZone } = useOrg();
  const specialties = useSpecialtyNames();
  const practitioner = useQuery({
    queryKey: orgKeys.practitioner(orgId, practitionerId),
    queryFn: ({ signal }) => api<{ practitioner: Practitioner }>(`/orgs/${orgId}/practitioners/${practitionerId}`, { signal }).then((r) => r.practitioner),
  });
  useDocumentTitle(practitioner.data?.displayName ?? t('practitioners.title'));
  if (!timeZone) return <TimeZoneRequired />;
  if (practitioner.isPending) return <Loading />;
  if (practitioner.isError) return <ErrorState message={errorMessage(t, practitioner.error)} onRetry={() => void practitioner.refetch()} />;
  const p = practitioner.data;
  const manage = can('practitioner.manage');

  return (
    <>
      <PageHeader title={p.displayName} subtitle={`${specialties.name(p.specialtyCode)} · ${t('appointments.timeZoneNote', { zone: timeZone })}`}>
        <span className={`badge badge--${p.status}`}>{t(`practitioners.status.${p.status}`)}</span>
      </PageHeader>
      {manage && <ProfileEditor practitioner={p} />}
      <WeeklySchedule practitioner={p} editable={manage} />
      <Exceptions practitioner={p} editable={manage} />
    </>
  );
}

function ProfileEditor({ practitioner }: { practitioner: Practitioner }) {
  const { t } = useTranslation();
  const { orgId, branches } = useOrg();
  const specialties = useSpecialtyNames();
  const invalidate = useInvalidateOrg();
  const [form, setForm] = useState({
    displayName: practitioner.displayName,
    specialtyCode: practitioner.specialtyCode,
    status: practitioner.status,
    branchIds: practitioner.branchIds,
    defaultDurationMinutes: practitioner.defaultDurationMinutes,
  });
  const save = useMutation({
    mutationFn: () => api(`/orgs/${orgId}/practitioners/${practitioner.id}`, { method: 'PATCH', body: { ...form, version: practitioner.version } }),
    onSuccess: () => invalidate(),
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <section className="card" aria-labelledby="profile-title">
      <h2 id="profile-title">{t('practitioners.profile')}</h2>
      {save.isSuccess && <Notice kind="success">{t('practitioners.saved')}</Notice>}
      {conflictAppointments(save.error).length > 0 ? <ConflictList error={save.error} /> : save.isError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
      <form onSubmit={onSubmit} noValidate>
        <div className="form-grid">
          <Field id="profile-name" label={t('practitioners.displayName')}>
            <input id="profile-name" maxLength={80} value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
          </Field>
          <Field id="profile-specialty" label={t('practitioners.specialty')}>
            <select id="profile-specialty" value={form.specialtyCode} onChange={(e) => setForm((f) => ({ ...f, specialtyCode: e.target.value }))}>
              {specialties.list.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name[specialties.lang]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="profile-duration" label={t('practitioners.durationLabel')}>
            <input
              id="profile-duration"
              type="number"
              min={5}
              max={240}
              step={5}
              value={form.defaultDurationMinutes}
              onChange={(e) => setForm((f) => ({ ...f, defaultDurationMinutes: Number(e.target.value) }))}
            />
          </Field>
          <Field id="profile-status" label={t('practitioners.statusLabel')}>
            <select id="profile-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Practitioner['status'] }))}>
              <option value="active">{t('practitioners.status.active')}</option>
              <option value="inactive">{t('practitioners.status.inactive')}</option>
            </select>
          </Field>
        </div>
        <fieldset className="fieldset">
          <legend>{t('practitioners.branches')}</legend>
          <div className="choice-group">
            {branches
              .filter((b) => b.status === 'active' || form.branchIds.includes(b.id))
              .map((b) => (
                <label key={b.id} className="choice">
                  <input
                    type="checkbox"
                    checked={form.branchIds.includes(b.id)}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, branchIds: e.target.checked ? [...f.branchIds, b.id] : f.branchIds.filter((id) => id !== b.id) }))
                    }
                  />
                  {b.name}
                </label>
              ))}
          </div>
        </fieldset>
        <button type="submit" className="button button--primary" disabled={save.isPending}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
      </form>
    </section>
  );
}

function WeeklySchedule({ practitioner, editable }: { practitioner: Practitioner; editable: boolean }) {
  const { t } = useTranslation();
  const { orgId, branches } = useOrg();
  const fmt = useFormatters();
  const invalidate = useInvalidateOrg();
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<WeeklyInterval[]>(practitioner.weeklySchedule);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/practitioners/${practitioner.id}/schedule`, {
        method: 'PUT',
        body: { weeklySchedule: rows, version: practitioner.version },
      }),
    onSuccess: async () => {
      setEditing(false);
      await invalidate();
    },
  });
  const update = (index: number, patch: Partial<WeeklyInterval>) => setRows((all) => all.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const sorted = [...practitioner.weeklySchedule].sort((a, b) => WEEK_ORDER.indexOf(a.weekday) - WEEK_ORDER.indexOf(b.weekday) || a.start.localeCompare(b.start));

  return (
    <section className="card" aria-labelledby="weekly-title">
      <div className="section-header">
        <h2 id="weekly-title">{t('schedule.weeklyTitle')}</h2>
        {editable && !editing && (
          <button type="button" className="button button--secondary" onClick={() => { setRows(practitioner.weeklySchedule); setEditing(true); }}>
            {t('common.edit')}
          </button>
        )}
      </div>
      <p className="muted small">{t('schedule.weeklyHint')}</p>
      {conflictAppointments(save.error).length > 0 ? <ConflictList error={save.error} /> : save.isError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
      {!editing ? (
        sorted.length === 0 ? (
          <EmptyState>{t('schedule.noHours')}</EmptyState>
        ) : (
          <table className="data-table" aria-label={t('schedule.weeklyTitle')}>
            <thead>
              <tr>
                <th scope="col">{t('schedule.weekday')}</th>
                <th scope="col">{t('booking.branch')}</th>
                <th scope="col">{t('schedule.hours')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((i) => (
                <tr key={`${i.weekday}-${i.branchId}-${i.start}`} data-testid="weekly-row">
                  <td data-label={t('schedule.weekday')}>{fmt.weekday(i.weekday)}</td>
                  <td data-label={t('booking.branch')}>{branchName.get(i.branchId) ?? '—'}</td>
                  <td data-label={t('schedule.hours')} dir="ltr">
                    {i.start}–{i.end}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          noValidate
          aria-label={t('schedule.weeklyTitle')}
        >
          {rows.map((row, index) => (
            <div key={index} className="interval-row">
              <Field id={`wk-day-${index}`} label={t('schedule.weekday')}>
                <select id={`wk-day-${index}`} value={row.weekday} onChange={(e) => update(index, { weekday: Number(e.target.value) })}>
                  {WEEK_ORDER.map((d) => (
                    <option key={d} value={d}>
                      {fmt.weekday(d)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id={`wk-branch-${index}`} label={t('booking.branch')}>
                <select id={`wk-branch-${index}`} value={row.branchId} onChange={(e) => update(index, { branchId: e.target.value })}>
                  {practitioner.branchIds.map((id) => (
                    <option key={id} value={id}>
                      {branchName.get(id) ?? '—'}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id={`wk-start-${index}`} label={t('schedule.start')}>
                <input id={`wk-start-${index}`} type="time" step={300} value={row.start} onChange={(e) => update(index, { start: e.target.value })} />
              </Field>
              <Field id={`wk-end-${index}`} label={t('schedule.end')}>
                <input id={`wk-end-${index}`} type="time" step={300} value={row.end === '24:00' ? '23:59' : row.end} onChange={(e) => update(index, { end: e.target.value === '23:59' ? '24:00' : e.target.value })} />
              </Field>
              <button type="button" className="button button--secondary" onClick={() => setRows((all) => all.filter((_, i) => i !== index))} aria-label={t('schedule.removeInterval')}>
                {t('schedule.remove')}
              </button>
            </div>
          ))}
          <div className="form-actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={practitioner.branchIds.length === 0}
              onClick={() => setRows((all) => [...all, { weekday: 6, branchId: practitioner.branchIds[0] ?? '', start: '09:00', end: '17:00' }])}
            >
              {t('schedule.addInterval')}
            </button>
            <button type="submit" className="button button--primary" disabled={save.isPending}>
              {save.isPending ? t('common.saving') : t('common.save')}
            </button>
            <button type="button" className="button button--secondary" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function Exceptions({ practitioner, editable }: { practitioner: Practitioner; editable: boolean }) {
  const { t } = useTranslation();
  const { orgId, branches, timeZone } = useOrg();
  const fmt = useFormatters();
  const invalidate = useInvalidateOrg();
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const list = useQuery({
    queryKey: orgKeys.exceptions(orgId, practitioner.id),
    queryFn: ({ signal }) => api<{ data: ScheduleException[] }>(`/orgs/${orgId}/practitioners/${practitioner.id}/exceptions`, { signal }).then((r) => r.data),
  });
  const [form, setForm] = useState({ date: timeZone ? todayIn(timeZone) : '', kind: 'closed' as ScheduleException['kind'], branchId: '', start: '09:00', end: '13:00' });
  const add = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/practitioners/${practitioner.id}/exceptions`, {
        method: 'POST',
        body: {
          date: form.date,
          kind: form.kind,
          branchId: form.branchId || null,
          intervals: form.kind === 'hours' ? [{ start: form.start, end: form.end }] : [],
        },
      }),
    onSuccess: () => invalidate(),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/orgs/${orgId}/practitioners/${practitioner.id}/exceptions/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(),
  });
  const error = add.error ?? remove.error;

  return (
    <section className="card" aria-labelledby="exceptions-title">
      <h2 id="exceptions-title">{t('schedule.exceptionsTitle')}</h2>
      <p className="muted small">{t('schedule.exceptionsHint')}</p>
      {conflictAppointments(error).length > 0 ? <ConflictList error={error} /> : error ? <Notice kind="error">{errorMessage(t, error)}</Notice> : null}
      {list.isPending && <Loading />}
      {list.isSuccess && list.data.length === 0 && <EmptyState>{t('schedule.noExceptions')}</EmptyState>}
      {list.isSuccess && list.data.length > 0 && (
        <ul className="data-list">
          {list.data.map((e) => (
            <li key={e.id} className="data-row" data-testid="exception-row">
              <div className="data-main">
                <strong>{fmt.localDate(e.date)}</strong>
                <span className="muted small">{e.branchId ? branchName.get(e.branchId) ?? '—' : t('schedule.allBranches')}</span>
              </div>
              <div className="data-meta">
                <span className="badge">{t(`schedule.kind.${e.kind}`)}</span>
                {e.kind === 'hours' && (
                  <span dir="ltr" className="small">
                    {e.intervals.map((i) => `${i.start}–${i.end}`).join(', ')}
                  </span>
                )}
              </div>
              {editable && (
                <button type="button" className="button button--secondary" disabled={remove.isPending} onClick={() => remove.mutate(e.id)} aria-label={t('schedule.removeException', { date: fmt.localDate(e.date) })}>
                  {t('schedule.remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
          noValidate
          aria-label={t('schedule.addException')}
        >
          <Field id="exc-date" label={t('booking.date')}>
            <input id="exc-date" type="date" min={timeZone ? todayIn(timeZone) : undefined} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </Field>
          <Field id="exc-kind" label={t('schedule.kindLabel')}>
            <select id="exc-kind" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as ScheduleException['kind'] }))}>
              <option value="closed">{t('schedule.kind.closed')}</option>
              <option value="hours">{t('schedule.kind.hours')}</option>
            </select>
          </Field>
          <Field id="exc-branch" label={t('booking.branch')}>
            <select id="exc-branch" value={form.branchId} onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}>
              {form.kind === 'closed' && <option value="">{t('schedule.allBranches')}</option>}
              {form.kind === 'hours' && <option value="">{t('common.choose')}</option>}
              {practitioner.branchIds.map((id) => (
                <option key={id} value={id}>
                  {branchName.get(id) ?? '—'}
                </option>
              ))}
            </select>
          </Field>
          {form.kind === 'hours' && (
            <>
              <Field id="exc-start" label={t('schedule.start')}>
                <input id="exc-start" type="time" step={300} value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} />
              </Field>
              <Field id="exc-end" label={t('schedule.end')}>
                <input id="exc-end" type="time" step={300} value={form.end} onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} />
              </Field>
            </>
          )}
          <button type="submit" className="button button--primary" disabled={add.isPending || !form.date || (form.kind === 'hours' && !form.branchId)}>
            {t('schedule.addException')}
          </button>
        </form>
      )}
    </section>
  );
}
