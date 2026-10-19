import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BranchModel } from '../src/modules/branches/branch.model.js';
import { MembershipModel } from '../src/modules/memberships/membership.model.js';
import { TenantScopeError } from '../src/tenancy/tenant-guard.plugin.js';
import { addBranch, addMember, createOrg, register, send, testApp, type Client } from './helpers/api.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

const app = testApp();

let ownerA: Client;
let ownerB: Client;
let doctorA: Client;
let multi: Client;
const A = { orgId: '', branch1: '', branch2: '', doctorMembership: '' };
const B = { orgId: '', branch1: '', branch2: '', ownerMembership: '' };

beforeAll(async () => {
  await connectTestDatabase('tenancy');
  ownerA = await register(app, 'ownerA');
  ownerB = await register(app, 'ownerB');
  doctorA = await register(app, 'doctorA');
  multi = await register(app, 'multi');

  ({ orgId: A.orgId, branchId: A.branch1 } = await createOrg(ownerA, 'Alpha Clinics', 'Alpha North'));
  A.branch2 = await addBranch(ownerA, A.orgId, 'Alpha South');
  ({ orgId: B.orgId, branchId: B.branch1 } = await createOrg(ownerB, 'Beta Secret Center', 'Beta Riyadh'));
  B.branch2 = await addBranch(ownerB, B.orgId, 'Beta Jeddah');
  B.ownerMembership = (await ownerB.agent.get(`/api/v1/orgs/${B.orgId}`)).body.membership.id;

  A.doctorMembership = await addMember(ownerA, A.orgId, doctorA, 'doctor', [A.branch1]);
  await addMember(ownerA, A.orgId, multi, 'admin');
  await addMember(ownerB, B.orgId, multi, 'doctor', [B.branch2]);
});
afterAll(() => dropTestDatabase());

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Not found' } };

describe('cross-organization access', () => {
  it('another organization looks exactly like one that does not exist', async () => {
    const foreign = await ownerA.agent.get(`/api/v1/orgs/${B.orgId}`);
    const missing = await ownerA.agent.get(`/api/v1/orgs/${new Types.ObjectId().toString()}`);
    const malformed = await ownerA.agent.get('/api/v1/orgs/not-an-id');

    for (const res of [foreign, missing, malformed]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    }
  });

  it('cannot list, read or modify branches of another organization', async () => {
    const checks = [
      await ownerA.agent.get(`/api/v1/orgs/${B.orgId}/branches`),
      await ownerA.agent.get(`/api/v1/orgs/${B.orgId}/branches/${B.branch1}`),
      // Tampering: own organization in the path, foreign branch id.
      await ownerA.agent.get(`/api/v1/orgs/${A.orgId}/branches/${B.branch1}`),
      await send(ownerA, 'patch', `/api/v1/orgs/${A.orgId}/branches/${B.branch1}`, { name: 'Taken over' }),
      await send(ownerA, 'patch', `/api/v1/orgs/${B.orgId}/branches/${B.branch1}`, { name: 'Taken over' }),
      await send(ownerA, 'post', `/api/v1/orgs/${B.orgId}/branches`, { name: 'Implant' }),
    ];
    for (const res of checks) {
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('Beta');
    }
    const untouched = await BranchModel.findOne({ organizationId: B.orgId, _id: B.branch1 });
    expect(untouched?.name).toBe('Beta Riyadh');
    expect(await BranchModel.countDocuments({ organizationId: B.orgId })).toBe(2);
  });

  it('cannot read or change memberships of another organization', async () => {
    const checks = [
      await ownerA.agent.get(`/api/v1/orgs/${B.orgId}/members`),
      await send(ownerA, 'patch', `/api/v1/orgs/${B.orgId}/members/${B.ownerMembership}`, { status: 'suspended' }),
      await send(ownerA, 'patch', `/api/v1/orgs/${A.orgId}/members/${B.ownerMembership}`, { status: 'suspended' }),
      await send(ownerA, 'post', `/api/v1/orgs/${B.orgId}/members`, { email: doctorA.email, role: 'viewer' }),
    ];
    for (const res of checks) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    }
    const ownerMembership = await MembershipModel.findOne({ organizationId: B.orgId, _id: B.ownerMembership });
    expect(ownerMembership?.status).toBe('active');
    expect(await MembershipModel.countDocuments({ organizationId: B.orgId })).toBe(2);
  });

  it('rejects branch references from another organization like unknown ids', async () => {
    const person = await register(app, 'cross-ref');
    const foreignBranch = await send(ownerA, 'post', `/api/v1/orgs/${A.orgId}/members`, {
      email: person.email,
      role: 'doctor',
      branchScope: { type: 'selected', branchIds: [A.branch1, B.branch1] },
    });
    const unknownBranch = await send(ownerA, 'post', `/api/v1/orgs/${A.orgId}/members`, {
      email: person.email,
      role: 'doctor',
      branchScope: { type: 'selected', branchIds: [new Types.ObjectId().toString()] },
    });
    const viaUpdate = await send(ownerA, 'patch', `/api/v1/orgs/${A.orgId}/members/${A.doctorMembership}`, {
      branchScope: { type: 'selected', branchIds: [B.branch2] },
    });

    expect(foreignBranch.status).toBe(400);
    expect(foreignBranch.body).toEqual(unknownBranch.body);
    expect(foreignBranch.body.error.code).toBe('INVALID_BRANCH');
    expect(viaUpdate.status).toBe(400);
    const doctor = await MembershipModel.findOne({ organizationId: A.orgId, _id: A.doctorMembership });
    expect(doctor?.branchScope.branchIds.map(String)).toEqual([A.branch1]);
  });

  it('ignores organization ids supplied in request bodies', async () => {
    const res = await send(ownerA, 'post', `/api/v1/orgs/${A.orgId}/branches`, {
      name: 'Alpha Smuggled',
      organizationId: B.orgId,
    });
    expect(res.status).toBe(201);
    const stored = await BranchModel.findOne({ organizationId: A.orgId, _id: res.body.branch.id });
    expect(stored).not.toBeNull();
    expect(await BranchModel.countDocuments({ organizationId: B.orgId, name: 'Alpha Smuggled' })).toBe(0);
  });

  it('lists, searches, counts and team views contain only the own organization', async () => {
    const search = await ownerA.agent.get(`/api/v1/orgs/${A.orgId}/branches?q=Beta`);
    const all = await ownerA.agent.get(`/api/v1/orgs/${A.orgId}/branches`);
    const team = await ownerA.agent.get(`/api/v1/orgs/${A.orgId}/members`);
    const detail = await ownerA.agent.get(`/api/v1/orgs/${A.orgId}`);

    expect(search.body.data).toEqual([]);
    expect(all.body.data.every((b: { name: string }) => b.name.startsWith('Alpha'))).toBe(true);
    expect(JSON.stringify(team.body)).not.toContain(ownerB.email);
    expect(team.body.data).toHaveLength(await MembershipModel.countDocuments({ organizationId: A.orgId }));
    expect(detail.body.stats.accessibleBranches).toBe(all.body.data.length);
    expect(detail.body.stats.activeMembers).toBe(3);
  });
});

