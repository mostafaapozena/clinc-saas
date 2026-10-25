import type { RequestHandler } from 'express';
import { DateTime } from 'luxon';
import type { Types } from 'mongoose';
import { conflict, HttpError } from '../../http/errors.js';
import { tenantOf } from '../../tenancy/tenant-context.js';
import { clock } from '../../time/clock.js';
import {
  BillingPolicyModel,
  DEFAULT_POLICY,
  SubscriptionModel,
  type BillingPolicy,
  type PlanPrice,
  type PlatformPlan,
  type PlatformSubscription,
  type SubscriptionStatus,
} from './billing.model.js';
import { recordPlatformAudit } from './operator.model.js';
import { GROWTH_BLOCKED, REPLACEABLE, changeStatus, effectiveStatus, type EnforcementMode } from './subscription.service.js';

// Subscription lifecycle (docs/architecture/SUBSCRIPTIONS.md#lifecycle): trials, grace policy,
// plan-change and cancellation REQUESTS, and the processing pass that moves subscriptions whose
// dates have passed. Nothing commercial is invented: trial length comes from the plan, grace from
// the platform policy, and both are unset by default.
//
// Local intent vs provider state: an owner's plan change or cancellation is stored as a request.
// It is "provider acknowledged" only when the provider (today: the labelled simulator) holds the
// same schedule; a commercial subscription changes plan or ends only through a verified provider
// event. Without a provider, the request stays a recorded intent and nothing claims otherwise.

type Sub = PlatformSubscription & { _id: Types.ObjectId };

const POLICY_ID = 'default';
export async function getPolicy(): Promise<Omit<BillingPolicy, '_id' | 'updatedAt' | 'updatedByOperatorId'> & { updatedAt: Date | null }> {
  const doc = await BillingPolicyModel.findById(POLICY_ID).lean();
  return doc
    ? {
        graceDays: doc.graceDays,
        afterGrace: doc.afterGrace,
        restrictedAccess: doc.restrictedAccess,
        revision: doc.revision,
        updatedAt: doc.updatedAt,
      }
    : { ...DEFAULT_POLICY, updatedAt: null };
}

export async function updatePolicy(
  input: Pick<BillingPolicy, 'graceDays' | 'afterGrace' | 'restrictedAccess'>,
  revision: number,
  operatorId: Types.ObjectId,
) {
  if (input.afterGrace === 'restricted' && input.graceDays === null) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid input', { graceDays: 'required_for_after_grace' });
  }
  const current = await getPolicy();
  if (current.revision !== revision) throw conflict('POLICY_CHANGED', 'The policy changed meanwhile; reload and try again');
  const updated = await BillingPolicyModel.findOneAndUpdate(
    { _id: POLICY_ID, revision },
    { $set: { ...input, updatedByOperatorId: operatorId }, $inc: { revision: 1 } },
    // Only the very first save may create the document (revision 0 and none stored yet).
    { upsert: revision === 0, returnDocument: 'after', runValidators: true },
  )
    .lean()
    .catch((err: unknown) => {
      if ((err as { code?: number }).code === 11000) throw conflict('POLICY_CHANGED', 'The policy changed meanwhile; reload and try again');
      throw err;
    });
  if (!updated) throw conflict('POLICY_CHANGED', 'The policy changed meanwhile; reload and try again');
  await recordPlatformAudit({
    operatorId,
    actor: 'operator',
    action: 'billing.policy_updated',
    target: { type: 'subscription', id: 'policy' },
    changes: {
      from: { graceDays: current.graceDays, afterGrace: current.afterGrace, restrictedAccess: current.restrictedAccess },
      to: input,
    },
  });
  return updated;
}

// --- Trials -------------------------------------------------------------------------------------

export const trialEnd = (start: Date, days: number) => DateTime.fromJSDate(start, { zone: 'utc' }).plus({ days }).toJSDate();

/**
 * Starts a trial on a plan that offers one (plan.trialDays) — or, for an operator, with an explicit
 * end date. One trial per organization ever; only when there is no live subscription.
 */
