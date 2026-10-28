import { runTransaction } from '../../db/transaction.js';
import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import { Types, type ClientSession } from 'mongoose';
import { conflict, isDuplicateKeyError } from '../../http/errors.js';
import { clock } from '../../time/clock.js';
import {
  BillingEventModel,
  CheckoutModel,
  SimulatorSubscriptionModel,
  SubscriptionModel,
  type BillingCheckout,
  type BillingEvent,
  type BillingInterval,
  type PlanPrice,
  type PlatformSubscription,
  type SubscriptionStatus,
} from './billing.model.js';
import { recordPlatformAudit } from './operator.model.js';
import { newSimulatorId, simulatorDelivery, type PaymentProvider, type ProviderEvent } from './payment-provider.js';
import { canTransition, changeStatus } from './subscription.service.js';

// Webhook processing, simulator actions and reconciliation (docs/architecture/SUBSCRIPTIONS.md).
// Every provider event is verified, recorded once (provider + event id, unique) and applied in the
// same transaction, so a duplicate delivery or a concurrent replay changes nothing twice. Events
// older than the last applied one for a subscription are recorded as ignored_stale.

type Sub = PlatformSubscription & { _id: Types.ObjectId };
type Outcome = BillingEvent['outcome'];
export type WebhookResult = { eventId: string; duplicate: boolean; outcome: Outcome | null; detail: string };

export const periodEnd = (from: Date, interval: BillingInterval) =>
  DateTime.fromJSDate(from, { zone: 'utc' })
    .plus(interval === 'month' ? { months: 1 } : { years: 1 })
    .toJSDate();

const str = (v: unknown) => (typeof v === 'string' && v.length <= 100 ? v : null);
const date = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);

/** Verifies, dedupes and applies one raw webhook delivery. */
export async function handleWebhook(provider: PaymentProvider, rawBody: Buffer, signature: string | undefined): Promise<WebhookResult> {
  const event = provider.verifyWebhook(rawBody, signature);
  const payloadHash = createHash('sha256').update(rawBody).digest('hex');
  if (await BillingEventModel.exists({ provider: provider.name, eventId: event.id })) {
    return { eventId: event.id, duplicate: true, outcome: null, detail: 'already processed' };
  }
  try {
    return await runTransaction(async (session) => {
      const { outcome, detail, organizationId, providerSubscriptionId } = await applyEvent(event, session);
      await BillingEventModel.create(
        [
          {
            provider: provider.name,
            eventId: event.id,
            type: event.type,
            occurredAt: event.occurredAt,
            organizationId,
            providerSubscriptionId,
            outcome,
            detail,
            payloadHash,
          },
        ],
        { session },
      );
      return { eventId: event.id, duplicate: false, outcome, detail };
    });
  } catch (err) {
    // A concurrent delivery of the same event committed first.
    if (isDuplicateKeyError(err)) return { eventId: event.id, duplicate: true, outcome: null, detail: 'already processed' };
    throw err;
  }
}

type Applied = { outcome: Outcome; detail: string; organizationId: Types.ObjectId | null; providerSubscriptionId: string | null };

