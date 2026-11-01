import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { useFormatters, zoneLabel } from '../lib/format';
import { opApi, opKeys, planName, type Plan, type Subscription, type Usage } from '../lib/operator';
import { useSpecialtyNames } from '../lib/specialties';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { PriceText, SubscriptionStatusBadge } from '../components/subscription';
import { ActionBar, CardGrid } from '../components/layout';
import { useOperator, useArrow } from './shared';

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
                  <td data-label={t('operator.organizations.type')}>
                    {o.type ? t(`onboarding.types.${o.type}.title`, { defaultValue: o.type }) : '—'}
                  </td>
                  <td data-label={t('operator.organizations.subscriptionKind')}>
                    {o.subscription ? t(`subscription.kind.${o.subscription.kind}`) : '—'}
                  </td>
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
      <CardGrid wide>
        <section className="card" aria-labelledby="op-org-meta">
          <h2 id="op-org-meta">{t('operator.organization.metadata')}</h2>
          <dl className="details">
            <dt>{t('operator.organizations.created')}</dt>
            <dd>{fmt.date(org.createdAt)}</dd>
            <dt>{t('operator.organization.timeZone')}</dt>
            <dd>{org.timeZone ? zoneLabel(t, org.timeZone) : '—'}</dd>
            <dt>{t('operator.organization.specialties')}</dt>
            <dd>{org.specialtyCodes.length ? fmt.list(org.specialtyCodes.map((c) => specialtyNames.name(c))) : '—'}</dd>
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
              <ActionBar>
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
              </ActionBar>
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
                <input id="op-grant-end" type="date" value={grant.endsAt} onChange={(e) => setGrant({ ...grant, endsAt: e.target.value })} />
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
              <button type="submit" className="button button--primary" disabled={action.isPending || !grant.planId || grant.note.trim().length < 3}>
                {t('operator.organization.grant')}
              </button>
              {!sub?.trialUsed && (
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={action.isPending || !grant.planId || !grant.endsAt}
                  onClick={() =>
                    action.mutate({ path: `/organizations/${orgId}/subscription/trial`, body: { planId: grant.planId, endsAt: grant.endsAt } })
                  }
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
              <ActionBar>
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
              </ActionBar>
            </div>
          )}
        </section>
      </CardGrid>
      <CardGrid wide>
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
      </CardGrid>
    </>
  );
}
