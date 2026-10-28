import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useParams, useSearchParams } from 'react-router';
import { BrandLogo } from '../components/BrandLogo';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { Icon } from '../components/Icon';
import { Metric } from '../components/Metric';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { ToastRegion } from '../components/Toasts';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import { useFocusOnError } from '../lib/a11y';
import { errorMessage } from '../lib/errors';
import { moneyInput, parseMoney, toLatinDigits } from '../lib/finance';
import { useFormatters, zoneLabel } from '../lib/format';
import {
  OPERATOR_SESSION_KEY,
  opApi,
  opKeys,
  planName,
  setOperatorCsrf,
  type BillingPolicy,
  type OperatorSession,
  type Plan,
  type PlanLimits,
  type PlanPrice,
  type Subscription,
  type Usage,
} from '../lib/operator';
import { useSpecialtyNames } from '../lib/specialties';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { PriceText, SubscriptionStatusBadge } from '../components/subscription';
import { SupportConversation, SupportStatusBadge, type SupportDetail } from '../components/support';

// The platform operator console (/operator). Separate sign-in, separate session; shows
// organizations' metadata, plans, subscriptions, inquiries, operators and the platform audit —
// never patients, appointments, clinical records or clinic finances, and no impersonation.

const OperatorContext = createContext<OperatorSession | null>(null);
const useOperator = () => {
  const value = useContext(OperatorContext);
  if (!value) throw new Error('OperatorContext missing');
  return { ...value, can: (permission: string) => value.permissions.includes(permission) };
};

/** "from → to" pointing the reading direction: ← in Arabic (right to left), → in English. */
function useArrow() {
  const { i18n } = useTranslation();
  return i18n.dir(i18n.resolvedLanguage) === 'rtl' ? '←' : '→';
}

async function fetchOperatorSession(): Promise<OperatorSession | null> {
  const res = await opApi<{ operator: OperatorSession | null; csrfToken?: string }>('/auth/session');
  setOperatorCsrf(res.operator ? (res.csrfToken ?? null) : null);
  return res.operator;
}

export function OperatorRoot() {
  const { t } = useTranslation();
  const session = useQuery({ queryKey: OPERATOR_SESSION_KEY, queryFn: fetchOperatorSession, staleTime: 30_000, retry: false });
  if (session.isPending) return <Loading />;
  if (session.isError) return <ErrorState message={errorMessage(t, session.error)} onRetry={() => void session.refetch()} />;
  if (!session.data) return <OperatorLogin />;
  return (
    <OperatorContext.Provider value={session.data}>
      <OperatorLayout>
        <Outlet />
      </OperatorLayout>
    </OperatorContext.Provider>
  );
}

function OperatorShellFrame({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="public-layout operator-layout">
      <a className="skip-link" href="#main-content">
        {t('shell.skipToContent')}
      </a>
      <header className="public-header operator-header">
        <span className="operator-brand">
          <BrandLogo variant="wordmark" />
          <span className="badge badge--operator">{t('operator.consoleLabel')}</span>
        </span>
        <div className="public-header-actions operator-header-actions">
          {actions}
          <ThemeSwitcher />
          <LanguageSwitcher />
        </div>
      </header>
      <main id="main-content" className="public-main operator-main" tabIndex={-1}>
        {children}
      </main>
      <ToastRegion />
      <footer className="app-footer">{t('operator.footer')}</footer>
    </div>
  );
}

function OperatorLogin() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  useDocumentTitle(t('operator.loginTitle'));
  const login = useMutation({
    mutationFn: () => opApi<{ operator: OperatorSession; csrfToken: string }>('/auth/login', { method: 'POST', body: { email, password } }),
    onSuccess: (res) => {
      setOperatorCsrf(res.csrfToken);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] === 'operator' && q.queryKey[1] !== 'session' });
      queryClient.setQueryData(OPERATOR_SESSION_KEY, res.operator);
    },
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate();
  };
  return (
    <OperatorShellFrame>
      <section className="card auth-card" aria-labelledby="operator-login-title">
        <h1 id="operator-login-title">{t('operator.loginTitle')}</h1>
        <p className="muted">{t('operator.loginSubtitle')}</p>
        {login.isError && <Notice kind="error">{errorMessage(t, login.error)}</Notice>}
        <form onSubmit={onSubmit} noValidate>
          <Field id="operator-email" label={t('auth.email')}>
            <input
              id="operator-email"
              type="email"
              autoComplete="username"
              dir="ltr"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field id="operator-password" label={t('auth.password')}>
            <input
              id="operator-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <button type="submit" className="button button--primary button--block" disabled={login.isPending}>
            {login.isPending ? t('auth.submittingLogin') : t('auth.submitLogin')}
          </button>
        </form>
        <p className="muted small">{t('operator.noRegistration')}</p>
      </section>
    </OperatorShellFrame>
  );
}

function OperatorLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const operator = useOperator();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: () => opApi<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      setOperatorCsrf(null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] === 'operator' && q.queryKey[1] !== 'session' });
      queryClient.setQueryData(OPERATOR_SESSION_KEY, null);
    },
  });
  // The development mail sink is linked only where it exists (never in production).
  const overview = useQuery({
    queryKey: opKeys.overview,
    queryFn: ({ signal }) => opApi<Overview>('/overview', { signal }),
    // Shared with the overview page: one request, not one per component that mounts.
    staleTime: 30_000,
    enabled: operator.can('platform.audit.read'),
  });
  const devMail = overview.data?.config.mailProvider === 'dev_sink';
  const nav = [
    { to: '/operator', label: t('operator.nav.overview'), end: true },
    { to: '/operator/organizations', label: t('operator.nav.organizations') },
    { to: '/operator/plans', label: t('operator.nav.plans') },
    { to: '/operator/inquiries', label: t('operator.nav.inquiries') },
    { to: '/operator/contact-messages', label: t('operator.nav.contactMessages') },
    { to: '/operator/support', label: t('operator.nav.support') },
    ...(operator.can('platform.operators.read') ? [{ to: '/operator/operators', label: t('operator.nav.operators') }] : []),
    ...(operator.can('platform.audit.read') ? [{ to: '/operator/audit', label: t('operator.nav.audit') }] : []),
    ...(devMail ? [{ to: '/operator/dev-mail', label: t('operator.nav.devMail') }] : []),
  ];
  return (
    <OperatorShellFrame
      actions={
        <>
          <span className="small operator-user">
            {operator.displayName} · {t(`operator.roles.${operator.role}`)}
          </span>
          <button type="button" className="button button--ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
            {t('shell.logout')}
          </button>
        </>
      }
    >
      <nav aria-label={t('operator.navLabel')} className="operator-nav">
        {nav.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
            {item.label}
          </NavLink>
        ))}
      </nav>
      {children}
    </OperatorShellFrame>
  );
}

// --- Overview --------------------------------------------------------------------------------

type Overview = {
  organizations: number;
  subscriptions: { byStatus: Record<string, number>; byKind: Record<string, number> };
  inquiries: { new: number };
  contactMessages?: { new: number };
  health: { database: { status: 'up' | 'down'; latencyMs: number | null }; uptimeSeconds: number };
  config: {
    billingProvider: 'none' | 'simulator';
    subscriptionEnforcement: 'off' | 'log' | 'on';
    operatorIdleMinutes: number;
    mailProvider?: 'none' | 'dev_sink';
    sessionIdleMinutes?: number;
  };
  support?: { open: number };
};
type Drift = { organizationId: string; action: string; applied: boolean; local: { status: string }; provider: { status: string } | null };