describe('branch-restricted access', () => {
  it('a restricted member only sees and opens assigned branches', async () => {
    const list = await doctorA.agent.get(`/api/v1/orgs/${A.orgId}/branches`);
    const search = await doctorA.agent.get(`/api/v1/orgs/${A.orgId}/branches?q=South`);
    const assigned = await doctorA.agent.get(`/api/v1/orgs/${A.orgId}/branches/${A.branch1}`);
    const other = await doctorA.agent.get(`/api/v1/orgs/${A.orgId}/branches/${A.branch2}`);
    const detail = await doctorA.agent.get(`/api/v1/orgs/${A.orgId}`);

    expect(list.body.data.map((b: { id: string }) => b.id)).toEqual([A.branch1]);
    expect(search.body.data).toEqual([]);
    expect(assigned.status).toBe(200);
    expect(other.status).toBe(404);
    expect(other.body).toEqual(NOT_FOUND);
    expect(detail.body.stats).toEqual({ accessibleBranches: 1 });
  });
});

describe('members of several organizations', () => {
  it('get the role and branch scope of the organization they are working in', async () => {
    const session = await multi.agent.get('/api/v1/auth/session');
    expect(session.body.memberships).toEqual([
      { organization: { id: A.orgId, name: 'Alpha Clinics' }, role: 'admin' },
      { organization: { id: B.orgId, name: 'Beta Secret Center' }, role: 'doctor' },
    ]);

    const inA = await multi.agent.get(`/api/v1/orgs/${A.orgId}`);
    const teamA = await multi.agent.get(`/api/v1/orgs/${A.orgId}/members`);
    const branchesA = await multi.agent.get(`/api/v1/orgs/${A.orgId}/branches`);
    expect(inA.body.membership.role).toBe('admin');
    expect(teamA.status).toBe(200);
    expect(branchesA.body.data.length).toBeGreaterThanOrEqual(2);

    const inB = await multi.agent.get(`/api/v1/orgs/${B.orgId}`);
    const teamB = await multi.agent.get(`/api/v1/orgs/${B.orgId}/members`);
    const branchesB = await multi.agent.get(`/api/v1/orgs/${B.orgId}/branches`);
    expect(inB.body.membership.role).toBe('doctor');
    expect(teamB.status).toBe(403);
    expect(branchesB.body.data.map((b: { id: string }) => b.id)).toEqual([B.branch2]);
    // Admin rights in Alpha do not carry over to Beta.
    const crossWrite = await send(multi, 'post', `/api/v1/orgs/${B.orgId}/branches`, { name: 'Beta New' });
    expect(crossWrite.status).toBe(403);
  });
});

describe('tenant guard (defense in depth)', () => {
  it('rejects tenant queries that are not scoped to an organization', async () => {
    await expect(BranchModel.find({})).rejects.toBeInstanceOf(TenantScopeError);
    await expect(BranchModel.findById(A.branch1)).rejects.toBeInstanceOf(TenantScopeError);
    await expect(MembershipModel.countDocuments({ role: 'owner' })).rejects.toBeInstanceOf(TenantScopeError);
    await expect(MembershipModel.updateMany({}, { status: 'suspended' })).rejects.toBeInstanceOf(TenantScopeError);
    await expect(BranchModel.aggregate([{ $group: { _id: null, n: { $sum: 1 } } }])).rejects.toBeInstanceOf(TenantScopeError);
  });

  it('allows scoped queries', async () => {
    const orgId = new Types.ObjectId(A.orgId);
    expect(await BranchModel.countDocuments({ organizationId: orgId })).toBeGreaterThan(0);
    const [row] = await BranchModel.aggregate([{ $match: { organizationId: orgId } }, { $count: 'n' }]);
    expect(row.n).toBeGreaterThan(0);
  });
});