async function applyEvent(event: ProviderEvent, session: ClientSession): Promise<Applied> {
  const subId = str(event.data.providerSubscriptionId);
  const result = (outcome: Outcome, detail: string, organizationId: Types.ObjectId | null = null): Applied => ({
    outcome,
    detail,
    organizationId,
    providerSubscriptionId: subId,
  });

  if (event.type === 'checkout.completed' || event.type === 'checkout.failed') {
    const checkoutId = str(event.data.checkoutId);
    const checkout = checkoutId && Types.ObjectId.isValid(checkoutId) ? await CheckoutModel.findById(checkoutId).session(session) : null;
    if (!checkout) return result('ignored_unknown', 'unknown checkout');
    if (checkout.status !== 'open') return result('ignored_stale', `checkout already ${checkout.status}`, checkout.organizationId);
    if (event.type === 'checkout.failed') {
      checkout.status = 'failed';
      await checkout.save({ session });
      await audit('subscription.checkout_failed', checkout.organizationId, { checkoutId: String(checkout._id) }, session);
      return result('applied', 'checkout failed; subscription unchanged', checkout.organizationId);
    }
    const end = date(event.data.currentPeriodEnd);
    if (!subId || !end) return result('rejected', 'missing subscription id or period', checkout.organizationId);
    checkout.status = 'completed';
    await checkout.save({ session });
    await startCommercial(checkout, subId, end, event, session);
    return result('applied', 'commercial subscription active', checkout.organizationId);
  }

  if (!['subscription.renewed', 'subscription.payment_failed', 'subscription.canceled'].includes(event.type)) {
    return result('ignored_unknown', 'event type not handled');
  }
  const sub = subId ? await SubscriptionModel.findOne({ providerSubscriptionId: { $eq: subId, $type: 'string' } }).session(session).lean() : null;
  if (!sub) return result('ignored_unknown', 'unknown subscription');
  if (sub.providerEventAt && event.occurredAt <= sub.providerEventAt)
    return result('ignored_stale', 'older than the last applied event', sub.organizationId);

  let to: SubscriptionStatus = sub.status;
  const extra: Partial<PlatformSubscription> = { providerEventAt: event.occurredAt };
  if (event.type === 'subscription.renewed') {
    const end = date(event.data.currentPeriodEnd);
    if (!end) return result('rejected', 'missing period', sub.organizationId);
    extra.currentPeriodEnd = end;
    if (sub.status === 'past_due') to = 'active';
    if (to !== 'past_due') extra.pastDueSince = null;
    // The provider renewed on a different plan (a scheduled change took effect at its side).
    const plan = event.data.plan as { planId?: unknown; planCode?: unknown; planVersion?: unknown; price?: PlanPrice } | undefined;
    if (plan && typeof plan.planId === 'string' && Types.ObjectId.isValid(plan.planId) && typeof plan.planCode === 'string' && typeof plan.planVersion === 'number' && plan.price) {
      Object.assign(extra, { planId: new Types.ObjectId(plan.planId), planCode: plan.planCode, planVersion: plan.planVersion, price: plan.price, pendingChange: null });
    }
  } else if (event.type === 'subscription.payment_failed') {
    if (sub.status === 'active') to = 'past_due';
    if (!sub.pastDueSince) extra.pastDueSince = event.occurredAt;
  } else {
    to = 'canceled';
    Object.assign(extra, { pendingChange: null });
  }
  if (sub.status === 'canceled' || sub.status === 'expired') return result('ignored_stale', `subscription already ${sub.status}`, sub.organizationId);
  if (!canTransition(sub.status, to)) return result('ignored_stale', `no transition ${sub.status} → ${to}`, sub.organizationId);
  // A restriction is an operator decision: provider events update the period but never lift it.
  await changeStatus(sub, to, 'provider', event.type, extra, session);
  await audit(`subscription.${event.type.split('.')[1]}`, sub.organizationId, { from: sub.status, to, eventId: event.id }, session);
  return result('applied', `${sub.status} → ${to}`, sub.organizationId);
}

async function startCommercial(
  checkout: BillingCheckout & { _id: Types.ObjectId },
  providerSubscriptionId: string,
  end: Date,
  event: ProviderEvent,
  session: ClientSession,
) {
  const existing = await SubscriptionModel.findOne({ organizationId: checkout.organizationId }).session(session).lean();
  const status: SubscriptionStatus = existing?.status === 'restricted' ? 'restricted' : 'active';
  const entry = {
    at: clock.now(),
    from: existing?.status ?? null,
    to: status,
    kind: 'commercial' as const,
    planCode: checkout.planCode,
    planVersion: checkout.planVersion,
    actor: 'provider' as const,
    reason: existing ? `checkout.completed (replaces ${existing.kind})` : 'checkout.completed',
  };
  const fields = {
    kind: 'commercial' as const,
    planId: checkout.planId,
    planCode: checkout.planCode,
    planVersion: checkout.planVersion,
    status,
    currentPeriodEnd: end,
    price: checkout.price,
    provider: checkout.provider,
    providerSubscriptionId,
    providerEventAt: event.occurredAt,
    // A new commercial subscription starts clean (a trial converts; earlier requests do not carry over).
    trialEndsAt: null,
    pastDueSince: null,
    cancelRequest: null,
    pendingChange: null,
    ...(existing?.status === 'restricted' ? {} : { restriction: null }),
  };
  if (existing) {
    const updated = await SubscriptionModel.updateOne(
      { _id: existing._id, version: existing.version },
      { $set: fields, $inc: { version: 1 }, $push: { history: { $each: [entry], $slice: -200 } } },
      { session },
    );
    if (updated.modifiedCount !== 1) throw conflict('SUBSCRIPTION_CHANGED', 'The subscription changed meanwhile');
  } else {
    await SubscriptionModel.create([{ organizationId: checkout.organizationId, ...fields, history: [entry] }], { session });
  }
  await audit(
    'subscription.commercial_started',
    checkout.organizationId,
    {
      plan: `${checkout.planCode}@${checkout.planVersion}`,
      currency: checkout.price.currency,
      interval: checkout.price.interval,
      amountMinor: checkout.price.amountMinor,
    },
    session,
  );
}

