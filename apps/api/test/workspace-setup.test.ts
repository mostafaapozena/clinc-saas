import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrganizationModel } from '../src/modules/organizations/organization.model.js';
import { seedSpecialties } from '../src/modules/specialties/specialty.seed.js';
import { addMember, createOrg, register, send, testApp, type Client } from './helpers/api.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// Workspace preparation and module activation (docs/architecture/MODULES.md): setup applies the
// defaults of the chosen kind of organization exactly once; a lost response resumes into the same
// workspace; switched-off modules refuse their API; existing organizations keep everything.
const app = testApp();

beforeAll(async () => {
  await connectTestDatabase('workspace_setup');
  await seedSpecialties();
});
afterAll(() => dropTestDatabase());

async function setUp(user: Client, type: 'clinic' | 'medical_center', specialties: string[]) {
  let res = await send(user, 'put', '/api/v1/onboarding', {
    step: 'specialties',
    version: null,
    data: { organizationType: type, name: 'عيادة التجهيز', timeZone: 'Africa/Cairo' },
  });
  res = await send(user, 'put', '/api/v1/onboarding', { step: 'branch', version: res.body.draft.version, data: { specialtyCodes: specialties } });
  res = await send(user, 'put', '/api/v1/onboarding', {
    step: 'review',
    version: res.body.draft.version,
    data: { branch: { name: 'الفرع الأول', city: 'القاهرة', specialtyCodes: specialties } },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.draft.id as string;
}

describe('workspace preparation', () => {
  it('applies the clinic defaults once, and resumes into the workspace after a lost response', async () => {
    const user = await register(app, 'setup-dental');
    const draftId = await setUp(user, 'clinic', ['dentistry']);
    // Duplicate clicks and retries: one organization, the same answer.
    const results = await Promise.all([1, 2, 3].map(() => send(user, 'post', `/api/v1/onboarding/${draftId}/complete`)));
    const ids = new Set(results.map((r) => r.body.organization.id));
    expect(ids.size).toBe(1);
    const orgId = [...ids][0] as string;
    expect(await OrganizationModel.countDocuments({ createdBy: user.userId })).toBe(1);
    // A single clinic starts with the day-to-day modules; the rest are one switch away.
    const detail = await user.agent.get(`/api/v1/orgs/${orgId}`);
    expect(detail.body.organization).toMatchObject({
      specialtyCodes: ['dentistry'],
      enabledModules: ['accounting', 'cash', 'inventory', 'purchasing'],
    });
    // "Reload" after the response was lost: the page learns the setup is done and where.
    const again = await user.agent.get('/api/v1/onboarding');
    expect(again.body).toMatchObject({ draft: null, completed: { organizationId: orgId } });
  });

  it('gives centers every module', async () => {
    const user = await register(app, 'setup-center');
    const draftId = await setUp(user, 'medical_center', ['dentistry', 'physiotherapy', 'ent']);
    const done = await send(user, 'post', `/api/v1/onboarding/${draftId}/complete`);
    const detail = await user.agent.get(`/api/v1/orgs/${done.body.organization.id}`);
    expect(detail.body.organization.enabledModules).toEqual(['accounting', 'cash', 'inventory', 'purchasing', 'compensation', 'assets']);
  });
});

describe('module activation', () => {
  it('lets the owner switch modules, refuses switched-off APIs, and keeps existing organizations whole', async () => {
    const owner = await register(app, 'modules-owner');
    const admin = await register(app, 'modules-admin');
    const { orgId } = await createOrg(owner, 'Existing Clinic');
    await addMember(owner, orgId, admin, 'admin');
    // Created before modules existed (no setting): everything stays on.
    expect((await owner.agent.get(`/api/v1/orgs/${orgId}`)).body.organization.enabledModules).toHaveLength(6);
    expect((await owner.agent.get(`/api/v1/orgs/${orgId}/assets`)).status).toBe(200);

    expect((await send(admin, 'put', `/api/v1/orgs/${orgId}/modules`, { enabledModules: [] })).status).toBe(403);
    const bad = await send(owner, 'put', `/api/v1/orgs/${orgId}/modules`, { enabledModules: ['cash'] });
    expect(bad.body.error.fields).toEqual({ enabledModules: 'cash_needs_accounting' });
    expect((await send(owner, 'put', `/api/v1/orgs/${orgId}/modules`, { enabledModules: ['accounting', 'inventory'] })).body.enabledModules).toEqual([
      'accounting',
      'inventory',
    ]);
    const refused = await owner.agent.get(`/api/v1/orgs/${orgId}/assets`);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('MODULE_DISABLED');
    expect((await owner.agent.get(`/api/v1/orgs/${orgId}/purchasing/suppliers`)).body.error.code).toBe('MODULE_DISABLED');
    expect((await owner.agent.get(`/api/v1/orgs/${orgId}/inventory/items`)).status).toBe(200);
    // Switching back on shows everything as it was.
    expect(
      (
        await send(owner, 'put', `/api/v1/orgs/${orgId}/modules`, {
          enabledModules: ['accounting', 'cash', 'inventory', 'purchasing', 'compensation', 'assets'],
        })
      ).status,
    ).toBe(200);
    expect((await owner.agent.get(`/api/v1/orgs/${orgId}/assets`)).status).toBe(200);
  });
});
