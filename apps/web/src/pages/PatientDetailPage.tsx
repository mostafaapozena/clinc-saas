import { useMutation, useQuery } from '@tanstack/react-query';
import { PatientContextHeader } from '../components/PatientContextHeader';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';
import { ClinicalHistoryCard } from '../components/clinical';
import { DentalChartCard, PhysioCoursesCard } from '../components/specialty';
import { PatientFields } from '../components/PatientForm';
import { patientBody, patientFormFrom, type PatientFormValue } from '../lib/patient-form';
import { ConflictList, StatusBadge } from '../components/scheduling';
import { useInvalidateOrg } from '../lib/scheduling';
import { EmptyState, ErrorState, Loading, Notice } from '../components/ui';
import { ApiError, api, query } from '../lib/api';
import { errorMessage, fieldErrors, isApiError } from '../lib/errors';
import { useFormatters } from '../lib/format';
import type { Appointment, Page, Patient } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { orgKeys, useOrg } from '../org/context';

export function PatientDetailPage() {
  const { t } = useTranslation();
  const { patientId = '' } = useParams();
  const location = useLocation();
  const { orgId, can } = useOrg();
  const fmt = useFormatters();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>((location.state as { created?: boolean } | null)?.created ? t('patients.created') : null);

  const patient = useQuery({
    queryKey: orgKeys.patient(orgId, patientId),
    queryFn: ({ signal }) => api<{ patient: Patient }>(`/orgs/${orgId}/patients/${patientId}`, { signal }).then((r) => r.patient),
  });
  // The file number, never the name: titles end up in history, synced tabs and shared screens.
  useDocumentTitle(patient.data ? t('patients.fileTitle', { number: patient.data.patientNumber }) : t('patients.title'));

  if (patient.isPending) return <Loading />;
  if (patient.isError) {
    if (patient.error instanceof ApiError && patient.error.status === 404) {
      return (
        <section className="card state-card">
          <h1>{t('patients.notFoundTitle')}</h1>
          <p>{t('errors.NOT_FOUND')}</p>
          {can('patient.list') && (
            <Link className="button button--secondary" to={`/app/${orgId}/patients`}>
              {t('patients.backToList')}
            </Link>
          )}
        </section>
      );
    }
    return <ErrorState message={errorMessage(t, patient.error)} onRetry={() => void patient.refetch()} />;
  }
  const p = patient.data;

  return (
    <>
      <PatientContextHeader patient={p}>
        {can('appointment.book') && (
          <Link className="button button--primary" to={`/app/${orgId}/appointments/new?patientId=${p.id}`}>
            {t('appointments.book')}
          </Link>
        )}
      </PatientContextHeader>
      {notice && <Notice kind="success">{notice}</Notice>}

      <div className="card-grid card-grid--wide">
        <section className="card" aria-labelledby="patient-details-title">
          <div className="section-header">
            <h2 id="patient-details-title">{t('patients.details')}</h2>
            {can('patient.update') && !editing && (
              <button type="button" className="button button--secondary" onClick={() => setEditing(true)}>
                {t('common.edit')}
              </button>
            )}
          </div>
          {editing ? (
            <EditPatient
              patient={p}
              onDone={(saved) => {
                setEditing(false);
                if (saved) setNotice(t('patients.saved'));
              }}
            />
          ) : (
            <dl className="details">
              <div>
                <dt>{t('patients.phone')}</dt>
                <dd dir="ltr">{p.phone.e164}</dd>
              </div>
              {p.secondaryPhone && (
                <div>
                  <dt>{t('patients.secondaryPhone')}</dt>
                  <dd dir="ltr">{p.secondaryPhone.e164}</dd>
                </div>
              )}
              <div>
                <dt>{t('auth.email')}</dt>
                <dd dir="ltr">{p.email ?? t('common.notSet')}</dd>
              </div>
              <div>
                <dt>{t('patients.dateOfBirth')}</dt>
                <dd>{p.dateOfBirth ? fmt.localDate(p.dateOfBirth) : t('common.notSet')}</dd>
              </div>
              <div>
                <dt>{t('patients.sex')}</dt>
                <dd>{t(`patients.sexes.${p.sex}`)}</dd>
              </div>
              <div>
                <dt>{t('patients.address')}</dt>
                <dd>{p.address ? [p.address.line, p.address.city].filter(Boolean).join('، ') : t('common.notSet')}</dd>
              </div>
            </dl>
          )}
        </section>
        <Registrations patient={p} />
      </div>
      <PatientAppointments patientId={p.id} />
      <DentalChartCard patientId={p.id} />
      <PhysioCoursesCard patientId={p.id} />
      <ClinicalHistoryCard patientId={p.id} />
    </>
  );
}

