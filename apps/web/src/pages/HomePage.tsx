import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useSession } from '../auth/session';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { useFormatters } from '../lib/format';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useOrg } from '../org/context';

export function HomePage() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const user = useSession().data?.user;
  const { orgId, detail, branches, selectedBranchId, can } = useOrg();
  const { organization, membership, stats } = detail;
  const selected = branches.find((b) => b.id === selectedBranchId);
  useDocumentTitle(t('nav.home'));

  const links = [
    { to: `/app/${orgId}/branches`, label: t('nav.branches') },
    ...(can('member.read') ? [{ to: `/app/${orgId}/team`, label: t('nav.team') }] : []),
    ...(can('organization.update') ? [{ to: `/app/${orgId}/settings`, label: t('nav.settings') }] : []),
    { to: `/app/${orgId}/profile`, label: t('nav.profile') },
  ];

  return (
    <>
      <PageHeader title={t('home.welcome', { name: user?.displayName ?? '' })} subtitle={organization.name} />
      <div className="card-grid">
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
