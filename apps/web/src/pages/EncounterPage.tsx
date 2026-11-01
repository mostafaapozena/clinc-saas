import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useBlocker, useLocation, useParams } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { DocumentationBadge } from '../components/clinical';
import { ShareRecord } from '../components/coverage';
import { ClinicalCharges } from '../components/finance';
import { MaterialsUsed } from '../components/inventory';
import { SpecialtyEditor, SpecialtyView } from '../components/specialty';
import { isEditable } from '../lib/templates';
import { TimeZoneRequired } from '../components/scheduling';
import { ErrorState, Field, Loading, Notice } from '../components/ui';
import { revealAndFocus } from '../lib/a11y';
import { ApiError, api } from '../lib/api';
import {
  CLINICAL_QUERY,
  ENCOUNTER_SECTIONS,
  SECTION_MAX,
  newRequestKey,
  sameSections,
  type Encounter,
  type EncounterView,
  type RecordView,
  type Sections,
} from '../lib/clinical';
import { errorMessage, fieldErrors, fieldMessage, isApiError } from '../lib/errors';
import { useFormatters } from '../lib/format';
import type { Appointment } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { orgKeys, useOrg } from '../org/context';
import { ActionBar } from '../components/layout';

/**
 * The treating doctor's record of one visit: start (or late entry), draft, finalize, addenda.
 * The API decides access; a page for a visit the caller does not treat shows "unavailable".
 */
export function EncounterPage() {
  const { t } = useTranslation();
  const { appointmentId = '' } = useParams();
  const { orgId, timeZone } = useOrg();
  const fmt = useFormatters();
  // A generic title: patient names and clinical text stay out of the browser history.
  useDocumentTitle(t('clinical.title'));

  const appointment = useQuery({
    queryKey: orgKeys.appointment(orgId, appointmentId),
    queryFn: ({ signal }) => api<{ appointment: Appointment }>(`/orgs/${orgId}/appointments/${appointmentId}`, { signal }).then((r) => r.appointment),
  });
  const record = useQuery({
    queryKey: orgKeys.encounter(orgId, appointmentId),
    queryFn: ({ signal }) => api<EncounterView>(`/orgs/${orgId}/appointments/${appointmentId}/encounter`, { signal }),
    ...CLINICAL_QUERY,
  });
  const update = useRecordUpdater(appointmentId);

  if (!timeZone) return <TimeZoneRequired />;
  if (appointment.isPending || record.isPending) return <Loading />;
  const failed = appointment.error ?? record.error;
  if (failed) {
    if (failed instanceof ApiError && (failed.status === 404 || failed.status === 403)) {
      return (
        <section className="card state-card">
          <h1>{t('clinical.notFoundTitle')}</h1>
          <p>{t('errors.NOT_FOUND')}</p>
          <Link className="button button--secondary" to={`/app/${orgId}/appointments`}>
            {t('appointments.backToSchedule')}
          </Link>
        </section>
      );
    }
    return (
      <ErrorState
        message={errorMessage(t, failed)}
        onRetry={() => {
          void appointment.refetch();
          void record.refetch();
        }}
      />
    );
  }
  const a = appointment.data;
  const view = record.data;
  const encounter = view?.encounter ?? null;
  if (!a || !view) return <Loading />;

  return (
    <>
      {/* First-strong isolates keep a Latin name and the date in order inside Arabic text. */}
      <PageHeader title={t('clinical.title')} subtitle={`\u2068${a.patient?.fullName ?? '—'}\u2069 · \u2068${fmt.dateTime(a.startAt, timeZone)}\u2069`}>
        <DocumentationBadge status={encounter?.status ?? 'none'} />
        {encounter?.lateEntry && <span className="badge badge--late-entry">{t('clinical.lateEntryBadge')}</span>}
      </PageHeader>
      <p className="muted small">
        <Link to={`/app/${orgId}/appointments/${a.id}`}>{t('clinical.backToAppointment')}</Link>
      </p>
      <Notice kind="info">
        {t('clinical.provisionalNote')} {t('clinical.privacyNote')}
      </Notice>
      {!encounter && <StartRecord view={view} appointmentId={a.id} />}
      {encounter?.status === 'draft' && <DraftEditor encounter={encounter} reload={async () => (await record.refetch()).data?.encounter ?? null} />}
      {encounter?.status === 'finalized' && <FinalizedRecord encounter={encounter} onUpdated={update} />}
      {encounter?.status === 'finalized' && <ClinicalCharges encounter={encounter} />}
      {encounter?.status === 'finalized' && <MaterialsUsed encounter={encounter} />}
      {encounter && <ShareRecord encounter={encounter} />}
    </>
  );
}

