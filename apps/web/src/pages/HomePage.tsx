import { useQuery } from '@tanstack/react-query';
import { FocusPanel, SpecialtyContextChooser, SpecialtyQuickActions } from './WorkspacePages';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useSession } from '../auth/session';
import { Icon, type IconName } from '../components/Icon';
import { Metric, type MetricTone } from '../components/Metric';
import { CardGrid, MetricGrid } from '../components/layout';
import { PageHeader } from '../components/PageHeader';
import { SpecialtySummaryCard } from '../components/specialty';
import { TimeZoneRequired } from '../components/scheduling';
import { EmptyState, ErrorState, Loading } from '../components/ui';
import { api, query } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { readStored, writeStored } from '../lib/storage';
import type { DashboardCounts, Member, Page, PatientSummary, Practitioner } from '../lib/types';
import { useSpecialtyNames } from '../lib/specialties';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { orgKeys, useBranchFilter, useOrg, useSpecialtyFilter } from '../org/context';

export function HomePage() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const user = useSession().data?.user;
  const { orgId, detail, branches, selectedBranchId, can } = useOrg();
  const { organization, membership, stats } = detail;
  const selected = branches.find((b) => b.id === selectedBranchId);
  useDocumentTitle(t('nav.home'));

  // One main action for the role in the header; the sidebar holds every other destination.
  const primary = can('appointment.book')
    ? { to: `/app/${orgId}/appointments/new`, label: t('appointments.book'), icon: 'plus' as const }
    : can('clinical.encounter.own')
      ? { to: `/app/${orgId}/queue`, label: t('nav.queue'), icon: 'queue' as const }
      : can('finance.report.read') || can('accounting.read')
        ? { to: `/app/${orgId}/reports`, label: t('nav.reports'), icon: 'chart' as const }
        : null;

  return (
    <>
      <PageHeader title={t('home.welcome', { name: user?.displayName ?? '' })} subtitle={organization.name}>
        {primary && (
          <Link className="button button--primary" to={primary.to}>
            <Icon name={primary.icon} /> {primary.label}
          </Link>
        )}
      </PageHeader>
      <SpecialtySetupNotice />
      <SpecialtyContextChooser />
      {/* 1. What needs a decision or an action now. */}
      <FocusPanel />
      {/* 2. Today's work. */}
      {can('dashboard.read') && <TodayCounts />}
      <SpecialtyQuickActions />
      {can('practitioner.manage') && can('member.read') && <GettingStarted />}
      {/* 3. Context: the organization, your access and branch — available, but not competing with the work. */}
      <details className="card home-context" data-testid="home-context">
        <summary>
          <Icon name="info" /> {t('home.context')}
        </summary>
        <CardGrid className="home-grid">
          <section className="card" aria-labelledby="access-title">
            <h2 id="access-title">{t('home.yourAccess')}</h2>
            <dl className="details">
              <div>
                <dt>{t('home.organization')}</dt>
                <dd data-testid="home-org-name">{organization.name}</dd>
              </div>
              <div>
                <dt>{t('home.yourRole')}</dt>
                <dd>
                  <span className="badge" data-testid="home-role">
                    {t(`roles.${membership.role}`)}
                  </span>
                </dd>
              </div>
              <div>
                <dt>{t('home.branchAccess')}</dt>
                <dd data-testid="home-branch-access">
                  {membership.branchScope.type === 'all' ? t('home.allBranchesAccess') : fmt.list(branches.map((b) => b.name))}
                </dd>
              </div>
            </dl>
            <MetricGrid columns="compact">
              <Metric icon="building" label={t('home.accessibleBranches')} value={stats.accessibleBranches} tone="brand" testId="stat-branches" />
              {stats.activeMembers !== undefined && <Metric icon="users" label={t('home.activeMembers')} value={stats.activeMembers} tone="brand" testId="stat-members" />}
            </MetricGrid>
          </section>
          <section className="card" aria-labelledby="current-branch-title">
            <h2 id="current-branch-title">{t('home.currentBranch')}</h2>
            {selected ? (
              <dl className="details" data-testid="current-branch">
                <div>
                  <dt>{t('branches.name')}</dt>
                  <dd>{selected.name}</dd>
                </div>
                <div>
                  <dt>{t('branches.city')}</dt>
                  <dd>{selected.city || t('common.notSet')}</dd>
                </div>
                <div>
                  <dt>{t('branches.createdAt')}</dt>
                  <dd>{fmt.date(selected.createdAt)}</dd>
                </div>
              </dl>
            ) : (
              <p data-testid="current-branch">{t('home.allBranchesSelected')}</p>
            )}
          </section>
          <SpecialtyOverview />
          {can('clinical.documentation_status.read') && <SpecialtySummaryCard />}
        </CardGrid>
      </details>
    </>
  );
}

