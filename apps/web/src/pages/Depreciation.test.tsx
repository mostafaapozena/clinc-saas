import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

// Equipment depreciation (docs/architecture/ASSETS.md, milestone H4): the accountant's inputs are
// sent as entered; the API computes and posts every amount.
const ORG = 'a'.repeat(24);
const P = `/api/v1/orgs/${ORG}`;
const user = { id: 'u1', email: 'noha@example.test', displayName: 'Noha', preferredLanguage: 'ar', emailVerified: false };
const ACCOUNTANT: Permission[] = ['organization.read', 'branch.read', 'dashboard.read', 'asset.read', 'accounting.read', 'accounting.manage'];
const asset = {
  id: 'as1',
  code: 'UNIT-1',
  name: 'Dental unit',
  category: '',
  serialNumber: '',
  branchId: 'b1',
  location: '',
  purchase: { date: '2026-10-02', cost: 1_200_000 },
  capitalized: true,
  maintenanceIntervalDays: null,
  nextMaintenanceDue: null,
  maintenanceDue: false,
  status: 'active',
  disposal: null,
  depreciation: null,
  version: 3,
};
const shell = {
  'GET /api/v1/auth/session': { user, csrfToken: 'csrf', memberships: [{ organization: { id: ORG, name: 'Clinic' }, role: 'accountant' }] },
  [`GET ${P}`]: {
    organization: {
      id: ORG,
      name: 'Clinic',
      timeZone: 'Africa/Cairo',
      type: null,
      specialtyCodes: [],
      configVersion: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    membership: {
      id: 'm1',
      role: 'accountant',
      branchScope: { type: 'all', branchIds: [] },
      permissions: ACCOUNTANT,
      capabilities: [],
      practitionerId: null,
    },
    stats: { accessibleBranches: 1 },
  },
  [`GET ${P}/branches`]: {
    data: [{ id: 'b1', name: 'North', city: '', status: 'active', specialtyCodes: [], createdAt: '2026-01-01T00:00:00.000Z' }],
  },
  [`GET ${P}/finance/settings`]: { currency: 'EGP' },
};

describe('equipment depreciation', () => {
  it('sends the accountant’s method inputs for a capitalized device', async () => {
    let sent: Record<string, unknown> | null = null;
    mockApi({
      ...shell,
      [`GET ${P}/assets/as1`]: { asset, maintenance: [] },
      [`PUT ${P}/assets/as1/depreciation`]: (init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return { depreciation: {}, version: 4 };
      },
    });
    renderRoute(`/app/${ORG}/assets/as1`);
    const card = within(await screen.findByTestId('depreciation'));
    expect(card.getByText('لم يُحدَّد إهلاك لهذا الجهاز بعد.')).toBeInTheDocument();
    fireEvent.change(card.getByLabelText('العمر الإنتاجي (شهور)'), { target: { value: '60' } });
    fireEvent.change(card.getByLabelText('القيمة المتبقية'), { target: { value: '1000' } });
    expect(card.getByLabelText('أول شهر إهلاك')).toHaveValue('2026-10');
    fireEvent.click(card.getByRole('button', { name: 'حفظ طريقة الإهلاك' }));
    await waitFor(() => expect(sent).toEqual({ usefulLifeMonths: 60, residualValue: 100_000, startMonth: '2026-10', version: 3 }));
  });

  it('shows what a run would post and posts through the chosen month', async () => {
    let body: Record<string, unknown> | null = null;
    mockApi({
      ...shell,
      [`GET ${P}/assets`]: { today: '2026-11-10', assets: [] },
      [`GET ${P}/assets/depreciation/schedule`]: {
        through: '2026-10',
        assets: [{ id: 'as1', code: 'UNIT-1', name: 'Dental unit', due: [{ month: '2026-10', amount: 100_000 }] }],
      },
      [`POST ${P}/assets/depreciation/run`]: (init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return { month: '2026-10', results: [], total: 100_000 };
      },
    });
    renderRoute(`/app/${ORG}/assets`);
    const run = within(await screen.findByTestId('depreciation-run'));
    expect(await run.findByText(/1 قسط مستحق/)).toBeInTheDocument();
    fireEvent.click(run.getByRole('button', { name: 'ترحيل الإهلاك' }));
    await waitFor(() => expect(body).toEqual({ month: '2026-10' }));
  });
});
