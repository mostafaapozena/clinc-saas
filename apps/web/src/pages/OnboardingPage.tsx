import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { SESSION_KEY, useAuthActions, useSession } from '../auth/session';
import { SpecialtyCheckboxes } from '../components/SpecialtyCheckboxes';
import { ErrorState, Field, Loading, Notice } from '../components/ui';
import { PublicLayout } from '../layouts/PublicLayout';
import { describedBy } from '../lib/a11y';
import { ApiError, api } from '../lib/api';
import { errorMessage, fieldErrors, fieldMessage, isApiError } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { useSpecialtyNames } from '../lib/specialties';
import {
  ONBOARDING_STEPS,
  ORGANIZATION_TYPES,
  TIME_ZONES,
  type OnboardingData,
  type OnboardingDraft,
  type OnboardingStep,
  type OrganizationType,
} from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { SPECIALTY_SOLUTION_CODES } from '../public/solutions';

/** Not organization data: cleared with the rest of the cache on sign-in and sign-out. */
const ONBOARDING_KEY = ['onboarding'] as const;

const EMPTY: OnboardingData = {
  organizationType: null,
  name: '',
  timeZone: null,
  specialtyCodes: [],
  branch: { name: '', city: '', specialtyCodes: [] },
};

export function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useSession().data;
  const { logout } = useAuthActions();
  const [startNew, setStartNew] = useState(false);
  useDocumentTitle(t('onboarding.title'));

  const draft = useQuery({
    queryKey: ONBOARDING_KEY,
    queryFn: ({ signal }) => api<{ draft: OnboardingDraft | null }>('/onboarding', { signal }).then((r) => r.draft),
    staleTime: 0,
  });

  const signOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };
  const memberships = session?.memberships ?? [];

  let body;
  if (draft.isPending) body = <Loading />;
  else if (draft.isError) body = <ErrorState message={errorMessage(t, draft.error)} onRetry={() => void draft.refetch()} />;
  else if (!draft.data && memberships.length > 0 && !startNew) body = <ExistingWorkspaces onStartNew={() => setStartNew(true)} />;
  else body = <Wizard key={draft.data?.id ?? 'new'} initial={draft.data} />;

  return (
    <PublicLayout
      brand
      actions={
        <button type="button" className="button button--ghost" onClick={() => void signOut()}>
          {t('shell.logout')}
        </button>
      }
    >
      <section className="card auth-card onboarding-card" aria-labelledby="onboarding-title">
        <h1 id="onboarding-title">{t('onboarding.title')}</h1>
        <p className="muted">{t('onboarding.subtitle', { name: session?.user.displayName ?? '' })}</p>
        {body}
      </section>
    </PublicLayout>
  );
}

/** Someone who already belongs to an organization: no automatic second one. */
function ExistingWorkspaces({ onStartNew }: { onStartNew: () => void }) {
  const { t } = useTranslation();
  const memberships = useSession().data?.memberships ?? [];
  return (
    <div className="onboarding-existing" data-testid="onboarding-existing">
      <h2>{t('onboarding.existingTitle')}</h2>
      <p>{t('onboarding.existingBody')}</p>
      <ul className="link-list">
        {memberships.map((m) => (
          <li key={m.organization.id}>
            <Link to={`/app/${m.organization.id}`}>{t('onboarding.openWorkspace', { name: m.organization.name })}</Link>
          </li>
        ))}
      </ul>
      <button type="button" className="button button--secondary" onClick={onStartNew}>
        {t('onboarding.createAnother')}
      </button>
    </div>
  );
}

/** Pre-selection from a public solution page; only known values, and only for a new setup. */
function usePreselection(): Partial<OnboardingData> {
  const [params] = useSearchParams();
  const specialty = params.get('specialty');
  const type = params.get('type');
  return {
    ...(specialty && SPECIALTY_SOLUTION_CODES.includes(specialty) ? { specialtyCodes: [specialty] } : {}),
    ...(type && (ORGANIZATION_TYPES as readonly string[]).includes(type) ? { organizationType: type as OrganizationType } : {}),
  };
}

