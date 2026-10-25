import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import type { AppConfig } from '../../config/app-config.js';
import { checkDatabase } from '../../db/connection.js';
import { conflict, forbidden, isDuplicateKeyError, notFound } from '../../http/errors.js';
import { objectIdSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { parseObjectId } from '../../tenancy/tenant-context.js';
import { clock } from '../../time/clock.js';
import { BranchModel } from '../branches/branch.model.js';
import { CURRENCY_CODES, MAX_AMOUNT } from '../finance/finance.model.js';
import { INQUIRY_STATUSES, OwnershipInquiryModel, type InquiryStatus, type OwnershipInquiry } from '../inquiries/inquiry.model.js';
import { maskEmail, maskName, maskPhone } from '../inquiries/inquiry.review.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { UserModel } from '../../users/user.model.js';
import { BILLING_INTERVALS, BillingEventModel, PlanModel, SubscriptionModel } from './billing.model.js';
import { SIMULATOR_ACTIONS, reconcile, simulateProviderAction } from './billing.service.js';
import {
  OPERATOR_IDLE_MINUTES,
  createOperatorAuthRouter,
  operatorOf,
  requireOperator,
  requireOperatorPermission,
  revokeOperatorSessions,
} from './operator-auth.js';
import { OperatorModel, PlatformAuditModel, recordPlatformAudit } from './operator.model.js';
import { planDto, simulatorFor } from './subscription.routes.js';
import { DevMailModel, type Mailer } from '../mail/mailer.js';
import { createSupportQueueRouter } from '../support/support.routes.js';
import { SupportRequestModel } from '../support/support.model.js';
import { REPLACEABLE, changeStatus, effectiveStatus, subscriptionDto, usageOf } from './subscription.service.js';
import { getPolicy, processLifecycle, startTrial, updatePolicy } from './subscription.lifecycle.js';
import { AFTER_GRACE_ACTIONS, RESTRICTED_ACCESS_MODES } from './billing.model.js';

// The platform operator console API (docs/architecture/PLATFORM.md). Operators manage raclinic as a
// business: organizations' METADATA, plans, subscriptions, inquiries, operators and the platform
// audit. Nothing here reads patients, appointments, clinical records or clinic finances, and there is
// no way to act as a tenant user (no impersonation).

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reasonSchema = z.string().trim().min(3).max(200);
const limitSchema = z.number().int().min(0).max(100_000).nullable();
const planInput = z.object({
  name: z.object({ ar: z.string().trim().min(2).max(80), en: z.string().trim().min(2).max(80) }),
  prices: z
    .array(
      z.object({
        currency: z.enum(CURRENCY_CODES),
        interval: z.enum(BILLING_INTERVALS),
        amountMinor: z.number().int().min(0).max(MAX_AMOUNT),
      }),
    )
    .max(8)
    .refine((list) => new Set(list.map((p) => `${p.currency}/${p.interval}`)).size === list.length, 'duplicate_price'),
  limits: z.object({ branches: limitSchema, practitioners: limitSchema, members: limitSchema }),
  note: z.string().trim().max(500).default(''),
  // Optional and unset by default: no trial length is invented.
  trialDays: z.number().int().min(1).max(365).nullable().default(null),
});
const createPlanSchema = planInput.extend({
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9-]{1,39}$/),
});
const updatePlanSchema = planInput.extend({ revision: z.number().int().min(0) });
const grantSchema = z.object({
  planId: objectIdSchema,
  endsAt: z.iso.date().nullable(),
  note: z.string().trim().min(3).max(200),
});
const statusChangeSchema = z.object({ reason: reasonSchema, version: z.number().int().min(0) });

