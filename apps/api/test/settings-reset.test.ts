import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InvoiceModel } from '../src/modules/finance/finance.model.js';
import { OrganizationModel } from '../src/modules/organizations/organization.model.js';
import { send, testApp } from './helpers/api.js';
import { buildClinic, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// Safe settings reset (docs/architecture/SETTINGS_RESET.md).
const app = testApp();
let c: Clinic;
let name: string;
const url = (path: string) => `/api/v1/orgs/${c.orgId}${path}`;
const settings = async () => (await c.owner.agent.get(url('/accounting/settings'))).body.settings;

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('settings-reset');
  c = await buildClinic(app, 'settings-reset');
  await send(c.owner, 'put', url('/finance/settings'), { currency: 'EGP' });
  await send(c.owner, 'post', url('/accounting/setup'), { cutoverDate: '2026-11-01' });
  name = (await OrganizationModel.findById(c.orgId).lean())!.name;
  // Settings drift from the defaults: a module switched off, a mapping moved, a cashier rule on.
  await send(c.owner, 'put', url('/modules'), { enabledModules: ['accounting', 'cash', 'inventory'] });
  const accounts = (await c.owner.agent.get(url('/accounting/accounts'))).body.accounts as { id: string; code: string }[];
  const s = await settings();
  const moved = await send(c.owner, 'patch', url('/accounting/settings'), {
    mappings: { cashOverShort: accounts.find((a) => a.code === '6990')!.id },
    requireCashSession: true,
    version: s.version,
  });
  expect(moved.status, JSON.stringify(moved.body)).toBe(200);
});
afterAll(() => dropTestDatabase());

describe('settings reset', () => {
  let token: string;
  let snapshotId: string;
  it('previews exactly what would change, without changing anything', async () => {
    expect((await c.admin.agent.get(url('/settings-reset/preview?sections=modules'))).status).toBe(403);
    const preview = await c.owner.agent.get(url('/settings-reset/preview?sections=modules,accounting'));
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.changes.map((ch: { key: string }) => ch.key).sort()).toEqual([
      'enabledModules',
      'mappings.cashOverShort',
      'requireCashSession',
    ]);
    expect(preview.body.skipped).toEqual([]);
    token = preview.body.token;
    expect((await settings()).requireCashSession).toBe(true);
  });

  it('needs the organization’s name and the previewed state', async () => {
    expect(
      (await send(c.owner, 'post', url('/settings-reset'), { sections: ['modules', 'accounting'], token, confirmName: 'wrong' })).body.error.fields,
    ).toEqual({ confirmName: 'does_not_match' });
    expect(
      (await send(c.owner, 'post', url('/settings-reset'), { sections: ['modules', 'accounting'], token: 'x'.repeat(32), confirmName: name })).body
        .error.code,
    ).toBe('SETTINGS_CHANGED');
  });

  it('snapshots, resets to the defaults and audits; records are untouched', async () => {
    const invoicesBefore = await InvoiceModel.countDocuments({ organizationId: c.orgId });
    const reset = await send(c.owner, 'post', url('/settings-reset'), { sections: ['modules', 'accounting'], token, confirmName: name });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    snapshotId = reset.body.snapshot.id;
    expect(reset.body.snapshot).toMatchObject({ kind: 'reset', changes: 3 });
    const org = (await c.owner.agent.get(url(''))).body.organization;
    expect(org.enabledModules).toEqual(['accounting', 'cash', 'inventory', 'purchasing', 'compensation', 'assets']); // defaults of the test organization's type
    expect((await settings()).requireCashSession).toBe(false);
    expect(await InvoiceModel.countDocuments({ organizationId: c.orgId })).toBe(invoicesBefore);
    const again = await c.owner.agent.get(url('/settings-reset/preview?sections=modules,accounting'));
    expect(again.body.changes).toEqual([]);
  });

  it('restores the snapshot once, itself snapshotted', async () => {
    const restored = await send(c.owner, 'post', url(`/settings-reset/snapshots/${snapshotId}/restore`), { confirmName: name });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect((await settings()).requireCashSession).toBe(true);
    expect((await c.owner.agent.get(url(''))).body.organization.enabledModules).toEqual(['accounting', 'cash', 'inventory']);
    expect((await send(c.owner, 'post', url(`/settings-reset/snapshots/${snapshotId}/restore`), { confirmName: name })).body.error.code).toBe(
      'ALREADY_RESTORED',
    );
    const list = await c.owner.agent.get(url('/settings-reset/snapshots'));
    expect(list.body.snapshots.map((s: { kind: string }) => s.kind)).toEqual(['restore', 'reset']);
  });
});
