import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/auth/password.js';
import { PatientModel } from '../src/modules/patients/patient.model.js';
import { PlanModel, SimulatorSubscriptionModel, SubscriptionModel } from '../src/modules/platform/billing.model.js';
import { OperatorModel, PlatformAuditModel } from '../src/modules/platform/operator.model.js';
import { simulatorDelivery, SIMULATOR_SIGNATURE_HEADER } from '../src/modules/platform/payment-provider.js';
import { processLifecycle, requestPlanChange } from '../src/modules/platform/subscription.lifecycle.js';
import { seedSpecialties } from '../src/modules/specialties/specialty.seed.js';
import { clock } from '../src/time/clock.js';
import { TEST_PASSWORD, addMember, createOrg, register, send, testApp, type Client } from './helpers/api.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

const SECRET = 'test-only-simulator-secret-lifecycle-0123456789';
const app = testApp({ billingProvider: 'simulator', billingSimulatorSecret: SECRET });
const DAY = 86_400_000;

type Operator = { agent: ReturnType<typeof request.agent>; csrf: string };
let admin: Operator;
let support: Operator;
const op = (o: Operator, method: 'post' | 'put', url: string, body: object = {}) =>
  o.agent[method](`/api/v1/platform${url}`).set('X-Operator-CSRF', o.csrf).send(body);
async function operator(email: string, role: 'platform_admin' | 'support'): Promise<Operator> {
  await OperatorModel.create({ email, displayName: role, role, passwordHash: await hashPassword(TEST_PASSWORD) });
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/platform/auth/login').send({ email, password: TEST_PASSWORD });
  return { agent, csrf: res.body.csrfToken };
}
const view = async (owner: Client, orgId: string) => (await owner.agent.get(`/api/v1/orgs/${orgId}/subscription`)).body;
const later = (ms: number) => vi.spyOn(clock, 'now').mockImplementation(() => new Date(Date.now() + ms));

let trialPlan: string;
let paidA: string;
let paidB: string;

