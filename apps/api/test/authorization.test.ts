import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditEventModel } from '../src/modules/audit/audit-event.model.js';
import { MembershipModel } from '../src/modules/memberships/membership.model.js';
import { ROLES, permissionsFor, type Role } from '../src/tenancy/permissions.js';
import { addBranch, addMember, createOrg, register, send, testApp, type Client } from './helpers/api.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

const app = testApp();

let owner: Client;
let orgId: string;
let branchA: string;
let branchB: string;
const clients = {} as Record<Role, Client>;

beforeAll(async () => {
  await connectTestDatabase('authz');
  owner = await register(app, 'owner');
  ({ orgId, branchId: branchA } = await createOrg(owner, 'Authz Clinic', 'Branch A'));
  branchB = await addBranch(owner, orgId, 'Branch B');
  clients.owner = owner;
  for (const role of ['admin', 'doctor', 'receptionist', 'viewer'] as const) {
    clients[role] = await register(app, role);
    await addMember(owner, orgId, clients[role], role, role === 'doctor' || role === 'receptionist' ? [branchA] : undefined);
  }
});
afterAll(() => dropTestDatabase());

let seq = 0;
type Action = { name: string; allowed: readonly Role[]; run: (c: Client) => Promise<{ status: number }> };

// Every implemented organization-level action, with the roles that may perform it.
const ACTIONS: Action[] = [
  { name: 'read organization', allowed: ROLES, run: (c) => c.agent.get(`/api/v1/orgs/${orgId}`) },
  { name: 'rename organization', allowed: ['owner'], run: (c) => send(c, 'patch', `/api/v1/orgs/${orgId}`, { name: `Authz Clinic ${++seq}` }) },
  { name: 'list branches', allowed: ROLES, run: (c) => c.agent.get(`/api/v1/orgs/${orgId}/branches`) },
  { name: 'read an assigned branch', allowed: ROLES, run: (c) => c.agent.get(`/api/v1/orgs/${orgId}/branches/${branchA}`) },
  { name: 'create branch', allowed: ['owner', 'admin'], run: (c) => send(c, 'post', `/api/v1/orgs/${orgId}/branches`, { name: `New branch ${++seq}` }) },
  { name: 'update branch', allowed: ['owner', 'admin'], run: (c) => send(c, 'patch', `/api/v1/orgs/${orgId}/branches/${branchA}`, { city: `City ${++seq}` }) },
  { name: 'list team', allowed: ['owner', 'admin'], run: (c) => c.agent.get(`/api/v1/orgs/${orgId}/members`) },
  {
    name: 'add member',
    allowed: ['owner', 'admin'],
    run: async (c) => {
      const newcomer = await register(app, 'newcomer');
      return send(c, 'post', `/api/v1/orgs/${orgId}/members`, { email: newcomer.email, role: 'viewer' });
    },
  },
  {
    name: 'change a member role',
    allowed: ['owner', 'admin'],
    run: async (c) => {
      const target = await register(app, 'target');
      const id = await addMember(owner, orgId, target, 'viewer');
      return send(c, 'patch', `/api/v1/orgs/${orgId}/members/${id}`, { role: 'receptionist', branchScope: { type: 'selected', branchIds: [branchB] } });
    },
  },
];

describe.each(ROLES)('role %s', (role) => {
  for (const action of ACTIONS) {
    const allowed = action.allowed.includes(role);
    it(`${allowed ? 'may' : 'may not'} ${action.name}`, async () => {
      const res = await action.run(clients[role]);
      if (allowed) expect(res.status).toBeLessThan(300);
      else expect(res.status).toBe(403);
    });
  }

  it('receives exactly its permissions, and team size only if it may read the team', async () => {
    const res = await clients[role].agent.get(`/api/v1/orgs/${orgId}`);
    expect(res.body.membership.role).toBe(role);
    expect(res.body.membership.permissions).toEqual(permissionsFor(role));
    expect('activeMembers' in res.body.stats).toBe(role === 'owner' || role === 'admin');
  });
});