export async function startTrial(
  organizationId: Types.ObjectId,
  plan: PlatformPlan & { _id: Types.ObjectId },
  endsAt: Date,
  actor: 'owner' | 'operator',
  actorId: Types.ObjectId,
) {
  const now = clock.now();
  if (endsAt <= now) throw conflict('END_IN_PAST', 'The trial must end in the future');
  const existing = (await SubscriptionModel.findOne({ organizationId }).lean()) as Sub | null;
  if (existing?.trialUsed) throw conflict('TRIAL_ALREADY_USED', 'This organization has already had a trial');
  if (existing && !REPLACEABLE.includes(existing.status))
    throw conflict('SUBSCRIPTION_EXISTS', 'The organization already has a subscription');
  const reason = actor === 'owner' ? 'trial started by the owner' : 'trial started by an operator';
  const entry = {
    at: now,
    from: existing?.status ?? null,
    to: 'trialing' as const,
    kind: 'development_grant' as const,
    planCode: plan.code,
    planVersion: plan.version,
    actor: actor === 'owner' ? ('system' as const) : ('operator' as const),
    reason,
  };
  // A trial is free access, like a grant: kind development_grant, never commercial.
  const fields = {
    kind: 'development_grant' as const,
    planId: plan._id,
    planCode: plan.code,
    planVersion: plan.version,
    status: 'trialing' as const,
    trialEndsAt: endsAt,
    trialUsed: true,
    currentPeriodEnd: endsAt,
    price: null,
    provider: null,
    providerSubscriptionId: null,
    providerEventAt: null,
    restriction: null,
    pastDueSince: null,
    cancelRequest: null,
    pendingChange: null,
    note: reason,
  };
  let saved;
  if (existing) {
    saved = await SubscriptionModel.findOneAndUpdate(
      { _id: existing._id, version: existing.version, trialUsed: { $ne: true } },
      { $set: fields, $inc: { version: 1 }, $push: { history: { $each: [entry], $slice: -200 } } },
      { returnDocument: 'after' },
    ).lean();
    if (!saved) throw conflict('SUBSCRIPTION_CHANGED', 'The subscription changed meanwhile; reload and try again');
  } else {
    try {
      saved = (await SubscriptionModel.create({ organizationId, ...fields, history: [entry] })).toObject();
    } catch (err) {
      if ((err as { code?: number }).code === 11000)
        throw conflict('SUBSCRIPTION_CHANGED', 'The subscription changed meanwhile; reload and try again');
      throw err;
    }
  }
  await recordPlatformAudit({
    operatorId: actor === 'operator' ? actorId : null,
    actor,
    action: 'subscription.trial_started',
    target: { type: 'organization', id: String(organizationId) },
    changes: { plan: `${plan.code}@${plan.version}`, trialEndsAt: endsAt.toISOString() },
  });
  return saved as Sub;
}

// --- Owner requests: plan change and cancellation ---------------------------------------------------

export type ProviderScheduler = {
  /** Tells the provider about a schedule; returns whether the provider now holds it. */
  schedule(
    sub: Sub,
    change: {
      cancelAtPeriodEnd?: boolean;
      scheduledPlan?: { planId: Types.ObjectId; planCode: string; planVersion: number; price: PlanPrice } | null;
    },
  ): Promise<boolean>;
} | null;

const live = (sub: Sub) => !REPLACEABLE.includes(sub.status);