/**
 * A record opened by id (from coverage or the patient timeline). The API decides the access:
 * own, read-only coverage, or coverage with addenda. Someone else's draft is never editable.
 */
export function RecordPage() {
  const { t } = useTranslation();
  const { encounterId = '' } = useParams();
  const { orgId, timeZone } = useOrg();
  const fmt = useFormatters();
  const queryClient = useQueryClient();
  useDocumentTitle(t('clinical.title'));
  const key = orgKeys.record(orgId, encounterId);
  const view = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<RecordView>(`/orgs/${orgId}/encounters/${encounterId}`, { signal }),
    ...CLINICAL_QUERY,
  });
  if (!timeZone) return <TimeZoneRequired />;
  if (view.isPending) return <Loading />;
  if (view.isError) {
    if (view.error instanceof ApiError && (view.error.status === 404 || view.error.status === 403)) {
      return (
        <section className="card state-card">
          <h1>{t('clinical.notFoundTitle')}</h1>
          <p>{t('coverage.unavailable')}</p>
          <Link className="button button--secondary" to={`/app/${orgId}/coverage`}>
            {t('coverage.backToCoverage')}
          </Link>
        </section>
      );
    }
    return <ErrorState message={errorMessage(t, view.error)} onRetry={() => void view.refetch()} />;
  }
  const { encounter, access, canAddAddendum, context } = view.data;
  const onUpdated = (next: Encounter) => queryClient.setQueryData<RecordView>(key, (old) => (old ? { ...old, encounter: next } : old));
  const subtitle = [
    context.patient ? `⁨${context.patient.fullName}⁩ (#${fmt.number(context.patient.patientNumber)})` : null,
    context.appointment ? `⁨${fmt.dateTime(context.appointment.startAt, timeZone)}⁩` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <PageHeader title={t('clinical.title')} subtitle={subtitle}>
        <DocumentationBadge status={encounter.status} />
        {encounter.lateEntry && <span className="badge badge--late-entry">{t('clinical.lateEntryBadge')}</span>}
      </PageHeader>
      {access !== 'own' && (
        <Notice kind="info">
          {t(access === 'author' ? 'coverage.viewingAuthor' : 'coverage.viewingRead', { name: encounter.author.displayName })}
        </Notice>
      )}
      {access === 'own' && context.appointment && (
        <p className="muted small">
          <Link to={`/app/${orgId}/appointments/${context.appointment.id}/record`}>{t('coverage.openOwnRecord')}</Link>
        </p>
      )}
      <Notice kind="info">{t('clinical.provisionalNote')}</Notice>
      <FinalizedRecord encounter={encounter} canAddAddendum={canAddAddendum} onUpdated={onUpdated} />
    </>
  );
}

/** Keeps the cached view in step with a mutation result (and refreshes the documentation status). */
function useRecordUpdater(appointmentId: string) {
  const queryClient = useQueryClient();
  const { orgId } = useOrg();
  return (encounter: Encounter) => {
    queryClient.setQueryData<EncounterView>(orgKeys.encounter(orgId, appointmentId), (old) =>
      old ? { ...old, encounter, canStart: false, lateEntryRequired: false } : old,
    );
    void queryClient.invalidateQueries({ queryKey: orgKeys.appointment(orgId, appointmentId) });
    void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'queue'] });
    void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'clinical', 'history'] });
  };
}