describe('role escalation and owner protection', () => {
  it('nobody can grant the owner role through team management', async () => {
    const candidate = await register(app, 'would-be-owner');
    const viaAdd = await send(clients.admin, 'post', `/api/v1/orgs/${orgId}/members`, { email: candidate.email, role: 'owner' });
    const ownerAdd = await send(owner, 'post', `/api/v1/orgs/${orgId}/members`, { email: candidate.email, role: 'owner' });
    const id = await addMember(owner, orgId, candidate, 'viewer');
    const viaUpdate = await send(owner, 'patch', `/api/v1/orgs/${orgId}/members/${id}`, { role: 'owner' });

    for (const res of [viaAdd, ownerAdd, viaUpdate]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ROLE_NOT_ASSIGNABLE');
    }
    expect((await MembershipModel.findOne({ organizationId: orgId, _id: id }))?.role).toBe('viewer');
  });

  it('members cannot change their own membership', async () => {
    const doctorSelf = await clients.doctor.agent.get(`/api/v1/orgs/${orgId}`);
    const doctorEscalation = await send(clients.doctor, 'patch', `/api/v1/orgs/${orgId}/members/${doctorSelf.body.membership.id}`, { role: 'admin' });
    const adminSelf = await clients.admin.agent.get(`/api/v1/orgs/${orgId}`);
    const adminSelfChange = await send(clients.admin, 'patch', `/api/v1/orgs/${orgId}/members/${adminSelf.body.membership.id}`, { status: 'suspended' });

    expect(doctorEscalation.status).toBe(403);
    expect(adminSelfChange.status).toBe(403);
    expect(adminSelfChange.body.error.code).toBe('SELF_MODIFICATION');
  });

  it('admins cannot modify owner memberships', async () => {
    const ownerView = await owner.agent.get(`/api/v1/orgs/${orgId}`);
    for (const change of [{ role: 'admin' }, { status: 'suspended' }]) {
      const res = await send(clients.admin, 'patch', `/api/v1/orgs/${orgId}/members/${ownerView.body.membership.id}`, change);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('OWNER_PROTECTED');
    }
  });

  it('the last active owner cannot be suspended or demoted', async () => {
    const soloOwner = await register(app, 'solo');
    const solo = await createOrg(soloOwner, 'Solo Clinic');
    const view = await soloOwner.agent.get(`/api/v1/orgs/${solo.orgId}`);
    for (const change of [{ status: 'suspended' }, { role: 'admin' }]) {
      const res = await send(soloOwner, 'patch', `/api/v1/orgs/${solo.orgId}/members/${view.body.membership.id}`, change);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LAST_OWNER');
    }
  });

  it('an owner may demote another owner while one active owner remains', async () => {
    const second = await register(app, 'second-owner');
    const id = await addMember(owner, orgId, second, 'admin');
    // Ownership transfer is out of scope, so a second owner is set up directly in the database.
    await MembershipModel.updateOne({ organizationId: orgId, _id: id }, { role: 'owner' });

    const res = await send(owner, 'patch', `/api/v1/orgs/${orgId}/members/${id}`, { role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.member.role).toBe('admin');
  });

  it('owners and admins always get organization-wide branch access', async () => {
    const person = await register(app, 'wide');
    const res = await send(owner, 'post', `/api/v1/orgs/${orgId}/members`, {
      email: person.email,
      role: 'admin',
      branchScope: { type: 'selected', branchIds: [branchA] },
    });
    expect(res.body.member.branchScope).toEqual({ type: 'all', branchIds: [] });
  });
});

describe('changes take effect immediately on existing sessions', () => {
  it('suspending a membership blocks access at once; reactivating restores it', async () => {
    const member = await register(app, 'suspendee');
    const id = await addMember(owner, orgId, member, 'doctor', [branchA]);
    expect((await member.agent.get(`/api/v1/orgs/${orgId}`)).status).toBe(200);

    await send(owner, 'patch', `/api/v1/orgs/${orgId}/members/${id}`, { status: 'suspended' });
    const blocked = await member.agent.get(`/api/v1/orgs/${orgId}/branches`);
    expect(blocked.status).toBe(404);
    expect((await member.agent.get('/api/v1/auth/session')).body.memberships).toEqual([]);

    await send(owner, 'patch', `/api/v1/orgs/${orgId}/members/${id}`, { status: 'active' });
    expect((await member.agent.get(`/api/v1/orgs/${orgId}/branches`)).status).toBe(200);
  });

  it('role and branch changes apply without signing in again', async () => {
    const member = await register(app, 'promotee');
    const id = await addMember(owner, orgId, member, 'doctor', [branchA]);
    expect((await member.agent.get(`/api/v1/orgs/${orgId}/members`)).status).toBe(403);
    expect((await member.agent.get(`/api/v1/orgs/${orgId}/branches/${branchB}`)).status).toBe(404);

    await send(owner, 'patch', `/api/v1/orgs/${orgId}/members/${id}`, { branchScope: { type: 'all', branchIds: [] } });
    expect((await member.agent.get(`/api/v1/orgs/${orgId}/branches/${branchB}`)).status).toBe(200);

    await send(owner, 'patch', `/api/v1/orgs/${orgId}/members/${id}`, { role: 'admin' });
    expect((await member.agent.get(`/api/v1/orgs/${orgId}/members`)).status).toBe(200);
  });
});

describe('team management', () => {
  it('requires an existing account and rejects duplicates', async () => {
    const unknown = await send(owner, 'post', `/api/v1/orgs/${orgId}/members`, { email: 'nobody.here@example.test', role: 'viewer' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('USER_NOT_FOUND');

    const duplicate = await send(owner, 'post', `/api/v1/orgs/${orgId}/members`, { email: clients.viewer.email, role: 'viewer' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('ALREADY_MEMBER');
  });

  it('records server-generated audit events without personal data', async () => {
    const person = await register(app, 'audited');
    const id = await addMember(owner, orgId, person, 'viewer');
    await send(owner, 'patch', `/api/v1/orgs/${orgId}/members/${id}`, { role: 'receptionist', branchScope: { type: 'selected', branchIds: [branchA] } });
    await send(owner, 'patch', `/api/v1/orgs/${orgId}/members/${id}`, { status: 'suspended' });
    await send(owner, 'patch', `/api/v1/orgs/${orgId}/members/${id}`, { status: 'active' });

    const events = await AuditEventModel.find({ organizationId: orgId, 'target.id': id }).sort({ createdAt: 1 }).lean();
    expect(events.map((e) => e.action)).toEqual([
      'member.added',
      'member.role_changed',
      'member.branch_scope_changed',
      'member.suspended',
      'member.reactivated',
    ]);
    expect(events.every((e) => String(e.actorUserId) === owner.userId)).toBe(true);
    expect(JSON.stringify(events)).not.toContain(person.email);
  });
});