const audit = (action: string, organizationId: Types.ObjectId, changes: Record<string, unknown>, session?: ClientSession) =>
  recordPlatformAudit(
    { operatorId: null, actor: 'provider', action, target: { type: 'organization', id: String(organizationId) }, changes },
    session,
  );

// ---------------------------------------------------------------------------------------------
// SIMULATOR actions — development and tests only. Each mutates the simulator's own state (what a
// real provider would hold) and then, unless `emit` is false (a "lost webhook"), delivers a signed
// event through exactly the same handleWebhook path as an HTTP delivery.

export type Simulator = { provider: PaymentProvider; secret: string };

const deliver = (sim: Simulator, type: string, data: Record<string, unknown>, occurredAt?: Date) => {
  const d = simulatorDelivery(sim.secret, type, data, occurredAt);
  return handleWebhook(sim.provider, d.raw, d.signature);
};

export async function simulateCheckout(
  sim: Simulator,
  checkout: BillingCheckout & { _id: Types.ObjectId },
  outcome: 'succeeded' | 'failed',
) {
  if (outcome === 'failed') return deliver(sim, 'checkout.failed', { checkoutId: String(checkout._id) });
  const providerSubscriptionId = newSimulatorId('sub_sim');
  const end = periodEnd(clock.now(), checkout.price.interval);
  await SimulatorSubscriptionModel.create({
    providerSubscriptionId,
    organizationId: checkout.organizationId,
    status: 'active',
    currentPeriodEnd: end,
    price: checkout.price,
  });
  return deliver(sim, 'checkout.completed', {
    checkoutId: String(checkout._id),
    providerSubscriptionId,
    currentPeriodEnd: end.toISOString(),
  });
}

export const SIMULATOR_ACTIONS = ['renew', 'fail_payment', 'cancel'] as const;
export type SimulatorAction = (typeof SIMULATOR_ACTIONS)[number];

export async function simulateProviderAction(sim: Simulator, organizationId: Types.ObjectId, action: SimulatorAction, emit: boolean) {
  const sub = await SubscriptionModel.findOne({ organizationId, provider: 'simulator' }).lean();
  const record = sub?.providerSubscriptionId
    ? await SimulatorSubscriptionModel.findOne({ providerSubscriptionId: sub.providerSubscriptionId })
    : null;
  if (!sub || !record) throw conflict('NO_PROVIDER_SUBSCRIPTION', 'This organization has no simulator subscription');
  if (record.status === 'canceled') throw conflict('PROVIDER_SUBSCRIPTION_CANCELED', 'The simulator subscription is canceled');
  let type: string;
  let plan: Record<string, unknown> | undefined;
  if (action === 'renew' && record.cancelAtPeriodEnd) {
    // The period ended with a scheduled cancellation: the provider ends it instead of renewing.
    record.status = 'canceled';
    type = 'subscription.canceled';
  } else if (action === 'renew') {
    if (record.scheduledPlan) {
      record.price = record.scheduledPlan.price;
      plan = { planId: String(record.scheduledPlan.planId), planCode: record.scheduledPlan.planCode, planVersion: record.scheduledPlan.planVersion, price: record.scheduledPlan.price };
      record.scheduledPlan = null;
    }
    record.currentPeriodEnd = periodEnd(record.currentPeriodEnd > clock.now() ? record.currentPeriodEnd : clock.now(), record.price.interval);
    record.status = 'active';
    type = 'subscription.renewed';
  } else if (action === 'fail_payment') {
    record.status = 'past_due';
    type = 'subscription.payment_failed';
  } else {
    record.status = 'canceled';
    type = 'subscription.canceled';
  }
  await record.save();
  if (!emit) return { emitted: false as const };
  const result = await deliver(sim, type, {
    providerSubscriptionId: record.providerSubscriptionId,
    currentPeriodEnd: record.currentPeriodEnd.toISOString(),
    ...(plan ? { plan } : {}),
  });
  return { emitted: true as const, result };
}