export function createPlatformRouter(config: AppConfig, mailer?: Mailer) {
  const router = Router();
  const simulator = simulatorFor(config);
  router.use('/auth', createOperatorAuthRouter(config));
  router.use(requireOperator);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const audit = (
    req: Parameters<typeof operatorOf>[0],
    action: string,
    target: { type: Parameters<typeof recordPlatformAudit>[0]['target']['type']; id: string },
    changes: Record<string, unknown> = {},
  ) => recordPlatformAudit({ operatorId: operatorOf(req).operator._id, actor: 'operator', action, target, changes });

  // --- Overview and health ------------------------------------------------------------------
  router.get('/overview', requireOperatorPermission('platform.overview.read'), async (_req, res) => {
    const [organizations, subs, newInquiries, database, openSupport] = await Promise.all([
      OrganizationModel.estimatedDocumentCount(),
      SubscriptionModel.find().select('status kind currentPeriodEnd').lean(),
      OwnershipInquiryModel.countDocuments({ status: 'new' }),
      checkDatabase(),
      SupportRequestModel.countDocuments({ status: 'open' }),
    ]);
    const byStatus: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    for (const s of subs) {
      const status = effectiveStatus(s);
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
    }
    byStatus.none = Math.max(0, organizations - subs.length);
    res.json({
      organizations,
      subscriptions: { byStatus, byKind },
      inquiries: { new: newInquiries },
      support: { open: openSupport },
      health: { database, uptimeSeconds: Math.round(process.uptime()) },
      config: {
        billingProvider: config.billingProvider,
        subscriptionEnforcement: config.subscriptionEnforcement,
        operatorIdleMinutes: OPERATOR_IDLE_MINUTES,
        mailProvider: mailer?.name ?? config.mailProvider,
        sessionIdleMinutes: config.sessionIdleMinutes,
      },
    });
  });

  // --- Organizations (metadata only) --------------------------------------------------------
  router.get('/organizations', requireOperatorPermission('platform.organizations.read'), async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    const orgs = await OrganizationModel.find(q ? { name: { $regex: escapeRegex(q), $options: 'i' } } : {})
      .select('name type specialtyCodes timeZone createdAt')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    const ids = orgs.map((o) => o._id);
    const subs = await SubscriptionModel.find({ organizationId: { $in: ids } }).lean();
    const byOrg = new Map(subs.map((s) => [String(s.organizationId), s]));
    res.json({
      data: orgs.map((o) => {
        const s = byOrg.get(String(o._id));
        return {
          id: String(o._id),
          name: o.name,
          type: o.type ?? null,
          specialtyCodes: o.specialtyCodes ?? [],
          createdAt: o.createdAt.toISOString(),
          subscription: s
            ? { kind: s.kind, status: s.status, effectiveStatus: effectiveStatus(s), plan: `${s.planCode}@${s.planVersion}` }
            : null,
        };
      }),
    });
  });

  router.get('/organizations/:orgId', requireOperatorPermission('platform.organizations.read'), async (req, res) => {
    const id = parseObjectId(req.params.orgId);
    const org = id ? await OrganizationModel.findById(id).select('name type specialtyCodes timeZone currency createdAt').lean() : null;
    if (!org) throw notFound();
    const [sub, usage, branches, owners, events] = await Promise.all([
      SubscriptionModel.findOne({ organizationId: org._id }).lean(),
      usageOf(org._id),
      BranchModel.find({ organizationId: org._id }).select('name status').lean(),
      MembershipModel.find({ organizationId: org._id, role: 'owner', status: 'active' }).select('userId').lean(),
      BillingEventModel.find({ organizationId: org._id }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);
    const plan = sub ? await PlanModel.findById(sub.planId).lean() : null;
    const ownerUsers = await UserModel.find({ _id: { $in: owners.map((o) => o.userId) } })
      .select('displayName email')
      .lean();
    res.json({
      organization: {
        id: String(org._id),
        name: org.name,
        type: org.type ?? null,
        specialtyCodes: org.specialtyCodes ?? [],
        timeZone: org.timeZone,
        currency: org.currency ?? null,
        createdAt: org.createdAt.toISOString(),
        branches: branches.map((b) => ({ id: String(b._id), name: b.name, status: b.status })),
        // Owner contact masked: operators reach clinics through support requests, not by browsing.
        owners: ownerUsers.map((u) => ({ displayName: u.displayName, email: maskEmail(u.email) })),
      },
      usage,
      subscription: subscriptionDto(sub, plan?.limits ?? null, plan?.name ?? null),
      history: (sub?.history ?? [])
        .slice(-50)
        .reverse()
        .map((h) => ({ ...h, at: h.at.toISOString() })),
      billingEvents: events.map((e) => ({
        id: e.eventId,
        type: e.type,
        outcome: e.outcome,
        detail: e.detail,
        occurredAt: e.occurredAt.toISOString(),
        receivedAt: e.createdAt.toISOString(),
      })),
    });
  });

  // --- Plans -----------------------------------------------------------------------------------
  router.get('/plans', requireOperatorPermission('platform.plans.read'), async (_req, res) => {
    const plans = await PlanModel.find().sort({ code: 1, version: -1 }).lean();
    res.json({
      data: plans.map((p) => ({
        ...planDto(p),
        note: p.note,
        revision: p.revision,
        activatedAt: p.activatedAt?.toISOString() ?? null,
        retiredAt: p.retiredAt?.toISOString() ?? null,
      })),
    });
  });

  router.post('/plans', requireOperatorPermission('platform.plans.manage'), async (req, res) => {
    const input = parseInput(createPlanSchema, req.body);
    if (await PlanModel.exists({ code: input.code }))
      throw conflict('PLAN_CODE_TAKEN', 'A plan with this code exists; create a new version instead');
    const plan = await PlanModel.create({ ...input, version: 1, status: 'draft' });
    await audit(req, 'plan.created', { type: 'plan', id: String(plan._id) }, { code: plan.code, version: 1, prices: plan.prices.length });
    res.status(201).json({ plan: planDto(plan.toObject()) });
  });

  router.patch('/plans/:planId', requireOperatorPermission('platform.plans.manage'), async (req, res) => {
    const input = parseInput(updatePlanSchema, req.body);
    const id = parseObjectId(req.params.planId);
    if (!id) throw notFound();
    const { revision, ...fields } = input;
    const plan = await PlanModel.findOneAndUpdate(
      { _id: id, status: 'draft', revision },
      { $set: fields, $inc: { revision: 1 } },
      { returnDocument: 'after', runValidators: true },
    ).lean();
    if (!plan) {
      const exists = await PlanModel.findById(id).select('status').lean();
      if (!exists) throw notFound();
      throw conflict(exists.status === 'draft' ? 'PLAN_CHANGED' : 'PLAN_NOT_DRAFT', 'Only an unchanged draft plan can be edited');
    }
    await audit(req, 'plan.updated', { type: 'plan', id: String(plan._id) }, { prices: plan.prices.length });
    res.json({ plan: planDto(plan) });
  });

  router.post('/plans/:planId/:action', requireOperatorPermission('platform.plans.manage'), async (req, res) => {
    const action = String(req.params.action);
    if (!['activate', 'retire', 'new-version'].includes(action)) throw notFound();
    const id = parseObjectId(req.params.planId);
    const plan = id ? await PlanModel.findById(id) : null;
    if (!plan) throw notFound();
    if (action === 'activate') {
      if (plan.status !== 'draft') throw conflict('PLAN_NOT_DRAFT', 'Only a draft can be activated');
      plan.status = 'active';
      plan.activatedAt = clock.now();
      await plan.save();
    } else if (action === 'retire') {
      if (plan.status !== 'active') throw conflict('PLAN_NOT_ACTIVE', 'Only an active plan can be retired');
      // Existing subscriptions keep their plan version; it is simply no longer offered.
      plan.status = 'retired';
      plan.retiredAt = clock.now();
      await plan.save();
    } else {
      const latest = await PlanModel.findOne({ code: plan.code }).sort({ version: -1 }).lean();
      try {
        const draft = await PlanModel.create({
          code: plan.code,
          version: (latest?.version ?? plan.version) + 1,
          name: plan.name,
          prices: plan.prices,
          limits: plan.limits,
          note: plan.note,
          trialDays: plan.trialDays ?? null,
          status: 'draft',
        });
        await audit(req, 'plan.version_created', { type: 'plan', id: String(draft._id) }, { code: draft.code, version: draft.version });
        res.status(201).json({ plan: planDto(draft.toObject()) });
        return;
      } catch (err) {
        if (isDuplicateKeyError(err)) throw conflict('PLAN_DRAFT_EXISTS', 'A draft of this plan already exists');
        throw err;
      }
    }
    await audit(
      req,
      action === 'activate' ? 'plan.activated' : 'plan.retired',
      { type: 'plan', id: String(plan._id) },
      { code: plan.code, version: plan.version },
    );
    res.json({ plan: planDto(plan.toObject()) });
  });

  // --- Subscriptions ---------------------------------------------------------------------------
  const orgOr404 = async (raw: unknown) => {
    const id = parseObjectId(typeof raw === 'string' ? raw : undefined);
    const org = id ? await OrganizationModel.findById(id).select('_id').lean() : null;
    if (!org) throw notFound();
    return org._id;
  };

  /** Development grant: free access for development, pilots or demos — never a commercial subscription. */
  router.post('/organizations/:orgId/subscription/grant', requireOperatorPermission('platform.subscriptions.manage'), async (req, res) => {
    const organizationId = await orgOr404(req.params.orgId);
    const input = parseInput(grantSchema, req.body);
    const plan = await PlanModel.findOne({ _id: new Types.ObjectId(input.planId), status: 'active' }).lean();
    if (!plan) throw notFound();
    const endsAt = input.endsAt ? new Date(`${input.endsAt}T23:59:59.999Z`) : null;
    if (endsAt && endsAt <= clock.now()) throw conflict('END_IN_PAST', 'The grant must end in the future');
    const existing = await SubscriptionModel.findOne({ organizationId }).lean();
    if (existing && !REPLACEABLE.includes(existing.status))
      throw conflict('SUBSCRIPTION_EXISTS', 'Cancel the current subscription before granting another');
    const entry = {
      at: clock.now(),
      from: existing?.status ?? null,
      to: 'active' as const,
      kind: 'development_grant' as const,
      planCode: plan.code,
      planVersion: plan.version,
      actor: 'operator' as const,
      reason: input.note,
    };
    const fields = {
      kind: 'development_grant' as const,
      planId: plan._id,
      planCode: plan.code,
      planVersion: plan.version,
      status: 'active' as const,
      currentPeriodEnd: endsAt,
      price: null,
      provider: null,
      providerSubscriptionId: null,
      providerEventAt: null,
      restriction: null,
      trialEndsAt: null,
      pastDueSince: null,
      cancelRequest: null,
      pendingChange: null,
      note: input.note,
    };
    let sub;
    if (existing) {
      sub = await SubscriptionModel.findOneAndUpdate(
        { _id: existing._id, version: existing.version },
        { $set: fields, $inc: { version: 1 }, $push: { history: { $each: [entry], $slice: -200 } } },
        { returnDocument: 'after' },
      ).lean();
      if (!sub) throw conflict('SUBSCRIPTION_CHANGED', 'The subscription changed meanwhile; reload and try again');
    } else {
      try {
        sub = (await SubscriptionModel.create({ organizationId, ...fields, history: [entry] })).toObject();
      } catch (err) {
        if (isDuplicateKeyError(err)) throw conflict('SUBSCRIPTION_CHANGED', 'The subscription changed meanwhile; reload and try again');
        throw err;
      }
    }
    await audit(
      req,
      'subscription.granted',
      { type: 'organization', id: String(organizationId) },
      { plan: `${plan.code}@${plan.version}`, endsAt: input.endsAt },
    );
    res.status(201).json({ subscription: subscriptionDto(sub, plan.limits, plan.name) });
  });

  router.post(
    '/organizations/:orgId/subscription/:action',
    requireOperatorPermission('platform.subscriptions.manage'),
    async (req, res, next) => {
      // Other subscription actions (trial, plan) have their own routes further down.
      if (!['restrict', 'reinstate', 'cancel'].includes(String(req.params.action))) return next();
      const organizationId = await orgOr404(req.params.orgId);
      const input = parseInput(statusChangeSchema, req.body);
      const sub = await SubscriptionModel.findOne({ organizationId }).lean();
      if (!sub) throw notFound();
      if (sub.version !== input.version) throw conflict('SUBSCRIPTION_CHANGED', 'The subscription changed meanwhile; reload and try again');
      const action = req.params.action as 'restrict' | 'reinstate' | 'cancel';
      if (action === 'reinstate' && sub.status !== 'restricted')
        throw conflict('INVALID_TRANSITION', 'Only a restricted subscription can be reinstated');
      // Cancelling a commercial subscription here ends raclinic's side only; the provider-side
      // cancellation (a real refund or stop) is a separate, human action with the provider.
      const to = action === 'restrict' ? 'restricted' : action === 'reinstate' ? 'active' : 'canceled';
      const updated = await changeStatus(sub, to, 'operator', input.reason, {
        restriction: to === 'restricted' ? { reason: input.reason, at: clock.now() } : null,
      });
      await audit(
        req,
        `subscription.${to === 'active' ? 'reinstated' : to}`,
        { type: 'organization', id: String(organizationId) },
        { from: sub.status, to, reason: input.reason },
      );
      const plan = await PlanModel.findById(updated.planId).lean();
      res.json({ subscription: subscriptionDto(updated, plan?.limits ?? null, plan?.name ?? null) });
    },
  );

  router.get('/billing/events', requireOperatorPermission('platform.organizations.read'), async (_req, res) => {
    const events = await BillingEventModel.find().sort({ createdAt: -1 }).limit(100).lean();
    res.json({
      data: events.map((e) => ({
        id: e.eventId,
        provider: e.provider,
        type: e.type,
        outcome: e.outcome,
        detail: e.detail,
        organizationId: e.organizationId ? String(e.organizationId) : null,
        occurredAt: e.occurredAt.toISOString(),
        receivedAt: e.createdAt.toISOString(),
      })),
    });
  });

  // --- Billing policy and lifecycle processing (scalability/subscriptions checkpoint) -------------
  router.get('/billing/policy', requireOperatorPermission('platform.plans.read'), async (_req, res) => {
    res.json({ policy: await getPolicy() });
  });

  router.put('/billing/policy', requireOperatorPermission('platform.subscriptions.manage'), async (req, res) => {
    const input = parseInput(
      z.object({
        graceDays: z.number().int().min(1).max(365).nullable(),
        afterGrace: z.enum(AFTER_GRACE_ACTIONS),
        restrictedAccess: z.enum(RESTRICTED_ACCESS_MODES),
        revision: z.number().int().min(0),
      }),
      req.body,
    );
    const { revision, ...policy } = input;
    await updatePolicy(policy, revision, operatorOf(req).operator._id);
    res.json({ policy: await getPolicy() });
  });

  /** Runs (or previews) the lifecycle pass. Safe to repeat and safe if another replica runs it too. */
  router.post('/billing/lifecycle', requireOperatorPermission('platform.subscriptions.manage'), async (req, res) => {
    const { apply } = parseInput(z.object({ apply: z.boolean() }), req.body);
    const actions = await processLifecycle(apply, clock.now(), operatorOf(req).operator._id);
    if (apply) await audit(req, 'billing.lifecycle_run', { type: 'subscription', id: 'all' }, { actions: actions.length, applied: actions.filter((a) => a.applied).length });
    res.json({ actions });
  });

  /** Operator-started trial with an explicit end date (no plan default is assumed). */
  router.post('/organizations/:orgId/subscription/trial', requireOperatorPermission('platform.subscriptions.manage'), async (req, res) => {
    const organizationId = await orgOr404(req.params.orgId);
    const input = parseInput(z.object({ planId: objectIdSchema, endsAt: z.iso.date() }), req.body);
    const plan = await PlanModel.findOne({ _id: new Types.ObjectId(input.planId), status: 'active' }).lean();
    if (!plan) throw notFound();
    const sub = await startTrial(organizationId, plan, new Date(`${input.endsAt}T23:59:59.999Z`), 'operator', operatorOf(req).operator._id);
    res.status(201).json({ subscription: subscriptionDto(sub, plan.limits, plan.name) });
  });

  /** Changes the plan of a free grant or trial immediately (commercial plans change only through the provider). */
  router.post('/organizations/:orgId/subscription/plan', requireOperatorPermission('platform.subscriptions.manage'), async (req, res) => {
    const organizationId = await orgOr404(req.params.orgId);
    const input = parseInput(z.object({ planId: objectIdSchema, version: z.number().int().min(0), reason: reasonSchema }), req.body);
    const sub = await SubscriptionModel.findOne({ organizationId }).lean();
    if (!sub) throw notFound();
    if (sub.kind !== 'development_grant' || REPLACEABLE.includes(sub.status)) throw conflict('PLAN_CHANGE_NOT_AVAILABLE', 'Only a live grant or trial can change plan here');
    if (sub.version !== input.version) throw conflict('SUBSCRIPTION_CHANGED', 'The subscription changed meanwhile; reload and try again');
    const plan = await PlanModel.findOne({ _id: new Types.ObjectId(input.planId), status: 'active' }).lean();
    if (!plan) throw notFound();
    const updated = await changeStatus(sub, sub.status, 'operator', `plan changed: ${input.reason}`.slice(0, 200), { planId: plan._id, planCode: plan.code, planVersion: plan.version });
    await audit(req, 'subscription.plan_changed', { type: 'organization', id: String(organizationId) }, { from: `${sub.planCode}@${sub.planVersion}`, to: `${plan.code}@${plan.version}` });
    res.json({ subscription: subscriptionDto(updated, plan.limits, plan.name) });
  });

  router.post('/billing/reconcile', requireOperatorPermission('platform.subscriptions.manage'), async (req, res) => {
    if (!simulator) throw conflict('BILLING_NOT_CONFIGURED', 'No payment provider is configured');
    const { apply } = parseInput(z.object({ apply: z.boolean() }), req.body);
    const drifts = await reconcile(simulator.provider, apply, operatorOf(req).operator._id);
    await audit(
      req,
      'billing.reconciliation_run',
      { type: 'subscription', id: 'all' },
      { apply, drifts: drifts.length, applied: drifts.filter((d) => d.applied).length },
    );
    res.json({ drifts });
  });

  // SIMULATOR ONLY: provider-side events (renewal, failed payment, cancellation), optionally without
  // delivering the webhook — a "lost webhook" that reconciliation must then detect.
  router.post('/simulator/organizations/:orgId/:action', requireOperatorPermission('platform.subscriptions.manage'), async (req, res) => {
    if (!simulator) throw notFound();
    const action = String(req.params.action) as (typeof SIMULATOR_ACTIONS)[number];
    if (!SIMULATOR_ACTIONS.includes(action)) throw notFound();
    const organizationId = await orgOr404(req.params.orgId);
    const { emit } = parseInput(z.object({ emit: z.boolean().default(true) }), req.body);
    const result = await simulateProviderAction(simulator, organizationId, action, emit);
    await audit(req, 'billing.simulator_action', { type: 'organization', id: String(organizationId) }, { action, emit });
    res.json(result);
  });

  // --- Ownership inquiries (replaces the review script for day-to-day work) ------------------------
  const inquiryRow = (i: OwnershipInquiry) => ({
    reference: i.reference,
    createdAt: i.createdAt.toISOString(),
    status: i.status,
    country: i.country,
    organizationType: i.organizationType,
    interest: i.interest,
    organizationName: i.organizationName,
    language: i.language,
    contactName: maskName(i.contactName),
    phone: i.phone ? maskPhone(i.phone.e164) : null,
    email: i.email ? maskEmail(i.email) : null,
    reviewedAt: i.reviewedAt?.toISOString() ?? null,
  });
  const findInquiry = (reference: unknown) =>
    typeof reference === 'string' && /^R-[A-Z0-9]{8}$/.test(reference)
      ? OwnershipInquiryModel.findOne({ reference }).lean()
      : Promise.resolve(null);

  router.get('/inquiries', requireOperatorPermission('platform.inquiries.read'), async (req, res) => {
    const status =
      typeof req.query.status === 'string' && (INQUIRY_STATUSES as readonly string[]).includes(req.query.status)
        ? req.query.status
        : undefined;
    const rows = await OwnershipInquiryModel.find(status ? { status: status as InquiryStatus } : {})
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ data: rows.map(inquiryRow) });
  });

  router.get('/inquiries/:reference', requireOperatorPermission('platform.inquiries.read'), async (req, res) => {
    const inquiry = await findInquiry(req.params.reference);
    if (!inquiry) throw notFound();
    res.json({ inquiry: { ...inquiryRow(inquiry), description: inquiry.description } });
  });

  /** Unmasked contact details: explicit, per inquiry, audited. */
  router.post('/inquiries/:reference/reveal-contact', requireOperatorPermission('platform.inquiries.manage'), async (req, res) => {
    const inquiry = await findInquiry(req.params.reference);
    if (!inquiry) throw notFound();
    await audit(req, 'inquiry.contact_revealed', { type: 'inquiry', id: inquiry.reference });
    res.json({ contact: { name: inquiry.contactName, phone: inquiry.phone?.e164 ?? null, email: inquiry.email } });
  });

  router.patch('/inquiries/:reference', requireOperatorPermission('platform.inquiries.manage'), async (req, res) => {
    const { status } = parseInput(z.object({ status: z.enum(INQUIRY_STATUSES) }), req.body);
    const inquiry = await findInquiry(req.params.reference);
    if (!inquiry) throw notFound();
    const updated = await OwnershipInquiryModel.findOneAndUpdate(
      { _id: inquiry._id },
      { $set: { status, reviewedAt: status === 'new' ? null : (inquiry.reviewedAt ?? clock.now()) } },
      { returnDocument: 'after' },
    ).lean();
    await audit(req, 'inquiry.status_changed', { type: 'inquiry', id: inquiry.reference }, { from: inquiry.status, to: status });
    res.json({ inquiry: inquiryRow(updated!) });
  });

  // --- Operators (provisioned by CLI; the console can only suspend or reactivate) ----------------
  router.get('/operators', requireOperatorPermission('platform.operators.read'), async (_req, res) => {
    const operators = await OperatorModel.find().sort({ createdAt: 1 }).lean();
    res.json({
      data: operators.map((o) => ({
        id: String(o._id),
        email: o.email,
        displayName: o.displayName,
        role: o.role,
        status: o.status,
        lastLoginAt: o.lastLoginAt?.toISOString() ?? null,
      })),
    });
  });

  router.patch('/operators/:operatorId', requireOperatorPermission('platform.operators.manage'), async (req, res) => {
    const { status } = parseInput(z.object({ status: z.enum(['active', 'suspended']) }), req.body);
    const id = parseObjectId(req.params.operatorId);
    if (!id) throw notFound();
    if (id.equals(operatorOf(req).operator._id)) throw forbidden('CANNOT_CHANGE_SELF', 'You cannot change your own operator account');
    const operator = await OperatorModel.findById(id);
    if (!operator) throw notFound();
    if (
      status === 'suspended' &&
      operator.role === 'platform_admin' &&
      (await OperatorModel.countDocuments({ role: 'platform_admin', status: 'active' })) <= 1
    ) {
      throw conflict('LAST_PLATFORM_ADMIN', 'At least one active platform administrator must remain');
    }
    const from = operator.status;
    operator.status = status;
    await operator.save();
    if (status === 'suspended') await revokeOperatorSessions(operator._id);
    await audit(req, 'operator.status_changed', { type: 'operator', id: String(operator._id) }, { from, to: status });
    res.json({ operator: { id: String(operator._id), status: operator.status } });
  });

  // --- Support queue (milestone 5) ------------------------------------------------------------
  router.use('/support', createSupportQueueRouter());

  // --- Development mail sink (development only; never in production) ----------------------------
  router.get('/dev-mail', requireOperatorPermission('platform.audit.read'), async (_req, res) => {
    if ((mailer?.name ?? config.mailProvider) !== 'dev_sink' || config.production) throw notFound();
    const rows = await DevMailModel.find().sort({ createdAt: -1 }).limit(50).lean();
    res.json({ data: rows.map((m) => ({ id: String(m._id), to: m.to, template: m.template, subject: m.subject, text: m.text, createdAt: m.createdAt.toISOString() })) });
  });

  // --- Platform audit -------------------------------------------------------------------------
  router.get('/audit', requireOperatorPermission('platform.audit.read'), async (req, res) => {
    const before = typeof req.query.before === 'string' && !Number.isNaN(Date.parse(req.query.before)) ? new Date(req.query.before) : null;
    const events = await PlatformAuditModel.find(before ? { createdAt: { $lt: before } } : {})
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const operatorIds = [...new Set(events.filter((e) => e.operatorId).map((e) => String(e.operatorId)))];
    const operators = await OperatorModel.find({ _id: { $in: operatorIds } })
      .select('displayName')
      .lean();
    const names = new Map(operators.map((o) => [String(o._id), o.displayName]));
    res.json({
      data: events.map((e) => ({
        id: String(e._id),
        at: e.createdAt.toISOString(),
        actor: e.actor,
        operator: e.operatorId ? (names.get(String(e.operatorId)) ?? null) : null,
        action: e.action,
        target: e.target,
        changes: e.changes ?? {},
      })),
      next: events.length === 50 ? events.at(-1)!.createdAt.toISOString() : null,
    });
  });

  return router;
}
