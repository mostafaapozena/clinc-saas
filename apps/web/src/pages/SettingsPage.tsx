import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { SESSION_KEY } from '../auth/session';
import { ModuleSettings } from '../components/ModuleSettings';
import { OrganizationProfileSettings } from '../components/OrganizationProfile';
import { SettingsReset } from '../components/SettingsReset';
import { PageHeader } from '../components/PageHeader';
import { SpecialtyCheckboxes } from '../components/SpecialtyCheckboxes';
import { Field, Notice } from '../components/ui';
import { describedBy } from '../lib/a11y';
import { ApiError, api } from '../lib/api';
import { errorMessage, fieldErrors, fieldMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { useSpecialtyNames } from '../lib/specialties';
import { DEFAULT_TIME_ZONE, ORGANIZATION_TYPES, TIME_ZONES, type OrganizationType } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useUnsavedSections } from '../lib/useUnsavedSections';
import { orgKeys, useOrg } from '../org/context';

export function SettingsPage() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const { orgId, detail } = useOrg();
  const queryClient = useQueryClient();
  const [name, setName] = useState(detail.organization.name);
  useDocumentTitle(t('nav.settings'));
  const { dirty, blocker } = useUnsavedSections();

  const save = useMutation({
    mutationFn: () => api(`/orgs/${orgId}`, { method: 'PATCH', body: { name } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orgKeys.detail(orgId) }),
        queryClient.invalidateQueries({ queryKey: SESSION_KEY }),
      ]);
    },
  });
  const nameError = fieldMessage(t, 'name', fieldErrors(save.error).name);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  const sections = [
    { id: 'org-settings-title', label: t('settings.general') },
    { id: 'time-zone-title', label: t('settings.timeZone') },
    { id: 'specialty-settings-title', label: t('settings.specialtiesTitle') },
    { id: 'profile-title', label: t('orgProfile.title') },
    { id: 'modules-title', label: t('settings.modules.title') },
    { id: 'reset-title', label: t('settingsReset.title') },
  ];

  return (
    <>
      <PageHeader title={t('settings.title')} subtitle={t('settings.createdOn', { date: fmt.date(detail.organization.createdAt) })} />
      {/* Sections at a glance, with the ones that have unsaved changes marked (UX-016). */}
      <nav className="settings-nav" aria-label={t('settings.sectionsNav')}>
        {sections.map((s) => (
          <a key={s.id} href={`#${s.id}`} className={dirty.includes(s.id) ? 'settings-nav-link settings-nav-link--dirty' : 'settings-nav-link'}>
            {s.label}
            {dirty.includes(s.id) && <span className="visually-hidden"> ({t('settings.unsaved')})</span>}
          </a>
        ))}
      </nav>
      {dirty.length > 0 && (
        <p className="settings-unsaved" role="status" data-testid="settings-unsaved">
          {t('settings.unsavedSections', { sections: fmt.list(sections.filter((s) => dirty.includes(s.id)).map((s) => s.label)) })}
        </p>
      )}
      {blocker.state === 'blocked' && (
        <div className="confirm-panel" role="alertdialog" aria-labelledby="settings-leave-title">
          <h3 id="settings-leave-title">{t('settings.leaveTitle')}</h3>
          <p>{t('settings.leaveBody')}</p>
          <div className="form-actions form-actions--start">
            <button type="button" className="button button--primary" onClick={() => blocker.reset?.()}>
              {t('clinical.stay')}
            </button>
            <button type="button" className="button button--danger" onClick={() => blocker.proceed?.()}>
              {t('clinical.leave')}
            </button>
          </div>
        </div>
      )}
      <section className="card" aria-labelledby="org-settings-title">
        <h2 id="org-settings-title">{t('settings.general')}</h2>
        {save.isSuccess && <Notice kind="success">{t('settings.saved')}</Notice>}
        {save.isError && !nameError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
        <form onSubmit={onSubmit} noValidate>
          <Field id="settings-org-name" label={t('settings.orgName')} error={nameError}>
            <input
              id="settings-org-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              {...describedBy('settings-org-name', nameError)}
            />
          </Field>
          <button type="submit" className="button button--primary" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </button>
        </form>
      </section>
      <TimeZoneSettings />
      <SpecialtySettings />
      <OrganizationProfileSettings />
      <ModuleSettings />
      <SettingsReset />
    </>
  );
}

/**
 * Organization type and specialties, with the specialties of every branch, saved together.
 * For organizations created before phase 4 this is their explicit setup.
 */