function StartRecord({ view, appointmentId }: { view: EncounterView; appointmentId: string }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const location = useLocation();
  const update = useRecordUpdater(appointmentId);
  const [reason, setReason] = useState('');
  // Specialty template (only offered when the practitioner's specialty has several).
  const [template, setTemplate] = useState(view.templates?.[0] ?? '');
  const key = useRef(newRequestKey());
  const start = useMutation({
    mutationFn: () =>
      api<{ encounter: Encounter }>(`/orgs/${orgId}/appointments/${appointmentId}/encounter`, {
        method: 'POST',
        body: { ...(view.lateEntryRequired ? { lateEntryReason: reason } : {}), ...(template ? { template } : {}) },
        headers: { 'Idempotency-Key': key.current },
      }),
    onSuccess: (r) => update(r.encounter),
  });
  // "Open the visit record" from the queue or the appointment: no second "start" click when nothing
  // needs choosing (no late-entry reason, at most one template). The idempotency key makes a
  // repeated request harmless.
  const autoStart = Boolean((location.state as { startRecord?: boolean } | null)?.startRecord) && view.canStart && !view.lateEntryRequired && (view.templates?.length ?? 0) <= 1;
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    start.mutate();
  }, [autoStart, start]);

  if (autoStart && !start.isError) return <Loading label={t('clinical.starting')} />;
  if (!view.canStart) {
    const closed = view.appointmentStatus === 'cancelled' || view.appointmentStatus === 'no_show';
    return (
      <section className="card">
        <p>{t(closed ? 'clinical.cannotStart.closed' : 'clinical.cannotStart.notStarted')}</p>
      </section>
    );
  }
  const fields = fieldErrors(start.error);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    start.mutate();
  };
  return (
    <section className="card" aria-labelledby="start-record-title">
      <h2 id="start-record-title">{view.lateEntryRequired ? t('clinical.lateEntryTitle') : t('clinical.start')}</h2>
      <form onSubmit={onSubmit} noValidate>
        {view.lateEntryRequired ? (
          <>
            <p>{t('clinical.lateEntryExplain')}</p>
            <Field id="late-entry-reason" label={t('clinical.lateEntryReason')} error={fieldMessage(t, 'lateEntryReason', fields.lateEntryReason)}>
              <textarea
                id="late-entry-reason"
                rows={2}
                maxLength={300}
                required
                value={reason}
                aria-invalid={Boolean(fields.lateEntryReason)}
                onChange={(e) => {
                  setReason(e.target.value);
                  key.current = newRequestKey();
                }}
              />
            </Field>
          </>
        ) : (
          <p className="muted">{t('clinical.startHint')}</p>
        )}
        {(view.templates?.length ?? 0) > 1 && (
          <fieldset className="fieldset">
            <legend>{t('specialty.chooseTemplate')}</legend>
            {view.templates.map((id) => (
              <label key={id} className="choice">
                <input
                  type="radio"
                  name="record-template"
                  value={id}
                  checked={template === id}
                  onChange={() => {
                    setTemplate(id);
                    key.current = newRequestKey();
                  }}
                />
                {t(`specialty.templates.${id}`)}
              </label>
            ))}
          </fieldset>
        )}
        {start.isError && !fields.lateEntryReason && <Notice kind="error">{errorMessage(t, start.error)}</Notice>}
        <ActionBar>
          <button type="submit" className="button button--primary" disabled={start.isPending}>
            {start.isPending ? t('clinical.starting') : t('clinical.start')}
          </button>
        </ActionBar>
      </form>
    </section>
  );
}

type Conflict = null | { kind: 'version'; currentVersion: number | null } | { kind: 'finalized' };

const AUTOSAVE_MS = 5000;

/** The API's minimum for finalizing (clinical.routes.ts): a reason, plus examination, assessment or plan. */
function finalizationProblems(sections: Sections): Record<string, string> | null {
  const problems: Record<string, string> = {};
  if (!sections.reason.trim()) problems['sections.reason'] = 'required';
  if (!sections.examination.trim() && !sections.assessment.trim() && !sections.plan.trim()) problems.sections = 'needs_findings_assessment_or_plan';
  return Object.keys(problems).length > 0 ? problems : null;
}