/** Organizations created before phase 4: the owner is asked (not forced) to choose specialties. */
function SpecialtySetupNotice() {
  const { t } = useTranslation();
  const { orgId, specialties, can } = useOrg();
  if (specialties.length > 0 || !can('organization.update')) return null;
  return (
    <section className="notice notice--info" aria-labelledby="specialty-setup-title" data-testid="specialty-setup-notice">
      <h2 id="specialty-setup-title">{t('home.specialtySetupTitle')}</h2>
      <p>{t('home.specialtySetupBody')}</p>
      <Link className="button button--secondary" to={`/app/${orgId}/settings`}>
        {t('home.specialtySetupLink')}
      </Link>
    </section>
  );
}

/**
 * The organization's specialties and where they are offered (accessible branches only). The
 * workspace is the same shared operational one for every specialty; this says so plainly.
 */
function SpecialtyOverview() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const names = useSpecialtyNames();
  const { specialties, branches, selectedSpecialty } = useOrg();
  if (specialties.length === 0) return null;
  const active = branches.filter((b) => b.status === 'active');
  return (
    <section className="card" aria-labelledby="specialties-title" data-testid="specialty-overview">
      <h2 id="specialties-title">{t('home.specialtiesTitle')}</h2>
      <ul className="specialty-overview">
        {specialties.map((code) => {
          const at = active.filter((b) => b.specialtyCodes.includes(code)).map((b) => b.name);
          return (
            <li key={code} aria-current={selectedSpecialty === code ? 'true' : undefined}>
              <strong>{names.name(code)}</strong>
              <span className="muted small">{at.length > 0 ? t('home.offeredAt', { branches: fmt.list(at) }) : t('home.notOfferedHere')}</span>
            </li>
          );
        })}
      </ul>
      <p className="muted small">{t('specialtyContext.sharedNote')}</p>
    </section>
  );
}

/** Today's counts, in the order of the working day, with the appointment status each one lists. */
const COUNTS: { key: keyof DashboardCounts; icon: IconName; tone: MetricTone; status: string }[] = [
  { key: 'scheduled', icon: 'calendar', tone: 'neutral', status: 'scheduled' },
  { key: 'waiting', icon: 'queue', tone: 'warn', status: 'checked_in' },
  { key: 'inProgress', icon: 'activity', tone: 'info', status: 'in_progress' },
  { key: 'completed', icon: 'checkCircle', tone: 'ok', status: 'completed' },
  { key: 'noShow', icon: 'userX', tone: 'muted', status: 'no_show' },
  { key: 'cancelled', icon: 'ban', tone: 'bad', status: 'cancelled' },
];

/**
 * Real counts from the API for today's appointments (by their start on today's local date),
 * scoped to the caller: their branches and selected branch; doctors their own; viewers totals.
 */
function TodayCounts() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const { orgId, timeZone, detail } = useOrg();
  const branchId = useBranchFilter();
  const specialty = useSpecialtyFilter();
  const counts = useQuery({
    queryKey: orgKeys.dashboard(orgId, branchId ?? 'all', specialty ?? 'all'),
    queryFn: ({ signal }) =>
      api<{ date: string; counts: DashboardCounts }>(`/orgs/${orgId}/dashboard${query({ branchId, specialty })}`, { signal }),
    enabled: Boolean(timeZone),
    refetchInterval: 60_000,
  });
  if (!timeZone) return <TimeZoneRequired />;
  const own = detail.membership.practitionerId && !detail.membership.permissions.includes('appointment.book');
  // Viewers see numbers only; everyone who can read appointments can open the counted list.
  const listable = detail.membership.permissions.includes('appointment.read');
  return (
    <section className="card today-card" aria-labelledby="today-title">
      <div className="section-header">
        <h2 id="today-title" className="card-title">
          <Icon name="calendar" /> {own ? t('home.todayOwn') : t('home.today')}
        </h2>
        {counts.isSuccess && <span className="muted small">{fmt.localDate(counts.data.date)}</span>}
      </div>
      {counts.isPending && <Loading />}
      {counts.isError && <ErrorState message={errorMessage(t, counts.error)} onRetry={() => void counts.refetch()} />}
      {/* Zero is meaningful: a day without appointments says so once, with the next step, instead of
          six tiles of zero (UI-09). Any activity shows every status, zeros included. */}
      {counts.isSuccess && Object.values(counts.data.counts).every((n) => n === 0) && (
        <EmptyState
          icon="calendar"
          action={
            detail.membership.permissions.includes('appointment.book') ? (
              <Link to={`/app/${orgId}/appointments/new`}>{t('appointments.book')}</Link>
            ) : undefined
          }
        >
          <span data-testid="today-none">{t('home.noAppointmentsToday')}</span>
        </EmptyState>
      )}
      {counts.isSuccess && Object.values(counts.data.counts).some((n) => n > 0) && (
        <dl className="metrics metrics--six">
          {COUNTS.map(({ key, icon, tone, status }) => (
            <Metric
              key={key}
              icon={icon}
              tone={tone}
              label={t(`home.counts.${key}`)}
              value={counts.data.counts[key]}
              testId={`today-${key}`}
              to={listable ? `/app/${orgId}/appointments?status=${status}` : undefined}
              linkLabel={t('home.counts.open', { label: t(`home.counts.${key}`) })}
            />
          ))}
        </dl>
      )}
      <p className="muted small">{t('home.countsDefinition')}</p>
    </section>
  );
}

