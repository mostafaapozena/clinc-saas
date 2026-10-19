import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BranchModel } from '../src/modules/branches/branch.model.js';
import { seedDemoData } from '../src/modules/demo/demo.seed.js';
import { MembershipModel } from '../src/modules/memberships/membership.model.js';
import { OrganizationModel } from '../src/modules/organizations/organization.model.js';
import { UserModel } from '../src/users/user.model.js';
import { testApp } from './helpers/api.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';
import request from 'supertest';

const PASSWORD = 'seed-test-password-1';

beforeAll(() => connectTestDatabase('seed'));
afterAll(() => dropTestDatabase());

describe('demo seed', () => {
  it('creates the documented scenarios and is idempotent', async () => {
    await seedDemoData(PASSWORD);
    await seedDemoData(PASSWORD);

    const orgs = await OrganizationModel.find().lean();
    expect(orgs).toHaveLength(2);
    const userIds = new Map((await UserModel.find().lean()).map((u) => [u.email, u._id]));
    expect([...userIds.keys()].every((email) => email.endsWith('@demo.test'))).toBe(true);

    const membershipsOf = async (email: string) => {
      const userId = userIds.get(email);
      return MembershipModel.find({ userId }).setOptions({ skipTenantGuard: true }).lean();
    };
    expect(await membershipsOf('multi@demo.test')).toHaveLength(2);
    expect((await membershipsOf('suspended.nour@demo.test'))[0]?.status).toBe('suspended');
    expect((await membershipsOf('doctor.nour@demo.test'))[0]?.branchScope.branchIds).toHaveLength(1);
    expect(await membershipsOf('newcomer@demo.test')).toHaveLength(0);
    for (const org of orgs) {
      expect(await BranchModel.countDocuments({ organizationId: org._id })).toBeGreaterThanOrEqual(2);
    }
  });

  it('demo accounts work in development and are refused in production', async () => {
    const login = (production: boolean) =>
      request(testApp({ production }))
        .post('/api/v1/auth/login')
        .send({ email: 'owner.nour@demo.test', password: PASSWORD });

    expect((await login(false)).status).toBe(200);
    expect((await login(true)).status).toBe(401);
  });
});
