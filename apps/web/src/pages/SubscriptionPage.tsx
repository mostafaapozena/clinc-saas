import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { PriceText, SubscriptionStatusBadge } from '../components/subscription';
import { EmptyState, ErrorState, Loading, Notice } from '../components/ui';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatMoney } from '../lib/finance';
import { useFormatters } from '../lib/format';
import { planName, type BillingPolicy, type Checkout, type Plan, type Subscription, type Usage } from '../lib/operator';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useOrg } from '../org/context';

// The organization's platform subscription (what the clinic has with raclinic) — separate from the
// clinic's own finances. Payments, where enabled, go through a clearly labelled SIMULATOR only.

type SubscriptionView = {
  subscription: Subscription | null;
  usage: Usage;
  enforcement: 'off' | 'log' | 'on';
  billingProvider: 'none' | 'simulator';
  policy?: BillingPolicy;
};
const ENDED = ['canceled', 'expired'];

/** Owner requests are local intent until a provider confirms; the label says which. */
function IntentNote({ acknowledged }: { acknowledged: boolean }) {
  const { t } = useTranslation();
  return <p className="muted small">{acknowledged ? t('subscription.intent.acknowledged') : t('subscription.intent.local')}</p>;
}

function CancelPanel({ sub, onDone }: { sub: Subscription; onDone: () => void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const fmt = useFormatters();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => api<SubscriptionView>(`/orgs/${orgId}/subscription/cancel`, { method: 'POST', body: { version: sub.version, confirm: true, reason } }),
    onSuccess: (data) => {
      queryClient.setQueryData(subscriptionKey(orgId), data);
      setOpen(false);
      onDone();
    },
  });
  if (!open) {
    return (
      <button type="button" className="button button--ghost" onClick={() => setOpen(true)}>
        {t('subscription.cancel.open')}
      </button>
    );
  }
  return (
    <div className="confirm-panel" role="group" aria-labelledby="cancel-title" data-testid="cancel-panel">
      <h3 id="cancel-title">{t('subscription.cancel.title')}</h3>
      <p>
        {sub.kind === 'commercial'
          ? t('subscription.cancel.commercial', { date: sub.currentPeriodEnd ? fmt.date(sub.currentPeriodEnd) : '—' })
          : t('subscription.cancel.free')}
      </p>
      <p className="muted small">{t('subscription.dataSafe')}</p>
      <label htmlFor="cancel-reason" className="block">
        {t('subscription.cancel.reason')}
      </label>
      <input id="cancel-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
      <label className="choice">
        <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /> {t('subscription.cancel.understand')}
      </label>
      {cancel.isError && <Notice kind="error">{errorMessage(t, cancel.error)}</Notice>}
      <div className="form-actions">
        <button type="button" className="button button--danger" disabled={!understood || cancel.isPending} onClick={() => cancel.mutate()}>
          {t('subscription.cancel.confirm')}
        </button>
        <button type="button" className="button button--secondary" onClick={() => setOpen(false)}>
          {t('subscription.cancel.keep')}
        </button>
      </div>
    </div>
  );
}
const subscriptionKey = (orgId: string) => ['org', orgId, 'subscription'] as const;

