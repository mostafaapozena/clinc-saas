import type { Request } from 'express';
import type { ClientSession, Types } from 'mongoose';
import { conflict, HttpError } from '../../http/errors.js';
import type { TenantContext } from '../../tenancy/tenant-context.js';
import { clock } from '../../time/clock.js';
import { BranchModel } from '../branches/branch.model.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { PractitionerModel } from '../practitioners/practitioner.model.js';
import {
  PlanModel,
  SubscriptionModel,
  type HistoryActor,
  type LimitedResource,
  type PlanLimits,
  type PlatformSubscription,
  type SubscriptionStatus,
} from './billing.model.js';
import { recordPlatformAudit } from './operator.model.js';

// The subscription state machine and entitlement checks (docs/architecture/SUBSCRIPTIONS.md).

/** Allowed status changes. A canceled subscription is replaced by a new grant or checkout, never revived. */
export const TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  active: ['past_due', 'restricted', 'canceled'],
  past_due: ['active', 'restricted', 'canceled'],
  restricted: ['active', 'canceled'],
  canceled: [],
};
export const canTransition = (from: SubscriptionStatus, to: SubscriptionStatus) => from === to || TRANSITIONS[from].includes(to);

/** What the organization is entitled to right now. "expired" and "none" are derived, never stored. */
export type EffectiveStatus = SubscriptionStatus | 'expired' | 'none';
export function effectiveStatus(sub: Pick<PlatformSubscription, 'status' | 'currentPeriodEnd'> | null, now = clock.now()): EffectiveStatus {
  if (!sub) return 'none';
  if ((sub.status === 'active' || sub.status === 'past_due') && sub.currentPeriodEnd && sub.currentPeriodEnd <= now) return 'expired';
  return sub.status;
}
/**
 * Statuses that, with enforcement on, stop the organization from GROWING (new branches,
 * practitioners, members). Nothing else is ever blocked: reading, clinical work, appointments and
 * finances continue, and no data is removed. past_due is not blocking — any grace policy is a
 * commercial decision (B4).
 */
const GROWTH_BLOCKED: readonly EffectiveStatus[] = ['restricted', 'canceled', 'expired', 'none'];

export type EnforcementMode = 'off' | 'log' | 'on';

export async function usageOf(organizationId: Types.ObjectId): Promise<Record<LimitedResource, number>> {
  const [branches, practitioners, members] = await Promise.all([
    BranchModel.countDocuments({ organizationId, status: 'active' }),
    PractitionerModel.countDocuments({ organizationId, status: 'active' }),
    MembershipModel.countDocuments({ organizationId, status: 'active' }),
  ]);
  return { branches, practitioners, members };
}

export type EntitlementVerdict =
  { allowed: true } | { allowed: false; code: 'SUBSCRIPTION_INACTIVE' | 'PLAN_LIMIT_REACHED'; resource: LimitedResource; limit?: number };

/** Pure decision: may the organization add one more of `resource`? */
export function decide(
  sub: (Pick<PlatformSubscription, 'status' | 'currentPeriodEnd'> & { limits?: PlanLimits | null }) | null,
  resource: LimitedResource,
  current: number,
  now = clock.now(),
): EntitlementVerdict {
  if (GROWTH_BLOCKED.includes(effectiveStatus(sub, now))) return { allowed: false, code: 'SUBSCRIPTION_INACTIVE', resource };
  const max = sub?.limits?.[resource] ?? null;
  if (max !== null && current + 1 > max) return { allowed: false, code: 'PLAN_LIMIT_REACHED', resource, limit: max };
  return { allowed: true };
}

/**
 * Called before creating a branch, practitioner or membership. `off` (default): nothing happens.
 * `log`: a would-be refusal is written to the platform audit, the request proceeds. `on`: refused
 * with 403 — only after the owner decides the commercial policy (B4).
 */
export async function assertEntitlement(req: Request, tenant: TenantContext, resource: LimitedResource) {
  const mode = (req.app.locals.subscriptionEnforcement ?? 'off') as EnforcementMode;
  if (mode === 'off') return;
  const sub = await SubscriptionModel.findOne({ organizationId: tenant.organizationId }).lean();
  const plan = sub ? await PlanModel.findById(sub.planId).select('limits').lean() : null;
  const usage = await usageOf(tenant.organizationId);
  const verdict = decide(sub ? { ...sub, limits: plan?.limits ?? null } : null, resource, usage[resource]);
  if (verdict.allowed) return;
  if (mode === 'log') {
    await recordPlatformAudit({
      operatorId: null,
      actor: 'system',
      action: 'entitlement.would_block',
      target: { type: 'organization', id: String(tenant.organizationId) },
      changes: { resource, code: verdict.code, limit: verdict.limit ?? null, current: usage[resource] },
    });
    return;
  }
  throw new HttpError(
    403,
    verdict.code,
    verdict.code === 'PLAN_LIMIT_REACHED' ? 'The subscription plan limit for this resource is reached' : 'The subscription is not active',
    undefined,
    { resource, ...(verdict.limit !== undefined ? { limit: verdict.limit } : {}) },
  );
}

/**
 * Applies a status change with optimistic concurrency (version) and a history entry. Throws 409
 * INVALID_TRANSITION / SUBSCRIPTION_CHANGED. Returns the updated document.
 */
export async function changeStatus(
  sub: PlatformSubscription & { _id: Types.ObjectId },
  to: SubscriptionStatus,
  actor: HistoryActor,
  reason: string,
  extra: Partial<Pick<PlatformSubscription, 'currentPeriodEnd' | 'restriction' | 'providerEventAt'>> = {},
  session?: ClientSession,
) {
  if (!canTransition(sub.status, to))
    throw conflict('INVALID_TRANSITION', `Cannot change a ${sub.status} subscription to ${to}`, { from: sub.status, to });
  const entry = {
    at: clock.now(),
    from: sub.status,
    to,
    kind: sub.kind,
    planCode: sub.planCode,
    planVersion: sub.planVersion,
    actor,
    reason,
  };
  const updated = await SubscriptionModel.findOneAndUpdate(
    { _id: sub._id, version: sub.version },
    { $set: { status: to, ...extra }, $inc: { version: 1 }, $push: { history: { $each: [entry], $slice: -200 } } },
    { returnDocument: 'after', session },
  ).lean();
  if (!updated) throw conflict('SUBSCRIPTION_CHANGED', 'The subscription changed meanwhile; reload and try again');
  return updated;
}

export function subscriptionDto(
  sub: (PlatformSubscription & { _id: Types.ObjectId }) | null,
  limits: PlanLimits | null,
  planName: { ar: string; en: string } | null,
) {
  if (!sub) return null;
  return {
    id: String(sub._id),
    kind: sub.kind,
    status: sub.status,
    effectiveStatus: effectiveStatus(sub),
    plan: { id: String(sub.planId), code: sub.planCode, version: sub.planVersion, name: planName },
    limits,
    currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
    price: sub.price,
    provider: sub.provider,
    restriction: sub.restriction ? { reason: sub.restriction.reason, at: sub.restriction.at.toISOString() } : null,
    version: sub.version,
    updatedAt: sub.updatedAt.toISOString(),
  };
}
