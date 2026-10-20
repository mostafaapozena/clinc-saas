import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditEventModel } from '../src/modules/audit/audit-event.model.js';
import { BranchModel } from '../src/modules/branches/branch.model.js';
import { MembershipModel } from '../src/modules/memberships/membership.model.js';
import { OnboardingDraftModel } from '../src/modules/onboarding/onboarding.model.js';
import { OrganizationModel } from '../src/modules/organizations/organization.model.js';
import { seedSpecialties } from '../src/modules/specialties/specialty.seed.js';
import { addMember, createOrg, register, send, testApp, type Client } from './helpers/api.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

const app = testApp();

beforeAll(async () => {
  await connectTestDatabase('onboarding');
  await seedSpecialties();
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => dropTestDatabase());

type Draft = { id: string; version: number; step: string; status: string; data: Record<string, unknown> };

const save = (client: Client, body: Record<string, unknown>) => send(client, 'put', '/api/v1/onboarding', body);
const complete = (client: Client, draftId: string) => send(client, 'post', `/api/v1/onboarding/${draftId}/complete`);
const ownedOrgs = (userId: string) => OrganizationModel.countDocuments({ createdBy: userId });

/** Walks through every step the way the web app does, saving after each one. */
async function fullDraft(client: Client, overrides: { specialtyCodes?: string[]; branchSpecialties?: string[]; type?: string } = {}) {
  const specialties = overrides.specialtyCodes ?? ['dentistry', 'physiotherapy'];
  let res = await save(client, {
    step: 'specialties',
    version: null,
    data: { organizationType: overrides.type ?? 'medical_center', name: 'مركز التجربة', timeZone: 'Asia/Riyadh' },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  res = await save(client, { step: 'branch', version: res.body.draft.version, data: { specialtyCodes: specialties } });
  res = await save(client, {
    step: 'review',
    version: res.body.draft.version,
    data: { branch: { name: 'الفرع الأول', city: 'الرياض', specialtyCodes: overrides.branchSpecialties ?? specialties.slice(0, 1) } },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.draft as Draft;
}

describe('resumable setup', () => {
  it('saves each step, resumes after a reload, and completes into a configured organization', async () => {
    const user = await register(app, 'onb-user');
    expect((await user.agent.get('/api/v1/onboarding')).body.draft).toBeNull();
    const draft = await fullDraft(user);

    // "Reload": a fresh read returns the same draft, at the step the user reached.
    const resumed = (await user.agent.get('/api/v1/onboarding')).body.draft as Draft;
    expect(resumed).toMatchObject({ id: draft.id, step: 'review', version: draft.version, status: 'draft' });
    expect(resumed.data).toMatchObject({
      organizationType: 'medical_center',
      name: 'مركز التجربة',
      timeZone: 'Asia/Riyadh',
      specialtyCodes: ['dentistry', 'physiotherapy'],
      branch: { name: 'الفرع الأول', city: 'الرياض', specialtyCodes: ['dentistry'] },
    });

    const done = await complete(user, draft.id);
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    const orgId = done.body.organization.id as string;
    const org = await OrganizationModel.findById(orgId).lean();
    expect(org).toMatchObject({ type: 'medical_center', timeZone: 'Asia/Riyadh', specialtyCodes: ['dentistry', 'physiotherapy'] });
    const branches = await BranchModel.find({ organizationId: orgId }).lean();
    expect(branches.map((b) => [b.name, b.specialtyCodes])).toEqual([['الفرع الأول', ['dentistry']]]);
    const membership = await MembershipModel.findOne({ organizationId: orgId, userId: user.userId }).lean();
    expect(membership).toMatchObject({ role: 'owner', status: 'active' });
    expect(await AuditEventModel.countDocuments({ organizationId: orgId, action: 'organization.created' })).toBe(1);

    // The draft is finished: the next visit starts fresh, and the session lists the new workspace.
    expect((await user.agent.get('/api/v1/onboarding')).body.draft).toBeNull();
    const session = await user.agent.get('/api/v1/auth/session');
    expect(session.body.memberships.map((m: { organization: { id: string } }) => m.organization.id)).toContain(orgId);
  });

  it('a repeated completion returns the same organization; concurrent ones create exactly one', async () => {
    const user = await register(app, 'onb-repeat');
    const draft = await fullDraft(user);
    const first = await complete(user, draft.id);
    const again = await complete(user, draft.id);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ replayed: true, organization: { id: first.body.organization.id } });

    const racer = await register(app, 'onb-race');
    const racing = await fullDraft(racer, { type: 'clinic', specialtyCodes: ['ent'] });
    const results = await Promise.all(Array.from({ length: 6 }, () => complete(racer, racing.id)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.organization.id)).size).toBe(1);
    expect(await ownedOrgs(racer.userId)).toBe(1);
    expect(await BranchModel.countDocuments({ organizationId: results[0]?.body.organization.id })).toBe(1);
  });

  it('a failure part-way through leaves no organization and a draft that can be completed later', async () => {
    const user = await register(app, 'onb-failure');
    const draft = await fullDraft(user, { type: 'multi_branch', specialtyCodes: ['ent'] });
    vi.spyOn(MembershipModel, 'create').mockRejectedValueOnce(new Error('simulated failure'));
    const failed = await complete(user, draft.id);
    expect(failed.status).toBe(500);
    expect(await ownedOrgs(user.userId)).toBe(0);
    expect((await OnboardingDraftModel.findById(draft.id).lean())?.status).toBe('draft');
    vi.mocked(MembershipModel.create).mockRestore();

    const retried = await complete(user, draft.id);
    expect(retried.status).toBe(201);
    expect(await ownedOrgs(user.userId)).toBe(1);
  });

  it('rejects stale versions and a second draft from another tab', async () => {
    const user = await register(app, 'onb-tabs');
    const created = await save(user, { step: 'organization', version: null, data: { name: 'Tab one' } });
    const otherTab = await save(user, { step: 'organization', version: null, data: { name: 'Tab two' } });
    expect(otherTab.status).toBe(409);
    expect(otherTab.body.error.code).toBe('VERSION_CONFLICT');
    const updated = await save(user, { step: 'specialties', version: created.body.draft.version, data: { name: 'Tab one, step 2' } });
    expect(updated.status).toBe(200);
    const stale = await save(user, { step: 'specialties', version: created.body.draft.version, data: { name: 'Lost update' } });
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect((await user.agent.get('/api/v1/onboarding')).body.draft.data.name).toBe('Tab one, step 2');
  });
});

describe('validation and integrity', () => {
  it('validates every specialty against the catalog, and branch specialties at completion', async () => {
    const user = await register(app, 'onb-valid');
    const radiology = await save(user, { step: 'specialties', version: null, data: { specialtyCodes: ['radiology'] } });
    expect(radiology.status).toBe(400);
    expect(radiology.body.error.fields).toEqual({ specialtyCodes: 'unsupported_specialty' });

    const draft = await fullDraft(user, { specialtyCodes: ['ent'], branchSpecialties: ['dentistry'] });
    const mismatch = await complete(user, draft.id);
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.fields).toEqual({ 'branch.specialtyCodes': 'not_in_organization' });
    expect(await ownedOrgs(user.userId)).toBe(0);
  });

  it('reports which step is incomplete instead of creating a partial organization', async () => {
    const user = await register(app, 'onb-incomplete');
    const res = await save(user, { step: 'review', version: null, data: { organizationType: 'clinic', name: 'Half done' } });
    const done = await complete(user, res.body.draft.id);
    expect(done.status).toBe(400);
    expect(done.body.error).toMatchObject({ code: 'ONBOARDING_INCOMPLETE', details: { step: 'organization' } });
    expect(Object.keys(done.body.error.fields)).toEqual(['timeZone', 'specialtyCodes', 'branch.name', 'branch.specialtyCodes']);
    expect(await ownedOrgs(user.userId)).toBe(0);
  });

  it('ignores fields outside the allowlist and refuses operator objects', async () => {
    const user = await register(app, 'onb-mass');
    const res = await save(user, {
      step: 'organization',
      version: null,
      status: 'completed',
      organizationId: '64b000000000000000000001',
      userId: '64b000000000000000000002',
      data: { name: 'Allowlisted', organizationId: '64b000000000000000000001', role: 'owner' },
    });
    expect(res.status).toBe(201);
    const stored = await OnboardingDraftModel.findById(res.body.draft.id).lean();
    expect(stored).toMatchObject({ status: 'draft', organizationId: null });
    expect(String(stored?.userId)).toBe(user.userId);
    const injected = await save(user, { step: 'organization', version: res.body.draft.version, data: { name: { $gt: '' } } });
    expect(injected.status).toBe(400);
    const badStep = await save(user, { step: 'payment', version: res.body.draft.version, data: {} });
    expect(badStep.status).toBe(400);
  });
});

describe('scope and access', () => {
  it('requires a session, and nobody can read or complete another user’s draft', async () => {
    expect((await request(app).get('/api/v1/onboarding')).status).toBe(401);
    const owner = await register(app, 'onb-owner-a');
    const draft = await fullDraft(owner);
    const intruder = await register(app, 'onb-intruder');
    expect((await intruder.agent.get('/api/v1/onboarding')).body.draft).toBeNull();
    const stolen = await complete(intruder, draft.id);
    expect(stolen.status).toBe(404);
    expect(await ownedOrgs(intruder.userId)).toBe(0);
    expect((await complete(intruder, 'not-an-id')).status).toBe(404);
  });

  it('a member of an existing organization only ever creates a new one, never changes theirs', async () => {
    const owner = await register(app, 'onb-existing-owner');
    const existing = await createOrg(owner, 'Existing Clinic');
    const receptionist = await register(app, 'onb-existing-reception');
    await addMember(owner, existing.orgId, receptionist, 'receptionist', [existing.branchId]);

    const draft = await fullDraft(receptionist, { type: 'clinic', specialtyCodes: ['ent'] });
    const done = await complete(receptionist, draft.id);
    expect(done.status).toBe(201);
    expect(done.body.organization.id).not.toBe(existing.orgId);
    const untouched = await OrganizationModel.findById(existing.orgId).lean();
    expect(untouched).toMatchObject({ specialtyCodes: [], type: null });
    // They still are only a receptionist there; ownership is of the new organization only.
    const roles = await MembershipModel.find({ userId: receptionist.userId }).setOptions({ skipTenantGuard: true }).lean();
    expect(roles.map((m) => [String(m.organizationId), m.role]).sort()).toEqual(
      [
        [existing.orgId, 'receptionist'],
        [done.body.organization.id, 'owner'],
      ].sort(),
    );
  });

  it('limits organization creation per client', async () => {
    const limited = testApp({ setupRateLimit: { max: 2, windowMs: 60_000 } });
    const user = await register(limited, 'onb-limited');
    const attempt = () =>
      send(user, 'post', '/api/v1/orgs', { name: 'Limited', timeZone: 'Africa/Cairo', specialtyCodes: ['ent'], branch: { name: 'Main' } });
    expect((await attempt()).status).toBe(201);
    expect((await attempt()).status).toBe(201);
    const third = await attempt();
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });
});
