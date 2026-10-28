import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

// Practitioner fees (docs/architecture/COMPENSATION.md): a doctor sees only their own statements;
// the owner approves a draft with its version.
const ORG = 'a'.repeat(24);
const user = { id: 'u1', email: 'noha@example.test', displayName: 'Noha', preferredLanguage: 'ar', emailVerified: false };
const BASE: Permission[] = ['organization.read', 'branch.read', 'dashboard.read'];

function shell(role: string, permissions: Permission[]) {
  return {
    'GET /api/v1/auth/session': { user, csrfToken: 'csrf', memberships: [{ organization: { id: ORG, name: 'Clinic' }, role }] },
    [`GET /api/v1/orgs/${ORG}`]: {
      organization: {
        id: ORG,
        name: 'Clinic',
        timeZone: 'Africa/Cairo',
        type: null,
        specialtyCodes: [],
        configVersion: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      membership: { id: 'm1', role, branchScope: { type: 'all', branchIds: [] }, permissions, capabilities: [], practitionerId: null },
      stats: { accessibleBranches: 1 },
    },
    [`GET /api/v1/orgs/${ORG}/branches`]: {
      data: [{ id: 'b1', name: 'North', city: '', status: 'active', specialtyCodes: [], createdAt: '2026-01-01T00:00:00.000Z' }],
    },
    [`GET /api/v1/orgs/${ORG}/finance/settings`]: { currency: 'EGP', currencyLocked: true, supportedCurrencies: ['EGP', 'SAR'] },
  };
}
const settlement = (extra: Record<string, unknown> = {}) => ({
  id: 's1',
  number: 'STL-2026-000001',
  practitionerId: 'p1',
  periodFrom: '2026-11-01',
  periodTo: '2026-11-30',
  status: 'draft',
  lines: [{ sourceKey: 'charge:c1', sourceType: 'charge', date: '2026-11-05', description: 'Consultation', qty: 1, base: 30000, amount: 10000 }],
  adjustments: [],
  computed: 10000,
  total: 10000,
  paid: 0,
  remaining: 0,
  version: 3,
  ...extra,
});
const callsTo = (fetchMock: ReturnType<typeof mockApi>, method: string, suffix: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).split('?')[0]!.endsWith(suffix) && ((init as RequestInit | undefined)?.method ?? 'GET') === method,
  ) as [string, RequestInit][];

describe('practitioner fees', () => {
  it('shows a doctor their own statements only', async () => {
    const fetchMock = mockApi({
      ...shell('doctor', [...BASE, 'compensation.own.read']),
      [`GET /api/v1/orgs/${ORG}/compensation/my-settlements`]: { settlements: [settlement({ status: 'approved' })] },
    });
    renderRoute(`/app/${ORG}/compensation`);
    expect(await screen.findByTestId('my-settlements')).toHaveTextContent('STL-2026-000001');
    expect(callsTo(fetchMock, 'GET', '/compensation/settlements')).toHaveLength(0);
    expect(screen.queryByText('اتفاقية جديدة')).toBeNull();
  });

  it('lets the owner approve a draft with its version', async () => {
    const fetchMock = mockApi({
      ...shell('owner', [...BASE, 'compensation.read', 'compensation.manage', 'compensation.approve', 'compensation.pay']),
      [`GET /api/v1/orgs/${ORG}/compensation/settlements/s1`]: { settlement: settlement() },
      [`POST /api/v1/orgs/${ORG}/compensation/settlements/s1/approve`]: { settlement: settlement({ status: 'approved' }) },
    });
    renderRoute(`/app/${ORG}/compensation/settlements/s1`);
    expect(await screen.findByTestId('settlement-lines')).toHaveTextContent('Consultation');
    fireEvent.click(screen.getByRole('button', { name: 'اعتماد' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/compensation/settlements/s1/approve')).toHaveLength(1));
    expect(JSON.parse(String(callsTo(fetchMock, 'POST', '/compensation/settlements/s1/approve')[0]![1].body))).toEqual({ version: 3 });
  });
});