export function OperatorOverviewPage() {
  const { t } = useTranslation();
  const operator = useOperator();
  const fmt = useFormatters();
  useDocumentTitle(t('operator.nav.overview'));
  const overview = useQuery({ queryKey: opKeys.overview, queryFn: ({ signal }) => opApi<Overview>('/overview', { signal }), staleTime: 30_000 });
  const arrow = useArrow();
  const [drifts, setDrifts] = useState<Drift[] | null>(null);
  const reconcile = useMutation({
    mutationFn: (apply: boolean) => opApi<{ drifts: Drift[] }>('/billing/reconcile', { method: 'POST', body: { apply } }),
    onSuccess: (res) => setDrifts(res.drifts),
  });
  if (overview.isPending) return <Loading />;
  if (overview.isError) return <ErrorState message={errorMessage(t, overview.error)} onRetry={() => void overview.refetch()} />;
  const o = overview.data;
  return (
    <>
      <PageHeader title={t('operator.nav.overview')} />
      <Notice kind="info">{t('operator.privacyRule')}</Notice>
      {/* What waits for an operator first, each card opening its list; then the platform at a glance (UX-045). */}
      <section className="card op-metrics" aria-labelledby="op-action-title">
        <h2 id="op-action-title" className="card-title">
          <Icon name="alert" /> {t('operator.overview.needsAction')}
        </h2>
        <dl className="metrics metrics--four">
          <Metric
            icon="file"
            tone="warn"
            label={t('operator.overview.newInquiries')}
            value={o.inquiries.new}
            to="/operator/inquiries"
            linkLabel={t('operator.overview.openList', { label: t('operator.overview.newInquiries') })}
            testId="op-new-inquiries"
          />
          <Metric
            icon="message"
            tone="warn"
            label={t('operator.overview.newContact')}
            value={o.contactMessages?.new ?? 0}
            to="/operator/contact-messages"
            linkLabel={t('operator.overview.openList', { label: t('operator.overview.newContact') })}
          />
          <Metric
            icon="help"
            tone="info"
            label={t('operator.overview.openSupport')}
            value={o.support?.open ?? 0}
            to="/operator/support"
            linkLabel={t('operator.overview.openList', { label: t('operator.overview.openSupport') })}
          />
          <Metric
            icon="card"
            tone="bad"
            label={t('subscription.status.past_due')}
            value={o.subscriptions.byStatus.past_due ?? 0}
            to="/operator/organizations"
            linkLabel={t('operator.overview.openList', { label: t('subscription.status.past_due') })}
          />
        </dl>
      </section>
      <section className="card op-metrics" aria-labelledby="op-status-title">
        <h2 id="op-status-title" className="card-title">
          <Icon name="chart" /> {t('operator.overview.platformStatus')}
        </h2>
        <dl className="metrics metrics--six">
          <Metric icon="building" tone="brand" label={t('operator.overview.organizations')} value={o.organizations} to="/operator/organizations" testId="op-organizations" />
          <Metric icon="checkCircle" tone="ok" label={t('subscription.status.active')} value={o.subscriptions.byStatus.active ?? 0} />
          <Metric icon="lock" tone="warn" label={t('subscription.status.restricted')} value={o.subscriptions.byStatus.restricted ?? 0} />
          <Metric icon="clock" tone="muted" label={t('subscription.status.expired')} value={o.subscriptions.byStatus.expired ?? 0} />
          <Metric icon="ban" tone="muted" label={t('subscription.status.canceled')} value={o.subscriptions.byStatus.canceled ?? 0} />
          <Metric icon="layers" tone="neutral" label={t('subscription.status.none')} value={o.subscriptions.byStatus.none ?? 0} />
        </dl>
      </section>
      <div className="card-grid card-grid--wide">
        <section className="card" aria-labelledby="op-health-title">
          <h2 id="op-health-title">{t('operator.overview.health')}</h2>
          <dl className="details">
            <dt>{t('operator.overview.database')}</dt>
            <dd>
              <span className={`badge badge--${o.health.database.status === 'up' ? 'connected' : 'unreachable'}`}>
                {t(`operator.overview.db.${o.health.database.status}`)}
              </span>
              {o.health.database.latencyMs !== null && (
                <span className="muted small"> {t('operator.overview.latency', { ms: fmt.number(o.health.database.latencyMs) })}</span>
              )}
            </dd>
            <dt>{t('operator.overview.billingProvider')}</dt>
            <dd>{t(`operator.overview.provider.${o.config.billingProvider}`)}</dd>
            <dt>{t('operator.overview.enforcement')}</dt>
            <dd>{t(`subscription.enforcement.${o.config.subscriptionEnforcement}`)}</dd>
            <dt>{t('operator.overview.idle')}</dt>
            <dd>{t('operator.overview.idleMinutes', { count: o.config.operatorIdleMinutes })}</dd>
          </dl>
        </section>
        {operator.can('platform.subscriptions.manage') && o.config.billingProvider !== 'none' && (
          <section className="card" aria-labelledby="op-reconcile-title">
            <h2 id="op-reconcile-title">{t('operator.reconcile.title')}</h2>
            <p className="muted small">{t('operator.reconcile.hint')}</p>
            {reconcile.isError && <Notice kind="error">{errorMessage(t, reconcile.error)}</Notice>}
            <div className="form-actions">
              <button
                type="button"
                className="button button--primary"
                disabled={reconcile.isPending}
                onClick={() => reconcile.mutate(false)}
              >
                {t('operator.reconcile.dryRun')}
              </button>
              <button
                type="button"
                className="button button--secondary"
                disabled={reconcile.isPending || !drifts?.length}
                onClick={() => reconcile.mutate(true)}
              >
                {t('operator.reconcile.apply')}
              </button>
            </div>
            {drifts &&
              (drifts.length === 0 ? (
                <p data-testid="reconcile-result">{t('operator.reconcile.none')}</p>
              ) : (
                <ul className="data-list" data-testid="reconcile-result">
                  {drifts.map((d) => (
                    <li key={d.organizationId} className="data-row">
                      <Link to={`/operator/organizations/${d.organizationId}`}>{d.organizationId.slice(-6)}</Link>
                      <span className="data-meta">
                        {t(`operator.reconcile.action.${d.action}`)}: {d.local.status} {arrow} {d.provider?.status ?? '—'} ·{' '}
                        {d.applied ? t('operator.reconcile.applied') : t('operator.reconcile.notApplied')}
                      </span>
                    </li>
                  ))}
                </ul>
              ))}
          </section>
        )}
        {operator.can('platform.plans.read') && <PolicyCard canEdit={operator.can('platform.subscriptions.manage')} />}
        {operator.can('platform.subscriptions.manage') && <LifecycleCard />}
      </div>
    </>
  );
}