function DraftEditor({ encounter, reload }: { encounter: Encounter; reload: () => Promise<Encounter | null> }) {
  const { t } = useTranslation();
  const { orgId, timeZone } = useOrg();
  const fmt = useFormatters();
  const update = useRecordUpdater(encounter.appointmentId);
  // `base` is the last version known to be saved; `sections` is what is on screen.
  const [base, setBase] = useState(encounter);
  const [sections, setSections] = useState<Sections>(encounter.sections);
  // Specialty data is edited only for template versions this app knows (others stay read-only).
  const editableSpecialty = encounter.specialty && isEditable(encounter.specialty) ? encounter.specialty : null;
  const [specialtyData, setSpecialtyData] = useState<Record<string, unknown>>(encounter.specialty?.data ?? {});
  const [conflict, setConflict] = useState<Conflict>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // What the API will refuse at finalizing, checked first so the confirmation only opens when it can succeed.
  const [precheck, setPrecheck] = useState<Record<string, string> | null>(null);
  const finalizeKey = useRef(newRequestKey());
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const specialtyDirty = Boolean(editableSpecialty) && JSON.stringify(specialtyData) !== JSON.stringify(base.specialty?.data ?? {});
  const dirty = !sameSections(sections, base.sections) || specialtyDirty;

  const onConflict = (error: unknown) => {
    if (isApiError(error, 'VERSION_CONFLICT')) {
      const current = error.details.currentVersion;
      setConflict({ kind: 'version', currentVersion: typeof current === 'number' ? current : null });
    } else if (isApiError(error, 'ENCOUNTER_FINALIZED')) {
      setConflict({ kind: 'finalized' });
    }
  };
  const save = useMutation({
    mutationFn: (version: number) =>
      api<{ encounter: Encounter }>(`/orgs/${orgId}/encounters/${encounter.id}`, {
        method: 'PUT',
        body: { sections, version, ...(editableSpecialty ? { specialtyData } : {}) },
      }),
    onSuccess: (r) => {
      setBase(r.encounter);
      // The API returns the normalized data (trimmed text, defaults); show exactly what was saved.
      if (r.encounter.specialty) setSpecialtyData(r.encounter.specialty.data);
      setSavedAt(r.encounter.lastEditedAt);
      setConflict(null);
      update(r.encounter);
    },
    onError: onConflict,
  });
  const finalize = useMutation({
    mutationFn: () =>
      api<{ encounter: Encounter }>(`/orgs/${orgId}/encounters/${encounter.id}/finalize`, {
        method: 'POST',
        body: { version: base.version },
        headers: { 'Idempotency-Key': finalizeKey.current },
      }),
    onSuccess: (r) => update(r.encounter),
    onError: (error) => {
      setConfirming(false);
      finalizeKey.current = newRequestKey();
      onConflict(error);
    },
  });

  // Unsaved changes: warn before leaving inside the app, and before closing or reloading the tab.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (confirming) revealAndFocus(confirmRef.current);
  }, [confirming]);

  // UX-033: a draft with changes saves itself after a short pause, through the same versioned save
  // (a conflicting edit elsewhere still stops it and shows the conflict choices).
  useEffect(() => {
    if (!dirty || conflict || save.isPending || confirming) return;
    const timer = window.setTimeout(() => save.mutate(base.version), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, conflict, save, confirming, base.version, sections, specialtyData]);

  const requestFinalize = () => {
    const problems = finalizationProblems(sections);
    setPrecheck(problems);
    if (!problems) {
      setConfirming(true);
      return;
    }
    const first = problems['sections.reason'] ? 'section-reason' : 'section-examination';
    revealAndFocus(document.getElementById(first));
  };

  const loadLatest = async () => {
    const latest = await reload();
    setConflict(null);
    if (latest && latest.status === 'draft') {
      setBase(latest);
      setSections(latest.sections);
      setSpecialtyData(latest.specialty?.data ?? {});
    }
  };
  const fields = { ...fieldErrors(save.error), ...fieldErrors(finalize.error), ...(precheck ? (finalizationProblems(sections) ?? {}) : {}) };
  // The rule "one of examination, assessment or plan" is shown on the examination field.
  if (fields.sections && !fields['sections.examination']) fields['sections.examination'] = fields.sections;
  const incomplete = isApiError(finalize.error, 'ENCOUNTER_INCOMPLETE');

  return (
    <section className="card" aria-labelledby="draft-title">
      <div className="section-header">
        <h2 id="draft-title">{t('clinical.draftTitle')}</h2>
        <span className="muted small" role="status" data-testid="save-state">
          {dirty ? t('clinical.unsaved') : savedAt ? t('clinical.savedAt', { time: fmt.time(savedAt, timeZone ?? 'UTC') }) : t('clinical.allSaved')}
        </span>
      </div>

      {conflict?.kind === 'version' && (
        <div className="notice notice--warning" role="alert" data-testid="conflict">
          <p>
            <strong>{t('clinical.conflictTitle')}</strong>
          </p>
          <p>{t('clinical.conflictBody')}</p>
          <ActionBar>
            <button type="button" className="button button--secondary" onClick={() => void loadLatest()}>
              {t('clinical.loadLatest')}
            </button>
            {conflict.currentVersion !== null && (
              <button type="button" className="button button--secondary" disabled={save.isPending} onClick={() => save.mutate(conflict.currentVersion ?? 0)}>
                {t('clinical.keepMine')}
              </button>
            )}
          </ActionBar>
        </div>
      )}
      {conflict?.kind === 'finalized' && (
        <div className="notice notice--warning" role="alert" data-testid="conflict">
          <p>
            <strong>{t('clinical.finalizedElsewhereTitle')}</strong>
          </p>
          <p>{t('clinical.finalizedElsewhereBody')}</p>
          <button type="button" className="button button--secondary" onClick={() => void loadLatest()}>
            {t('clinical.openFinalized')}
          </button>
        </div>
      )}
      {save.isError && !conflict && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty) save.mutate(base.version);
        }}
      >
        {ENCOUNTER_SECTIONS.map((section) => {
          const error = fieldMessage(t, `sections.${section}`, fields[`sections.${section}`]);
          return (
            <Field key={section} id={`section-${section}`} label={t(`clinical.sections.${section}`)} hint={t(`clinical.sectionHints.${section}`)} error={error}>
              <textarea
                id={`section-${section}`}
                rows={section === 'reason' ? 2 : 4}
                maxLength={SECTION_MAX}
                value={sections[section]}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `section-${section}-error` : `section-${section}-hint`}
                onChange={(e) => setSections((current) => ({ ...current, [section]: e.target.value }))}
              />
            </Field>
          );
        })}
        {encounter.specialty && (
          <SpecialtyEditor
            specialty={encounter.specialty}
            value={specialtyData}
            onChange={setSpecialtyData}
            patientId={encounter.patientId}
            encounterId={encounter.id}
            errors={fields}
          />
        )}
        <p className="muted small">{t('clinical.finalizeRule')}</p>
        {(incomplete || (precheck && finalizationProblems(sections))) && (
          <Notice kind="error">
            {fields.sections || fields['sections.reason'] ? (
              <>
                {fields['sections.reason'] && <span className="block">{fieldMessage(t, 'sections.reason', fields['sections.reason'])}</span>}
                {fields.sections && <span className="block">{fieldMessage(t, 'sections', fields.sections)}</span>}
              </>
            ) : (
              errorMessage(t, finalize.error)
            )}
            {Object.keys(fields)
              .filter((k) => k.startsWith('specialty.'))
              .map((k) => (
                <span key={k} className="block">
                  {t(`specialty.required.${k.slice('specialty.'.length)}`, { defaultValue: t('specialty.fixErrors') })}
                </span>
              ))}
          </Notice>
        )}
        {finalize.isError && !incomplete && !conflict && <Notice kind="error">{errorMessage(t, finalize.error)}</Notice>}
        {/* Kept in view at the bottom of the screen while the record is long (UX-033). */}
        <div className="draft-actions">
          <span className="muted small draft-actions-state" aria-hidden="true">
            {dirty ? t('clinical.unsaved') : savedAt ? t('clinical.savedAt', { time: fmt.time(savedAt, timeZone ?? 'UTC') }) : t('clinical.allSaved')}
          </span>
          <ActionBar>
            <button type="submit" className="button button--primary" disabled={!dirty || save.isPending}>
              {save.isPending ? t('common.saving') : t('clinical.saveDraft')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={dirty || save.isPending || finalize.isPending || confirming}
              aria-describedby={dirty ? 'finalize-blocked' : undefined}
              onClick={requestFinalize}
            >
              {t('clinical.finalize')}
            </button>
          </ActionBar>
          {dirty && (
            <p id="finalize-blocked" className="muted small">
              {t('clinical.saveBeforeFinalize')}
            </p>
          )}
        </div>
      </form>

      {confirming && (
        <div className="confirm-panel" role="alertdialog" aria-labelledby="confirm-finalize-title" aria-describedby="confirm-finalize-body">
          <h3 id="confirm-finalize-title" tabIndex={-1} ref={confirmRef}>
            {t('clinical.confirmTitle')}
          </h3>
          <p id="confirm-finalize-body">{t('clinical.confirmBody')}</p>
          <ActionBar>
            <button type="button" className="button button--primary" disabled={finalize.isPending} onClick={() => finalize.mutate()}>
              {finalize.isPending ? t('clinical.finalizing') : t('clinical.confirmFinalize')}
            </button>
            <button type="button" className="button button--secondary" disabled={finalize.isPending} onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </button>
          </ActionBar>
        </div>
      )}

      {blocker.state === 'blocked' && (
        <div className="confirm-panel" role="alertdialog" aria-labelledby="leave-title">
          <h3 id="leave-title">{t('clinical.leaveTitle')}</h3>
          <p>{t('clinical.leaveBody')}</p>
          <ActionBar>
            <button type="button" className="button button--primary" onClick={() => blocker.reset()}>
              {t('clinical.stay')}
            </button>
            <button type="button" className="button button--danger" onClick={() => blocker.proceed()}>
              {t('clinical.leave')}
            </button>
          </ActionBar>
        </div>
      )}
    </section>
  );
}

