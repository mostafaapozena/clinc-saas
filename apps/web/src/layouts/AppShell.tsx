import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { SESSION_KEY, useAuthActions, useSession } from '../auth/session';
import { BrandLogo } from '../components/BrandLogo';
import { Icon, type IconName } from '../components/Icon';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { ToastRegion } from '../components/Toasts';
import { ErrorState, Loading } from '../components/ui';
import { useRouteFocus } from '../lib/a11y';
import { ApiError, api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useSpecialtyNames } from '../lib/specialties';
import { LAST_ORG_KEY, branchKey, readStored, specialtyKey, writeStored } from '../lib/storage';
import type { Branch, OrgDetail, Permission } from '../lib/types';
import { OrgContext, orgKeys, useOrg, type OrgContextValue } from '../org/context';

export function AppShell() {
  const { orgId = '' } = useParams();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Cancel in-flight requests and drop every other organization's cached data, so none of it
  // can arrive late or render in this one.
  useEffect(() => {
    const otherOrg = (q: { queryKey: readonly unknown[] }) => q.queryKey[0] === 'org' && q.queryKey[1] !== orgId;
    void queryClient.cancelQueries({ predicate: otherOrg });
    queryClient.removeQueries({ predicate: otherOrg });
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
  const [storedSpecialty, setStoredSpecialty] = useState(() => readStored(specialtyKey(orgId)));

  const orgWide = detail.membership.branchScope.type === 'all';
  const activeBranches = branches.filter((b) => b.status === 'active');
  const storedIsValid = storedBranch === 'all' ? orgWide : activeBranches.some((b) => b.id === storedBranch);
  const selectedBranchId =
    storedBranch && storedIsValid ? storedBranch : orgWide ? 'all' : (activeBranches[0]?.id ?? '');

  // Specialty filter choices: the organization's specialties, limited to what the selected branch
  // offers. An option that no longer applies falls back to "all specialties".
  const specialties = detail.organization.specialtyCodes;
  const selectedBranch = activeBranches.find((b) => b.id === selectedBranchId);
  const specialtyOptions = useMemo(
    () => (selectedBranch ? specialties.filter((code) => selectedBranch.specialtyCodes.includes(code)) : specialties),
    [specialties, selectedBranch],
  );
  const selectedSpecialty = storedSpecialty && specialtyOptions.includes(storedSpecialty) ? storedSpecialty : 'all';

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
      timeZone: detail.organization.timeZone,
      specialties,
      specialtyOptions,
      selectedSpecialty,
      selectSpecialty: (code: string) => {
        setStoredSpecialty(code);
        writeStored(specialtyKey(orgId), code);
      },
    }),
    [orgId, detail, branches, selectedBranchId, specialties, specialtyOptions, selectedSpecialty],
  );

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]);

  // The mobile drawer behaves as a dialog: focus moves into it, the page behind is inert while it
  // is open, and focus returns to the menu button when it closes.
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (navOpen) closeButton.current?.focus();
    else if (wasOpen.current) menuButton.current?.focus();
    wasOpen.current = navOpen;
  }, [navOpen]);

  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  useRouteFocus(mainRef, location.pathname);

  // A doctor sees only their own schedule there; front desk and admins see every practitioner.
  const ownScheduleOnly = !value.can('appointment.book') && !value.can('practitioner.manage');
  type NavItem = { to: string; icon: IconName; label: string; end?: boolean };
  const worklistIcon = ({ dentistry: 'tooth', physiotherapy: 'activity', ent: 'ear' } as Record<string, IconName>)[value.detail.membership.practitionerSpecialty ?? ''];
  // Grouped by area; permissions alone decide which items appear, and empty groups are dropped.
  const navGroups: { key: string; items: NavItem[] }[] = [
    { key: 'start', items: [{ to: `/app/${orgId}`, icon: 'home', label: t('nav.home'), end: true }] },
    {
      key: 'daily',
      items: [
        ...(value.can('appointment.read') ? [{ to: `/app/${orgId}/appointments`, icon: 'calendar' as const, label: t('nav.appointments') }] : []),
        ...(value.can('queue.read') ? [{ to: `/app/${orgId}/queue`, icon: 'queue' as const, label: t('nav.queue') }] : []),
        ...(value.can('patient.list') ? [{ to: `/app/${orgId}/patients`, icon: 'patients' as const, label: t('nav.patients') }] : []),
        ...(value.can('practitioner.read')
          ? [{ to: `/app/${orgId}/practitioners`, icon: 'stethoscope' as const, label: ownScheduleOnly ? t('nav.mySchedule') : t('nav.practitioners') }]
          : []),
      ],
    },
    {
      key: 'records',
      items: [
        ...(value.can('finance.account.read') ? [{ to: `/app/${orgId}/finance`, icon: 'wallet' as const, label: t('nav.finance') }] : []),
        // The doctor's specialty worklist: open plans (dentistry), active courses (physiotherapy), follow-ups (ENT).
        ...(value.can('clinical.encounter.own') && worklistIcon
          ? [{ to: `/app/${orgId}/worklist`, icon: worklistIcon, label: t(`nav.worklist.${value.detail.membership.practitionerSpecialty}`) }]
          : []),
        ...(value.can('clinical.encounter.own') ? [{ to: `/app/${orgId}/coverage`, icon: 'share' as const, label: t('nav.coverage') }] : []),
        ...(value.can('clinical.audit.read') ? [{ to: `/app/${orgId}/clinical-audit`, icon: 'shield' as const, label: t('nav.clinicalAudit') }] : []),
      ],
    },
    {
      key: 'erp',
      items: [
        ...(value.can('accounting.read') || value.can('finance.report.read') || value.can('purchase.read') || value.can('cash.session.review')
          ? [{ to: `/app/${orgId}/reports`, icon: 'chart' as const, label: t('nav.reports') }]
          : []),
        ...(value.can('accounting.read') ? [{ to: `/app/${orgId}/accounting`, icon: 'book' as const, label: t('nav.accounting') }] : []),
        ...(value.can('cash.session.operate') ? [{ to: `/app/${orgId}/cash`, icon: 'cash' as const, label: t('nav.cash') }] : []),
        ...(value.can('inventory.read') ? [{ to: `/app/${orgId}/inventory`, icon: 'box' as const, label: t('nav.inventory') }] : []),
        // Purchasing in the menu for those who run it; anyone may still raise a request from the stock pages.
        ...(value.can('purchase.read') ? [{ to: `/app/${orgId}/purchasing`, icon: 'cart' as const, label: t('nav.purchasing') }] : []),
        ...(value.can('asset.manage') || value.can('asset.maintain') ? [{ to: `/app/${orgId}/assets`, icon: 'tool' as const, label: t('nav.assets') }] : []),
        ...(value.can('compensation.read') || value.can('compensation.own.read') ? [{ to: `/app/${orgId}/compensation`, icon: 'users' as const, label: t('nav.compensation') }] : []),
      ],
    },
    {
      key: 'organization',
      items: [
        { to: `/app/${orgId}/branches`, icon: 'building', label: t('nav.branches') },
        ...(value.can('member.read') ? [{ to: `/app/${orgId}/team`, icon: 'users' as const, label: t('nav.team') }] : []),
        ...(value.can('organization.update') ? [{ to: `/app/${orgId}/settings`, icon: 'settings' as const, label: t('nav.settings') }] : []),
        ...(value.can('subscription.read') ? [{ to: `/app/${orgId}/subscription`, icon: 'card' as const, label: t('nav.subscription') }] : []),
      ],
    },
    {
      key: 'account',
      items: [
        ...(value.can('support.request') ? [{ to: `/app/${orgId}/support`, icon: 'help' as const, label: t('nav.support') }] : []),
        { to: `/app/${orgId}/profile`, icon: 'user', label: t('nav.profile') },
      ],
    },
  ];

  return (
    <OrgContext.Provider value={value}>
      <div className={navOpen ? 'shell shell--nav-open' : 'shell'}>
        <a className="skip-link" href="#main-content">
          {t('shell.skipToContent')}
        </a>
        <aside
          className="sidebar"
          id="app-sidebar"
          {...(navOpen ? { role: 'dialog', 'aria-modal': true, 'aria-label': t('shell.navigation') } : {})}
        >
          <div className="sidebar-brand">
            <Link to={`/app/${orgId}`} className="sidebar-brand-link" onClick={() => setNavOpen(false)}>
              <BrandLogo variant="wordmark" />
            </Link>
            <button
              ref={closeButton}
              type="button"
              className="icon-button sidebar-close"
              onClick={() => setNavOpen(false)}
              aria-label={t('shell.closeMenu')}
            >
              <Icon name="close" />
            </button>
          </div>
          <nav aria-label={t('shell.navigation')}>
            {navGroups
              .filter((group) => group.items.length > 0)
              .map((group) => (
                <div key={group.key} className="nav-group">
                  {group.key !== 'start' && (
                    <p className="nav-group-title" id={`nav-group-${group.key}`}>
                      {t(`nav.groups.${group.key}`)}
                    </p>
                  )}
                  <ul className="nav-list" {...(group.key !== 'start' ? { 'aria-labelledby': `nav-group-${group.key}` } : {})}>
                    {group.items.map((item) => (
                      <li key={item.to}>
                        <NavLink to={item.to} end={item.end} className="nav-link" onClick={() => setNavOpen(false)}>
                          <Icon name={item.icon} />
                          <span>{item.label}</span>
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </nav>
        </aside>
        <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />

        <div className="shell-main" inert={navOpen}>
          <header className="topbar">
            <button
              ref={menuButton}
              type="button"
              className="icon-button menu-button"
              aria-controls="app-sidebar"
              aria-expanded={navOpen}
              aria-label={t('shell.openMenu')}
              onClick={() => setNavOpen(true)}
            >
              <Icon name="menu" />
            </button>
            <Link to={`/app/${orgId}`} className="topbar-brand">
              <BrandLogo variant="symbol" />
            </Link>
            <OrgSwitcher orgId={orgId} currentName={detail.organization.name} />
            <BranchSwitcher />
            <SpecialtySwitcher />
            <div className="topbar-end">
              <ThemeSwitcher />
              <LanguageSwitcher />
              <UserMenu orgId={orgId} />
            </div>
          </header>
          <main id="main-content" className="content" tabIndex={-1} ref={mainRef}>
            <Outlet />
          </main>
          <ToastRegion />
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
  // Nothing to choose: show the name, not a one-option list (UX-027).
  if (options.length === 1) {
    return (
      <div className="switcher switcher--static">
        <span className="switcher-label">{t('shell.organization')}</span>
        <bdi className="switcher-value" id="org-current">
          {currentName}
        </bdi>
      </div>
    );
  }
  return (
    <div className="switcher">
      <label htmlFor="org-switcher" className="switcher-label">
        {t('shell.organization')}
      </label>
      <select id="org-switcher" dir="auto" value={orgId} onChange={(e) => navigate(`/app/${e.target.value}`)}>
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
  if (active.length === 1 && detail.membership.branchScope.type !== 'all') {
    return (
      <div className="switcher switcher--static">
        <span className="switcher-label">{t('shell.branch')}</span>
        <bdi className="switcher-value" id="branch-current">
          {active[0]!.name}
        </bdi>
      </div>
    );
  }
  return (
    <div className="switcher">
      <label htmlFor="branch-switcher" className="switcher-label">
        {t('shell.branch')}
      </label>
      <select id="branch-switcher" dir="auto" value={selectedBranchId} onChange={(e) => selectBranch(e.target.value)}>
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

/** Offered when there is a choice. It filters the shared operational views; access stays as is. */
function SpecialtySwitcher() {
  const { t } = useTranslation();
  const specialties = useSpecialtyNames();
  const { specialtyOptions, selectedSpecialty, selectSpecialty } = useOrg();
  if (specialtyOptions.length < 2) return null;
  return (
    <div className="switcher">
      <label htmlFor="specialty-switcher" className="switcher-label">
        {t('specialtyContext.label')}
      </label>
      <select id="specialty-switcher" value={selectedSpecialty} onChange={(e) => selectSpecialty(e.target.value)}>
        <option value="all">{t('specialtyContext.all')}</option>
        {specialtyOptions.map((code) => (
          <option key={code} value={code}>
            {specialties.name(code)}
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