function SpecialtySettings() {
  const { t } = useTranslation();
  const { orgId, detail, branches } = useOrg();
  const queryClient = useQueryClient();
  const specialtyNames = useSpecialtyNames();
  const organization = detail.organization;
  const [type, setType] = useState<OrganizationType | ''>(organization.type ?? '');
  const [codes, setCodes] = useState<string[]>(organization.specialtyCodes);
  // Branches the owner changed; the others keep what they offer now. A branch without specialties
  // (not set up yet) starts with all ticked — visible and editable before anything is saved.
  const [perBranch, setPerBranch] = useState<Record<string, string[]>>({});
  const offeredAt = (branch: { id: string; specialtyCodes: string[] }) =>
    (perBranch[branch.id] ?? (branch.specialtyCodes.length > 0 ? branch.specialtyCodes : codes)).filter((c) => codes.includes(c));

  const refresh = () => queryClient.invalidateQueries({ queryKey: orgKeys.all(orgId) });
  const saveType = useMutation({
    mutationFn: () => api(`/orgs/${orgId}`, { method: 'PATCH', body: { type } }),
    onSuccess: refresh,
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/specialties`, {
        method: 'PUT',
        body: {
          specialtyCodes: codes,
          branches: branches.map((b) => ({ branchId: b.id, specialtyCodes: offeredAt(b) })),
          configVersion: organization.configVersion,
        },
      }),
    onSuccess: refresh,
  });

  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const details = save.error instanceof ApiError ? save.error.details : {};
  const blockingPractitioners = Array.isArray(details.practitioners)
    ? (details.practitioners as { id: string; displayName: string; specialtyCode: string }[])
    : [];
  const blockingBranches = Array.isArray(details.branchIds) ? (details.branchIds as string[]) : [];

  return (
    <section className="card" aria-labelledby="specialty-settings-title" data-testid="specialty-settings">
      <h2 id="specialty-settings-title">{t('settings.specialtiesTitle')}</h2>
      <p className="muted small">{t('settings.specialtiesIntro')}</p>
      {organization.specialtyCodes.length === 0 && <Notice kind="info">{t('settings.specialtiesLegacy')}</Notice>}

      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          saveType.mutate();
        }}
        noValidate
      >
        {saveType.isSuccess && <Notice kind="success">{t('settings.typeSaved')}</Notice>}
        {saveType.isError && <Notice kind="error">{errorMessage(t, saveType.error)}</Notice>}
        <Field id="settings-org-type" label={t('settings.orgType')}>
          <select id="settings-org-type" value={type} onChange={(e) => setType(e.target.value as OrganizationType)}>
            <option value="">{t('common.choose')}</option>
            {ORGANIZATION_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`onboarding.types.${value}.title`)}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit" className="button button--secondary" disabled={!type || type === organization.type || saveType.isPending}>
          {saveType.isPending ? t('common.saving') : t('settings.saveType')}
        </button>
      </form>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        noValidate
      >
        {save.isSuccess && <Notice kind="success">{t('settings.specialtiesSaved')}</Notice>}
        {save.isError && (
          <Notice kind="error">
            <p>{errorMessage(t, save.error)}</p>
            {blockingPractitioners.length > 0 && (
              <ul data-testid="blocking-practitioners">
                {blockingPractitioners.map((p) => (
                  <li key={p.id}>
                    {p.displayName} — {specialtyNames.name(p.specialtyCode)}
                  </li>
                ))}
              </ul>
            )}
            {blockingBranches.length > 0 && (
              <ul>
                {blockingBranches.map((id) => (
                  <li key={id}>{branchName.get(id) ?? id}</li>
                ))}
              </ul>
            )}
          </Notice>
        )}
        <SpecialtyCheckboxes
          id="settings-specialties"
          legend={t('settings.orgSpecialties')}
          hint={t('settings.orgSpecialtiesHint')}
          value={codes}
          onChange={setCodes}
        />
        {codes.length > 0 && (
          <div className="branch-specialties">
            <h3>{t('settings.branchSpecialties')}</h3>
            {branches.map((branch) => (
              <SpecialtyCheckboxes
                key={branch.id}
                id={`settings-branch-${branch.id}`}
                legend={branch.status === 'active' ? branch.name : `${branch.name} (${t('branches.status.inactive')})`}
                value={offeredAt(branch)}
                options={codes}
                onChange={(next) => setPerBranch((current) => ({ ...current, [branch.id]: next }))}
              />
            ))}
          </div>
        )}
        <div className="form-actions">
          <button type="submit" className="button button--primary" disabled={codes.length === 0 || save.isPending}>
            {save.isPending ? t('common.saving') : t('settings.saveSpecialties')}
          </button>
        </div>
      </form>
    </section>
  );
}

function TimeZoneSettings() {
  const { t } = useTranslation();
  const { orgId, detail, timeZone } = useOrg();
  const queryClient = useQueryClient();
  const [zone, setZone] = useState(timeZone ?? DEFAULT_TIME_ZONE);
  const save = useMutation({
    mutationFn: () => api(`/orgs/${orgId}`, { method: 'PATCH', body: { timeZone: zone } }),
    // Every scheduling view depends on the zone: refresh the whole organization.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orgKeys.all(orgId) }),
  });
  return (
    <section className="card" aria-labelledby="time-zone-title">
      <h2 id="time-zone-title">{t('settings.timeZone')}</h2>
      {!detail.organization.timeZone && <Notice kind="info">{t('settings.timeZoneMissing')}</Notice>}
      <p className="muted small">{t('settings.timeZoneHint')}</p>
      {save.isSuccess && <Notice kind="success">{t('settings.timeZoneSaved')}</Notice>}
      {save.isError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        noValidate
      >
        <Field id="settings-time-zone" label={t('settings.timeZone')}>
          <select id="settings-time-zone" value={zone} onChange={(e) => setZone(e.target.value)}>
            {TIME_ZONES.map((z) => (
              <option key={z} value={z}>
                {t(`timeZones.${z}`)}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit" className="button button--primary" disabled={save.isPending || zone === timeZone}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
      </form>
    </section>
  );
}