async function plan(code: string, extra: object) {
  const created = await op(admin, 'post', '/plans', {
    code,
    name: { ar: code, en: code },
    prices: [],
    limits: { branches: null, practitioners: null, members: null },
    ...extra,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  await op(admin, 'post', `/plans/${created.body.plan.id}/activate`);
  return created.body.plan.id as string;
}
async function clinic(label: string) {
  const owner = await register(app, `${label}-owner`);
  const { orgId, branchId } = await createOrg(owner, `${label} Clinic`);
  return { owner, orgId, branchId };
}
async function subscribe(owner: Client, orgId: string, planId: string) {
  const checkout = await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/checkouts`, {
    planId,
    currency: 'EGP',
    interval: 'month',
  });
  expect(checkout.status, JSON.stringify(checkout.body)).toBe(201);
  const done = await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/checkouts/${checkout.body.checkout.id}/simulate`, {
    outcome: 'succeeded',
  });
  expect(done.body.webhook.outcome).toBe('applied');
  return (await view(owner, orgId)).subscription;
}

beforeAll(async () => {
  await connectTestDatabase('sub_lifecycle');
  await seedSpecialties();
  admin = await operator('lc.admin@example.test', 'platform_admin');
  support = await operator('lc.support@example.test', 'support');
  trialPlan = await plan('trial-plan', { trialDays: 14 });
  paidA = await plan('paid-a', { prices: [{ currency: 'EGP', interval: 'month', amountMinor: 100 }] });
  paidB = await plan('paid-b', { prices: [{ currency: 'EGP', interval: 'month', amountMinor: 200 }] });
});
afterAll(() => dropTestDatabase());
afterEach(() => vi.restoreAllMocks());

describe('trials', () => {
  it('only plans that offer a trial can start one; owners only; once per organization', async () => {
    const { owner, orgId } = await clinic('trial1');
    expect((await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/trial`, { planId: paidA })).body.error.code).toBe(
      'TRIAL_NOT_OFFERED',
    );
    const adminUser = await register(app, 'trial1-admin');
    await addMember(owner, orgId, adminUser, 'admin');
    expect((await send(adminUser, 'post', `/api/v1/orgs/${orgId}/subscription/trial`, { planId: trialPlan })).status).toBe(403);
    const started = await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/trial`, { planId: trialPlan });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const s = started.body.subscription;
    expect(s).toMatchObject({ status: 'trialing', effectiveStatus: 'trialing', kind: 'development_grant', trialUsed: true, price: null });
    expect(Math.round((Date.parse(s.trialEndsAt) - Date.now()) / DAY)).toBe(14);
    expect((await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/trial`, { planId: trialPlan })).body.error.code).toBe(
      'TRIAL_ALREADY_USED',
    );
  });

  it('expires exactly at the end date, idempotently, even with concurrent runs; then a new trial is refused', async () => {
    const { owner, orgId } = await clinic('trial2');
    const s = (await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/trial`, { planId: trialPlan })).body.subscription;
    const end = Date.parse(s.trialEndsAt);
    vi.spyOn(clock, 'now').mockImplementation(() => new Date(end - 1));
    expect((await view(owner, orgId)).subscription.effectiveStatus).toBe('trialing');
    expect((await processLifecycle(true)).filter((a) => a.organizationId === orgId)).toEqual([]);
    vi.spyOn(clock, 'now').mockImplementation(() => new Date(end));
    expect((await view(owner, orgId)).subscription.effectiveStatus).toBe('expired');
    const dry = (await processLifecycle(false)).filter((a) => a.organizationId === orgId);
    expect(dry).toEqual([{ organizationId: orgId, from: 'trialing', to: 'expired', reason: 'trial_ended', applied: false }]);
    const runs = await Promise.all([processLifecycle(true), processLifecycle(true), processLifecycle(true)]);
    expect(runs.flat().filter((a) => a.organizationId === orgId && a.applied)).toHaveLength(1);
    expect((await processLifecycle(true)).filter((a) => a.organizationId === orgId)).toEqual([]);
    const stored = await SubscriptionModel.findOne({ organizationId: orgId }).lean();
    expect(stored?.status).toBe('expired');
    expect(stored?.history.map((h) => h.to)).toEqual(['trialing', 'expired']);
    expect((await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/trial`, { planId: trialPlan })).body.error.code).toBe(
      'TRIAL_ALREADY_USED',
    );
  });

  it('converts to a commercial subscription only through the verified checkout', async () => {
    const { owner, orgId } = await clinic('trial3');
    await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/trial`, { planId: trialPlan });
    const s = await subscribe(owner, orgId, paidA);
    expect(s).toMatchObject({ kind: 'commercial', status: 'active', trialEndsAt: null, trialUsed: true, provider: 'simulator' });
  });

  it('records every lifecycle run in the platform audit, previews marked as such', async () => {
    const runs = () => PlatformAuditModel.find({ action: 'billing.lifecycle_run' }).sort({ createdAt: 1 }).lean();
    const before = (await runs()).length;
    expect((await op(admin, 'post', '/billing/lifecycle', { apply: false })).status).toBe(200);
    expect((await op(admin, 'post', '/billing/lifecycle', { apply: true })).status).toBe(200);
    const recorded = (await runs()).slice(before);
    expect(recorded.map((r) => (r.changes as { apply: boolean }).apply)).toEqual([false, true]);
  });

  it('operators can start a trial with an explicit end date', async () => {
    const { owner, orgId } = await clinic('trial4');
    const endsAt = new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10);
    const res = await op(admin, 'post', `/organizations/${orgId}/subscription/trial`, { planId: paidA, endsAt });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await view(owner, orgId)).subscription).toMatchObject({ status: 'trialing', trialEndsAt: `${endsAt}T23:59:59.999Z` });
    expect((await op(support, 'post', `/organizations/${orgId}/subscription/trial`, { planId: paidA, endsAt })).status).toBe(403);
  });
});