/**
 * The simulator's side of an owner's request: records the schedule in the simulator's own state
 * (what a real provider would hold after an API call). Returns true — "acknowledged by the
 * SIMULATOR", which the UI labels as such; no real provider is involved.
 */
export function simulatorScheduler(sim: Simulator | null) {
  if (!sim) return null;
  return {
    async schedule(
      sub: Sub,
      change: { cancelAtPeriodEnd?: boolean; scheduledPlan?: { planId: Types.ObjectId; planCode: string; planVersion: number; price: PlanPrice } | null },
    ) {
      if (sub.provider !== 'simulator' || !sub.providerSubscriptionId) return false;
      const set: Record<string, unknown> = {};
      if (change.cancelAtPeriodEnd !== undefined) set.cancelAtPeriodEnd = change.cancelAtPeriodEnd;
      if (change.scheduledPlan !== undefined) set.scheduledPlan = change.scheduledPlan;
      const res = await SimulatorSubscriptionModel.updateOne({ providerSubscriptionId: sub.providerSubscriptionId, status: { $ne: 'canceled' } }, { $set: set });
      return res.matchedCount === 1;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Reconciliation: compare local provider-backed subscriptions with the provider's own state.

export type Drift = {
  organizationId: string;
  providerSubscriptionId: string;
  local: { status: SubscriptionStatus; currentPeriodEnd: string | null };
  provider: { status: string; currentPeriodEnd: string } | null;
  action: 'update_period' | 'change_status' | 'missing_at_provider';
  applied: boolean;
};

export async function reconcile(provider: PaymentProvider, apply: boolean, operatorId: Types.ObjectId | null): Promise<Drift[]> {
  const subs = (await SubscriptionModel.find({ provider: provider.name, providerSubscriptionId: { $type: 'string' } }).lean()) as Sub[];
  const drifts: Drift[] = [];
  for (const sub of subs) {
    const remote = await provider.fetchSubscription(sub.providerSubscriptionId!);
    const base = {
      organizationId: String(sub.organizationId),
      providerSubscriptionId: sub.providerSubscriptionId!,
      local: { status: sub.status, currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null },
      provider: remote ? { status: remote.status, currentPeriodEnd: remote.currentPeriodEnd.toISOString() } : null,
    };
    if (!remote) {
      // Never guess: a missing provider record is reported for a human to resolve.
      drifts.push({ ...base, action: 'missing_at_provider', applied: false });
      continue;
    }
    // Restricted is operator-owned; only a provider cancellation overrides it.
    const wanted: SubscriptionStatus = sub.status === 'restricted' && remote.status !== 'canceled' ? 'restricted' : remote.status;
    const periodDiffers = sub.currentPeriodEnd?.getTime() !== remote.currentPeriodEnd.getTime();
    if (wanted === sub.status && !periodDiffers) continue;
    const action = wanted !== sub.status ? 'change_status' : 'update_period';
    let applied = false;
    if (apply && sub.status !== 'canceled' && canTransition(sub.status, wanted)) {
      await changeStatus(sub, wanted, 'system', 'reconciliation', { currentPeriodEnd: remote.currentPeriodEnd });
      await recordPlatformAudit({
        operatorId,
        actor: operatorId ? 'operator' : 'system',
        action: 'subscription.reconciled',
        target: { type: 'subscription', id: String(sub._id) },
        changes: { from: sub.status, to: wanted, periodChanged: periodDiffers },
      });
      applied = true;
    }
    drifts.push({ ...base, action, applied });
  }
  return drifts;
}
