import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router';
import { SESSION_KEY, useAuthActions, useSession } from '../auth/session';
import { Icon, type IconName } from '../components/Icon';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ErrorState, Loading } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { LAST_ORG_KEY, branchKey, readStored, writeStored } from '../lib/storage';
import type { Branch, OrgDetail, Permission } from '../lib/types';
import { OrgContext, orgKeys, useOrg, type OrgContextValue } from '../org/context';

export function AppShell() {
  const { orgId = '' } = useParams();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Drop every other organization's cached data, so none of it can render in this one.
  useEffect(() => {
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] === 'org' && q.queryKey[1] !== orgId });
    writeStored(LAST_ORG_KEY, orgId);
  }, [orgId, queryClient]);

  const detail = useQuery({
    queryKey: orgKeys.detail(orgId),
    queryFn: ({ signal }) => api<OrgDetail>(`/orgs/${orgId}`, { signal }),
  });
  const branches = useQuery({
    queryKey: orgKeys.branches(orgId),
    queryFn: ({ signal }) => api<{ data: Branch[] }>(`/orgs/${orgId}/branches`, { signal }).then((r) => r.data),
    enabled: detail.isSuccess,
  });

  if (detail.isPending) return <div className="full-page"><Loading /></div>;
  if (detail.isError) {
    if (detail.error instanceof ApiError && detail.error.status === 404) return <OrgUnavailable />;
    return (
      <div className="full-page">
        <ErrorState message={errorMessage(t, detail.error)} onRetry={() => void detail.refetch()} />
      </div>
    );
  }
  return <Shell key={orgId} orgId={orgId} detail={detail.data} branches={branches.data ?? []} />;
}

function Shell({ orgId, detail, branches }: { orgId: string; detail: OrgDetail; branches: Branch[] }) {
  const { t } = useTranslation();
  const [navOpen, setNavOpen] = useState(false);
  const [storedBranch, setStoredBranch] = useState(() => readStored(branchKey(orgId)));

  const orgWide = detail.membership.branchScope.type === 'all';
  const activeBranches = branches.filter((b) => b.status === 'active');
  const storedIsValid = storedBranch === 'all' ? orgWide : activeBranches.some((b) => b.id === storedBranch);
  const selectedBranchId =
    storedBranch && storedIsValid ? storedBranch : orgWide ? 'all' : (activeBranches[0]?.id ?? '');

  const value = useMemo<OrgContextValue>(
    () => ({
      orgId,
      detail,
      branches,
      can: (permission: Permission) => detail.membership.permissions.includes(permission),
      selectedBranchId,
      selectBranch: (branchId: string) => {
        setStoredBranch(branchId);
        writeStored(branchKey(orgId), branchId);
      },
    }),
    [orgId, detail, branches, selectedBranchId],
  );

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]);

  const nav: { to: string; icon: IconName; label: string; end?: boolean }[] = [
    { to: `/app/${orgId}`, icon: 'home', label: t('nav.home'), end: true },
    { to: `/app/${orgId}/branches`, icon: 'building', label: t('nav.branches') },
    ...(value.can('member.read') ? [{ to: `/app/${orgId}/team`, icon: 'users' as const, label: t('nav.team') }] : []),
    ...(value.can('organization.update')
      ? [{ to: `/app/${orgId}/settings`, icon: 'settings' as const, label: t('nav.settings') }]
      : []),
    { to: `/app/${orgId}/profile`, icon: 'user', label: t('nav.profile') },
  ];

  return (
    <OrgContext.Provider value={value}>
      <div className={navOpen ? 'shell shell--nav-open' : 'shell'}>
        <a className="skip-link" href="#main-content">
          {t('shell.skipToContent')}
        </a>
        <aside className="sidebar" id="app-sidebar">
          <div className="sidebar-brand">
            <span className="brand-mark" aria-hidden="true">+</span>
            <span>
              {t('app.name')} <small className="temp-name">({t('app.tempName')})</small>
            </span>
            <button type="button" className="icon-button sidebar-close" onClick={() => setNavOpen(false)} aria-label={t('shell.closeMenu')}>
              <Icon name="close" />
            </button>
          </div>
          <nav aria-label={t('shell.navigation')}>
            <ul className="nav-list">
              {nav.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.end} className="nav-link" onClick={() => setNavOpen(false)}>
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />

        <div className="shell-main">
          <header className="topbar">
            <button
              type="button"
              className="icon-button menu-button"
              aria-controls="app-sidebar"
              aria-expanded={navOpen}
              aria-label={t('shell.openMenu')}
              onClick={() => setNavOpen(true)}
            >
              <Icon name="menu" />
            </button>
            <OrgSwitcher orgId={orgId} currentName={detail.organization.name} />
            <BranchSwitcher />
            <div className="topbar-end">
              <LanguageSwitcher />
              <UserMenu orgId={orgId} />
            </div>
          </header>
          <main id="main-content" className="content" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
      </div>
    </OrgContext.Provider>
  );
}

