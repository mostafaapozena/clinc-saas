import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { Metric } from '../components/Metric';
import { PageHeader } from '../components/PageHeader';
import { ErrorState, Field, Loading, Notice } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { opApi, opKeys, type BillingPolicy } from '../lib/operator';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { ActionBar, CardGrid, MetricGrid } from '../components/layout';
import { useOperator, useArrow } from './shared';

// --- Overview --------------------------------------------------------------------------------

export type Overview = {
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
        <MetricGrid columns="four">
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
        </MetricGrid>
      </section>
      <section className="card op-metrics" aria-labelledby="op-status-title">
        <h2 id="op-status-title" className="card-title">
          <Icon name="chart" /> {t('operator.overview.platformStatus')}
        </h2>
        <MetricGrid columns="six">
          <Metric
            icon="building"
            tone="brand"
            label={t('operator.overview.organizations')}
            value={o.organizations}
            to="/operator/organizations"
            testId="op-organizations"
          />
          <Metric icon="checkCircle" tone="ok" label={t('subscription.status.active')} value={o.subscriptions.byStatus.active ?? 0} />
          <Metric icon="lock" tone="warn" label={t('subscription.status.restricted')} value={o.subscriptions.byStatus.restricted ?? 0} />
          <Metric icon="clock" tone="muted" label={t('subscription.status.expired')} value={o.subscriptions.byStatus.expired ?? 0} />
          <Metric icon="ban" tone="muted" label={t('subscription.status.canceled')} value={o.subscriptions.byStatus.canceled ?? 0} />
          <Metric icon="layers" tone="neutral" label={t('subscription.status.none')} value={o.subscriptions.byStatus.none ?? 0} />
        </MetricGrid>
      </section>
      <CardGrid wide>
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
            <ActionBar>
              <button type="button" className="button button--primary" disabled={reconcile.isPending} onClick={() => reconcile.mutate(false)}>
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
            </ActionBar>
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
      </CardGrid>
    </>
  );
}

/** Billing policy: unset by default; values are commercial decisions (B4), recorded with an audit entry. */
function PolicyCard({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const policy = useQuery({
    queryKey: ['operator', 'policy'],
    queryFn: ({ signal }) => opApi<{ policy: BillingPolicy }>('/billing/policy', { signal }),
  });
  const [draft, setDraft] = useState<{
    graceDays: string;
    afterGrace: BillingPolicy['afterGrace'];
    restrictedAccess: BillingPolicy['restrictedAccess'];
  } | null>(null);
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
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setDraft({ graceDays: p.graceDays?.toString() ?? '', afterGrace: p.afterGrace, restrictedAccess: p.restrictedAccess })}
            >
              {t('operator.policy.edit')}
            </button>
          )}
        </>
      ) : (
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({
              graceDays: draft.graceDays.trim() === '' ? null : Number(draft.graceDays),
              afterGrace: draft.afterGrace,
              restrictedAccess: draft.restrictedAccess,
              revision: p.revision ?? 0,
            });
          }}
        >
          <Field id="policy-grace" label={t('operator.policy.graceDays')} hint={t('operator.policy.graceHint')}>
            <input
              id="policy-grace"
              inputMode="numeric"
              dir="ltr"
              value={draft.graceDays}
              onChange={(e) => setDraft({ ...draft, graceDays: e.target.value })}
            />
          </Field>
          <Field id="policy-after" label={t('operator.policy.afterGrace')}>
            <select
              id="policy-after"
              value={draft.afterGrace}
              onChange={(e) => setDraft({ ...draft, afterGrace: e.target.value as BillingPolicy['afterGrace'] })}
            >
              <option value="none">{t('operator.policy.after.none')}</option>
              <option value="restricted">{t('operator.policy.after.restricted')}</option>
            </select>
          </Field>
          <Field id="policy-access" label={t('operator.policy.restrictedAccess')} hint={t('operator.policy.accessHint')}>
            <select
              id="policy-access"
              value={draft.restrictedAccess}
              onChange={(e) => setDraft({ ...draft, restrictedAccess: e.target.value as BillingPolicy['restrictedAccess'] })}
            >
              <option value="growth_only">{t('operator.policy.access.growth_only')}</option>
              <option value="read_only">{t('operator.policy.access.read_only')}</option>
            </select>
          </Field>
          <ActionBar>
            <button type="submit" className="button button--primary" disabled={save.isPending}>
              {t('common.save')}
            </button>
            <button type="button" className="button button--ghost" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </button>
          </ActionBar>
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
      <ActionBar>
        <button type="button" className="button button--primary" disabled={run.isPending} onClick={() => run.mutate(false)}>
          {t('operator.lifecycle.dryRun')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          disabled={run.isPending || !actions?.some((a) => a.to)}
          onClick={() => run.mutate(true)}
        >
          {t('operator.lifecycle.apply')}
        </button>
      </ActionBar>
      {actions &&
        (actions.length === 0 ? (
          <p data-testid="lifecycle-result">{t('operator.lifecycle.none')}</p>
        ) : (
          <ul className="data-list" data-testid="lifecycle-result">
            {actions.map((a) => (
              <li key={`${a.organizationId}-${a.reason}`} className="data-row">
                <Link to={`/operator/organizations/${a.organizationId}`}>{a.organizationId.slice(-6)}</Link>
                <span className="data-meta">
                  {t(`operator.lifecycle.reason.${a.reason}`)}: {t(`subscription.status.${a.from}`)} {arrow}{' '}
                  {a.to ? t(`subscription.status.${a.to}`) : t('operator.lifecycle.providerDecides')} ·{' '}
                  {a.applied ? t('operator.reconcile.applied') : a.conflict ? t('operator.lifecycle.conflict') : t('operator.reconcile.notApplied')}
                </span>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