const startKey = (orgId: string) => `clinc.gettingStarted.${orgId}`;

/**
 * "Get started" for owners and admins of a new organization (UX-020): what a first booking
 * needs, each step marked from the organization's own data and linked to where it is done.
 * Hidden once everything is done, when dismissed (this browser), or if any check cannot load.
 */
function GettingStarted() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [dismissed, setDismissed] = useState(() => readStored(startKey(orgId)) === 'dismissed');
  const enabled = !dismissed;
  const settings = useQuery({
    queryKey: orgKeys.financeSettings(orgId),
    queryFn: ({ signal }) => api<{ currency: string | null }>(`/orgs/${orgId}/finance/settings`, { signal }),
    enabled,
  });
  const services = useQuery({
    queryKey: orgKeys.financeServices(orgId),
    queryFn: ({ signal }) => api<{ data: unknown[] }>(`/orgs/${orgId}/finance/services`, { signal }).then((r) => r.data),
    enabled,
  });
  const practitioners = useQuery({
    queryKey: orgKeys.practitioners(orgId),
    queryFn: ({ signal }) => api<{ data: Practitioner[] }>(`/orgs/${orgId}/practitioners`, { signal }).then((r) => r.data),
    enabled,
  });
  const members = useQuery({
    queryKey: orgKeys.members(orgId),
    queryFn: ({ signal }) => api<{ data: Member[] }>(`/orgs/${orgId}/members`, { signal }).then((r) => r.data),
    enabled,
  });
  const patients = useQuery({
    queryKey: orgKeys.patients(orgId, { pageSize: 1, start: true }),
    queryFn: ({ signal }) => api<Page<PatientSummary>>(`/orgs/${orgId}/patients${query({ pageSize: 1 })}`, { signal }),
    enabled,
  });
  const checks = [settings, services, practitioners, members, patients];
  if (dismissed || checks.some((c) => !c.isSuccess)) return null;

  const base = `/app/${orgId}`;
  const steps = [
    { key: 'currency', icon: 'wallet', to: `${base}/finance/services`, done: Boolean(settings.data?.currency) },
    { key: 'service', icon: 'card', to: `${base}/finance/services`, done: (services.data?.length ?? 0) > 0 },
    { key: 'practitioner', icon: 'stethoscope', to: `${base}/practitioners`, done: (practitioners.data?.length ?? 0) > 0 },
    { key: 'team', icon: 'users', to: `${base}/team`, done: (members.data?.filter((m) => m.status === 'active').length ?? 0) > 1 },
    { key: 'patient', icon: 'patients', to: `${base}/patients`, done: (patients.data?.total ?? 0) > 0 },
  ] as const;
  const done = steps.filter((step) => step.done).length;
  if (done === steps.length) return null;
  const dismiss = () => {
    writeStored(startKey(orgId), 'dismissed');
    setDismissed(true);
  };

  return (
    <section className="card start-card" aria-labelledby="start-title" data-testid="getting-started">
      <div className="section-header">
        <div>
          <h2 id="start-title" className="card-title">
            <Icon name="checkCircle" /> {t('home.start.title')}
          </h2>
          <p className="muted small">{t('home.start.lead')}</p>
        </div>
        <span className="badge">{t('home.start.progress', { done, total: steps.length })}</span>
      </div>
      <ol className="start-steps">
        {steps.map((step) => (
          <li key={step.key} className={step.done ? 'start-step start-step--done' : 'start-step'}>
            <span className="start-step-icon" aria-hidden="true">
              <Icon name={step.done ? 'check' : step.icon} />
            </span>
            <Link to={step.to}>{t(`home.start.steps.${step.key}`)}</Link>
            <span className={step.done ? 'badge badge--active' : 'badge'}>{step.done ? t('home.start.done') : t('home.start.todo')}</span>
          </li>
        ))}
      </ol>
      <div className="form-actions start-actions">
        {(patients.data?.total ?? 0) > 0 && (
          <Link className="button button--primary" to={`${base}/appointments/new`}>
            <Icon name="calendar" /> {t('home.start.steps.booking')}
          </Link>
        )}
        <button type="button" className="button button--ghost" onClick={dismiss}>
          {t('home.start.dismiss')}
        </button>
      </div>
    </section>
  );
}