describe('grace policy', () => {
  it('nothing happens to past-due subscriptions until a policy is configured; then only after the grace period', async () => {
    const { owner, orgId } = await clinic('grace');
    await subscribe(owner, orgId, paidA);
    expect((await op(admin, 'post', `/simulator/organizations/${orgId}/fail_payment`, { emit: true })).body.result.outcome).toBe('applied');
    expect((await view(owner, orgId)).subscription).toMatchObject({ status: 'past_due', pastDueSince: expect.any(String) });

    later(30 * DAY);
    const noPolicy = (await processLifecycle(true)).filter((a) => a.organizationId === orgId && a.reason === 'grace_ended');
    expect(noPolicy).toEqual([]);
    vi.restoreAllMocks();

    const current = (await admin.agent.get('/api/v1/platform/billing/policy')).body.policy;
    expect(current).toMatchObject({ graceDays: null, afterGrace: 'none', restrictedAccess: 'growth_only' });
    expect(
      (
        await op(admin, 'put', '/billing/policy', {
          graceDays: null,
          afterGrace: 'restricted',
          restrictedAccess: 'growth_only',
          revision: current.revision,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await op(support, 'put', '/billing/policy', {
          graceDays: 7,
          afterGrace: 'restricted',
          restrictedAccess: 'growth_only',
          revision: current.revision,
        })
      ).status,
    ).toBe(403);
    const saved = await op(admin, 'put', '/billing/policy', {
      graceDays: 7,
      afterGrace: 'restricted',
      restrictedAccess: 'growth_only',
      revision: current.revision,
    });
    expect(saved.body.policy).toMatchObject({ graceDays: 7, revision: current.revision + 1 });
    expect(
      (
        await op(admin, 'put', '/billing/policy', {
          graceDays: 9,
          afterGrace: 'restricted',
          restrictedAccess: 'growth_only',
          revision: current.revision,
        })
      ).body.error.code,
    ).toBe('POLICY_CHANGED');

    later(6 * DAY);
    expect((await processLifecycle(true)).filter((a) => a.organizationId === orgId && a.reason === 'grace_ended')).toEqual([]);
    later(7 * DAY + 60_000);
    expect((await processLifecycle(true)).filter((a) => a.organizationId === orgId && a.reason === 'grace_ended')).toEqual([
      expect.objectContaining({ applied: true, to: 'restricted' }),
    ]);
    vi.restoreAllMocks();
    expect((await view(owner, orgId)).subscription).toMatchObject({
      status: 'restricted',
      restriction: { reason: 'grace period of 7 days ended' },
    });
    // Reset the policy for the other tests.
    await op(admin, 'put', '/billing/policy', {
      graceDays: null,
      afterGrace: 'none',
      restrictedAccess: 'growth_only',
      revision: current.revision + 1,
    });
  });
});

describe('plan changes and cancellation (owner requests vs provider state)', () => {
  it('a plan change is recorded as intent, acknowledged by the simulator, idempotent, and applied only by the provider renewal', async () => {
    const { owner, orgId } = await clinic('change');
    const s = await subscribe(owner, orgId, paidA);
    const body = { planId: paidB, currency: 'EGP', interval: 'month', version: s.version };
    const first = await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/plan-change`, body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.subscription).toMatchObject({
      plan: { code: 'paid-a' },
      pendingChange: { plan: { code: 'paid-b' }, price: { amountMinor: 200 }, providerAcknowledged: true },
    });
    const replay = await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/plan-change`, {
      ...body,
      version: first.body.subscription.version,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect((await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/plan-change`, body)).body.error.code).toBe(
      'SUBSCRIPTION_CHANGED',
    );
    expect(
      (
        await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/plan-change`, {
          ...body,
          planId: paidA,
          version: first.body.subscription.version,
        })
      ).body.error.code,
    ).toBe('SAME_PLAN');

    later(60_000);
    expect((await op(admin, 'post', `/simulator/organizations/${orgId}/renew`, { emit: true })).body.result.outcome).toBe('applied');
    vi.restoreAllMocks();
    expect((await view(owner, orgId)).subscription).toMatchObject({
      plan: { code: 'paid-b' },
      price: { amountMinor: 200 },
      pendingChange: null,
      status: 'active',
    });
  });

  it('a withdrawn plan change is withdrawn at the provider too', async () => {
    const { owner, orgId } = await clinic('withdraw');
    const s = await subscribe(owner, orgId, paidA);
    const req = await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/plan-change`, {
      planId: paidB,
      currency: 'EGP',
      interval: 'month',
      version: s.version,
    });
    await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/plan-change/withdraw`, { version: req.body.subscription.version });
    const record = await SimulatorSubscriptionModel.findOne({ organizationId: orgId }).lean();
    expect(record?.scheduledPlan).toBeNull();
    later(60_000);
    await op(admin, 'post', `/simulator/organizations/${orgId}/renew`, { emit: true });
    vi.restoreAllMocks();
    expect((await view(owner, orgId)).subscription).toMatchObject({ plan: { code: 'paid-a' }, pendingChange: null });
  });

  it('without a provider a request stays an unacknowledged intent', async () => {
    const { owner, orgId } = await clinic('noprov');
    await subscribe(owner, orgId, paidA);
    const s = (await SubscriptionModel.findOne({ organizationId: orgId }).lean())!;
    const planB = (await PlanModel.findById(paidB).lean())!;
    const { subscription } = await requestPlanChange(s, planB, planB.prices[0]!, s.organizationId, null);
    expect(subscription.pendingChange?.providerAcknowledged).toBe(false);
    expect(subscription.planCode).toBe('paid-a');
  });

  it('cancellation needs explicit confirmation, ends only by the provider at period end, keeps every record', async () => {
    const { owner, orgId, branchId } = await clinic('cancel');
    await send(owner, 'post', `/api/v1/orgs/${orgId}/patients`, {
      fullName: 'Kept Patient',
      phone: { country: 'EG', number: '01000000300' },
      branchId,
    });
    const s = await subscribe(owner, orgId, paidA);
    expect((await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/cancel`, { version: s.version })).status).toBe(400);
    const cancel = await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/cancel`, {
      version: s.version,
      confirm: true,
      reason: 'Synthetic test',
    });
    expect(cancel.status).toBe(201);
    expect(cancel.body.subscription).toMatchObject({ status: 'active', cancelRequest: { providerAcknowledged: true } });
    const again = await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/cancel`, {
      version: cancel.body.subscription.version,
      confirm: true,
    });
    expect(again.body.replayed).toBe(true);
    expect(
      (
        await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/plan-change`, {
          planId: paidB,
          currency: 'EGP',
          interval: 'month',
          version: cancel.body.subscription.version,
        })
      ).body.error.code,
    ).toBe('CANCELLATION_PENDING');
    // Lifecycle processing never ends a commercial subscription itself.
    later(40 * DAY);
    expect((await processLifecycle(true)).filter((a) => a.organizationId === orgId)).toEqual([
      expect.objectContaining({ reason: 'awaiting_provider', to: null, applied: false }),
    ]);
    vi.restoreAllMocks();
    later(60_000);
    expect((await op(admin, 'post', `/simulator/organizations/${orgId}/renew`, { emit: true })).body.result.outcome).toBe('applied');
    vi.restoreAllMocks();
    expect((await view(owner, orgId)).subscription.status).toBe('canceled');
    expect(await PatientModel.countDocuments({ organizationId: orgId })).toBe(1);
    expect((await owner.agent.get(`/api/v1/orgs/${orgId}/patients`)).status).toBe(200);
  });

  it('a withdrawn cancellation renews normally; a late, older cancellation event is ignored', async () => {
    const { owner, orgId } = await clinic('keep');
    const s = await subscribe(owner, orgId, paidA);
    const c = await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/cancel`, { version: s.version, confirm: true });
    await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/cancel/withdraw`, { version: c.body.subscription.version });
    expect((await SimulatorSubscriptionModel.findOne({ organizationId: orgId }).lean())?.cancelAtPeriodEnd).toBe(false);
    later(60_000);
    await op(admin, 'post', `/simulator/organizations/${orgId}/renew`, { emit: true });
    vi.restoreAllMocks();
    const stored = (await SubscriptionModel.findOne({ organizationId: orgId }).lean())!;
    expect(stored.status).toBe('active');
    const old = simulatorDelivery(
      SECRET,
      'subscription.canceled',
      { providerSubscriptionId: stored.providerSubscriptionId },
      new Date(stored.providerEventAt!.getTime() - 30_000),
    );
    const res = await request(app)
      .post('/api/v1/billing/webhooks/simulator')
      .set('Content-Type', 'application/json')
      .set(SIMULATOR_SIGNATURE_HEADER, old.signature)
      .send(old.raw.toString());
    expect(res.body.outcome).toBe('ignored_stale');
    expect((await SubscriptionModel.findOne({ organizationId: orgId }).lean())!.status).toBe('active');
  });

  it('an owner cancels a free grant at once (after confirmation); others cannot', async () => {
    const { owner, orgId } = await clinic('grant');
    const granted = await op(admin, 'post', `/organizations/${orgId}/subscription/grant`, { planId: paidA, endsAt: null, note: 'Pilot' });
    const receptionist = await register(app, 'grant-reception');
    await addMember(owner, orgId, receptionist, 'receptionist');
    expect(
      (
        await send(receptionist, 'post', `/api/v1/orgs/${orgId}/subscription/cancel`, {
          version: granted.body.subscription.version,
          confirm: true,
        })
      ).status,
    ).toBe(403);
    const stranger = await clinic('grant-other');
    expect(
      (
        await send(stranger.owner, 'post', `/api/v1/orgs/${orgId}/subscription/cancel`, {
          version: granted.body.subscription.version,
          confirm: true,
        })
      ).status,
    ).toBe(404);
    const res = await send(owner, 'post', `/api/v1/orgs/${orgId}/subscription/cancel`, {
      version: granted.body.subscription.version,
      confirm: true,
    });
    expect(res.body.subscription.status).toBe('canceled');
    // The operator plan change applies only to live grants.
    expect(
      (
        await op(admin, 'post', `/organizations/${orgId}/subscription/plan`, {
          planId: paidB,
          version: res.body.subscription.version,
          reason: 'test change',
        })
      ).body.error.code,
    ).toBe('PLAN_CHANGE_NOT_AVAILABLE');
  });
});