function FinalizedRecord({
  encounter,
  canAddAddendum = true,
  onUpdated,
}: {
  encounter: Encounter;
  canAddAddendum?: boolean;
  onUpdated: (encounter: Encounter) => void;
}) {
  return (
    <>
      <RecordSections encounter={encounter} />
      <RecordTimeline encounter={encounter} />
      {canAddAddendum && <AddAddendum encounter={encounter} onAdded={onUpdated} />}
    </>
  );
}

/** Read-only sections of a record (finalized, or someone else's draft seen through coverage). */
function RecordSections({ encounter }: { encounter: Encounter }) {
  const { t } = useTranslation();
  const { timeZone } = useOrg();
  const fmt = useFormatters();
  const zone = timeZone ?? 'UTC';
  return (
    <>
      <section className="card" aria-labelledby="finalized-title">
        <h2 id="finalized-title">{encounter.status === 'finalized' ? t('clinical.finalizedTitle') : t('clinical.draftReadOnlyTitle')}</h2>
        <p className="muted small">
          {t('clinical.author')}: {encounter.author.displayName}
          {encounter.finalizedAt && <> · {t('clinical.finalizedAt', { time: fmt.dateTime(encounter.finalizedAt, zone) })}</>}
        </p>
        {encounter.lateEntry && <p className="muted small">{t('clinical.lateEntryShown', { reason: encounter.lateEntry.reason })}</p>}
        <dl className="record-sections">
          {ENCOUNTER_SECTIONS.map((section) => (
            <div key={section}>
              <dt>{t(`clinical.sections.${section}`)}</dt>
              <dd className="record-text">{encounter.sections[section] || <span className="muted">{t('clinical.notRecorded')}</span>}</dd>
            </div>
          ))}
        </dl>
        {encounter.specialty && <SpecialtyView specialty={encounter.specialty} />}
      </section>
    </>
  );
}

