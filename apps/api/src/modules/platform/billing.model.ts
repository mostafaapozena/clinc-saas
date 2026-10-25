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
export const SUBSCRIPTION_STATUSES = ['active', 'past_due', 'restricted', 'canceled'] as const;
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
  createdAt: Date;
  updatedAt: Date;
}
const simulatorSchema = new Schema<SimulatorSubscription>(
  {
    providerSubscriptionId: { type: String, required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    status: { type: String, enum: ['active', 'past_due', 'canceled'], required: true },
    currentPeriodEnd: { type: Date, required: true },
    price: { type: priceSchema, required: true },
  },
  { collection: 'billing_simulator_subscriptions', timestamps: true },
);
simulatorSchema.index({ providerSubscriptionId: 1 }, { unique: true });
export const SimulatorSubscriptionModel = model<SimulatorSubscription>('SimulatorSubscription', simulatorSchema);