describe('read-only access policy (enforcement on only)', () => {
  it('blocks most changes for an expired organization, never reading, support or clinical documentation', async () => {
    const onApp = testApp({ billingProvider: 'simulator', billingSimulatorSecret: SECRET, subscriptionEnforcement: 'on' });
    const owner = await register(onApp, 'ro-owner');
    const { orgId, branchId } = await createOrg(owner, 'Read Only Clinic');
    // No subscription at all ("none") counts as not entitled.
    const policy = (await admin.agent.get('/api/v1/platform/billing/policy')).body.policy;
    // growth_only: growth refused, other work allowed.
    expect((await send(owner, 'post', `/api/v1/orgs/${orgId}/branches`, { name: 'Second' })).body.error.code).toBe('SUBSCRIPTION_INACTIVE');
    expect(
      (
        await send(owner, 'post', `/api/v1/orgs/${orgId}/patients`, {
          fullName: 'Allowed Patient',
          phone: { country: 'EG', number: '01000000301' },
          branchId,
        })
      ).status,
    ).toBe(201);
    await op(admin, 'put', '/billing/policy', {
      graceDays: null,
      afterGrace: 'none',
      restrictedAccess: 'read_only',
      revision: policy.revision,
    });
    try {
      const blocked = await send(owner, 'post', `/api/v1/orgs/${orgId}/patients`, {
        fullName: 'Blocked Patient',
        phone: { country: 'EG', number: '01000000302' },
        branchId,
      });
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('SUBSCRIPTION_READ_ONLY');
      expect((await owner.agent.get(`/api/v1/orgs/${orgId}/patients`)).status).toBe(200);
      expect(
        (await send(owner, 'post', `/api/v1/orgs/${orgId}/support`, { subject: 'Need help', category: 'subscription', body: 'Synthetic.' }))
          .status,
      ).toBe(201);
      // The clinical documentation path is exempt (it reaches its own permission check instead).
      expect((await send(owner, 'put', `/api/v1/orgs/${orgId}/encounters/${'0'.repeat(24)}`, {})).body.error?.code).not.toBe(
        'SUBSCRIPTION_READ_ONLY',
      );
    } finally {
      await op(admin, 'put', '/billing/policy', {
        graceDays: null,
        afterGrace: 'none',
        restrictedAccess: 'growth_only',
        revision: policy.revision + 1,
      });
    }
  });
});