function clientErrors(step: OnboardingStep, data: OnboardingData): Record<string, string> {
  const errors: Record<string, string> = {};
  if (step === 'organization') {
    if (!data.organizationType) errors.organizationType = 'required';
    if (data.name.trim().length < 2) errors.name = data.name.trim() ? 'too_short' : 'required';
    if (!data.timeZone) errors.timeZone = 'required';
  }
  if (step === 'specialties' && data.specialtyCodes.length === 0) errors.specialtyCodes = 'too_short';
  if (step === 'branch') {
    if (data.branch.name.trim().length < 2) errors['branch.name'] = data.branch.name.trim() ? 'too_short' : 'required';
    if (data.branch.specialtyCodes.length === 0) errors['branch.specialtyCodes'] = 'too_short';
  }
  return errors;
}

function Wizard({ initial }: { initial: OnboardingDraft | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const specialties = useSpecialtyNames();
  const preselect = usePreselection();
  const preselectedName = preselect.specialtyCodes?.[0] ? specialties.name(preselect.specialtyCodes[0]) : null;

  const [step, setStep] = useState<OnboardingStep>(initial?.step ?? 'organization');
  const [data, setData] = useState<OnboardingData>(() => {
    if (!initial) return { ...EMPTY, ...preselect, branch: { ...EMPTY.branch } };
    // A resumed draft keeps its values; a public pre-selection only fills what is still empty.
    return {
      ...initial.data,
      organizationType: initial.data.organizationType ?? preselect.organizationType ?? null,
      specialtyCodes: initial.data.specialtyCodes.length > 0 ? initial.data.specialtyCodes : (preselect.specialtyCodes ?? []),
    };
  });
  const [draftId, setDraftId] = useState(initial?.id ?? null);
  const [version, setVersion] = useState<number | null>(initial?.version ?? null);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<'resumed' | 'saved' | 'conflict' | null>(initial ? 'resumed' : null);
  const index = ONBOARDING_STEPS.indexOf(step);

  const save = useMutation({
    mutationFn: (nextStep: OnboardingStep) =>
      api<{ draft: OnboardingDraft }>('/onboarding', { method: 'PUT', body: { step: nextStep, version, data } }),
    onSuccess: ({ draft }) => {
      setDraftId(draft.id);
      setVersion(draft.version);
      setStep(draft.step);
      setNotice('saved');
      queryClient.setQueryData(ONBOARDING_KEY, draft);
    },
    onError: async (error) => {
      if (!isApiError(error, 'VERSION_CONFLICT')) return;
      // Another tab saved first: continue from what is stored.
      const latest = await queryClient.fetchQuery({
        queryKey: ONBOARDING_KEY,
        queryFn: () => api<{ draft: OnboardingDraft | null }>('/onboarding').then((r) => r.draft),
      });
      if (latest) {
        setDraftId(latest.id);
        setVersion(latest.version);
        setData(latest.data);
        setStep(latest.step);
      }
      setNotice('conflict');
    },
  });

  const complete = useMutation({
    mutationFn: () => api<{ organization: { id: string } }>(`/onboarding/${draftId}/complete`, { method: 'POST' }),
    onSuccess: async ({ organization }) => {
      queryClient.removeQueries({ queryKey: ONBOARDING_KEY });
      await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      navigate(`/app/${organization.id}`, { replace: true });
    },
    onError: (error) => {
      const target = error instanceof ApiError ? error.details.step : undefined;
      if (typeof target === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(target)) setStep(target as OnboardingStep);
    },
  });

  const serverErrors = { ...fieldErrors(save.error), ...fieldErrors(complete.error) };
  const errors = { ...serverErrors, ...localErrors };
  const message = (field: string) => fieldMessage(t, field, errors[field]);

  const goTo = (target: OnboardingStep) => {
    const problems = ONBOARDING_STEPS.indexOf(target) > index ? clientErrors(step, data) : {};
    setLocalErrors(problems);
    if (Object.keys(problems).length > 0) return;
    if (target === 'branch' && data.branch.specialtyCodes.length === 0) {
      setData((d) => ({ ...d, branch: { ...d.branch, specialtyCodes: d.specialtyCodes } }));
    }
    save.mutate(target);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const next = ONBOARDING_STEPS[index + 1];
    if (next) goTo(next);
    else complete.mutate();
  };

  const setSpecialties = (codes: string[]) =>
    setData((d) => ({ ...d, specialtyCodes: codes, branch: { ...d.branch, specialtyCodes: d.branch.specialtyCodes.filter((c) => codes.includes(c)) } }));

  const busy = save.isPending || complete.isPending;
  const fatal = (save.error && !isApiError(save.error, 'VERSION_CONFLICT') && Object.keys(fieldErrors(save.error)).length === 0) || complete.error;

  return (
    <div className="wizard">
      <ol className="wizard-steps" aria-label={t('onboarding.progress')}>
        {ONBOARDING_STEPS.map((s, i) => (
          <li key={s} aria-current={s === step ? 'step' : undefined} className={i < index ? 'wizard-step--done' : undefined}>
            <span className="wizard-step-number" aria-hidden="true">
              {i + 1}
            </span>
            <span>{t(`onboarding.steps.${s}`)}</span>
          </li>
        ))}
      </ol>
      <p className="muted small" aria-live="polite">
        {t('onboarding.stepLabel', { current: index + 1, total: ONBOARDING_STEPS.length })}
      </p>

      {notice === 'resumed' && <Notice kind="info">{t('onboarding.resumed')}</Notice>}
      {notice === 'saved' && <Notice kind="success">{t('onboarding.saved')}</Notice>}
      {notice === 'conflict' && <Notice kind="info">{t('onboarding.conflict')}</Notice>}
      {fatal && <Notice kind="error">{errorMessage(t, save.error ?? complete.error)}</Notice>}

      <form onSubmit={onSubmit} noValidate data-testid={`onboarding-step-${step}`}>
        {step === 'organization' && (
          <>
            <fieldset className="fieldset" aria-describedby={message('organizationType') ? 'org-type-error' : undefined}>
              <legend>{t('onboarding.type')}</legend>
              {message('organizationType') && (
                <p className="field-error" id="org-type-error">
                  {message('organizationType')}
                </p>
              )}
              <div className="type-options">
                {ORGANIZATION_TYPES.map((type) => (
                  <label key={type} className="type-option">
                    <input
                      type="radio"
                      name="organization-type"
                      value={type}
                      checked={data.organizationType === type}
                      onChange={() => setData((d) => ({ ...d, organizationType: type }))}
                    />
                    <span>
                      <strong>{t(`onboarding.types.${type}.title`)}</strong>
                      <span className="muted small">{t(`onboarding.types.${type}.body`)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field id="org-name" label={t('onboarding.orgName')} error={message('name')}>
              <input
                id="org-name"
                required
                maxLength={120}
                value={data.name}
                onChange={(e) => setData((d) => ({ ...d, name: e.target.value }))}
                {...describedBy('org-name', message('name'))}
              />
            </Field>
            <Field id="org-time-zone" label={t('onboarding.timeZone')} error={message('timeZone')} hint={t('onboarding.timeZoneHint')}>
              <select
                id="org-time-zone"
                value={data.timeZone ?? ''}
                onChange={(e) => setData((d) => ({ ...d, timeZone: e.target.value || null }))}
                {...describedBy('org-time-zone', message('timeZone'), t('onboarding.timeZoneHint'))}
              >
                <option value="">{t('onboarding.chooseTimeZone')}</option>
                {TIME_ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {t(`timeZones.${zone}`)}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}

        {step === 'specialties' && (
          <>
            {preselectedName && data.specialtyCodes.includes(preselect.specialtyCodes?.[0] ?? '') && (
              <p className="muted small">{t('onboarding.preselected', { name: preselectedName })}</p>
            )}
            <SpecialtyCheckboxes
              id="org-specialties"
              legend={t('onboarding.specialtiesTitle')}
              hint={t('onboarding.specialtiesHint')}
              error={message('specialtyCodes')}
              value={data.specialtyCodes}
              onChange={setSpecialties}
            />
            <p className="muted small">{t('onboarding.otherSpecialtiesNote')}</p>
          </>
        )}

        {step === 'branch' && (
          <>
            <Field id="branch-name" label={t('onboarding.branchName')} error={message('branch.name')} hint={t('onboarding.branchHint')}>
              <input
                id="branch-name"
                required
                maxLength={80}
                value={data.branch.name}
                onChange={(e) => setData((d) => ({ ...d, branch: { ...d.branch, name: e.target.value } }))}
                {...describedBy('branch-name', message('branch.name'), t('onboarding.branchHint'))}
              />
            </Field>
            <Field id="branch-city" label={`${t('onboarding.city')} ${t('common.optional')}`} error={message('branch.city')}>
              <input
                id="branch-city"
                maxLength={80}
                value={data.branch.city}
                onChange={(e) => setData((d) => ({ ...d, branch: { ...d.branch, city: e.target.value } }))}
              />
            </Field>
            <SpecialtyCheckboxes
              id="branch-specialties"
              legend={t('onboarding.branchSpecialties')}
              hint={t('onboarding.branchSpecialtiesHint')}
              error={message('branch.specialtyCodes')}
              value={data.branch.specialtyCodes}
              options={data.specialtyCodes}
              onChange={(codes) => setData((d) => ({ ...d, branch: { ...d.branch, specialtyCodes: codes } }))}
            />
            {data.organizationType !== 'clinic' && <Notice kind="info">{t('onboarding.moreBranchesHint')}</Notice>}
          </>
        )}

        {step === 'review' && <Review data={data} onEdit={(s) => setStep(s)} />}

        <div className="wizard-actions">
          {index > 0 && (
            <button type="button" className="button button--secondary" disabled={busy} onClick={() => goTo(ONBOARDING_STEPS[index - 1] ?? 'organization')}>
              {t('onboarding.back')}
            </button>
          )}
          <button type="submit" className="button button--primary" disabled={busy}>
            {step === 'review'
              ? complete.isPending
                ? t('onboarding.submitting')
                : t('onboarding.submit')
              : save.isPending
                ? t('onboarding.saving')
                : t('onboarding.next')}
          </button>
        </div>
      </form>
    </div>
  );
}

function Review({ data, onEdit }: { data: OnboardingData; onEdit: (step: OnboardingStep) => void }) {
  const { t } = useTranslation();
  const specialties = useSpecialtyNames();
  const fmt = useFormatters();
  const names = (codes: string[]) => fmt.list(codes.map(specialties.name));
  const rows: { step: OnboardingStep; label: string; value: string }[] = [
    { step: 'organization', label: t('onboarding.type'), value: data.organizationType ? t(`onboarding.types.${data.organizationType}.title`) : '—' },
    { step: 'organization', label: t('onboarding.orgName'), value: data.name },
    { step: 'organization', label: t('onboarding.timeZone'), value: data.timeZone ? t(`timeZones.${data.timeZone}`) : '—' },
    { step: 'specialties', label: t('onboarding.steps.specialties'), value: names(data.specialtyCodes) },
    { step: 'branch', label: t('onboarding.branchName'), value: data.branch.city ? `${data.branch.name} — ${data.branch.city}` : data.branch.name },
    { step: 'branch', label: t('onboarding.branchSpecialties'), value: names(data.branch.specialtyCodes) },
  ];
  return (
    <div className="review" data-testid="onboarding-review">
      <h2>{t('onboarding.reviewTitle')}</h2>
      <dl className="details review-list">
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>
              <span>{row.value}</span>
              <button type="button" className="link-button" onClick={() => onEdit(row.step)} aria-label={`${t('onboarding.edit')}: ${row.label}`}>
                {t('onboarding.edit')}
              </button>
            </dd>
          </div>
        ))}
      </dl>
      <p className="muted small">{t('onboarding.reviewOwner')}</p>
      <p className="muted small">{t('onboarding.reviewTerms')}</p>
    </div>
  );
}