function EditPatient({ patient, onDone }: { patient: Patient; onDone: (saved?: boolean) => void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const invalidate = useInvalidateOrg();
  const [form, setForm] = useState<PatientFormValue>(() => patientFormFrom(patient));
  const save = useMutation({
    mutationFn: () =>
      api<{ patient: Patient }>(`/orgs/${orgId}/patients/${patient.id}`, {
        method: 'PATCH',
        body: { ...patientBody(form), version: patient.version },
      }),
    onSuccess: async () => {
      await invalidate();
      onDone(true);
    },
  });
  const fields = fieldErrors(save.error);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <form onSubmit={onSubmit} noValidate aria-label={t('patients.editTitle')}>
      <Notice kind="info">{t('patients.sharedIdentityNote')}</Notice>
      {save.isError && <Notice kind="error">{Object.keys(fields).length > 0 ? t('errors.VALIDATION_ERROR') : errorMessage(t, save.error)}</Notice>}
      <PatientFields idPrefix="edit-patient" value={form} onChange={setForm} fields={fields} />
      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={save.isPending}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
        <button type="button" className="button button--secondary" onClick={() => onDone()}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

function Registrations({ patient }: { patient: Patient }) {
  const { t } = useTranslation();
  const { orgId, branches, can } = useOrg();
  const fmt = useFormatters();
  const invalidate = useInvalidateOrg();
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const registered = new Set(patient.registrations.map((r) => r.branchId));
  const addable = branches.filter((b) => b.status === 'active' && !registered.has(b.id));
  const [target, setTarget] = useState('');
  const manage = can('patient.registration.manage');

  const setStatus = useMutation({
    mutationFn: ({ branchId, status }: { branchId: string; status: 'active' | 'archived' }) =>
      api<{ patient: Patient }>(`/orgs/${orgId}/patients/${patient.id}/registrations/${branchId}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => invalidate(),
  });
  const add = useMutation({
    mutationFn: (branchId: string) =>
      api<{ patient: Patient }>(`/orgs/${orgId}/patients/${patient.id}/registrations`, { method: 'POST', body: { branchId } }),
    onSuccess: async () => {
      setTarget('');
      await invalidate();
    },
  });

  return (
    <section className="card" aria-labelledby="registrations-title">
      <h2 id="registrations-title">{t('patients.registrations')}</h2>
      <p className="muted small">{t('patients.registrationsHint')}</p>
      {isApiError(setStatus.error, 'FUTURE_APPOINTMENTS_EXIST') ? (
        <ConflictList error={setStatus.error} />
      ) : (
        setStatus.isError && <Notice kind="error">{errorMessage(t, setStatus.error)}</Notice>
      )}
      {add.isError && <Notice kind="error">{errorMessage(t, add.error)}</Notice>}
      <ul className="data-list">
        {patient.registrations.map((r) => {
          const name = branchName.get(r.branchId) ?? '—';
          return (
            <li key={r.branchId} className="data-row" data-testid="registration-row">
              <div className="data-main">
                <strong>{name}</strong>
                <span className="muted small">{t('patients.registeredOn', { date: fmt.date(r.registeredAt) })}</span>
              </div>
              <div className="data-meta">
                <span className={`badge badge--${r.status === 'active' ? 'active' : 'inactive'}`}>{t(`patients.registrationState.${r.status}`)}</span>
              </div>
              {manage && (
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ branchId: r.branchId, status: r.status === 'active' ? 'archived' : 'active' })}
                  aria-label={t(r.status === 'active' ? 'patients.archiveLabel' : 'patients.reactivateLabel', { branch: name })}
                >
                  {r.status === 'active' ? t('patients.archive') : t('patients.reactivate')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {manage && addable.length > 0 && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (target) add.mutate(target);
          }}
        >
          <div className="field">
            <label htmlFor="add-registration">{t('patients.addToBranch')}</label>
            <select id="add-registration" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{t('common.choose')}</option>
              {addable.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="button button--secondary" disabled={!target || add.isPending}>
            {t('patients.register')}
          </button>
        </form>
      )}
    </section>
  );
}

function PatientAppointments({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const { orgId, can, timeZone, branches } = useOrg();
  const fmt = useFormatters();
  const params = { when, pageSize: 20 };
  const list = useQuery({
    queryKey: orgKeys.patientAppointments(orgId, patientId, params),
    queryFn: ({ signal }) => api<Page<Appointment>>(`/orgs/${orgId}/patients/${patientId}/appointments${query(params)}`, { signal }),
    enabled: can('appointment.read'),
  });
  if (!can('appointment.read')) return null;
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  return (
    <section className="card" aria-labelledby="patient-appointments-title">
      <div className="section-header">
        <h2 id="patient-appointments-title">{t('patients.appointments')}</h2>
        <div className="segmented" role="group" aria-label={t('patients.appointments')}>
          {(['upcoming', 'past'] as const).map((w) => (
            <button key={w} type="button" aria-pressed={when === w} className={when === w ? 'segment segment--active' : 'segment'} onClick={() => setWhen(w)}>
              {t(`patients.when.${w}`)}
            </button>
          ))}
        </div>
      </div>
      {list.isPending && <Loading />}
      {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} />}
      {list.isSuccess && list.data.data.length === 0 && <EmptyState icon="calendar">{t(`patients.noAppointments.${when}`)}</EmptyState>}
      {list.isSuccess && list.data.data.length > 0 && timeZone && (
        <ul className="data-list">
          {list.data.data.map((a) => (
            <li key={a.id} className="data-row" data-testid="patient-appointment">
              <div className="data-main">
                <Link to={`/app/${orgId}/appointments/${a.id}`}>{fmt.dateTime(a.startAt, timeZone)}</Link>
                <span className="muted small">
                  {a.practitioner?.displayName} · {branchName.get(a.branchId) ?? '—'}
                </span>
              </div>
              <div className="data-meta">
                <StatusBadge status={a.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
