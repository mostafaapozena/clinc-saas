import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/auth/password.js';
import { parseEnv } from '../src/config/env.js';
import { OwnershipInquiryModel } from '../src/modules/inquiries/inquiry.model.js';
import { BillingEventModel, PlanModel, SubscriptionModel } from '../src/modules/platform/billing.model.js';
import { OPERATOR_IDLE_MINUTES } from '../src/modules/platform/operator-auth.js';
import { parseOperatorArgs, runOperatorsCommand } from '../src/modules/platform/operator.cli.js';
import { seedPlatformData } from '../src/modules/platform/platform.seed.js';
import { OperatorModel, OperatorSessionModel, PlatformAuditModel } from '../src/modules/platform/operator.model.js';
import { SIMULATOR_SIGNATURE_HEADER, signSimulatorPayload, simulatorDelivery } from '../src/modules/platform/payment-provider.js';
import { decide, effectiveStatus } from '../src/modules/platform/subscription.service.js';
import { seedSpecialties } from '../src/modules/specialties/specialty.seed.js';
import { clock } from '../src/time/clock.js';
import { TEST_PASSWORD, addMember, createOrg, register, send, testApp, type App, type Client } from './helpers/api.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

const SECRET = 'test-only-simulator-secret-0123456789abcdef';
const app = testApp({ billingProvider: 'simulator', billingSimulatorSecret: SECRET });
const WEBHOOK = '/api/v1/billing/webhooks/simulator';

type Operator = { agent: ReturnType<typeof request.agent>; csrf: string; id: string };