/** Billing policy: unset by default; values are commercial decisions (B4), recorded with an audit entry. */
function PolicyCard({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const policy = useQuery({ queryKey: ['operator', 'policy'], queryFn: ({ signal }) => opApi<{ policy: BillingPolicy }>('/billing/policy', { signal }) });
  const [draft, setDraft] = useState<{ graceDays: string; afterGrace: BillingPolicy['afterGrace']; restrictedAccess: BillingPolicy['restrictedAccess'] } | null>(null);
  const save = useMutation({
    mutationFn: (body: object) => opApi<{ policy: BillingPolicy }>('/billing/policy', { method: 'PUT', body }),
    onSuccess: (data) => {
      queryClient.setQueryData(['operator', 'policy'], data);
      setDraft(null);
    },
  });
  if (!policy.data) return null;
  const p = policy.data.policy;
  return (
    <section className="card" aria-labelledby="op-policy-title" data-testid="billing-policy">
      <h2 id="op-policy-title">{t('operator.policy.title')}</h2>
      <p className="muted small">{t('operator.policy.hint')}</p>
      {save.isError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
      {!draft ? (
        <>
          <dl className="details">
            <dt>{t('operator.policy.graceDays')}</dt>
            <dd>{p.graceDays === null ? t('operator.policy.notSet') : t('operator.policy.days', { count: p.graceDays })}</dd>
            <dt>{t('operator.policy.afterGrace')}</dt>
            <dd>{t(`operator.policy.after.${p.afterGrace}`)}</dd>
            <dt>{t('operator.policy.restrictedAccess')}</dt>
            <dd>{t(`operator.policy.access.${p.restrictedAccess}`)}</dd>
          </dl>
          {canEdit && (
            <button type="button" className="button button--secondary" onClick={() => setDraft({ graceDays: p.graceDays?.toString() ?? '', afterGrace: p.afterGrace, restrictedAccess: p.restrictedAccess })}>
              {t('operator.policy.edit')}
            </button>
          )}
        </>
      ) : (
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ graceDays: draft.graceDays.trim() === '' ? null : Number(draft.graceDays), afterGrace: draft.afterGrace, restrictedAccess: draft.restrictedAccess, revision: p.revision ?? 0 });
          }}
        >
          <Field id="policy-grace" label={t('operator.policy.graceDays')} hint={t('operator.policy.graceHint')}>
            <input id="policy-grace" inputMode="numeric" dir="ltr" value={draft.graceDays} onChange={(e) => setDraft({ ...draft, graceDays: e.target.value })} />
          </Field>
          <Field id="policy-after" label={t('operator.policy.afterGrace')}>
            <select id="policy-after" value={draft.afterGrace} onChange={(e) => setDraft({ ...draft, afterGrace: e.target.value as BillingPolicy['afterGrace'] })}>
              <option value="none">{t('operator.policy.after.none')}</option>
              <option value="restricted">{t('operator.policy.after.restricted')}</option>
            </select>
          </Field>
          <Field id="policy-access" label={t('operator.policy.restrictedAccess')} hint={t('operator.policy.accessHint')}>
            <select id="policy-access" value={draft.restrictedAccess} onChange={(e) => setDraft({ ...draft, restrictedAccess: e.target.value as BillingPolicy['restrictedAccess'] })}>
              <option value="growth_only">{t('operator.policy.access.growth_only')}</option>
              <option value="read_only">{t('operator.policy.access.read_only')}</option>
            </select>
          </Field>
          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={save.isPending}>
              {t('common.save')}
            </button>
            <button type="button" className="button button--ghost" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

type LifecycleAction = { organizationId: string; from: string; to: string | null; reason: string; applied: boolean; conflict?: boolean };

/** The lifecycle pass (trials and grants that ended, grace periods): dry run first, then apply. */
function LifecycleCard() {
  const { t } = useTranslation();
  const [actions, setActions] = useState<LifecycleAction[] | null>(null);
  const arrow = useArrow();
  const run = useMutation({
    mutationFn: (apply: boolean) => opApi<{ actions: LifecycleAction[] }>('/billing/lifecycle', { method: 'POST', body: { apply } }),
    onSuccess: (r) => setActions(r.actions),
  });
  return (
    <section className="card" aria-labelledby="op-lifecycle-title">
      <h2 id="op-lifecycle-title">{t('operator.lifecycle.title')}</h2>
      <p className="muted small">{t('operator.lifecycle.hint')}</p>
      {run.isError && <Notice kind="error">{errorMessage(t, run.error)}</Notice>}
      <div className="form-actions">
        <button type="button" className="button button--primary" disabled={run.isPending} onClick={() => run.mutate(false)}>
          {t('operator.lifecycle.dryRun')}
        </button>
        <button type="button" className="button button--secondary" disabled={run.isPending || !actions?.some((a) => a.to)} onClick={() => run.mutate(true)}>
          {t('operator.lifecycle.apply')}
        </button>
      </div>
      {actions &&
        (actions.length === 0 ? (
          <p data-testid="lifecycle-result">{t('operator.lifecycle.none')}</p>
        ) : (
          <ul className="data-list" data-testid="lifecycle-result">
            {actions.map((a) => (
              <li key={`${a.organizationId}-${a.reason}`} className="data-row">
                <Link to={`/operator/organizations/${a.organizationId}`}>{a.organizationId.slice(-6)}</Link>
                <span className="data-meta">
                  {t(`operator.lifecycle.reason.${a.reason}`)}: {t(`subscription.status.${a.from}`)} {arrow} {a.to ? t(`subscription.status.${a.to}`) : t('operator.lifecycle.providerDecides')} ·{' '}
                  {a.applied ? t('operator.reconcile.applied') : a.conflict ? t('operator.lifecycle.conflict') : t('operator.reconcile.notApplied')}
                </span>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

// --- Organizations ---------------------------------------------------------------------------

type OrgRow = {
  id: string;
  name: string;
  type: string | null;
  createdAt: string;
  subscription: { kind: string; status: string; effectiveStatus: string; plan: string } | null;
};

export function OperatorOrganizationsPage() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  useDocumentTitle(t('operator.nav.organizations'));
  const list = useQuery({
    queryKey: opKeys.organizations(q),
    queryFn: ({ signal }) => opApi<{ data: OrgRow[] }>(`/organizations${q ? `?q=${encodeURIComponent(q)}` : ''}`, { signal }),
  });
  return (
    <>
      <PageHeader title={t('operator.nav.organizations')} subtitle={t('operator.organizations.subtitle')} />
      <form
        className="search-row"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(text.trim() ? { q: text.trim() } : {});
        }}
      >
        <label htmlFor="op-org-search" className="visually-hidden">
          {t('operator.organizations.search')}
        </label>
        <input
          id="op-org-search"
          type="search"
          dir="auto"
          value={text}
          placeholder={t('operator.organizations.search')}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="button button--secondary">
          {t('operator.organizations.searchButton')}
        </button>
      </form>
      {list.isPending && <Loading />}
      {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} />}
      {list.isSuccess && list.data.data.length === 0 && (
        <EmptyState icon="building">
          {q ? (
            <>
              {t('operator.organizations.noMatches', { q })}{' '}
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setText('');
                  setParams({});
                }}
              >
                {t('operator.organizations.clearSearch')}
              </button>
            </>
          ) : (
            t('operator.organizations.none')
          )}
        </EmptyState>
      )}
      {list.isSuccess && list.data.data.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('operator.organizations.name')}</th>
                <th>{t('operator.organizations.created')}</th>
                <th>{t('operator.organizations.type')}</th>
                <th>{t('operator.organizations.subscriptionKind')}</th>
                <th>{t('subscription.statusLabel')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.data.map((o) => (
                <tr key={o.id}>
                  <td data-label={t('operator.organizations.name')}>
                    <span>
                      <Link to={`/operator/organizations/${o.id}`}>{o.name}</Link>{' '}
                      {/* Same-named organizations are told apart by the end of their id. */}
                      <bdi className="muted small" title={o.id}>
                        {o.id.slice(-6)}
                      </bdi>
                    </span>
                  </td>
                  <td data-label={t('operator.organizations.created')}>{fmt.date(o.createdAt)}</td>
                  <td data-label={t('operator.organizations.type')}>{o.type ? t(`onboarding.types.${o.type}.title`, { defaultValue: o.type }) : '—'}</td>
                  <td data-label={t('operator.organizations.subscriptionKind')}>{o.subscription ? t(`subscription.kind.${o.subscription.kind}`) : '—'}</td>
                  <td data-label={t('subscription.statusLabel')}>
                    <SubscriptionStatusBadge status={o.subscription?.effectiveStatus ?? 'none'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

type OrgDetail = {
  organization: {
    id: string;
    name: string;
    type: string | null;
    specialtyCodes: string[];
    timeZone: string | null;
    currency: string | null;
    createdAt: string;
    branches: { id: string; name: string; status: string }[];
    owners: { displayName: string; email: string }[];
  };
  usage: Usage;
  subscription: Subscription | null;
  history: {
    at: string;
    from: string | null;
    to: string;
    kind: string;
    planCode: string;
    planVersion: number;
    actor: string;
    reason: string;
  }[];
  billingEvents: { id: string; type: string; outcome: string; detail: string; occurredAt: string; receivedAt: string }[];
};

export function OperatorOrganizationPage() {
  const { t, i18n } = useTranslation();
  const { orgId = '' } = useParams();
  const operator = useOperator();
  const fmt = useFormatters();
  const specialtyNames = useSpecialtyNames();
  const arrow = useArrow();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: opKeys.organization(orgId),
    queryFn: ({ signal }) => opApi<OrgDetail>(`/organizations/${orgId}`, { signal }),
  });
  const plans = useQuery({
    queryKey: opKeys.plans,
    queryFn: ({ signal }) => opApi<{ data: Plan[] }>('/plans', { signal }),
    enabled: operator.can('platform.subscriptions.manage'),
  });
  useDocumentTitle(detail.data?.organization.name ?? t('operator.nav.organizations'));
  const refresh = () => queryClient.invalidateQueries({ queryKey: opKeys.organization(orgId) });
  const [grant, setGrant] = useState({ planId: '', endsAt: '', note: '' });
  const [reason, setReason] = useState('');
  const [planChange, setPlanChange] = useState('');
  const [emit, setEmit] = useState(true);
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body: object }) => opApi<unknown>(path, { method: 'POST', body }),
    onSuccess: async () => {
      setReason('');
      await refresh();
    },
  });
  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorState message={errorMessage(t, detail.error)} onRetry={() => void detail.refetch()} />;
  const { organization: org, usage, subscription: sub, history, billingEvents } = detail.data;
  const manage = operator.can('platform.subscriptions.manage');
  const activePlans = plans.data?.data.filter((p) => p.status === 'active') ?? [];
  /** A history entry's plan by name when the plan list is available, otherwise by code. */
  const historyPlan = (code: string, version: number) => {
    const plan = plans.data?.data.find((p) => p.code === code && p.version === version);
    return plan ? `${planName(plan, i18n.resolvedLanguage ?? 'ar')} v${version}` : `${code} v${version}`;
  };
  const statusAction = (name: 'restrict' | 'reinstate' | 'cancel') =>
    action.mutate({ path: `/organizations/${orgId}/subscription/${name}`, body: { reason, version: sub?.version ?? 0 } });
  return (
    <>
      <PageHeader title={org.name} subtitle={t('operator.organization.metadataOnly')} />
      <p className="muted small">
        <Link to="/operator/organizations">{t('operator.organization.back')}</Link>
      </p>
      {action.isError && <Notice kind="error">{errorMessage(t, action.error)}</Notice>}
      <div className="card-grid card-grid--wide">
        <section className="card" aria-labelledby="op-org-meta">
          <h2 id="op-org-meta">{t('operator.organization.metadata')}</h2>
          <dl className="details">
            <dt>{t('operator.organizations.created')}</dt>
            <dd>{fmt.date(org.createdAt)}</dd>
            <dt>{t('operator.organization.timeZone')}</dt>
            <dd>{org.timeZone ? zoneLabel(t, org.timeZone) : '—'}</dd>
            <dt>{t('operator.organization.specialties')}</dt>
            <dd>
              {org.specialtyCodes.length ? fmt.list(org.specialtyCodes.map((c) => specialtyNames.name(c))) : '—'}
            </dd>
            <dt>{t('operator.organization.branches')}</dt>
            <dd>{org.branches.map((b) => b.name).join('، ') || '—'}</dd>
            <dt>{t('operator.organization.owners')}</dt>
            <dd>
              {org.owners.map((o) => (
                <span key={o.email} className="block">
                  {o.displayName}{' '}
                  <span dir="ltr" className="muted small">
                    {o.email}
                  </span>
                </span>
              ))}
            </dd>
            <dt>{t('subscription.usage')}</dt>
            <dd>
              {(['branches', 'practitioners', 'members'] as const)
                .map((r) => `${t(`subscription.resource.${r}`)}: ${fmt.number(usage[r])}`)
                .join(t('common.separator'))}
            </dd>
          </dl>
        </section>
        <section className="card" aria-labelledby="op-org-sub" data-testid="operator-subscription">
          <h2 id="op-org-sub">{t('subscription.current')}</h2>
          {!sub ? (
            <EmptyState icon="card">{t('operator.organization.noSubscription')}</EmptyState>
          ) : (
            <dl className="details">
              <dt>{t('subscription.kindLabel')}</dt>
              <dd>{t(`subscription.kind.${sub.kind}`)}</dd>
              <dt>{t('subscription.statusLabel')}</dt>
              <dd>
                <SubscriptionStatusBadge status={sub.effectiveStatus} />
              </dd>
              <dt>{t('subscription.plan')}</dt>
              <dd>
                {planName(sub.plan, i18n.resolvedLanguage ?? 'ar')} v{sub.plan.version}
              </dd>
              <dt>{sub.kind === 'commercial' ? t('subscription.paidThrough') : t('subscription.endsAt')}</dt>
              <dd>{sub.currentPeriodEnd ? fmt.date(sub.currentPeriodEnd) : t('subscription.noEnd')}</dd>
              {sub.price && (
                <>
                  <dt>{t('subscription.price')}</dt>
                  <dd>
                    <PriceText price={sub.price} />
                  </dd>
                </>
              )}
            </dl>
          )}
          {manage && sub && sub.status !== 'canceled' && (
            <div className="stack-sm operator-actions">
              <h3>{t('operator.organization.actionsTitle')}</h3>
              <Field id="op-reason" label={t('operator.organization.reason')} hint={t('operator.organization.reasonHint')} required>
                <input
                  id="op-reason"
                  value={reason}
                  maxLength={200}
                  aria-required="true"
                  aria-describedby="op-reason-hint"
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <div className="form-actions">
                {sub.status !== 'restricted' && (
                  <button
                    type="button"
                    className="button button--secondary"
                    disabled={action.isPending || reason.trim().length < 3}
                    onClick={() => statusAction('restrict')}
                  >
                    {t('operator.organization.restrict')}
                  </button>
                )}
                {sub.status === 'restricted' && (
                  <button
                    type="button"
                    className="button button--secondary"
                    disabled={action.isPending || reason.trim().length < 3}
                    onClick={() => statusAction('reinstate')}
                  >
                    {t('operator.organization.reinstate')}
                  </button>
                )}
                <button
                  type="button"
                  className="button button--danger"
                  disabled={action.isPending || reason.trim().length < 3}
                  onClick={() => statusAction('cancel')}
                >
                  {t('operator.organization.cancel')}
                </button>
              </div>
              <p className="muted small">{t('operator.organization.restrictHint')}</p>
            </div>
          )}
          {sub && (sub.status === 'trialing' || sub.pendingChange || sub.cancelRequest) && (
            <dl className="details" data-testid="operator-lifecycle">
              {sub.status === 'trialing' && sub.trialEndsAt && (
                <>
                  <dt>{t('subscription.trial.endsLabel')}</dt>
                  <dd>{fmt.date(sub.trialEndsAt)}</dd>
                </>
              )}
              {sub.pendingChange && (
                <>
                  <dt>{t('subscription.change.pendingLabel')}</dt>
                  <dd>
                    {t('subscription.change.pending', { plan: sub.pendingChange.plan.code, date: fmt.date(sub.pendingChange.effectiveAt) })} ·{' '}
                    {sub.pendingChange.providerAcknowledged ? t('subscription.intent.acknowledged') : t('subscription.intent.local')}
                  </dd>
                </>
              )}
              {sub.cancelRequest && (
                <>
                  <dt>{t('subscription.cancel.pendingLabel')}</dt>
                  <dd>
                    {t('subscription.cancel.pending', { date: sub.currentPeriodEnd ? fmt.date(sub.currentPeriodEnd) : '—' })} ·{' '}
                    {sub.cancelRequest.providerAcknowledged ? t('subscription.intent.acknowledged') : t('subscription.intent.local')}
                  </dd>
                </>
              )}
            </dl>
          )}
          {manage && sub && sub.kind === 'development_grant' && !['canceled', 'expired'].includes(sub.status) && (
            <form
              className="stack-sm"
              onSubmit={(e) => {
                e.preventDefault();
                action.mutate({ path: `/organizations/${orgId}/subscription/plan`, body: { planId: planChange, version: sub.version, reason } });
              }}
            >
              <h3>{t('operator.organization.changePlanTitle')}</h3>
              <Field id="op-change-plan" label={t('subscription.plan')} hint={t('operator.organization.changePlanHint')}>
                <select id="op-change-plan" value={planChange} onChange={(e) => setPlanChange(e.target.value)}>
                  <option value="">{t('operator.organization.choosePlan')}</option>
                  {activePlans
                    .filter((p) => p.id !== sub.plan.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {planName(p, i18n.resolvedLanguage ?? 'ar')} v{p.version}
                      </option>
                    ))}
                </select>
              </Field>
              <button type="submit" className="button button--secondary" disabled={action.isPending || !planChange || reason.trim().length < 3}>
                {t('operator.organization.changePlan')}
              </button>
            </form>
          )}
          {manage && (!sub || sub.status === 'canceled' || sub.status === 'expired') && (
            <form
              className="stack-sm"
              onSubmit={(e) => {
                e.preventDefault();
                action.mutate({
                  path: `/organizations/${orgId}/subscription/grant`,
                  body: { planId: grant.planId, endsAt: grant.endsAt || null, note: grant.note },
                });
              }}
            >
              <h3>{t('operator.organization.grantTitle')}</h3>
              <p className="muted small">{t('operator.organization.grantHint')}</p>
              <Field id="op-grant-plan" label={t('subscription.plan')}>
                <select id="op-grant-plan" value={grant.planId} onChange={(e) => setGrant({ ...grant, planId: e.target.value })} required>
                  <option value="">{t('operator.organization.choosePlan')}</option>
                  {activePlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {planName(p, i18n.resolvedLanguage ?? 'ar')} v{p.version}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="op-grant-end" label={t('operator.organization.grantEnd')} hint={t('operator.organization.grantEndHint')}>
                <input
                  id="op-grant-end"
                  type="date"
                  value={grant.endsAt}
                  onChange={(e) => setGrant({ ...grant, endsAt: e.target.value })}
                />
              </Field>
              <Field id="op-grant-note" label={t('operator.organization.grantNote')}>
                <input
                  id="op-grant-note"
                  value={grant.note}
                  maxLength={200}
                  onChange={(e) => setGrant({ ...grant, note: e.target.value })}
                  required
                />
              </Field>
              <button
                type="submit"
                className="button button--primary"
                disabled={action.isPending || !grant.planId || grant.note.trim().length < 3}
              >
                {t('operator.organization.grant')}
              </button>
              {!sub?.trialUsed && (
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={action.isPending || !grant.planId || !grant.endsAt}
                  onClick={() => action.mutate({ path: `/organizations/${orgId}/subscription/trial`, body: { planId: grant.planId, endsAt: grant.endsAt } })}
                >
                  {t('operator.organization.startTrial')}
                </button>
              )}
            </form>
          )}
          {manage && sub?.provider === 'simulator' && sub.status !== 'canceled' && (
            <div className="stack-sm">
              <h3>{t('operator.simulator.title')}</h3>
              <p className="muted small">{t('operator.simulator.hint')}</p>
              <label className="choice">
                <input type="checkbox" checked={emit} onChange={(e) => setEmit(e.target.checked)} /> {t('operator.simulator.emit')}
              </label>
              <div className="form-actions">
                {(['renew', 'fail_payment', 'cancel'] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    className="button button--secondary"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ path: `/simulator/organizations/${orgId}/${a}`, body: { emit } })}
                  >
                    {t(`operator.simulator.${a}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
      <div className="card-grid card-grid--wide">
        <section className="card" aria-labelledby="op-org-history">
          <h2 id="op-org-history">{t('operator.organization.history')}</h2>
          {history.length === 0 ? (
            <EmptyState icon="file">{t('operator.organization.noHistory')}</EmptyState>
          ) : (
            <ol className="timeline">
              {history.map((h, i) => (
                <li key={i} className="timeline-item">
                  <div className="timeline-head">
                    <span>{fmt.date(h.at)}</span>
                    <span className="muted small">{t(`operator.actor.${h.actor}`)}</span>
                  </div>
                  <p className="small">
                    {h.from ? t(`subscription.status.${h.from}`) : '—'} {arrow} {t(`subscription.status.${h.to}`)} ·{' '}
                    {t(`subscription.kind.${h.kind}`)} · <bdi>{historyPlan(h.planCode, h.planVersion)}</bdi>
                  </p>
                  {h.reason && (
                    <p className="muted small" dir="auto">
                      {h.reason}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="card" aria-labelledby="op-org-events">
          <h2 id="op-org-events">{t('operator.organization.events')}</h2>
          {billingEvents.length === 0 ? (
            <EmptyState icon="file">{t('operator.organization.noEvents')}</EmptyState>
          ) : (
            <ul className="data-list">
              {billingEvents.map((e) => (
                <li key={e.id} className="data-row">
                  <span className="data-main" dir="ltr">
                    {e.type}
                  </span>
                  <span className="data-meta">
                    {t(`operator.outcome.${e.outcome}`)} · {fmt.date(e.receivedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

// --- Plans -----------------------------------------------------------------------------------

type PlanDraft = {
  code: string;
  nameAr: string;
  nameEn: string;
  prices: { currency: 'EGP' | 'SAR'; interval: 'month' | 'year'; amount: string }[];
  limits: Record<keyof PlanLimits, string>;
  note: string;
  trialDays: string;
};
const emptyDraft: PlanDraft = {
  code: '',
  nameAr: '',
  nameEn: '',
  prices: [],
  limits: { branches: '', practitioners: '', members: '' },
  note: '',
  trialDays: '',
};
const toDraft = (p: Plan): PlanDraft => ({
  code: p.code,
  nameAr: p.name.ar,
  nameEn: p.name.en,
  prices: p.prices.map((x) => ({ currency: x.currency, interval: x.interval, amount: moneyInput(x.amountMinor) })),
  limits: {
    branches: p.limits.branches?.toString() ?? '',
    practitioners: p.limits.practitioners?.toString() ?? '',
    members: p.limits.members?.toString() ?? '',
  },
  note: p.note ?? '',
  trialDays: p.trialDays?.toString() ?? '',
});

function PlanForm({ initial, plan, onDone }: { initial: PlanDraft; plan?: Plan; onDone: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [d, setD] = useState(initial);
  const [localError, setLocalError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const save = useMutation({
    mutationFn: (body: object) =>
      plan
        ? opApi(`/plans/${plan.id}`, { method: 'PATCH', body: { ...body, revision: plan.revision } })
        : opApi('/plans', { method: 'POST', body: { ...body, code: d.code } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: opKeys.plans });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const prices: PlanPrice[] = [];
    for (const p of d.prices) {
      const amountMinor = parseMoney(p.amount);
      if (amountMinor === null) return setLocalError(t('operator.plans.badAmount'));
      prices.push({ currency: p.currency, interval: p.interval, amountMinor });
    }
    // Arabic-Indic digits are accepted ("٣٥" → 35), as in money amounts.
    const limit = (v: string) => (v.trim() === '' ? null : Number(toLatinDigits(v.trim())));
    const limits = { branches: limit(d.limits.branches), practitioners: limit(d.limits.practitioners), members: limit(d.limits.members) };
    if (Object.values(limits).some((v) => v !== null && (!Number.isInteger(v) || v < 0)))
      return setLocalError(t('operator.plans.badLimit'));
    const trialDays = d.trialDays.trim() === '' ? null : Number(toLatinDigits(d.trialDays.trim()));
    if (trialDays !== null && (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 365)) return setLocalError(t('operator.plans.badTrial'));
    setLocalError(null);
    save.mutate({ name: { ar: d.nameAr, en: d.nameEn }, prices, limits, note: d.note, trialDays });
  };
  useFocusOnError(formRef, localError ?? save.error);
  return (
    <form className="stack-sm" onSubmit={submit} data-testid="plan-form" ref={formRef}>
      {(localError || save.isError) && <Notice kind="error">{localError ?? errorMessage(t, save.error)}</Notice>}
      <div className="form-grid">
        {!plan && (
          <Field id="plan-code" label={t('operator.plans.code')} hint={t('operator.plans.codeHint')} required>
            <input id="plan-code" dir="ltr" value={d.code} onChange={(e) => setD({ ...d, code: e.target.value })} required />
          </Field>
        )}
        <Field id="plan-name-ar" label={t('operator.plans.nameAr')} required>
          <input id="plan-name-ar" value={d.nameAr} onChange={(e) => setD({ ...d, nameAr: e.target.value })} required />
        </Field>
        <Field id="plan-name-en" label={t('operator.plans.nameEn')} required>
          <input id="plan-name-en" dir="ltr" value={d.nameEn} onChange={(e) => setD({ ...d, nameEn: e.target.value })} required />
        </Field>
      </div>
      <fieldset className="fieldset">
        <legend>{t('operator.plans.prices')}</legend>
        <p className="muted small">{t('operator.plans.pricesHint')}</p>
        {d.prices.map((p, i) => (
          <div className="form-row" key={i}>
            <select
              aria-label={t('operator.plans.currency')}
              value={p.currency}
              onChange={(e) =>
                setD({ ...d, prices: d.prices.map((x, j) => (j === i ? { ...x, currency: e.target.value as 'EGP' | 'SAR' } : x)) })
              }
            >
              <option value="EGP">EGP</option>
              <option value="SAR">SAR</option>
            </select>
            <select
              aria-label={t('operator.plans.interval')}
              value={p.interval}
              onChange={(e) =>
                setD({ ...d, prices: d.prices.map((x, j) => (j === i ? { ...x, interval: e.target.value as 'month' | 'year' } : x)) })
              }
            >
              <option value="month">{t('subscription.interval.month')}</option>
              <option value="year">{t('subscription.interval.year')}</option>
            </select>
            <input
              aria-label={t('operator.plans.amount')}
              inputMode="decimal"
              dir="ltr"
              value={p.amount}
              onChange={(e) => setD({ ...d, prices: d.prices.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })}
            />
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setD({ ...d, prices: d.prices.filter((_, j) => j !== i) })}
            >
              {t('operator.plans.removePrice')}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button button--secondary"
          onClick={() => setD({ ...d, prices: [...d.prices, { currency: 'EGP', interval: 'month', amount: '' }] })}
        >
          {t('operator.plans.addPrice')}
        </button>
      </fieldset>
      <fieldset className="fieldset">
        <legend>{t('operator.plans.limits')}</legend>
        <p className="muted small">{t('operator.plans.limitsHint')}</p>
        <div className="form-grid">
          {(['branches', 'practitioners', 'members'] as const).map((r) => (
            <Field key={r} id={`plan-limit-${r}`} label={t(`subscription.resource.${r}`)}>
              <input
                id={`plan-limit-${r}`}
                inputMode="numeric"
                dir="ltr"
                value={d.limits[r]}
                onChange={(e) => setD({ ...d, limits: { ...d.limits, [r]: e.target.value } })}
              />
            </Field>
          ))}
        </div>
      </fieldset>
      <Field id="plan-trial" label={t('operator.plans.trialDays')} hint={t('operator.plans.trialHint')}>
        <input id="plan-trial" inputMode="numeric" dir="ltr" value={d.trialDays} onChange={(e) => setD({ ...d, trialDays: e.target.value })} />
      </Field>
      <Field id="plan-note" label={t('operator.plans.note')}>
        <input id="plan-note" value={d.note} maxLength={500} onChange={(e) => setD({ ...d, note: e.target.value })} />
      </Field>
      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={save.isPending}>
          {t('operator.plans.saveDraft')}
        </button>
        <button type="button" className="button button--ghost" onClick={onDone}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

export function OperatorPlansPage() {
  const { t, i18n } = useTranslation();
  const operator = useOperator();
  const queryClient = useQueryClient();
  useDocumentTitle(t('operator.nav.plans'));
  const plans = useQuery({ queryKey: opKeys.plans, queryFn: ({ signal }) => opApi<{ data: Plan[] }>('/plans', { signal }) });
  const [editing, setEditing] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'retire' | 'new-version' }) =>
      opApi(`/plans/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: opKeys.plans }),
  });
  const manage = operator.can('platform.plans.manage');
  return (
    <>
      <PageHeader title={t('operator.nav.plans')} subtitle={t('operator.plans.subtitle')}>
        {manage && editing !== 'new' && (
          <button type="button" className="button button--primary" onClick={() => setEditing('new')}>
            {t('operator.plans.create')}
          </button>
        )}
      </PageHeader>
      <Notice kind="info">{t('operator.plans.noInventedTerms')}</Notice>
      {act.isError && <Notice kind="error">{errorMessage(t, act.error)}</Notice>}
      {editing === 'new' && (
        <section className="card">
          <h2>{t('operator.plans.create')}</h2>
          <PlanForm initial={emptyDraft} onDone={() => setEditing(null)} />
        </section>
      )}
      {plans.isPending && <Loading />}
      {plans.isError && <ErrorState message={errorMessage(t, plans.error)} onRetry={() => void plans.refetch()} />}
      {plans.isSuccess && (
        <ul className="data-list" data-testid="plans">
          {plans.data.data.map((p) => (
            <li key={p.id} className="data-row">
              <div className="data-main">
                <strong>{planName(p, i18n.resolvedLanguage ?? 'ar')}</strong>{' '}
                <span className="muted small" dir="ltr">
                  {p.code} v{p.version}
                </span>{' '}
                <span className={`badge badge--plan-status-${p.status}`}>{t(`operator.plans.status.${p.status}`)}</span>
                {/* One price per line: a "·" between two Arabic amounts read as part of the numbers. */}
                <p className="muted small">
                  {p.prices.length === 0
                    ? t('subscription.noPrice')
                    : p.prices.map((x) => (
                        <span key={`${x.currency}${x.interval}`} className="block">
                          <PriceText price={x} />
                        </span>
                      ))}
                </p>
                {p.note && (
                  <p className="muted small">
                    {t('operator.plans.noteLabel')}: <span dir="auto">{p.note}</span>
                  </p>
                )}
                {editing === p.id && <PlanForm initial={toDraft(p)} plan={p} onDone={() => setEditing(null)} />}
              </div>
              {manage && editing !== p.id && (
                <div className="row-actions">
                  {p.status === 'draft' && (
                    <>
                      <button type="button" className="button button--secondary" onClick={() => setEditing(p.id)}>
                        {t('operator.plans.edit')}
                      </button>
                      <button
                        type="button"
                        className="button button--primary"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ id: p.id, action: 'activate' })}
                      >
                        {t('operator.plans.activate')}
                      </button>
                    </>
                  )}
                  {p.status === 'active' && (
                    <>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ id: p.id, action: 'new-version' })}
                      >
                        {t('operator.plans.newVersion')}
                      </button>
                      <button
                        type="button"
                        className="button button--ghost"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ id: p.id, action: 'retire' })}
                      >
                        {t('operator.plans.retire')}
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// --- Inquiries -------------------------------------------------------------------------------

type InquiryRow = {
  reference: string;
  createdAt: string;
  status: 'new' | 'reviewed' | 'closed';
  country: string;
  organizationType: string;
  interest: string;
  organizationName: string;
  language: string;
  contactName: string;
  phone: string | null;
  email: string | null;
};

/** A list filter read from the URL: one of `allowed`, "" for "all", or the default. */
function statusFilter(raw: string | null, allowed: string[], fallback: string) {
  if (raw === 'all') return '';
  return raw && allowed.includes(raw) ? raw : fallback;
}

export function OperatorInquiriesPage() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  // The filter lives in the URL, so Back and refresh keep it ("all" = every status).
  const [params, setParams] = useSearchParams();
  const status = statusFilter(params.get('status'), ['new', 'reviewed', 'closed'], 'new');
  const setStatus = (s: string) => setParams(s === 'new' ? {} : { status: s || 'all' }, { replace: true });
  useDocumentTitle(t('operator.nav.inquiries'));
  const list = useQuery({
    queryKey: opKeys.inquiries(status),
    queryFn: ({ signal }) => opApi<{ data: InquiryRow[] }>(`/inquiries${status ? `?status=${status}` : ''}`, { signal }),
  });
  return (
    <>
      <PageHeader title={t('operator.nav.inquiries')} subtitle={t('operator.inquiries.subtitle')} />
      <div className="segmented" role="group" aria-label={t('operator.inquiries.filter')}>
        {['new', 'reviewed', 'closed', ''].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            className={`segment${status === s ? ' segment--active' : ''}`}
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
          >
            {s ? t(`operator.inquiries.status.${s}`) : t('operator.inquiries.all')}
          </button>
        ))}
      </div>
      {list.isPending && <Loading />}
      {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} />}
      {list.isSuccess && list.data.data.length === 0 && <EmptyState icon="file">{t('operator.inquiries.none')}</EmptyState>}
      {list.isSuccess && list.data.data.length > 0 && (
        <ul className="data-list">
          {list.data.data.map((i) => (
            <li key={i.reference} className="data-row">
              <div className="data-main">
                <Link to={`/operator/inquiries/${i.reference}`}>{i.organizationName}</Link>
                <p className="muted small">
                  <span dir="ltr">{i.reference}</span> · {fmt.date(i.createdAt)} · {i.contactName}
                </p>
              </div>
              <span className="badge">{t(`operator.inquiries.status.${i.status}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function OperatorInquiryPage() {
  const { t } = useTranslation();
  const { reference = '' } = useParams();
  const fmt = useFormatters();
  const operator = useOperator();
  const queryClient = useQueryClient();
  const inquiry = useQuery({
    queryKey: opKeys.inquiry(reference),
    queryFn: ({ signal }) => opApi<{ inquiry: InquiryRow & { description: string } }>(`/inquiries/${reference}`, { signal }),
  });
  const [contact, setContact] = useState<{ name: string; phone: string | null; email: string | null } | null>(null);
  const reveal = useMutation({
    mutationFn: () => opApi<{ contact: typeof contact }>(`/inquiries/${reference}/reveal-contact`, { method: 'POST' }),
    onSuccess: (r) => setContact(r.contact),
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => opApi(`/inquiries/${reference}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operator'] }),
  });
  useDocumentTitle(reference);
  if (inquiry.isPending) return <Loading />;
  if (inquiry.isError) return <ErrorState message={errorMessage(t, inquiry.error)} onRetry={() => void inquiry.refetch()} />;
  const i = inquiry.data.inquiry;
  return (
    <>
      <PageHeader title={i.organizationName} subtitle={i.reference} />
      <p className="muted small">
        <Link to="/operator/inquiries">{t('operator.inquiries.back')}</Link>
      </p>
      {(reveal.isError || setStatus.isError) && <Notice kind="error">{errorMessage(t, reveal.error ?? setStatus.error)}</Notice>}
      <section className="card">
        <dl className="details">
          <dt>{t('operator.inquiries.received')}</dt>
          <dd>{fmt.date(i.createdAt)}</dd>
          <dt>{t('operator.inquiries.statusLabel')}</dt>
          <dd>{t(`operator.inquiries.status.${i.status}`)}</dd>
          <dt>{t('operator.inquiries.country')}</dt>
          <dd>{t(`countries.${i.country}`, { defaultValue: i.country })}</dd>
          <dt>{t('operator.inquiries.interest')}</dt>
          <dd>{t(`site.inquiry.interests.${i.interest}`, { defaultValue: i.interest })}</dd>
          <dt>{t('operator.inquiries.description')}</dt>
          <dd className="record-text">{i.description}</dd>
          <dt>{t('operator.inquiries.contact')}</dt>
          <dd data-testid="inquiry-contact">
            {contact ? (
              <>
                <span className="block">{contact.name}</span>
                {contact.phone && (
                  <span className="block" dir="ltr">
                    {contact.phone}
                  </span>
                )}
                {contact.email && (
                  <span className="block" dir="ltr">
                    {contact.email}
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="block">{i.contactName}</span>
                {i.phone && (
                  <span className="block" dir="ltr">
                    {i.phone}
                  </span>
                )}
                {i.email && (
                  <span className="block" dir="ltr">
                    {i.email}
                  </span>
                )}
              </>
            )}
          </dd>
        </dl>
        {operator.can('platform.inquiries.manage') && (
          <div className="form-actions">
            {!contact && (
              <button type="button" className="button button--secondary" disabled={reveal.isPending} onClick={() => reveal.mutate()}>
                {t('operator.inquiries.reveal')}
              </button>
            )}
            {(['new', 'reviewed', 'closed'] as const)
              .filter((s) => s !== i.status)
              .map((s) => (
                <button
                  key={s}
                  type="button"
                  className="button button--ghost"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate(s)}
                >
                  {t(`operator.inquiries.markAs.${s}`)}
                </button>
              ))}
          </div>
        )}
        <p className="muted small">{t('operator.inquiries.revealHint')}</p>
      </section>
    </>
  );
}

// --- Operators and audit ---------------------------------------------------------------------

export function OperatorOperatorsPage() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const operator = useOperator();
  const queryClient = useQueryClient();
  useDocumentTitle(t('operator.nav.operators'));
  const list = useQuery({
    queryKey: opKeys.operators,
    queryFn: ({ signal }) =>
      opApi<{ data: (OperatorSession & { status: string; lastLoginAt: string | null })[] }>('/operators', { signal }),
  });
  const change = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => opApi(`/operators/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: opKeys.operators }),
  });
  return (
    <>
      <PageHeader title={t('operator.nav.operators')} subtitle={t('operator.operators.subtitle')} />
      {change.isError && <Notice kind="error">{errorMessage(t, change.error)}</Notice>}
      {list.isPending && <Loading />}
      {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} />}
      {list.isSuccess && (
        <ul className="data-list">
          {list.data.data.map((o) => (
            <li key={o.id} className="data-row">
              <div className="data-main">
                <strong>{o.displayName}</strong>{' '}
                <span className="muted small" dir="ltr">
                  {o.email}
                </span>
                <p className="muted small">
                  {t(`operator.roles.${o.role}`)} ·{' '}
                  {o.lastLoginAt ? t('operator.operators.lastSignIn', { date: fmt.date(o.lastLoginAt) }) : t('operator.operators.neverSignedIn')}
                </p>
              </div>
              <span className={`badge badge--${o.status === 'active' ? 'active' : 'suspended'}`}>
                {t(`operator.operators.status.${o.status}`)}
              </span>
              {operator.can('platform.operators.manage') && o.id !== operator.id && (
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={change.isPending}
                  onClick={() => change.mutate({ id: o.id, status: o.status === 'active' ? 'suspended' : 'active' })}
                >
                  {o.status === 'active' ? t('operator.operators.suspend') : t('operator.operators.reactivate')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

type AuditRow = {
  id: string;
  at: string;
  actor: string;
  operator: string | null;
  action: string;
  target: { type: string; id: string };
  changes: Record<string, unknown>;
};

export function OperatorAuditPage() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  useDocumentTitle(t('operator.nav.audit'));
  const [pages, setPages] = useState<string[]>(['']);
  const [hideSignIns, setHideSignIns] = useState(false);
  const [actionFilter, setActionFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const audit = useQuery({
    queryKey: [...opKeys.audit, pages],
    queryFn: async ({ signal }) => {
      const results = await Promise.all(
        pages.map((before) =>
          opApi<{ data: AuditRow[]; next: string | null }>(`/audit${before ? `?before=${encodeURIComponent(before)}` : ''}`, { signal }),
        ),
      );
      return { data: results.flatMap((r) => r.data), next: results.at(-1)?.next ?? null };
    },
  });
  return (
    <>
      <PageHeader title={t('operator.nav.audit')} subtitle={t('operator.audit.subtitle')} />
      {audit.isPending && <Loading />}
      {audit.isError && <ErrorState message={errorMessage(t, audit.error)} onRetry={() => void audit.refetch()} />}
      {audit.isSuccess && (
        <>
          <AuditFilters
            rows={audit.data.data}
            hideSignIns={hideSignIns}
            onHideSignIns={setHideSignIns}
            action={actionFilter}
            onAction={setActionFilter}
            actor={actorFilter}
            onActor={setActorFilter}
          />
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('operator.audit.time')}</th>
                  <th>{t('operator.audit.actor')}</th>
                  <th>{t('operator.audit.action')}</th>
                  <th>{t('operator.audit.target')}</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.data
                  .filter((e) => !(hideSignIns && e.action === 'operator.signed_in'))
                  .filter((e) => !actionFilter || e.action === actionFilter)
                  .filter((e) => !actorFilter || (e.operator ?? e.actor) === actorFilter)
                  .map((e) => (
                  <tr key={e.id}>
                    <td data-label={t('operator.audit.time')}>{fmt.dateTime(e.at, Intl.DateTimeFormat().resolvedOptions().timeZone)}</td>
                    <td data-label={t('operator.audit.actor')}>{e.operator ?? t(`operator.actor.${e.actor}`)}</td>
                    <td data-label={t('operator.audit.action')}>
                      {/* The code stays available as a tooltip for support staff. */}
                      <span title={e.action}>{t(`operator.audit.actions.${e.action}`, { defaultValue: e.action })}</span>
                      {e.changes.apply === false && <span className="muted small"> ({t('operator.audit.dryRun')})</span>}
                    </td>
                    <td data-label={t('operator.audit.target')}>
                      {e.target.id === 'all' ? (
                        t(`operator.audit.allTargets.${e.target.type}`, { defaultValue: t('operator.audit.all') })
                      ) : (
                        <>
                          {t(`operator.audit.targets.${e.target.type}`, { defaultValue: e.target.type })}{' '}
                          <bdi className="muted small" title={e.target.id}>
                            {e.target.id.slice(-6)}
                          </bdi>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {audit.data.next && (
            <button type="button" className="button button--secondary" onClick={() => setPages([...pages, audit.data.next!])}>
              {t('operator.audit.more')}
            </button>
          )}
        </>
      )}
    </>
  );
}

/** Filters for the platform log; they narrow the entries loaded so far ("Load more" fetches older ones). */
function AuditFilters({
  rows,
  hideSignIns,
  onHideSignIns,
  action,
  onAction,
  actor,
  onActor,
}: {
  rows: AuditRow[];
  hideSignIns: boolean;
  onHideSignIns: (value: boolean) => void;
  action: string;
  onAction: (value: string) => void;
  actor: string;
  onActor: (value: string) => void;
}) {
  const { t } = useTranslation();
  const actions = [...new Set(rows.map((r) => r.action))].sort();
  const actors = [...new Set(rows.map((r) => r.operator ?? r.actor))].sort();
  return (
    <div className="filters audit-filters">
      <Field id="audit-action" label={t('operator.audit.action')}>
        <select id="audit-action" value={action} onChange={(e) => onAction(e.target.value)}>
          <option value="">{t('operator.audit.allActions')}</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {t(`operator.audit.actions.${a}`, { defaultValue: a })}
            </option>
          ))}
        </select>
      </Field>
      <Field id="audit-actor" label={t('operator.audit.actor')}>
        <select id="audit-actor" value={actor} onChange={(e) => onActor(e.target.value)} dir="auto">
          <option value="">{t('operator.audit.allActors')}</option>
          {actors.map((a) => (
            <option key={a} value={a}>
              {t(`operator.actor.${a}`, { defaultValue: a })}
            </option>
          ))}
        </select>
      </Field>
      <label className="choice">
        <input type="checkbox" checked={hideSignIns} onChange={(e) => onHideSignIns(e.target.checked)} />
        {t('operator.audit.hideSignIns')}
      </label>
      <p className="field-hint">{t('operator.audit.filterHint')}</p>
    </div>
  );
}

// --- Support queue and development mail sink (milestone 5) -------------------------------------

type QueueRow = {
  id: string;
  reference: string;
  subject: string;
  category: string;
  status: string;
  messageCount: number;
  lastActivityAt: string;
  organization: { id: string; name: string };
};

export function OperatorSupportPage() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const [params, setParams] = useSearchParams();
  const status = statusFilter(params.get('status'), ['open', 'answered', 'closed'], 'open');
  const setStatus = (s: string) => setParams(s === 'open' ? {} : { status: s || 'all' }, { replace: true });
  useDocumentTitle(t('operator.nav.support'));
  const list = useQuery({
    queryKey: ['operator', 'support', status],
    queryFn: ({ signal }) => opApi<{ data: QueueRow[] }>(`/support${status ? `?status=${status}` : ''}`, { signal }),
  });
  return (
    <>
      <PageHeader title={t('operator.nav.support')} subtitle={t('operator.support.subtitle')} />
      <div className="segmented" role="group" aria-label={t('operator.inquiries.filter')}>
        {['open', 'answered', 'closed', ''].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            className={`segment${status === s ? ' segment--active' : ''}`}
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
          >
            {s ? t(`support.status.${s}`) : t('operator.inquiries.all')}
          </button>
        ))}
      </div>
      {list.isPending && <Loading />}
      {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} />}
      {list.isSuccess && list.data.data.length === 0 && <EmptyState icon="help">{t('operator.support.none')}</EmptyState>}
      {list.isSuccess && list.data.data.length > 0 && (
        <ul className="data-list" data-testid="support-queue">
          {list.data.data.map((r) => (
            <li key={r.id} className="data-row">
              <div className="data-main">
                <Link to={`/operator/support/${r.reference}`}>{r.subject}</Link>
                <p className="muted small">
                  {r.organization.name} · <span dir="ltr">{r.reference}</span> · {t(`support.categories.${r.category}`)} ·{' '}
                  {fmt.date(r.lastActivityAt)}
                </p>
              </div>
              <SupportStatusBadge status={r.status} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function OperatorSupportRequestPage() {
  const { t } = useTranslation();
  const { reference = '' } = useParams();
  const operator = useOperator();
  const queryClient = useQueryClient();
  const key = ['operator', 'support-request', reference];
  const detail = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      opApi<{
        request: SupportDetail & { organization: { id: string; name: string }; requester: { displayName: string; email: string } | null };
      }>(`/support/${reference}`, { signal }),
  });
  useDocumentTitle(reference);
  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: key });
    await queryClient.invalidateQueries({ queryKey: ['operator', 'support'] });
  };
  const reply = useMutation({
    mutationFn: (body: string) => opApi(`/support/${reference}/messages`, { method: 'POST', body: { body } }),
    onSuccess: done,
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => opApi(`/support/${reference}/status`, { method: 'POST', body: { status } }),
    onSuccess: done,
  });
  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorState message={errorMessage(t, detail.error)} onRetry={() => void detail.refetch()} />;
  const r = detail.data.request;
  const manage = operator.can('platform.support.manage');
  return (
    <>
      <PageHeader title={r.subject} subtitle={`${r.reference} · ${r.organization.name}`}>
        <SupportStatusBadge status={r.status} />
      </PageHeader>
      <p className="muted small">
        <Link to="/operator/support">{t('operator.support.back')}</Link>
        {r.requester && (
          <>
            {' '}
            · {t('operator.support.requester')}: {r.requester.displayName} <span dir="ltr">{r.requester.email}</span>
          </>
        )}
      </p>
      {manage ? (
        <SupportConversation
          viewer="operator"
          request={r}
          onReply={(body) => reply.mutateAsync(body)}
          replying={reply.isPending}
          replyError={reply.error ?? setStatus.error}
          extraActions={(['open', 'answered', 'closed'] as const)
            .filter((s) => s !== r.status)
            .map((s) => (
              <button
                key={s}
                type="button"
                className="button button--ghost"
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate(s)}
              >
                {t(`operator.support.markAs.${s}`)}
              </button>
            ))}
        />
      ) : (
        <EmptyState icon="lock">{t('operator.support.readOnly')}</EmptyState>
      )}
    </>
  );
}

type DevMailRow = { id: string; to: string; template: string; subject: string; text: string; createdAt: string };

/** Development only: messages the platform would have emailed. Never available in production. */
export function OperatorDevMailPage() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  useDocumentTitle(t('operator.nav.devMail'));
  const list = useQuery({
    queryKey: ['operator', 'dev-mail'],
    queryFn: ({ signal }) => opApi<{ data: DevMailRow[] }>('/dev-mail', { signal }),
  });
  return (
    <>
      <PageHeader title={t('operator.nav.devMail')} subtitle={t('operator.devMail.subtitle')} />
      <Notice kind="warning">{t('operator.devMail.warning')}</Notice>
      {list.isPending && <Loading />}
      {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} />}
      {list.isSuccess && list.data.data.length === 0 && <EmptyState icon="mail">{t('operator.devMail.none')}</EmptyState>}
      {list.isSuccess && list.data.data.length > 0 && (
        <ul className="data-list" data-testid="dev-mail">
          {list.data.data.map((m) => (
            <li key={m.id} className="data-row">
              <div className="data-main">
                <strong>{m.subject}</strong>
                <p className="muted small">
                  <span dir="ltr">{m.to}</span> · {fmt.date(m.createdAt)}
                </p>
                <pre className="record-text dev-mail-text" dir="auto">
                  {m.text}
                </pre>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// --- Contact messages from the public contact page -------------------------------------------------

type ContactRow = {
  reference: string;
  createdAt: string;
  status: 'new' | 'reviewed' | 'closed';
  intent: 'demo' | 'question' | 'other';
  organizationName: string | null;
  specialty: string | null;
  language: string;
  contactName: string;
  phone: string | null;
  email: string | null;
};

export function OperatorContactMessagesPage() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const [params, setParams] = useSearchParams();
  const status = statusFilter(params.get('status'), ['new', 'reviewed', 'closed'], 'new');
  const setStatus = (s: string) => setParams(s === 'new' ? {} : { status: s || 'all' }, { replace: true });
  useDocumentTitle(t('operator.nav.contactMessages'));
  const list = useQuery({
    queryKey: ['operator', 'contact-messages', status],
    queryFn: ({ signal }) => opApi<{ data: ContactRow[] }>(`/contact-messages${status ? `?status=${status}` : ''}`, { signal }),
  });
  return (
    <>
      <PageHeader title={t('operator.nav.contactMessages')} subtitle={t('operator.contact.subtitle')} />
      <div className="segmented" role="group" aria-label={t('operator.inquiries.filter')}>
        {['new', 'reviewed', 'closed', ''].map((s) => (
          <button key={s || 'all'} type="button" className={`segment${status === s ? ' segment--active' : ''}`} aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s ? t(`operator.inquiries.status.${s}`) : t('operator.inquiries.all')}
          </button>
        ))}
      </div>
      {list.isPending && <Loading />}
      {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} />}
      {list.isSuccess && list.data.data.length === 0 && <EmptyState icon="message">{t('operator.contact.none')}</EmptyState>}
      {list.isSuccess && list.data.data.length > 0 && (
        <ul className="data-list" data-testid="contact-messages">
          {list.data.data.map((m) => (
            <li key={m.reference} className="data-row">
              <div className="data-main">
                <Link to={`/operator/contact-messages/${m.reference}`}>{t(`site.contact.intents.${m.intent}`)}</Link>
                <p className="muted small">
                  <bdi dir="ltr">{m.reference}</bdi> · {fmt.date(m.createdAt)} · {m.contactName}
                  {m.organizationName && <> · {m.organizationName}</>}
                </p>
              </div>
              <span className="badge">{t(`operator.inquiries.status.${m.status}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function OperatorContactMessagePage() {
  const { t } = useTranslation();
  const { reference = '' } = useParams();
  const fmt = useFormatters();
  const operator = useOperator();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['operator', 'contact-message', reference],
    queryFn: ({ signal }) => opApi<{ message: ContactRow & { message: string } }>(`/contact-messages/${reference}`, { signal }),
  });
  const [contact, setContact] = useState<{ name: string; phone: string | null; email: string | null } | null>(null);
  const reveal = useMutation({
    mutationFn: () => opApi<{ contact: { name: string; phone: string | null; email: string | null } }>(`/contact-messages/${reference}/reveal-contact`, { method: 'POST' }),
    onSuccess: (r) => setContact(r.contact),
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => opApi(`/contact-messages/${reference}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operator'] }),
  });
  useDocumentTitle(reference);
  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorState message={errorMessage(t, detail.error)} onRetry={() => void detail.refetch()} />;
  const m = detail.data.message;
  const shown = contact ?? { name: m.contactName, phone: m.phone, email: m.email };
  return (
    <>
      <PageHeader title={t(`site.contact.intents.${m.intent}`)} subtitle={m.reference} />
      <p className="muted small">
        <Link to="/operator/contact-messages">{t('operator.contact.back')}</Link>
      </p>
      {(reveal.isError || setStatus.isError) && <Notice kind="error">{errorMessage(t, reveal.error ?? setStatus.error)}</Notice>}
      <section className="card">
        <dl className="details">
          <dt>{t('operator.inquiries.received')}</dt>
          <dd>{fmt.date(m.createdAt)}</dd>
          <dt>{t('operator.inquiries.statusLabel')}</dt>
          <dd>{t(`operator.inquiries.status.${m.status}`)}</dd>
          <dt>{t('operator.contact.organization')}</dt>
          <dd dir="auto">{m.organizationName ?? '—'}</dd>
          <dt>{t('operator.contact.specialty')}</dt>
          <dd>{m.specialty ? t(`site.inquiry.interests.${m.specialty}`, { defaultValue: m.specialty }) : '—'}</dd>
          <dt>{t('operator.contact.message')}</dt>
          <dd className="record-text" dir="auto">
            {m.message}
          </dd>
          <dt>{t('operator.inquiries.contact')}</dt>
          <dd data-testid="contact-message-contact">
            <span className="block">{shown.name}</span>
            {shown.phone && (
              <span className="block">
                <bdi dir="ltr">{shown.phone}</bdi>
              </span>
            )}
            {shown.email && (
              <span className="block">
                <bdi dir="ltr">{shown.email}</bdi>
              </span>
            )}
          </dd>
        </dl>
        {operator.can('platform.inquiries.manage') && (
          <div className="form-actions">
            {!contact && (
              <button type="button" className="button button--secondary" disabled={reveal.isPending} onClick={() => reveal.mutate()}>
                {t('operator.inquiries.reveal')}
              </button>
            )}
            {(['new', 'reviewed', 'closed'] as const)
              .filter((s) => s !== m.status)
              .map((s) => (
                <button key={s} type="button" className="button button--ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate(s)}>
                  {t(`operator.inquiries.markAs.${s}`)}
                </button>
              ))}
          </div>
        )}
        <p className="muted small">{t('operator.inquiries.revealHint')}</p>
      </section>
    </>
  );
}
