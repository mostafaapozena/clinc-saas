import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditEventModel } from '../src/modules/audit/audit-event.model.js';
import { BranchModel } from '../src/modules/branches/branch.model.js';
import { MembershipModel } from '../src/modules/memberships/membership.model.js';
import { OrganizationModel } from '../src/modules/organizations/organization.model.js';
import { PERMISSIONS } from '../src/tenancy/permissions.js';
import { addMember, createOrg, register, send, testApp } from './helpers/api.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

const app = testApp();

beforeAll(() => connectTestDatabase('orgs'));
afterAll(() => dropTestDatabase());
afterEach(() => vi.restoreAllMocks());

const countAllBranches = () => BranchModel.countDocuments({}).setOptions({ skipTenantGuard: true });

describe('organization onboarding', () => {
  it('a new user has no organizations and is sent to onboarding', async () => {
    const client = await register(app, 'fresh');
    const orgs = await client.agent.get('/api/v1/orgs');
    const session = await client.agent.get('/api/v1/auth/session');

    expect(orgs.body.data).toEqual([]);
    expect(session.body.memberships).toEqual([]);
  });

  it('creates the organization, its first branch and an active owner membership', async () => {
    const client = await register(app, 'founder');
    const res = await send(client, 'post', '/api/v1/orgs', {
      name: 'عيادة الاختبار',
      branch: { name: 'الفرع الرئيسي', city: 'القاهرة' },
    });

    expect(res.status).toBe(201);
    expect(res.body.branch).toMatchObject({ name: 'الفرع الرئيسي', city: 'القاهرة', status: 'active' });
    const orgId = res.body.organization.id;

    const detail = await client.agent.get(`/api/v1/orgs/${orgId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.organization.name).toBe('عيادة الاختبار');
    expect(detail.body.membership).toMatchObject({ role: 'owner', branchScope: { type: 'all' } });
    expect(detail.body.membership.permissions).toEqual(PERMISSIONS);
    expect(detail.body.stats).toEqual({ accessibleBranches: 1, activeMembers: 1 });

    const list = await client.agent.get('/api/v1/orgs');
    expect(list.body.data).toEqual([{ organization: { id: orgId, name: 'عيادة الاختبار' }, role: 'owner' }]);

    const audit = await AuditEventModel.find({ organizationId: orgId }).lean();
    expect(audit.map((e) => e.action)).toEqual(['organization.created']);
    expect(String(audit[0]?.actorUserId)).toBe(client.userId);
  });

  it('is atomic: a failure part-way leaves no organization without an owner', async () => {
    const client = await register(app, 'atomic');
    const orgsBefore = await OrganizationModel.countDocuments();
    const branchesBefore = await countAllBranches();
    vi.spyOn(MembershipModel, 'create').mockRejectedValueOnce(new Error('simulated failure'));

    const res = await send(client, 'post', '/api/v1/orgs', { name: 'Half Made', branch: { name: 'Branch' } });

    expect(res.status).toBe(500);
    expect(await OrganizationModel.countDocuments()).toBe(orgsBefore);
    expect(await OrganizationModel.countDocuments({ name: 'Half Made' })).toBe(0);
    expect(await countAllBranches()).toBe(branchesBefore);

    vi.restoreAllMocks();
    const retry = await send(client, 'post', '/api/v1/orgs', { name: 'Half Made', branch: { name: 'Branch' } });
    expect(retry.status).toBe(201);
  });

  it('validates the onboarding input', async () => {
    const client = await register(app, 'invalid-org');
    const res = await send(client, 'post', '/api/v1/orgs', { name: 'X', branch: {} });

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual({ name: 'too_short', 'branch.name': 'required' });
  });
});

describe('organization settings', () => {
  it('only the owner can rename the organization, and the change is audited', async () => {
    const owner = await register(app, 'settings-owner');
    const admin = await register(app, 'settings-admin');
    const { orgId } = await createOrg(owner, 'Before');
    await addMember(owner, orgId, admin, 'admin');

    const denied = await send(admin, 'patch', `/api/v1/orgs/${orgId}`, { name: 'Hijacked' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');

    const ok = await send(owner, 'patch', `/api/v1/orgs/${orgId}`, { name: 'After' });
    expect(ok.status).toBe(200);
    expect(ok.body.organization.name).toBe('After');

    const event = await AuditEventModel.findOne({ organizationId: orgId, action: 'organization.updated' }).lean();
    expect(event?.changes).toEqual({ name: { from: 'Before', to: 'After' } });
    expect(String(event?.actorUserId)).toBe(owner.userId);
  });
});