function OrgSwitcher({ orgId, currentName }: { orgId: string; currentName: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const memberships = useSession().data?.memberships ?? [];
  const options = memberships.some((m) => m.organization.id === orgId)
    ? memberships
    : [{ organization: { id: orgId, name: currentName } }, ...memberships];
  return (
    <div className="switcher">
      <label htmlFor="org-switcher" className="switcher-label">
        {t('shell.organization')}
      </label>
      <select id="org-switcher" value={orgId} onChange={(e) => navigate(`/app/${e.target.value}`)}>
        {options.map((m) => (
          <option key={m.organization.id} value={m.organization.id}>
            {m.organization.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function BranchSwitcher() {
  const { t } = useTranslation();
  const { detail, branches, selectedBranchId, selectBranch } = useOrg();
  const active = branches.filter((b) => b.status === 'active');
  if (active.length === 0) return null;
  return (
    <div className="switcher">
      <label htmlFor="branch-switcher" className="switcher-label">
        {t('shell.branch')}
      </label>
      <select id="branch-switcher" value={selectedBranchId} onChange={(e) => selectBranch(e.target.value)}>
        {detail.membership.branchScope.type === 'all' && <option value="all">{t('shell.allBranches')}</option>}
        {active.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function UserMenu({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { logout } = useAuthActions();
  const user = useSession().data?.user;
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const signOut = async () => {
    setLeaving(true);
    try {
      await logout();
    } finally {
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="button button--ghost user-menu-button"
        aria-expanded={open}
        aria-controls="user-menu-panel"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="user" />
        <span className="user-name">{user?.displayName}</span>
        <Icon name="chevronDown" />
      </button>
      {open && (
        <div className="user-menu-panel" id="user-menu-panel">
          <p className="user-menu-email">{user?.email}</p>
          <Link to={`/app/${orgId}/profile`} onClick={() => setOpen(false)}>
            <Icon name="user" /> {t('nav.profile')}
          </Link>
          <Link to="/onboarding" onClick={() => setOpen(false)}>
            <Icon name="plus" /> {t('shell.createOrganization')}
          </Link>
          <button type="button" onClick={() => void signOut()} disabled={leaving}>
            <Icon name="logout" /> {leaving ? t('shell.loggingOut') : t('shell.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

function OrgUnavailable() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // Memberships may have changed (e.g. suspended): refresh the organization list.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
  }, [queryClient]);
  return (
    <div className="full-page">
      <section className="card state-card" aria-labelledby="org-unavailable-title">
        <h1 id="org-unavailable-title">{t('access.orgUnavailableTitle')}</h1>
        <p>{t('access.orgUnavailableBody')}</p>
        <Link className="button button--secondary" to="/app">
          {t('access.backToWorkspace')}
        </Link>
      </section>
    </div>
  );
}
