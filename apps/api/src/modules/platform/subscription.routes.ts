import express, { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import type { AppConfig } from '../../config/app-config.js';
import { HttpError, conflict, notFound } from '../../http/errors.js';
import { objectIdSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { parseObjectId, requirePermission, tenantOf } from '../../tenancy/tenant-context.js';
import { clock } from '../../time/clock.js';
import { recordAudit } from '../audit/audit-event.model.js';
import { BILLING_INTERVALS, CheckoutModel, PlanModel, SubscriptionModel, type PlatformPlan } from './billing.model.js';
import { handleWebhook, simulateCheckout, simulatorScheduler, type Simulator } from './billing.service.js';
import { getPolicy, requestCancellation, requestPlanChange, startTrial, trialEnd, withdrawCancellation, withdrawPlanChange } from './subscription.lifecycle.js';
import { recordPlatformAudit } from './operator.model.js';
import { SIMULATOR_SIGNATURE_HEADER, createSimulatorProvider } from './payment-provider.js';
import { subscriptionDto, usageOf } from './subscription.service.js';
import { CURRENCY_CODES } from '../finance/finance.model.js';

// Tenant side of platform subscriptions: owners and admins see the organization's subscription and
// the active plans; only the owner starts a checkout. Amounts always come from the plan on the
// server — the browser chooses a plan, currency and interval, never a price.

export const CHECKOUT_MINUTES = 30;

export function simulatorFor(config: AppConfig): Simulator | null {
  if (config.billingProvider !== 'simulator') return null;
  return { provider: createSimulatorProvider(config.billingSimulatorSecret), secret: config.billingSimulatorSecret };
}

export const planDto = (p: PlatformPlan & { _id: Types.ObjectId }) => ({
  id: String(p._id),
  code: p.code,
  version: p.version,
  name: p.name,
  status: p.status,
  prices: p.prices,
  limits: p.limits,
  trialDays: p.trialDays ?? null,
});

const checkoutSchema = z.object({ planId: objectIdSchema, currency: z.enum(CURRENCY_CODES), interval: z.enum(BILLING_INTERVALS) });
const simulateSchema = z.object({ outcome: z.enum(['succeeded', 'failed']) });

export function createSubscriptionRouter(config: AppConfig) {
  const router = Router();
  const simulator = simulatorFor(config);

  const scheduler = simulatorScheduler(simulator);
  const view = async (organizationId: Types.ObjectId) => {
    const sub = await SubscriptionModel.findOne({ organizationId }).lean();
    const plan = sub ? await PlanModel.findById(sub.planId).lean() : null;
    const policy = await getPolicy();
    return {
      subscription: subscriptionDto(sub, plan?.limits ?? null, plan?.name ?? null),
      usage: await usageOf(organizationId),
      enforcement: config.subscriptionEnforcement,
      billingProvider: config.billingProvider,
      policy: { graceDays: policy.graceDays, afterGrace: policy.afterGrace, restrictedAccess: policy.restrictedAccess },
    };
  };
  const currentSub = async (organizationId: Types.ObjectId, version: number) => {
    const sub = await SubscriptionModel.findOne({ organizationId }).lean();
    if (!sub) throw notFound();
    if (sub.version !== version) throw conflict('SUBSCRIPTION_CHANGED', 'The subscription changed meanwhile; reload and try again');
    return sub;
  };

  router.get('/subscription', requirePermission('subscription.read'), async (req, res) => {
    res.json(await view(tenantOf(req).organizationId));
  });

  /** Owner-started trial on a plan that offers one (plan.trialDays), once per organization. */
  router.post('/subscription/trial', requirePermission('subscription.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const { planId } = parseInput(z.object({ planId: objectIdSchema }), req.body);
    const plan = await PlanModel.findOne({ _id: new Types.ObjectId(planId), status: 'active' }).lean();
    if (!plan) throw notFound();
    if (!plan.trialDays) throw conflict('TRIAL_NOT_OFFERED', 'This plan does not offer a trial');
    await startTrial(tenant.organizationId, plan, trialEnd(clock.now(), plan.trialDays), 'owner', tenant.userId);
    res.status(201).json(await view(tenant.organizationId));
  });

  router.post('/subscription/plan-change', requirePermission('subscription.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(checkoutSchema.extend({ version: z.number().int().min(0) }), req.body);
    const sub = await currentSub(tenant.organizationId, input.version);
    const plan = await PlanModel.findOne({ _id: new Types.ObjectId(input.planId), status: 'active' }).lean();
    if (!plan) throw notFound();
    // The price always comes from the plan, never from the browser.
    const price = plan.prices.find((p) => p.currency === input.currency && p.interval === input.interval);
    if (!price) throw conflict('PRICE_NOT_AVAILABLE', 'This plan has no price for that currency and interval');
    const { replayed } = await requestPlanChange(sub, plan, price, tenant.userId, scheduler);
    res.status(replayed ? 200 : 201).json({ ...(await view(tenant.organizationId)), replayed });
  });

  router.post('/subscription/plan-change/withdraw', requirePermission('subscription.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const { version } = parseInput(z.object({ version: z.number().int().min(0) }), req.body);
    await withdrawPlanChange(await currentSub(tenant.organizationId, version), tenant.userId, scheduler);
    res.json(await view(tenant.organizationId));
  });

  /** Owner cancellation: requires `confirm: true` (the UI asks explicitly). Data is never removed. */
  router.post('/subscription/cancel', requirePermission('subscription.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(z.object({ version: z.number().int().min(0), confirm: z.literal(true), reason: z.string().trim().max(200).default('') }), req.body);
    const sub = await currentSub(tenant.organizationId, input.version);
    const { replayed } = await requestCancellation(sub, tenant.userId, input.reason, scheduler);
    res.status(replayed ? 200 : 201).json({ ...(await view(tenant.organizationId)), replayed });
  });

  router.post('/subscription/cancel/withdraw', requirePermission('subscription.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const { version } = parseInput(z.object({ version: z.number().int().min(0) }), req.body);
    await withdrawCancellation(await currentSub(tenant.organizationId, version), tenant.userId, scheduler);
    res.json(await view(tenant.organizationId));
  });

  router.get('/subscription/plans', requirePermission('subscription.read'), async (_req, res) => {
    const plans = await PlanModel.find({ status: 'active' }).sort({ code: 1, version: -1 }).lean();
    res.json({ data: plans.map(planDto) });
  });

  router.post('/subscription/checkouts', requirePermission('subscription.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    if (!simulator) throw conflict('BILLING_NOT_CONFIGURED', 'Online subscription payments are not configured');
    const input = parseInput(checkoutSchema, req.body);
    const plan = await PlanModel.findOne({ _id: new Types.ObjectId(input.planId), status: 'active' }).lean();
    if (!plan) throw notFound();
    const price = plan.prices.find((p) => p.currency === input.currency && p.interval === input.interval);
    if (!price) throw conflict('PRICE_NOT_AVAILABLE', 'This plan has no price for that currency and interval');
    const current = await SubscriptionModel.findOne({ organizationId: tenant.organizationId }).lean();
    if (current?.status === 'restricted') throw conflict('SUBSCRIPTION_RESTRICTED', 'The subscription is restricted; contact support');
    // An existing commercial subscription changes plan through a plan-change request instead.
    if (current?.kind === 'commercial' && current.status !== 'canceled' && current.status !== 'expired')
      throw conflict('ALREADY_SUBSCRIBED', 'Use a plan change for an existing commercial subscription');
    const checkout = await CheckoutModel.create({
      organizationId: tenant.organizationId,
      createdByUserId: tenant.userId,
      planId: plan._id,
      planCode: plan.code,
      planVersion: plan.version,
      price,
      provider: 'simulator',
      expiresAt: new Date(clock.now().getTime() + CHECKOUT_MINUTES * 60_000),
    });
    await recordAudit({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      action: 'subscription.checkout_started',
      target: { type: 'organization', id: tenant.organizationId },
      changes: { plan: `${plan.code}@${plan.version}`, currency: price.currency, interval: price.interval, amountMinor: price.amountMinor },
    });
    await recordPlatformAudit({
      operatorId: null,
      actor: 'owner',
      action: 'subscription.checkout_started',
      target: { type: 'organization', id: String(tenant.organizationId) },
      changes: { checkoutId: String(checkout._id), plan: `${plan.code}@${plan.version}` },
    });
    res.status(201).json({ checkout: checkoutDto(checkout) });
  });

  router.get('/subscription/checkouts/:checkoutId', requirePermission('subscription.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    const id = parseObjectId(req.params.checkoutId);
    const checkout = id ? await CheckoutModel.findOne({ _id: id, organizationId: tenant.organizationId }).lean() : null;
    if (!checkout) throw notFound();
    res.json({ checkout: checkoutDto(checkout) });
  });

  // SIMULATOR ONLY: stands in for the provider's hosted payment page. The outcome is delivered as a
  // signed webhook through the same verification path a real provider's would take.
  router.post('/subscription/checkouts/:checkoutId/simulate', requirePermission('subscription.manage'), async (req, res) => {
    const tenant = tenantOf(req);
    if (!simulator) throw notFound();
    const { outcome } = parseInput(simulateSchema, req.body);
    const id = parseObjectId(req.params.checkoutId);
    const checkout = id
      ? await CheckoutModel.findOne({ _id: id, organizationId: tenant.organizationId, createdByUserId: tenant.userId })
      : null;
    if (!checkout) throw notFound();
    if (checkout.status !== 'open') throw conflict('CHECKOUT_CLOSED', `This checkout is already ${checkout.status}`);
    if (checkout.expiresAt <= clock.now()) {
      checkout.status = 'expired';
      await checkout.save();
      throw conflict('CHECKOUT_CLOSED', 'This checkout has expired');
    }
    const result = await simulateCheckout(simulator, checkout, outcome);
    const fresh = await CheckoutModel.findById(checkout._id).lean();
    res.json({ checkout: fresh ? checkoutDto(fresh) : null, webhook: { outcome: result.outcome, duplicate: result.duplicate } });
  });

  return router;
}

type CheckoutLean = {
  _id: Types.ObjectId;
  planCode: string;
  planVersion: number;
  price: unknown;
  status: string;
  expiresAt: Date;
  provider: string;
};
const checkoutDto = (c: CheckoutLean) => ({
  id: String(c._id),
  plan: { code: c.planCode, version: c.planVersion },
  price: c.price,
  status: c.status,
  provider: c.provider,
  simulated: c.provider === 'simulator',
  expiresAt: c.expiresAt.toISOString(),
});

/**
 * Provider webhooks: mounted before the JSON parser (the signature covers the exact raw bytes) and
 * outside sessions, CSRF and cookies. Only the configured provider has an endpoint.
 */
export function createWebhookRouter(config: AppConfig) {
  const router = Router();
  const simulator = simulatorFor(config);
  router.post('/simulator', express.raw({ type: '*/*', limit: '64kb' }), async (req, res) => {
    if (!simulator) throw notFound();
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'WEBHOOK_SIGNATURE_INVALID', 'Webhook rejected: empty body');
    const result = await handleWebhook(simulator.provider, req.body, req.get(SIMULATOR_SIGNATURE_HEADER));
    res.json(result);
  });
  return router;
}