async function makeOperator(email: string, role: 'platform_admin' | 'support', status: 'active' | 'suspended' = 'active') {
  const op = await OperatorModel.create({
    email,
    displayName: `Op ${role}`,
    role,
    status,
    passwordHash: await hashPassword(TEST_PASSWORD),
  });
  return String(op._id);
}
async function signIn(email: string, target: App = app): Promise<Operator> {
  const agent = request.agent(target);
  const res = await agent.post('/api/v1/platform/auth/login').send({ email, password: TEST_PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { agent, csrf: res.body.csrfToken, id: res.body.operator.id };
}
async function signInTenant(target: App, email: string): Promise<Client> {
  const agent = request.agent(target);
  const res = await agent.post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return { agent, csrf: res.body.csrfToken, userId: res.body.user.id, email };
}
const op = (o: Operator, method: 'post' | 'patch', url: string, body: object = {}) =>
  o.agent[method](`/api/v1/platform${url}`).set('X-Operator-CSRF', o.csrf).send(body);
const deliver = (raw: Buffer, signature: string, target: App = app) =>
  request(target).post(WEBHOOK).set('Content-Type', 'application/json').set(SIMULATOR_SIGNATURE_HEADER, signature).send(raw.toString());

let admin: Operator;
let support: Operator;
let owner: Client;
let orgId: string;
let devPlanId: string;
let pricedPlanId: string;

beforeAll(async () => {
  await connectTestDatabase('platform');
  await seedSpecialties();
  await makeOperator('admin.op@example.test', 'platform_admin');
  await makeOperator('support.op@example.test', 'support');
  admin = await signIn('admin.op@example.test');
  support = await signIn('support.op@example.test');
  owner = await register(app, 'plat-owner');
  ({ orgId } = await createOrg(owner, 'Platform Test Clinic'));
});
afterAll(() => dropTestDatabase());
afterEach(() => vi.restoreAllMocks());

describe('operator authentication is separate from tenant authentication', () => {
  it('answers the same for unknown, wrong-password and suspended operators', async () => {
    await makeOperator('suspended.op@example.test', 'support', 'suspended');
    for (const [email, password] of [
      ['nobody@example.test', TEST_PASSWORD],
      ['admin.op@example.test', 'wrong-password-123'],
      ['suspended.op@example.test', TEST_PASSWORD],
    ]) {
      const res = await request(app).post('/api/v1/platform/auth/login').send({ email, password });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }
  });

  it('a tenant session never opens the console, and an operator session never opens the workspace', async () => {
    expect((await owner.agent.get('/api/v1/platform/overview')).status).toBe(401);
    expect((await admin.agent.get('/api/v1/orgs')).status).toBe(401);
    expect((await admin.agent.get(`/api/v1/orgs/${orgId}`)).status).toBe(401);
    // A tenant user cannot sign in to the console with tenant credentials.
    const res = await request(app).post('/api/v1/platform/auth/login').send({ email: owner.email, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('requires the operator CSRF header for changes (the tenant header does not count)', async () => {
    const body = {
      code: 'csrf-check',
      name: { ar: 'خطة', en: 'Plan' },
      prices: [],
      limits: { branches: null, practitioners: null, members: null },
    };
    expect((await admin.agent.post('/api/v1/platform/plans').send(body)).status).toBe(403);
    expect((await admin.agent.post('/api/v1/platform/plans').set('X-CSRF-Token', admin.csrf).send(body)).status).toBe(403);
  });

  it('ends idle sessions and sessions of suspended operators', async () => {
    await makeOperator('idle.op@example.test', 'support');
    const idle = await signIn('idle.op@example.test');
    const start = clock.now().getTime();
    vi.spyOn(clock, 'now').mockImplementation(() => new Date(start + (OPERATOR_IDLE_MINUTES + 1) * 60_000));
    expect((await idle.agent.get('/api/v1/platform/overview')).status).toBe(401);
    vi.restoreAllMocks();

    const id = await makeOperator('victim.op@example.test', 'support');
    const victim = await signIn('victim.op@example.test');
    expect((await victim.agent.get('/api/v1/platform/overview')).status).toBe(200);
    expect((await op(admin, 'patch', `/operators/${id}`, { status: 'suspended' })).status).toBe(200);
    // Sessions are deleted at suspension (not only refused on their next use).
    expect(await OperatorSessionModel.countDocuments({ operatorId: id })).toBe(0);
    expect((await victim.agent.get('/api/v1/platform/overview')).status).toBe(401);
    expect((await op(admin, 'patch', `/operators/${admin.id}`, { status: 'suspended' })).body.error.code).toBe('CANNOT_CHANGE_SELF');
  });

  it('support operators cannot manage plans, subscriptions, operators or read the platform audit', async () => {
    expect((await op(support, 'post', '/plans', {})).status).toBe(403);
    expect((await op(support, 'post', `/organizations/${orgId}/subscription/grant`, {})).status).toBe(403);
    expect((await support.agent.get('/api/v1/platform/operators')).status).toBe(403);
    expect((await support.agent.get('/api/v1/platform/audit')).status).toBe(403);
    expect((await support.agent.get('/api/v1/platform/organizations')).status).toBe(200);
  });

  it('exposes organization metadata only — no patient, appointment or clinical route exists', async () => {
    const detail = await admin.agent.get(`/api/v1/platform/organizations/${orgId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.organization.owners[0].email).toMatch(/^p•••@example\.test$/);
    expect(JSON.stringify(detail.body)).not.toContain(owner.email);
    for (const path of ['patients', 'appointments', 'encounters', 'finance/invoices']) {
      expect((await admin.agent.get(`/api/v1/platform/organizations/${orgId}/${path}`)).status).toBe(404);
    }
  });
});

describe('plans are versioned configuration without invented terms', () => {
  it('drafts are editable with a revision check; active plans are frozen; new versions are drafts', async () => {
    const created = await op(admin, 'post', '/plans', {
      code: 'basic-test',
      name: { ar: 'أساسية', en: 'Basic' },
      prices: [],
      limits: { branches: null, practitioners: null, members: null },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.plan.id;
    const edited = await op(admin, 'patch', `/plans/${id}`, {
      revision: 0,
      name: { ar: 'أساسية', en: 'Basic' },
      prices: [{ currency: 'EGP', interval: 'month', amountMinor: 100 }],
      limits: { branches: 1, practitioners: null, members: null },
    });
    expect(edited.status).toBe(200);
    const stale = await op(admin, 'patch', `/plans/${id}`, {
      revision: 0,
      name: { ar: 'سس', en: 'Stale' },
      prices: [],
      limits: { branches: null, practitioners: null, members: null },
    });
    expect(stale.body.error.code).toBe('PLAN_CHANGED');
    const dup = await op(admin, 'patch', `/plans/${id}`, {
      revision: 1,
      name: { ar: 'أساسية', en: 'Basic' },
      prices: [
        { currency: 'EGP', interval: 'month', amountMinor: 1 },
        { currency: 'EGP', interval: 'month', amountMinor: 2 },
      ],
      limits: { branches: null, practitioners: null, members: null },
    });
    expect(dup.status).toBe(400);

    expect((await op(admin, 'post', `/plans/${id}/activate`)).status).toBe(200);
    const frozen = await op(admin, 'patch', `/plans/${id}`, {
      revision: 1,
      name: { ar: 'أساسية', en: 'Basic' },
      prices: [],
      limits: { branches: null, practitioners: null, members: null },
    });
    expect(frozen.body.error.code).toBe('PLAN_NOT_DRAFT');
    const v2 = await op(admin, 'post', `/plans/${id}/new-version`);
    expect(v2.status).toBe(201);
    expect(v2.body.plan).toMatchObject({ code: 'basic-test', version: 2, status: 'draft', limits: { branches: 1 } });
    expect((await op(admin, 'post', `/plans/${id}/new-version`)).body.error.code).toBe('PLAN_DRAFT_EXISTS');
    pricedPlanId = id;

    const dev = await op(admin, 'post', '/plans', {
      code: 'dev-test',
      name: { ar: 'تطوير', en: 'Dev' },
      prices: [],
      limits: { branches: null, practitioners: null, members: null },
    });
    devPlanId = dev.body.plan.id;
    await op(admin, 'post', `/plans/${devPlanId}/activate`);
  });
});

describe('development grants and the subscription state machine', () => {
  it('grants are labelled, single, versioned, and follow the allowed transitions with history', async () => {
    const grant = await op(admin, 'post', `/organizations/${orgId}/subscription/grant`, {
      planId: devPlanId,
      endsAt: null,
      note: 'Pilot for testing',
    });
    expect(grant.status, JSON.stringify(grant.body)).toBe(201);
    expect(grant.body.subscription).toMatchObject({ kind: 'development_grant', status: 'active', price: null, provider: null });
    expect(
      (await op(admin, 'post', `/organizations/${orgId}/subscription/grant`, { planId: devPlanId, endsAt: null, note: 'Again' })).body.error
        .code,
    ).toBe('SUBSCRIPTION_EXISTS');

    const tenantView = await owner.agent.get(`/api/v1/orgs/${orgId}/subscription`);
    expect(tenantView.body.subscription).toMatchObject({ kind: 'development_grant', effectiveStatus: 'active' });
    expect(tenantView.body.enforcement).toBe('off');

    const v = grant.body.subscription.version;
    expect(
      (await op(admin, 'post', `/organizations/${orgId}/subscription/restrict`, { reason: 'stale', version: v + 5 })).body.error.code,
    ).toBe('SUBSCRIPTION_CHANGED');
    const restricted = await op(admin, 'post', `/organizations/${orgId}/subscription/restrict`, {
      reason: 'Testing restriction',
      version: v,
    });
    expect(restricted.body.subscription).toMatchObject({ status: 'restricted', restriction: { reason: 'Testing restriction' } });
    // Restriction never removes data or blocks reading.
    expect((await owner.agent.get(`/api/v1/orgs/${orgId}/branches`)).status).toBe(200);
    const reinstated = await op(admin, 'post', `/organizations/${orgId}/subscription/reinstate`, { reason: 'Resolved', version: v + 1 });
    expect(reinstated.body.subscription).toMatchObject({ status: 'active', restriction: null });
    const canceled = await op(admin, 'post', `/organizations/${orgId}/subscription/cancel`, { reason: 'End pilot', version: v + 2 });
    expect(canceled.body.subscription.status).toBe('canceled');
    expect(
      (await op(admin, 'post', `/organizations/${orgId}/subscription/reinstate`, { reason: 'Nope', version: v + 3 })).body.error.code,
    ).toBe('INVALID_TRANSITION');

    const stored = await SubscriptionModel.findOne({ organizationId: orgId }).lean();
    expect(stored?.history.map((h) => h.to)).toEqual(['active', 'restricted', 'active', 'canceled']);
    expect((await admin.agent.get('/api/v1/platform/audit')).body.data.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['subscription.granted', 'subscription.restricted', 'subscription.reinstated', 'subscription.canceled']),
    );
    await expect(PlatformAuditModel.deleteMany({})).rejects.toThrow(/insert-only/);
    await expect(SubscriptionModel.deleteOne({ organizationId: orgId })).rejects.toThrow(/never deleted/);
  });

  it('derives expiry without storing it and decides growth only (pure rules)', () => {
    const now = new Date('2026-11-10T00:00:00Z');
    expect(effectiveStatus({ status: 'active', currentPeriodEnd: new Date('2026-11-09T00:00:00Z') }, now)).toBe('expired');
    expect(effectiveStatus({ status: 'active', currentPeriodEnd: null }, now)).toBe('active');
    expect(effectiveStatus(null, now)).toBe('none');
    const limited = { status: 'active' as const, currentPeriodEnd: null, limits: { branches: 2, practitioners: null, members: null } };
    expect(decide(limited, 'branches', 1, now)).toEqual({ allowed: true });
    expect(decide(limited, 'branches', 2, now)).toMatchObject({ allowed: false, code: 'PLAN_LIMIT_REACHED', limit: 2 });
    expect(decide(limited, 'members', 500, now)).toEqual({ allowed: true });
    expect(decide({ ...limited, status: 'past_due' }, 'practitioners', 0, now)).toEqual({ allowed: true });
    expect(decide({ ...limited, status: 'restricted' }, 'practitioners', 0, now)).toMatchObject({ code: 'SUBSCRIPTION_INACTIVE' });
    expect(decide(null, 'branches', 0, now)).toMatchObject({ code: 'SUBSCRIPTION_INACTIVE' });
  });
});

describe('simulated checkout, signed webhooks and reconciliation', () => {
  let checkoutId: string;

  it('only the owner starts a checkout, and the price always comes from the plan', async () => {
    const adminUser = await register(app, 'plat-admin');
    await addMember(owner, orgId, adminUser, 'admin');
    expect((await adminUser.agent.get(`/api/v1/orgs/${orgId}/subscription`)).status).toBe(200);
    expect(
      (
        await send(adminUser, 'post', `/api/v1/orgs/${orgId}/subscription/checkouts`, {
          planId: pricedPlanId,
          currency: 'EGP',
          interval: 'month',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/checkouts`, {
          planId: pricedPlanId,
          currency: 'SAR',
          interval: 'month',
        })
      ).body.error.code,
    ).toBe('PRICE_NOT_AVAILABLE');
    expect(
      (await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/checkouts`, { planId: devPlanId, currency: 'EGP', interval: 'month' }))
        .body.error.code,
    ).toBe('PRICE_NOT_AVAILABLE');

    const res = await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/checkouts`, {
      planId: pricedPlanId,
      currency: 'EGP',
      interval: 'month',
      amountMinor: 1,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.checkout).toMatchObject({
      status: 'open',
      simulated: true,
      price: { currency: 'EGP', interval: 'month', amountMinor: 100 },
    });
    checkoutId = res.body.checkout.id;

    // Another organization's owner cannot see or complete it.
    const stranger = await register(app, 'plat-stranger');
    const { orgId: otherOrg } = await createOrg(stranger, 'Other Clinic');
    expect((await stranger.agent.get(`/api/v1/orgs/${otherOrg}/subscription/checkouts/${checkoutId}`)).status).toBe(404);
    expect(
      (await send(stranger, 'post', `/api/v1/orgs/${otherOrg}/subscription/checkouts/${checkoutId}/simulate`, { outcome: 'succeeded' }))
        .status,
    ).toBe(404);
  });

  it('a successful simulated payment creates a commercial subscription only through the verified webhook path', async () => {
    const res = await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/checkouts/${checkoutId}/simulate`, { outcome: 'succeeded' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ checkout: { status: 'completed' }, webhook: { outcome: 'applied', duplicate: false } });
    const view = await owner.agent.get(`/api/v1/orgs/${orgId}/subscription`);
    expect(view.body.subscription).toMatchObject({
      kind: 'commercial',
      status: 'active',
      provider: 'simulator',
      plan: { code: 'basic-test', version: 1 },
    });
    expect(view.body.subscription.currentPeriodEnd).not.toBeNull();
    expect(
      (await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/checkouts/${checkoutId}/simulate`, { outcome: 'failed' })).body.error
        .code,
    ).toBe('CHECKOUT_CLOSED');
    const stored = await SubscriptionModel.findOne({ organizationId: orgId }).lean();
    expect(stored?.history.at(-1)).toMatchObject({ from: 'canceled', to: 'active', kind: 'commercial', actor: 'provider' });
  });

  it('rejects bad signatures, stale timestamps and malformed bodies, and stores nothing for them', async () => {
    const before = await BillingEventModel.countDocuments();
    const good = simulatorDelivery(SECRET, 'subscription.renewed', {
      providerSubscriptionId: 'sub_sim_x',
      currentPeriodEnd: new Date().toISOString(),
    });
    const forged = simulatorDelivery('another-secret-that-is-long-enough-000000', 'subscription.renewed', {
      providerSubscriptionId: 'sub_sim_x',
    });
    expect((await deliver(good.raw, forged.signature)).body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect((await deliver(Buffer.from(good.raw.toString().replace('renewed', 'canceled')), good.signature)).status).toBe(400);
    expect((await request(app).post(WEBHOOK).set('Content-Type', 'application/json').send(good.raw.toString())).status).toBe(400);
    const old = signSimulatorPayload(SECRET, good.raw.toString(), Math.floor(clock.now().getTime() / 1000) - 3600);
    expect((await deliver(good.raw, old)).body.error.message).toMatch(/tolerance/);
    const notJson = Buffer.from('not json');
    expect((await deliver(notJson, signSimulatorPayload(SECRET, 'not json'))).status).toBe(400);
    expect(await BillingEventModel.countDocuments()).toBe(before);
  });

  it('applies each event once — duplicates and concurrent replays change nothing twice', async () => {
    const sub = (await SubscriptionModel.findOne({ organizationId: orgId }).lean())!;
    const later = new Date(sub.providerEventAt!.getTime() + 60_000);
    const d = simulatorDelivery(SECRET, 'subscription.payment_failed', { providerSubscriptionId: sub.providerSubscriptionId }, later);
    const results = await Promise.all(Array.from({ length: 5 }, () => deliver(d.raw, d.signature)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.duplicate === false && r.body.outcome === 'applied')).toHaveLength(1);
    expect(await BillingEventModel.countDocuments({ eventId: d.id })).toBe(1);
    const after = (await SubscriptionModel.findOne({ organizationId: orgId }).lean())!;
    expect(after.status).toBe('past_due');
    expect(after.version).toBe(sub.version + 1);
  });

  it('ignores events older than the last applied one (out of order)', async () => {
    const sub = (await SubscriptionModel.findOne({ organizationId: orgId }).lean())!;
    const earlier = new Date(sub.providerEventAt!.getTime() - 30_000);
    const d = simulatorDelivery(
      SECRET,
      'subscription.renewed',
      { providerSubscriptionId: sub.providerSubscriptionId, currentPeriodEnd: '2030-01-01T00:00:00.000Z' },
      earlier,
    );
    const res = await deliver(d.raw, d.signature);
    expect(res.body).toMatchObject({ duplicate: false, outcome: 'ignored_stale' });
    expect((await SubscriptionModel.findOne({ organizationId: orgId }).lean())!.status).toBe('past_due');
    const unknown = simulatorDelivery(SECRET, 'subscription.renewed', {
      providerSubscriptionId: 'sub_sim_unknown',
      currentPeriodEnd: '2030-01-01T00:00:00.000Z',
    });
    expect((await deliver(unknown.raw, unknown.signature)).body.outcome).toBe('ignored_unknown');
  });

  it('reconciliation reports a lost webhook and applies the provider state only when asked', async () => {
    // Provider renews but the webhook never arrives.
    vi.spyOn(clock, 'now').mockImplementation(() => new Date(Date.now() + 120_000));
    const lost = await op(admin, 'post', `/simulator/organizations/${orgId}/renew`, { emit: false });
    expect(lost.body).toEqual({ emitted: false });
    const dry = await op(admin, 'post', '/billing/reconcile', { apply: false });
    expect(dry.body.drifts).toEqual([
      expect.objectContaining({
        organizationId: orgId,
        action: 'change_status',
        applied: false,
        local: expect.objectContaining({ status: 'past_due' }),
        provider: expect.objectContaining({ status: 'active' }),
      }),
    ]);
    expect((await SubscriptionModel.findOne({ organizationId: orgId }).lean())!.status).toBe('past_due');
    const applied = await op(admin, 'post', '/billing/reconcile', { apply: true });
    expect(applied.body.drifts[0].applied).toBe(true);
    expect((await SubscriptionModel.findOne({ organizationId: orgId }).lean())!.status).toBe('active');
    expect((await op(admin, 'post', '/billing/reconcile', { apply: false })).body.drifts).toEqual([]);
    // Support may not reconcile.
    expect((await op(support, 'post', '/billing/reconcile', { apply: true })).status).toBe(403);
  });

  it('a provider cancellation ends the subscription; later events are stale', async () => {
    vi.spyOn(clock, 'now').mockImplementation(() => new Date(Date.now() + 240_000));
    const res = await op(admin, 'post', `/simulator/organizations/${orgId}/cancel`, {});
    expect(res.body.result).toMatchObject({ outcome: 'applied' });
    expect((await SubscriptionModel.findOne({ organizationId: orgId }).lean())!.status).toBe('canceled');
  });

  it('is unavailable without a configured provider', async () => {
    const noBilling = testApp();
    const o = await register(noBilling, 'nobilling-owner');
    const { orgId: id } = await createOrg(o, 'No Billing Clinic');
    expect(
      (await send(o, 'post', `/api/v1/orgs/${id}/subscription/checkouts`, { planId: pricedPlanId, currency: 'EGP', interval: 'month' }))
        .body.error.code,
    ).toBe('BILLING_NOT_CONFIGURED');
    const d = simulatorDelivery(SECRET, 'x', {});
    expect((await deliver(d.raw, d.signature, noBilling)).status).toBe(404);
  });
});

describe('entitlement enforcement (off by default)', () => {
  it('off: nothing is checked; log: audited but allowed; on: growth refused, reading untouched', async () => {
    const o = await register(app, 'ent-owner');
    const { orgId: id } = await createOrg(o, 'Entitlement Clinic');
    expect((await send(o, 'post', `/api/v1/orgs/${id}/branches`, { name: 'Second branch' })).status).toBe(201);

    // Same database, differently configured apps: sign the owner in on each.
    const logOwner = await signInTenant(testApp({ subscriptionEnforcement: 'log' }), o.email);
    expect((await send(logOwner, 'post', `/api/v1/orgs/${id}/branches`, { name: 'Third branch' })).status).toBe(201);
    expect(await PlatformAuditModel.exists({ action: 'entitlement.would_block', 'target.id': id })).toBeTruthy();

    const onOwner = await signInTenant(testApp({ subscriptionEnforcement: 'on' }), o.email);
    const blocked = await send(onOwner, 'post', `/api/v1/orgs/${id}/branches`, { name: 'Fourth branch' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatchObject({ code: 'SUBSCRIPTION_INACTIVE', details: { resource: 'branches' } });
    expect((await onOwner.agent.get(`/api/v1/orgs/${id}/branches`)).status).toBe(200);
    expect((await onOwner.agent.get(`/api/v1/orgs/${id}/subscription`)).body.enforcement).toBe('on');

    // With a grant on a plan limiting branches to the current count, the limit applies.
    const limited = await PlanModel.create({
      code: 'limit-test',
      version: 1,
      name: { ar: 'حد', en: 'Limit' },
      status: 'active',
      limits: { branches: 3, practitioners: null, members: null },
    });
    expect(
      (
        await op(admin, 'post', `/organizations/${id}/subscription/grant`, {
          planId: String(limited._id),
          endsAt: null,
          note: 'Limit test',
        })
      ).status,
    ).toBe(201);
    const atLimit = await send(onOwner, 'post', `/api/v1/orgs/${id}/branches`, { name: 'Fourth branch' });
    expect(atLimit.body.error).toMatchObject({ code: 'PLAN_LIMIT_REACHED', details: { resource: 'branches', limit: 3 } });
  });
});

describe('ownership inquiries in the console', () => {
  it('lists masked contacts; revealing is explicit and audited; status changes are recorded', async () => {
    await OwnershipInquiryModel.create({
      reference: 'R-TEST0001',
      contactName: 'هالة محمود',
      organizationName: 'مركز تجريبي',
      country: 'EG',
      phone: { country: 'EG', e164: '+201000000009' },
      email: 'hala@example.test',
      organizationType: 'clinic',
      interest: 'custom',
      description: 'وصف تجريبي',
      language: 'ar',
      submissionKey: 'test-key-1',
      requestHash: 'x',
    });
    const list = await support.agent.get('/api/v1/platform/inquiries?status=new');
    const row = list.body.data.find((r: { reference: string }) => r.reference === 'R-TEST0001');
    expect(row).toMatchObject({ contactName: 'ه…', email: 'h•••@example.test' });
    expect(JSON.stringify(list.body)).not.toContain('+201000000009');
    const revealed = await op(support, 'post', '/inquiries/R-TEST0001/reveal-contact');
    expect(revealed.body.contact).toEqual({ name: 'هالة محمود', phone: '+201000000009', email: 'hala@example.test' });
    expect(await PlatformAuditModel.exists({ action: 'inquiry.contact_revealed', 'target.id': 'R-TEST0001' })).toBeTruthy();
    const changed = await op(support, 'patch', '/inquiries/R-TEST0001', { status: 'reviewed' });
    expect(changed.body.inquiry).toMatchObject({ status: 'reviewed', reviewedAt: expect.any(String) });
    expect((await support.agent.get('/api/v1/platform/inquiries/R-BAD')).status).toBe(404);
  });
});

describe('operator provisioning CLI and configuration', () => {
  it('creates operators only through the CLI, prints a generated password once, refuses duplicates and the last admin suspension', async () => {
    expect(parseOperatorArgs(['create', '--email', 'bad', '--name', 'X Y', '--role', 'support'])).toMatchObject({ kind: 'help' });
    expect(parseOperatorArgs(['create', '--email', 'a@example.test', '--name', 'A B', '--role', 'owner'])).toMatchObject({
      kind: 'help',
      error: 'Unknown --role',
    });
    const created = await runOperatorsCommand(
      parseOperatorArgs(['create', '--email', 'cli.op@example.test', '--name', 'CLI Op', '--role', 'support']),
    );
    expect(created[1]).toMatch(/^Initial password \(shown only now\): .{20,}$/);
    expect(
      await runOperatorsCommand(parseOperatorArgs(['create', '--email', 'cli.op@example.test', '--name', 'CLI Op', '--role', 'support'])),
    ).toEqual([expect.stringMatching(/already exists/)]);
    await expect(
      runOperatorsCommand(parseOperatorArgs(['reset-password', 'cli.op@example.test']), { OPERATOR_PASSWORD: 'short' }),
    ).rejects.toThrow(/12 characters/);
    const fixed = await runOperatorsCommand(parseOperatorArgs(['reset-password', 'cli.op@example.test']), {
      OPERATOR_PASSWORD: 'a-long-enough-password',
    });
    expect(fixed.join('\n')).not.toContain('a-long-enough-password');
    await OperatorModel.updateMany({ role: 'platform_admin', email: { $ne: 'admin.op@example.test' } }, { $set: { status: 'suspended' } });
    expect(await runOperatorsCommand(parseOperatorArgs(['suspend', 'admin.op@example.test']))).toEqual([
      expect.stringMatching(/at least one active platform administrator/),
    ]);
    // There is no HTTP route that creates operators.
    expect((await op(admin, 'post', '/operators', { email: 'x@example.test' })).status).toBe(404);
  });

  it('the development seed is idempotent and invents no commercial terms', async () => {
    await seedPlatformData(TEST_PASSWORD);
    await seedPlatformData(TEST_PASSWORD);
    expect(await OperatorModel.countDocuments({ email: /@demo.test$/ })).toBe(2);
    const seeded = await PlanModel.find({ seedKey: { $exists: true } }).lean();
    expect(seeded).toHaveLength(3);
    expect(seeded.find((p) => p.code === 'development')).toMatchObject({
      status: 'active',
      prices: [],
      limits: { branches: null, practitioners: null, members: null },
    });
    expect(seeded.find((p) => p.code === 'clinic')).toMatchObject({ status: 'draft', prices: [] });
    expect(seeded.find((p) => p.code === 'simulator-test')?.name.en).toMatch(/synthetic price/);
  });

  it('refuses the payment simulator in production', () => {
    const base = { MONGODB_URI: 'mongodb://localhost:27017', NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'true' };
    expect(() => parseEnv({ ...base, BILLING_PROVIDER: 'simulator' })).toThrow(/simulator is refused in production/);
    expect(parseEnv(base)).toMatchObject({ BILLING_PROVIDER: 'none', SUBSCRIPTION_ENFORCEMENT: 'off' });
  });
});