/** The record's history: created, finalized, then each addendum — in order, never rewritten. */
function RecordTimeline({ encounter }: { encounter: Encounter }) {
  const { t } = useTranslation();
  const { timeZone } = useOrg();
  const fmt = useFormatters();
  const zone = timeZone ?? 'UTC';
  return (
    <section className="card" aria-labelledby="record-timeline-title">
      <h2 id="record-timeline-title">{t('clinical.timelineTitle')}</h2>
      <ol className="timeline" data-testid="record-timeline">
        <li className="timeline-item">
          <div className="timeline-head">
            <strong>{encounter.lateEntry ? t('clinical.timelineCreatedLate') : t('clinical.timelineCreated')}</strong>
            <span className="muted small">{fmt.dateTime(encounter.createdAt, zone)}</span>
          </div>
        </li>
        {encounter.finalizedAt && (
          <li className="timeline-item">
            <div className="timeline-head">
              <strong>{t('clinical.timelineFinalized')}</strong>
              <span className="muted small">{fmt.dateTime(encounter.finalizedAt, zone)}</span>
            </div>
          </li>
        )}
        {encounter.addenda.map((addendum) => (
          <li key={addendum.id} className="timeline-item" data-testid="addendum">
            <div className="timeline-head">
              <strong>{t('clinical.addendum')}</strong>
              <span className="muted small">
                {fmt.dateTime(addendum.createdAt, zone)} · {addendum.author.displayName}
              </span>
            </div>
            <p className="muted small">{t('clinical.addendumReasonShown', { reason: addendum.reason })}</p>
            <p className="record-text">{addendum.content}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AddAddendum({ encounter, onAdded }: { encounter: Encounter; onAdded: (encounter: Encounter) => void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [reason, setReason] = useState('');
  const [content, setContent] = useState('');
  const [added, setAdded] = useState(false);
  const key = useRef(newRequestKey());
  const add = useMutation({
    mutationFn: () =>
      api<{ encounter: Encounter }>(`/orgs/${orgId}/encounters/${encounter.id}/addenda`, {
        method: 'POST',
        body: { reason, content },
        headers: { 'Idempotency-Key': key.current },
      }),
    onSuccess: (r) => {
      onAdded(r.encounter);
      setReason('');
      setContent('');
      setAdded(true);
      key.current = newRequestKey();
    },
  });
  const fields = fieldErrors(add.error);
  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    setAdded(false);
    key.current = newRequestKey();
  };
  return (
    <section className="card" aria-labelledby="add-addendum-title">
      <h2 id="add-addendum-title">{t('clinical.addAddendum')}</h2>
      <p className="muted small">{t('clinical.addendumHint')}</p>
      {added && <Notice kind="success">{t('clinical.addendumAdded')}</Notice>}
      {add.isError && Object.keys(fields).length === 0 && <Notice kind="error">{errorMessage(t, add.error)}</Notice>}
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate();
        }}
      >
        <Field id="addendum-reason" label={t('clinical.addendumReason')} error={fieldMessage(t, 'addendumReason', fields.reason)}>
          <input id="addendum-reason" maxLength={300} value={reason} aria-invalid={Boolean(fields.reason)} onChange={(e) => edit(setReason)(e.target.value)} />
        </Field>
        <Field id="addendum-content" label={t('clinical.addendumContent')} error={fieldMessage(t, 'addendumContent', fields.content)}>
          <textarea
            id="addendum-content"
            rows={4}
            maxLength={SECTION_MAX}
            value={content}
            aria-invalid={Boolean(fields.content)}
            onChange={(e) => edit(setContent)(e.target.value)}
          />
        </Field>
        <ActionBar>
          <button type="submit" className="button button--primary" disabled={add.isPending}>
            {add.isPending ? t('clinical.adding') : t('clinical.addAddendum')}
          </button>
        </ActionBar>
      </form>
    </section>
  );
}