export function SubscriptionPage() {
  const { t, i18n } = useTranslation();
  const { orgId, can } = useOrg();
  const fmt = useFormatters();
  const navigate = useNavigate();
  useDocumentTitle(t('subscription.title'));
  const view = useQuery({
    queryKey: subscriptionKey(orgId),
    queryFn: ({ signal }) => api<SubscriptionView>(`/orgs/${orgId}/subscription`, { signal }),
  });
  const plans = useQuery({
    queryKey: [...subscriptionKey(orgId), 'plans'],
    queryFn: ({ signal }) => api<{ data: Plan[] }>(`/orgs/${orgId}/subscription/plans`, { signal }),
  });
  const checkout = useMutation({
    mutationFn: (input: { planId: string; currency: string; interval: string }) =>
      api<{ checkout: Checkout }>(`/orgs/${orgId}/subscription/checkouts`, { method: 'POST', body: input }),
    onSuccess: ({ checkout: c }) => navigate(`/app/${orgId}/subscription/checkout/${c.id}`),
  });
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const setView = (data: SubscriptionView) => queryClient.setQueryData(subscriptionKey(orgId), data);
  const trial = useMutation({
    mutationFn: (planId: string) => api<SubscriptionView>(`/orgs/${orgId}/subscription/trial`, { method: 'POST', body: { planId } }),
    onSuccess: setView,
  });
  const change = useMutation({
    mutationFn: (input: { planId: string; currency: string; interval: string; version: number }) =>
      api<SubscriptionView>(`/orgs/${orgId}/subscription/plan-change`, { method: 'POST', body: input }),
    onSuccess: (data) => {
      setView(data);
      setNotice(t('subscription.change.requested'));
    },
  });
  const withdraw = useMutation({
    mutationFn: (what: 'plan-change' | 'cancel') =>
      api<SubscriptionView>(`/orgs/${orgId}/subscription/${what}/withdraw`, { method: 'POST', body: { version: view.data?.subscription?.version ?? 0 } }),
    onSuccess: setView,
  });
  const language = i18n.resolvedLanguage ?? 'ar';

  if (view.isPending) return <Loading />;
  if (view.isError) return <ErrorState message={errorMessage(t, view.error)} onRetry={() => void view.refetch()} />;
  const { subscription: sub, usage, enforcement, billingProvider } = view.data;
  const manage = can('subscription.manage');
  const live = sub && !ENDED.includes(sub.status);
  const commercialLive = sub?.kind === 'commercial' && live;
  const canBuy = manage && billingProvider === 'simulator' && sub?.status !== 'restricted' && !commercialLive;
  const canChange = manage && commercialLive && (sub.status === 'active' || sub.status === 'past_due') && !sub.cancelRequest;
  const canTrial = manage && !sub?.trialUsed && !live;
  const mutationError = trial.error ?? change.error ?? withdraw.error;

  return (
    <>
      <PageHeader title={t('subscription.title')} subtitle={t('subscription.subtitle')} />
      {billingProvider === 'simulator' ? (
        <Notice kind="warning">{t('subscription.simulatorNotice')}</Notice>
      ) : (
        <Notice kind="info">{t('subscription.noProvider')}</Notice>
      )}
      <div className="card-grid card-grid--wide">
        <section className="card" aria-labelledby="subscription-current-title">
          <h2 id="subscription-current-title">{t('subscription.current')}</h2>
          {!sub ? (
            <EmptyState icon="card">{t('subscription.none')}</EmptyState>
          ) : (
            <dl className="details" data-testid="subscription-current">
              <dt>{t('subscription.kindLabel')}</dt>
              <dd>
                <strong>{t(`subscription.kind.${sub.kind}`)}</strong>
                <p className="muted small">{t(`subscription.kindHint.${sub.kind}`)}</p>
              </dd>
              <dt>{t('subscription.statusLabel')}</dt>
              <dd>
                <SubscriptionStatusBadge status={sub.effectiveStatus} />
              </dd>
              <dt>{t('subscription.plan')}</dt>
              <dd>
                {planName(sub.plan, language)} <span className="muted small">v{sub.plan.version}</span>
              </dd>
              <dt>{sub.kind === 'commercial' ? t('subscription.paidThrough') : t('subscription.endsAt')}</dt>
              <dd>{sub.currentPeriodEnd ? fmt.date(sub.currentPeriodEnd) : t('subscription.noEnd')}</dd>
              {sub.price && (
                <>
                  <dt>{t('subscription.price')}</dt>
                  <dd>
                    <PriceText price={sub.price} />
                    {sub.provider === 'simulator' && <span className="muted small"> · {t('subscription.simulatedPayment')}</span>}
                  </dd>
                </>
              )}
              {sub.restriction && (
                <>
                  <dt>{t('subscription.restrictionReason')}</dt>
                  <dd>{sub.restriction.reason}</dd>
                </>
              )}
              {sub.status === 'trialing' && sub.trialEndsAt && (
                <>
                  <dt>{t('subscription.trial.endsLabel')}</dt>
                  <dd data-testid="trial-ends">{t('subscription.trial.ends', { date: fmt.date(sub.trialEndsAt) })}</dd>
                </>
              )}
              {sub.pendingChange && (
                <>
                  <dt>{t('subscription.change.pendingLabel')}</dt>
                  <dd data-testid="pending-change">
                    {t('subscription.change.pending', { plan: sub.pendingChange.plan.code, date: fmt.date(sub.pendingChange.effectiveAt) })} · <PriceText price={sub.pendingChange.price} />
                    <IntentNote acknowledged={sub.pendingChange.providerAcknowledged} />
                    {manage && (
                      <button type="button" className="button button--ghost" disabled={withdraw.isPending} onClick={() => withdraw.mutate('plan-change')}>
                        {t('subscription.change.withdraw')}
                      </button>
                    )}
                  </dd>
                </>
              )}
              {sub.cancelRequest && (
                <>
                  <dt>{t('subscription.cancel.pendingLabel')}</dt>
                  <dd data-testid="cancel-request">
                    {t('subscription.cancel.pending', { date: sub.currentPeriodEnd ? fmt.date(sub.currentPeriodEnd) : '—' })}
                    <IntentNote acknowledged={sub.cancelRequest.providerAcknowledged} />
                    {manage && (
                      <button type="button" className="button button--ghost" disabled={withdraw.isPending} onClick={() => withdraw.mutate('cancel')}>
                        {t('subscription.cancel.withdraw')}
                      </button>
                    )}
                  </dd>
                </>
              )}
            </dl>
          )}
          {notice && <Notice kind="success">{notice}</Notice>}
          {mutationError && <Notice kind="error">{errorMessage(t, mutationError)}</Notice>}
          {manage && live && !sub.cancelRequest && <CancelPanel sub={sub} onDone={() => setNotice(t('subscription.cancel.done'))} />}
          <p className="muted small">{t('subscription.dataSafe')}</p>
        </section>
        <section className="card" aria-labelledby="subscription-usage-title">
          <h2 id="subscription-usage-title">{t('subscription.usage')}</h2>
          <ul className="data-list">
            {(['branches', 'practitioners', 'members'] as const).map((resource) => {
              const limit = sub?.limits?.[resource] ?? null;
              return (
                <li key={resource} className="data-row">
                  <span className="data-main">{t(`subscription.resource.${resource}`)}</span>
                  <span className="data-meta">
                    {limit === null
                      ? t('subscription.usageUnlimited', { count: usage[resource] })
                      : t('subscription.usageOf', { count: usage[resource], limit })}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="muted small">{t(`subscription.enforcement.${enforcement}`)}</p>
        </section>
      </div>
      <section className="card" aria-labelledby="subscription-plans-title">
        <h2 id="subscription-plans-title">{t('subscription.plans')}</h2>
        {checkout.isError && <Notice kind="error">{errorMessage(t, checkout.error)}</Notice>}
        {plans.isPending && <Loading />}
        {plans.isError && <ErrorState message={errorMessage(t, plans.error)} onRetry={() => void plans.refetch()} />}
        {plans.isSuccess && plans.data.data.length === 0 && <EmptyState icon="layers">{t('subscription.noPlans')}</EmptyState>}
        {plans.isSuccess && plans.data.data.length > 0 && (
          <ul className="data-list">
            {plans.data.data.map((plan) => (
              <li key={plan.id} className="data-row">
                <div className="data-main">
                  <strong>{planName(plan, language)}</strong>
                  <p className="muted small">
                    {plan.prices.length === 0
                      ? t('subscription.noPrice')
                      : t('subscription.limitsSummary', { summary: limitsSummary(t, plan) })}
                  </p>
                  {plan.trialDays ? <p className="muted small">{t('subscription.trial.offered', { count: plan.trialDays })}</p> : null}
                </div>
                <div className="row-actions">
                  {canTrial && plan.trialDays ? (
                    <button type="button" className="button button--secondary" disabled={trial.isPending} onClick={() => trial.mutate(plan.id)}>
                      {t('subscription.trial.start', { count: plan.trialDays })}
                    </button>
                  ) : null}
                  {plan.prices.map((price) => (
                    <span key={`${price.currency}-${price.interval}`} className="stack-sm">
                      <span>
                        <PriceText price={price} />
                      </span>
                      {canBuy && (
                        <button
                          type="button"
                          className="button button--secondary"
                          disabled={checkout.isPending}
                          onClick={() => checkout.mutate({ planId: plan.id, currency: price.currency, interval: price.interval })}
                        >
                          {t('subscription.subscribeSimulated')}
                        </button>
                      )}
                      {canChange && !(sub.plan.id === plan.id && sub.price?.currency === price.currency && sub.price.interval === price.interval) && (
                        <button
                          type="button"
                          className="button button--secondary"
                          disabled={change.isPending}
                          onClick={() => change.mutate({ planId: plan.id, currency: price.currency, interval: price.interval, version: sub.version })}
                        >
                          {t('subscription.change.request')}
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function limitsSummary(t: (key: string, o?: Record<string, unknown>) => string, plan: Plan) {
  const parts = (['branches', 'practitioners', 'members'] as const)
    .filter((r) => plan.limits[r] !== null)
    .map((r) => t(`subscription.limitPart.${r}`, { count: plan.limits[r] }));
  return parts.length ? parts.join(' · ') : t('subscription.noLimits');
}

/** SIMULATOR checkout: stands in for a provider's hosted payment page. No card details, no money. */
export function SimulatorCheckoutPage() {
  const { t, i18n } = useTranslation();
  const { orgId } = useOrg();
  const { checkoutId = '' } = useParams();
  const fmt = useFormatters();
  const queryClient = useQueryClient();
  useDocumentTitle(t('subscription.checkoutTitle'));
  const checkout = useQuery({
    queryKey: [...subscriptionKey(orgId), 'checkout', checkoutId],
    queryFn: ({ signal }) => api<{ checkout: Checkout }>(`/orgs/${orgId}/subscription/checkouts/${checkoutId}`, { signal }),
  });
  const simulate = useMutation({
    mutationFn: (outcome: 'succeeded' | 'failed') =>
      api<{ checkout: Checkout }>(`/orgs/${orgId}/subscription/checkouts/${checkoutId}/simulate`, { method: 'POST', body: { outcome } }),
    onSuccess: async (data) => {
      queryClient.setQueryData([...subscriptionKey(orgId), 'checkout', checkoutId], data);
      await queryClient.invalidateQueries({ queryKey: subscriptionKey(orgId), exact: true });
    },
  });
  if (checkout.isPending) return <Loading />;
  if (checkout.isError) return <ErrorState message={errorMessage(t, checkout.error)} onRetry={() => void checkout.refetch()} />;
  const c = checkout.data.checkout;
  return (
    <>
      <PageHeader title={t('subscription.checkoutTitle')} />
      <Notice kind="warning">
        <strong>{t('subscription.simulatorBanner')}</strong> {t('subscription.simulatorBannerBody')}
      </Notice>
      <section className="card" aria-labelledby="checkout-summary-title" data-testid="simulator-checkout">
        <h2 id="checkout-summary-title">{t('subscription.checkoutSummary')}</h2>
        <dl className="details">
          <dt>{t('subscription.plan')}</dt>
          <dd>
            {c.plan.code} <span className="muted small">v{c.plan.version}</span>
          </dd>
          <dt>{t('subscription.price')}</dt>
          <dd>
            {formatMoney(c.price.amountMinor, c.price.currency, i18n.resolvedLanguage ?? 'ar')} /{' '}
            {t(`subscription.interval.${c.price.interval}`)}
          </dd>
          <dt>{t('subscription.statusLabel')}</dt>
          <dd>
            <span className={`badge badge--checkout-${c.status}`}>{t(`subscription.checkoutStatus.${c.status}`)}</span>
          </dd>
          {c.status === 'open' && (
            <>
              <dt>{t('subscription.checkoutExpires')}</dt>
              <dd>{fmt.dateTime(c.expiresAt, Intl.DateTimeFormat().resolvedOptions().timeZone)}</dd>
            </>
          )}
        </dl>
        {simulate.isError && <Notice kind="error">{errorMessage(t, simulate.error)}</Notice>}
        {c.status === 'open' ? (
          <div className="form-actions">
            <button
              type="button"
              className="button button--primary"
              disabled={simulate.isPending}
              onClick={() => simulate.mutate('succeeded')}
            >
              {t('subscription.simulateSuccess')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={simulate.isPending}
              onClick={() => simulate.mutate('failed')}
            >
              {t('subscription.simulateFailure')}
            </button>
          </div>
        ) : (
          <Notice kind={c.status === 'completed' ? 'success' : 'info'}>{t(`subscription.checkoutResult.${c.status}`)}</Notice>
        )}
        <p>
          <Link to={`/app/${orgId}/subscription`}>{t('subscription.backToSubscription')}</Link>
        </p>
      </section>
    </>
  );
}