async function setRequest(
  sub: Sub,
  set: Record<string, unknown>,
  action: string,
  userId: Types.ObjectId,
  changes: Record<string, unknown>,
) {
  const updated = await SubscriptionModel.findOneAndUpdate(
    { _id: sub._id, version: sub.version },
    { $set: set, $inc: { version: 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw conflict('SUBSCRIPTION_CHANGED', 'The subscription changed meanwhile; reload and try again');
  await recordPlatformAudit({
    operatorId: null,
    actor: 'owner',
    action,
    target: { type: 'organization', id: String(sub.organizationId) },
    changes: { ...changes, by: String(userId) },
  });
  return updated as Sub;
}

/** Plan change for a COMMERCIAL subscription, effective at the end of the current period. Idempotent. */
export async function requestPlanChange(
  sub: Sub,
  plan: PlatformPlan & { _id: Types.ObjectId },
  price: PlanPrice,
  userId: Types.ObjectId,
  provider: ProviderScheduler,
) {
  if (sub.kind !== 'commercial' || !['active', 'past_due'].includes(sub.status) || !sub.currentPeriodEnd) {
    throw conflict('PLAN_CHANGE_NOT_AVAILABLE', 'Only an active commercial subscription can change plan');
  }
  if (sub.cancelRequest) throw conflict('CANCELLATION_PENDING', 'Withdraw the cancellation request first');
  if (String(sub.planId) === String(plan._id) && sub.price?.currency === price.currency && sub.price.interval === price.interval) {
    throw conflict('SAME_PLAN', 'This is already the current plan and price');
  }
  const same =
    sub.pendingChange &&
    String(sub.pendingChange.planId) === String(plan._id) &&
    sub.pendingChange.price.currency === price.currency &&
    sub.pendingChange.price.interval === price.interval &&
    sub.pendingChange.price.amountMinor === price.amountMinor;
  if (same) return { subscription: sub, replayed: true };
  const scheduledPlan = { planId: plan._id, planCode: plan.code, planVersion: plan.version, price };
  const acknowledged = provider ? await provider.schedule(sub, { scheduledPlan }) : false;
  const pendingChange = {
    ...scheduledPlan,
    effectiveAt: sub.currentPeriodEnd,
    requestedAt: clock.now(),
    requestedByUserId: userId,
    providerAcknowledged: acknowledged,
  };
  const updated = await setRequest(sub, { pendingChange }, 'subscription.plan_change_requested', userId, {
    to: `${plan.code}@${plan.version}`,
    currency: price.currency,
    interval: price.interval,
    amountMinor: price.amountMinor,
    effectiveAt: sub.currentPeriodEnd.toISOString(),
    providerAcknowledged: acknowledged,
  });
  return { subscription: updated, replayed: false };
}

export async function withdrawPlanChange(sub: Sub, userId: Types.ObjectId, provider: ProviderScheduler) {
  if (!sub.pendingChange) return sub;
  if (provider && sub.pendingChange.providerAcknowledged) await provider.schedule(sub, { scheduledPlan: null });
  return setRequest(sub, { pendingChange: null }, 'subscription.plan_change_withdrawn', userId, {});
}

/**
 * Owner cancellation. Commercial: a request to end at the period end (provider-owned; see above).
 * Trial or development grant (free, local): ends now, after explicit confirmation. Data is kept.
 */
export async function requestCancellation(sub: Sub, userId: Types.ObjectId, reason: string, provider: ProviderScheduler) {
  if (!live(sub)) throw conflict('INVALID_TRANSITION', 'The subscription has already ended');
  if (sub.kind === 'commercial') {
    if (sub.cancelRequest) return { subscription: sub, replayed: true, endsAt: sub.currentPeriodEnd };
    const acknowledged = provider ? await provider.schedule(sub, { cancelAtPeriodEnd: true, scheduledPlan: null }) : false;
    const updated = await setRequest(
      sub,
      {
        cancelRequest: { requestedAt: clock.now(), requestedByUserId: userId, reason, providerAcknowledged: acknowledged },
        pendingChange: null,
      },
      'subscription.cancellation_requested',
      userId,
      { endsAt: sub.currentPeriodEnd?.toISOString() ?? null, providerAcknowledged: acknowledged },
    );
    return { subscription: updated, replayed: false, endsAt: sub.currentPeriodEnd };
  }
  const updated = await changeStatus(sub, 'canceled', 'system', `canceled by the owner${reason ? `: ${reason}` : ''}`.slice(0, 200), {
    pendingChange: null,
    cancelRequest: null,
  });
  await recordPlatformAudit({
    operatorId: null,
    actor: 'owner',
    action: 'subscription.canceled_by_owner',
    target: { type: 'organization', id: String(sub.organizationId) },
    changes: { kind: sub.kind, from: sub.status, by: String(userId) },
  });
  return { subscription: updated as Sub, replayed: false, endsAt: clock.now() };
}

export async function withdrawCancellation(sub: Sub, userId: Types.ObjectId, provider: ProviderScheduler) {
  if (!sub.cancelRequest) return sub;
  if (!live(sub)) throw conflict('INVALID_TRANSITION', 'The subscription has already ended');
  if (provider && sub.cancelRequest.providerAcknowledged) await provider.schedule(sub, { cancelAtPeriodEnd: false });
  return setRequest(sub, { cancelRequest: null }, 'subscription.cancellation_withdrawn', userId, {});
}

// --- Processing pass -------------------------------------------------------------------------------

export type LifecycleAction = {
  organizationId: string;
  from: SubscriptionStatus;
  to: SubscriptionStatus | null;
  reason: 'trial_ended' | 'grant_ended' | 'grace_ended' | 'awaiting_provider';
  applied: boolean;
  conflict?: boolean;
};

/**
 * Moves subscriptions whose dates have passed. Safe to run from several replicas or twice in a row:
 * every change is a conditional update on the version, so a concurrent run gets a conflict (counted,
 * not applied twice) and a second run finds nothing left to do. Commercial subscriptions are never
 * ended here — their end comes from the provider (reported as awaiting_provider).
 */
export async function processLifecycle(
  apply: boolean,
  now = clock.now(),
  operatorId: Types.ObjectId | null = null,
): Promise<LifecycleAction[]> {
  const policy = await getPolicy();
  const actions: LifecycleAction[] = [];
  const step = async (sub: Sub, to: SubscriptionStatus | null, reason: LifecycleAction['reason'], extra: Record<string, unknown> = {}) => {
    const action: LifecycleAction = { organizationId: String(sub.organizationId), from: sub.status, to, reason, applied: false };
    if (apply && to) {
      try {
        await changeStatus(sub, to, 'system', reason, extra);
        await recordPlatformAudit({
          operatorId,
          actor: operatorId ? 'operator' : 'system',
          action: `subscription.${reason}`,
          target: { type: 'organization', id: String(sub.organizationId) },
          changes: { from: sub.status, to },
        });
        action.applied = true;
      } catch (err) {
        if (err instanceof HttpError && err.status === 409) action.conflict = true;
        else throw err;
      }
    }
    actions.push(action);
  };

  for (const sub of (await SubscriptionModel.find({ status: 'trialing', trialEndsAt: { $lte: now } })
    .limit(1000)
    .lean()) as Sub[]) {
    await step(sub, 'expired', 'trial_ended');
  }
  for (const sub of (await SubscriptionModel.find({ status: 'active', kind: 'development_grant', currentPeriodEnd: { $lte: now } })
    .limit(1000)
    .lean()) as Sub[]) {
    await step(sub, 'expired', 'grant_ended');
  }
  if (policy.afterGrace === 'restricted' && policy.graceDays !== null) {
    const cutoff = new Date(now.getTime() - policy.graceDays * 86_400_000);
    for (const sub of (await SubscriptionModel.find({ status: 'past_due', pastDueSince: { $lte: cutoff } })
      .limit(1000)
      .lean()) as Sub[]) {
      await step(sub, 'restricted', 'grace_ended', { restriction: { reason: `grace period of ${policy.graceDays} days ended`, at: now } });
    }
  }
  for (const sub of (await SubscriptionModel.find({
    kind: 'commercial',
    status: { $in: ['active', 'past_due'] },
    currentPeriodEnd: { $lte: now },
  })
    .limit(1000)
    .lean()) as Sub[]) {
    await step(sub, null, 'awaiting_provider');
  }
  return actions;
}

// --- Read-only access policy (only with enforcement on AND policy read_only) ----------------------

/**
 * Paths a restricted organization may still change in read_only mode: its subscription (to pay or
 * cancel), support requests, and clinical documentation and coverage — blocking a doctor mid-visit
 * is a patient-safety question, not a billing one. Everything else that changes data is refused
 * with 403 SUBSCRIPTION_READ_ONLY. Reading is never blocked and nothing is deleted.
 */
const READ_ONLY_EXEMPT = [
  /^\/subscription(\/|$)/,
  /^\/support(\/|$)/,
  /^\/encounters(\/|$)/,
  /^\/appointments\/[^/]+\/encounter$/,
  /^\/clinical(\/|$)/,
];

export const restrictedWriteGuard: RequestHandler = async (req, _res, next) => {
  const mode = (req.app.locals.subscriptionEnforcement ?? 'off') as EnforcementMode;
  if (mode !== 'on' || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const path = req.path.replace(/^\/[a-f\d]{24}/i, '');
  if (READ_ONLY_EXEMPT.some((re) => re.test(path))) return next();
  const tenant = tenantOf(req);
  const policy = await getPolicy();
  if (policy.restrictedAccess !== 'read_only') return next();
  const sub = await SubscriptionModel.findOne({ organizationId: tenant.organizationId }).lean();
  if (!GROWTH_BLOCKED.includes(effectiveStatus(sub))) return next();
  throw new HttpError(403, 'SUBSCRIPTION_READ_ONLY', 'The subscription is not active; existing data stays readable');
};
