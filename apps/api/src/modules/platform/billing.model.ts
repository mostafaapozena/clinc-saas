import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { CURRENCY_CODES, MAX_AMOUNT, type Currency } from '../finance/finance.model.js';

// Platform subscriptions (docs/architecture/SUBSCRIPTIONS.md) — what an organization pays raclinic,
// entirely separate from a clinic's own finances. Plans are configuration: nothing here invents a
// price, trial length or limit. A plan may have no prices at all (usable for development grants
// only); a limit of null means "not limited by this plan".

export const PLAN_STATUSES = ['draft', 'active', 'retired'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const BILLING_INTERVALS = ['month', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
/** Resources a plan may limit; counted live when enforcement is on. */
export const LIMITED_RESOURCES = ['branches', 'practitioners', 'members'] as const;
export type LimitedResource = (typeof LIMITED_RESOURCES)[number];
export type PlanLimits = Record<LimitedResource, number | null>;

export type PlanPrice = { currency: Currency; interval: BillingInterval; amountMinor: number };

export interface PlatformPlan {
  code: string;
  version: number;
  name: { ar: string; en: string };
  status: PlanStatus;
  prices: PlanPrice[];
  limits: PlanLimits;
  /** Internal note for operators (never shown to clinics). */
  note: string;
  /** Free trial length offered with this plan; null = no trial (nothing is invented). */
  trialDays: number | null;
  activatedAt: Date | null;
  retiredAt: Date | null;
  /** Optimistic concurrency for draft edits. */
  revision: number;
  seedKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const priceSchema = new Schema<PlanPrice>(
  {
    currency: { type: String, enum: CURRENCY_CODES, required: true },
    interval: { type: String, enum: BILLING_INTERVALS, required: true },
    amountMinor: { type: Number, required: true, min: 0, max: MAX_AMOUNT, validate: Number.isInteger },
  },
  { _id: false },
);
const limit = { type: Number, default: null, min: 0, max: 100_000, validate: (v: number | null) => v === null || Number.isInteger(v) };

const planSchema = new Schema<PlatformPlan>(
  {
    code: { type: String, required: true, match: /^[a-z][a-z0-9-]{1,39}$/ },
    version: { type: Number, required: true, min: 1 },
    name: {
      type: new Schema(
        { ar: { type: String, required: true, maxlength: 80 }, en: { type: String, required: true, maxlength: 80 } },
        { _id: false },
      ),
      required: true,
    },
    status: { type: String, enum: PLAN_STATUSES, required: true, default: 'draft' },
    prices: { type: [priceSchema], default: [] },
    limits: {
      type: new Schema({ branches: limit, practitioners: limit, members: limit }, { _id: false }),
      default: () => ({ branches: null, practitioners: null, members: null }),
    },
    note: { type: String, default: '', maxlength: 500 },
    trialDays: { type: Number, default: null, min: 1, max: 365, validate: (v: number | null) => v === null || Number.isInteger(v) },
    activatedAt: { type: Date, default: null },
    retiredAt: { type: Date, default: null },
    revision: { type: Number, required: true, default: 0 },
    seedKey: { type: String },
  },
  { collection: 'platform_plans', timestamps: true, minimize: false },
);
planSchema.index({ code: 1, version: 1 }, { unique: true });
// At most one draft per plan code (the next version being prepared).
planSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { status: 'draft' } });
export type PlanDocument = HydratedDocument<PlatformPlan>;
export const PlanModel = model<PlatformPlan>('PlatformPlan', planSchema);

export const SUBSCRIPTION_KINDS = ['development_grant', 'commercial'] as const;
export type SubscriptionKind = (typeof SUBSCRIPTION_KINDS)[number];
/** `trialing` and `expired` added in the scalability/subscriptions checkpoint (documents written before simply never use them). */
export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'restricted', 'canceled', 'expired'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export type HistoryActor = 'operator' | 'provider' | 'system';

export interface SubscriptionHistoryEntry {
  at: Date;
  from: SubscriptionStatus | null;
  to: SubscriptionStatus;
  kind: SubscriptionKind;
  planCode: string;
  planVersion: number;
  actor: HistoryActor;
  /** Operator reason, provider event type or "reconciliation". Never patient data. */
  reason: string;
}

/**
 * One current subscription per organization. A development grant is free access granted by an
 * operator for development, pilots or demos — it is NOT a commercial subscription and is labelled as
 * such everywhere. A commercial subscription exists only after a confirmed provider event.
 */
export interface PlatformSubscription {
  organizationId: Types.ObjectId;
  kind: SubscriptionKind;
  planId: Types.ObjectId;
  planCode: string;
  planVersion: number;
  status: SubscriptionStatus;
  /** End of a grant (null = open-ended) or the paid-through date of a commercial subscription. */
  currentPeriodEnd: Date | null;
  price: PlanPrice | null;
  provider: 'simulator' | null;
  providerSubscriptionId: string | null;
  /** occurredAt of the latest provider event applied — older events are ignored (out of order). */
  providerEventAt: Date | null;
  restriction: { reason: string; at: Date } | null;
  note: string;
  /** Trial end while `trialing`. */
  trialEndsAt: Date | null;
  /** One trial per organization, ever. */
  trialUsed: boolean;
  /** When the subscription became past_due (start of any grace period). */
  pastDueSince: Date | null;
  /**
   * Owner's request to end a commercial subscription at the period end. LOCAL INTENT:
   * `providerAcknowledged` is true only once the provider (today: the simulator) holds the same
   * schedule; the subscription actually ends only through a provider event.
   */
  cancelRequest: { requestedAt: Date; requestedByUserId: Types.ObjectId; reason: string; providerAcknowledged: boolean } | null;
  /** Owner's request to switch plan at the period end — local intent, same rule as cancelRequest. */
  pendingChange: {
    planId: Types.ObjectId;
    planCode: string;
    planVersion: number;
    price: PlanPrice;
    effectiveAt: Date;
    requestedAt: Date;
    requestedByUserId: Types.ObjectId;
    providerAcknowledged: boolean;
  } | null;
  version: number;
  history: SubscriptionHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const historySchema = new Schema<SubscriptionHistoryEntry>(
  {
    at: { type: Date, required: true },
    from: { type: String, enum: [...SUBSCRIPTION_STATUSES, null], default: null },
    to: { type: String, enum: SUBSCRIPTION_STATUSES, required: true },
    kind: { type: String, enum: SUBSCRIPTION_KINDS, required: true },
    planCode: { type: String, required: true },
    planVersion: { type: Number, required: true },
    actor: { type: String, enum: ['operator', 'provider', 'system'], required: true },
    reason: { type: String, default: '', maxlength: 200 },
  },
  { _id: false },
);

const subscriptionSchema = new Schema<PlatformSubscription>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    kind: { type: String, enum: SUBSCRIPTION_KINDS, required: true },
    planId: { type: Schema.Types.ObjectId, ref: 'PlatformPlan', required: true },
    planCode: { type: String, required: true },
    planVersion: { type: Number, required: true },
    status: { type: String, enum: SUBSCRIPTION_STATUSES, required: true },
    currentPeriodEnd: { type: Date, default: null },
    price: { type: priceSchema, default: null },
    provider: { type: String, enum: ['simulator', null], default: null },
    providerSubscriptionId: { type: String, default: null },
    providerEventAt: { type: Date, default: null },
    restriction: {
      type: new Schema({ reason: { type: String, required: true, maxlength: 200 }, at: { type: Date, required: true } }, { _id: false }),
      default: null,
    },
    note: { type: String, default: '', maxlength: 200 },
    trialEndsAt: { type: Date, default: null },
    trialUsed: { type: Boolean, default: false },
    pastDueSince: { type: Date, default: null },
    cancelRequest: {
      type: new Schema(
        {
          requestedAt: { type: Date, required: true },
          requestedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          reason: { type: String, default: '', maxlength: 200 },
          providerAcknowledged: { type: Boolean, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    pendingChange: {
      type: new Schema(
        {
          planId: { type: Schema.Types.ObjectId, ref: 'PlatformPlan', required: true },
          planCode: { type: String, required: true },
          planVersion: { type: Number, required: true },
          price: { type: priceSchema, required: true },
          effectiveAt: { type: Date, required: true },
          requestedAt: { type: Date, required: true },
          requestedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          providerAcknowledged: { type: Boolean, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    version: { type: Number, required: true, default: 0 },
    history: { type: [historySchema], default: [] },
  },
  { collection: 'platform_subscriptions', timestamps: true },
);
subscriptionSchema.index({ organizationId: 1 }, { unique: true });
subscriptionSchema.index(
  { providerSubscriptionId: 1 },
  { unique: true, partialFilterExpression: { providerSubscriptionId: { $type: 'string' } } },
);
subscriptionSchema.index({ status: 1, kind: 1 });
// Lifecycle processing scans by these dates.
subscriptionSchema.index({ status: 1, trialEndsAt: 1 });
subscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });
subscriptionSchema.index({ status: 1, pastDueSince: 1 });
// Subscriptions are never deleted: history and audit must survive cancellation.
subscriptionSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], function () {
  if (this.getOptions().allowSeedCleanup !== true) throw new Error('Subscriptions are never deleted');
});
export type SubscriptionDocument = HydratedDocument<PlatformSubscription>;
export const SubscriptionModel = model<PlatformSubscription>('PlatformSubscription', subscriptionSchema);

/** A checkout an owner started; completed or failed only by a verified provider event. */
export interface BillingCheckout {
  organizationId: Types.ObjectId;
  createdByUserId: Types.ObjectId;
  planId: Types.ObjectId;
  planCode: string;
  planVersion: number;
  price: PlanPrice;
  provider: 'simulator';
  status: 'open' | 'completed' | 'failed' | 'expired';
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
const checkoutSchema = new Schema<BillingCheckout>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    planId: { type: Schema.Types.ObjectId, ref: 'PlatformPlan', required: true },
    planCode: { type: String, required: true },
    planVersion: { type: Number, required: true },
    price: { type: priceSchema, required: true },
    provider: { type: String, enum: ['simulator'], required: true },
    status: { type: String, enum: ['open', 'completed', 'failed', 'expired'], required: true, default: 'open' },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'billing_checkouts', timestamps: true },
);
checkoutSchema.index({ organizationId: 1, createdAt: -1 });
export const CheckoutModel = model<BillingCheckout>('BillingCheckout', checkoutSchema);

/** Webhook ledger: one row per provider event id (dedupe), with what was done about it. */
export const EVENT_OUTCOMES = ['applied', 'ignored_stale', 'ignored_unknown', 'rejected'] as const;
export interface BillingEvent {
  provider: string;
  eventId: string;
  type: string;
  occurredAt: Date;
  organizationId: Types.ObjectId | null;
  providerSubscriptionId: string | null;
  outcome: (typeof EVENT_OUTCOMES)[number];
  detail: string;
  payloadHash: string;
  createdAt: Date;
}
const billingEventSchema = new Schema<BillingEvent>(
  {
    provider: { type: String, required: true },
    eventId: { type: String, required: true, maxlength: 100 },
    type: { type: String, required: true, maxlength: 60 },
    occurredAt: { type: Date, required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null },
    providerSubscriptionId: { type: String, default: null },
    outcome: { type: String, enum: EVENT_OUTCOMES, required: true },
    detail: { type: String, default: '', maxlength: 200 },
    payloadHash: { type: String, required: true },
  },
  { collection: 'billing_events', timestamps: { createdAt: true, updatedAt: false } },
);
billingEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
billingEventSchema.index({ organizationId: 1, createdAt: -1 });
billingEventSchema.index({ createdAt: -1 });
export const BillingEventModel = model<BillingEvent>('BillingEvent', billingEventSchema);

/**
 * The payment SIMULATOR's own state — stands in for what a real provider would hold on its side, so
 * reconciliation can be exercised. Development and tests only; refused in production.
 */
export interface SimulatorSubscription {
  providerSubscriptionId: string;
  organizationId: Types.ObjectId;
  status: 'active' | 'past_due' | 'canceled';
  currentPeriodEnd: Date;
  price: PlanPrice;
  /** Provider-side schedule (what a real provider would hold after being told): cancel at period end. */
  cancelAtPeriodEnd: boolean;
  /** Provider-side schedule: switch to this plan/price at the next renewal. */
  scheduledPlan: { planId: Types.ObjectId; planCode: string; planVersion: number; price: PlanPrice } | null;
  createdAt: Date;
  updatedAt: Date;
}
const scheduledPlanSchema = new Schema(
  {
    planId: { type: Schema.Types.ObjectId, ref: 'PlatformPlan', required: true },
    planCode: { type: String, required: true },
    planVersion: { type: Number, required: true },
    price: { type: priceSchema, required: true },
  },
  { _id: false },
);
const simulatorSchema = new Schema<SimulatorSubscription>(
  {
    providerSubscriptionId: { type: String, required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    status: { type: String, enum: ['active', 'past_due', 'canceled'], required: true },
    currentPeriodEnd: { type: Date, required: true },
    price: { type: priceSchema, required: true },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    scheduledPlan: { type: scheduledPlanSchema, default: null },
  },
  { collection: 'billing_simulator_subscriptions', timestamps: true },
);
simulatorSchema.index({ providerSubscriptionId: 1 }, { unique: true });
export const SimulatorSubscriptionModel = model<SimulatorSubscription>('SimulatorSubscription', simulatorSchema);

/**
 * The platform billing POLICY (one document, edited by platform administrators, versioned and
 * audited). Every value starts unset: grace length and what happens after it, and how much a
 * restricted organization may still change, are commercial decisions (B4). Nothing here is applied
 * to anyone unless lifecycle processing is run and, for blocking, SUBSCRIPTION_ENFORCEMENT is on.
 */
export const AFTER_GRACE_ACTIONS = ['none', 'restricted'] as const;
export const RESTRICTED_ACCESS_MODES = ['growth_only', 'read_only'] as const;
export interface BillingPolicy {
  _id: string;
  /** Days a past_due subscription keeps full access before `afterGrace` applies; null = no automatic step. */
  graceDays: number | null;
  afterGrace: (typeof AFTER_GRACE_ACTIONS)[number];
  /** With enforcement on: restricted/expired organizations stop growing only, or stop most changes. */
  restrictedAccess: (typeof RESTRICTED_ACCESS_MODES)[number];
  revision: number;
  updatedByOperatorId: Types.ObjectId | null;
  updatedAt: Date;
}
const policySchema = new Schema<BillingPolicy>(
  {
    _id: { type: String, required: true },
    graceDays: { type: Number, default: null, min: 1, max: 365, validate: (v: number | null) => v === null || Number.isInteger(v) },
    afterGrace: { type: String, enum: AFTER_GRACE_ACTIONS, required: true, default: 'none' },
    restrictedAccess: { type: String, enum: RESTRICTED_ACCESS_MODES, required: true, default: 'growth_only' },
    revision: { type: Number, required: true, default: 0 },
    updatedByOperatorId: { type: Schema.Types.ObjectId, ref: 'PlatformOperator', default: null },
  },
  { collection: 'platform_billing_policy', timestamps: { createdAt: false, updatedAt: true } },
);
export const BillingPolicyModel = model<BillingPolicy>('BillingPolicy', policySchema);
export const DEFAULT_POLICY = { graceDays: null, afterGrace: 'none', restrictedAccess: 'growth_only', revision: 0 } as const;
