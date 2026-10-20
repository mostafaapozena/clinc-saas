import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useSession } from '../auth/session';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { TimeZoneRequired } from '../components/scheduling';
import { ErrorState, Loading } from '../components/ui';
import { api, query } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import type { DashboardCounts } from '../lib/types';
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

  const links = [
    ...(can('queue.read') ? [{ to: `/app/${orgId}/queue`, label: t('nav.queue') }] : []),
    ...(can('appointment.book') ? [{ to: `/app/${orgId}/appointments/new`, label: t('appointments.book') }] : []),
    ...(can('appointment.read') ? [{ to: `/app/${orgId}/appointments`, label: t('nav.appointments') }] : []),
    ...(can('patient.list') ? [{ to: `/app/${orgId}/patients`, label: t('nav.patients') }] : []),
    { to: `/app/${orgId}/branches`, label: t('nav.branches') },
    ...(can('member.read') ? [{ to: `/app/${orgId}/team`, label: t('nav.team') }] : []),
    ...(can('organization.update') ? [{ to: `/app/${orgId}/settings`, label: t('nav.settings') }] : []),
    { to: `/app/${orgId}/profile`, label: t('nav.profile') },
  ];

  return (
    <>
      <PageHeader title={t('home.welcome', { name: user?.displayName ?? '' })} subtitle={organization.name} />
      <SpecialtySetupNotice />
      {can('dashboard.read') && <TodayCounts />}
      <div className="card-grid">
        <SpecialtyOverview />
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
                <span className="badge" data-testid="home-role">{t(`roles.${membership.role}`)}</span>
              </dd>
            </div>
            <div>
              <dt>{t('home.branchAccess')}</dt>
              <dd data-testid="home-branch-access">
                {membership.branchScope.type === 'all'
                  ? t('home.allBranchesAccess')
                  : fmt.list(branches.map((b) => b.name))}
              </dd>
            </div>
          </dl>
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

        <section className="card" aria-labelledby="overview-title">
          <h2 id="overview-title">{t('home.overview')}</h2>
          <dl className="stats">
            <div>
              <dt>{t('home.accessibleBranches')}</dt>
              <dd data-testid="stat-branches">{fmt.number(stats.accessibleBranches)}</dd>
            </div>
            {stats.activeMembers !== undefined && (
              <div>
                <dt>{t('home.activeMembers')}</dt>
                <dd data-testid="stat-members">{fmt.number(stats.activeMembers)}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="card" aria-labelledby="links-title">
          <h2 id="links-title">{t('home.quickLinks')}</h2>
          <ul className="link-list">
            {links.map((link) => (
              <li key={link.to}>
                <Link to={link.to}>
                  <span>{link.label}</span>
                  <Icon name="arrowForward" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
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

const COUNT_KEYS: (keyof DashboardCounts)[] =['scheduled', 'waiting', 'inProgress', 'completed', 'noShow', 'cancelled'];

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
  return (
    <section className="card today-card" aria-labelledby="today-title">
      <div className="section-header">
        <h2 id="today-title">{own ? t('home.todayOwn') : t('home.today')}</h2>
        {counts.isSuccess && <span className="muted small">{fmt.localDate(counts.data.date)}</span>}
      </div>
      {counts.isPending && <Loading />}
      {counts.isError && <ErrorState message={errorMessage(t, counts.error)} onRetry={() => void counts.refetch()} />}
      {counts.isSuccess && (
        <dl className="stats stats--today">
          {COUNT_KEYS.map((key) => (
            <div key={key} className={`stat stat--${key}`}>
              <dt>{t(`home.counts.${key}`)}</dt>
              <dd data-testid={`today-${key}`}>{fmt.number(counts.data.counts[key])}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="muted small">{t('home.countsDefinition')}</p>
    </section>
  );
}
