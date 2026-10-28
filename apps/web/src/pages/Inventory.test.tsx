import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

// Inventory pages (docs/architecture/INVENTORY.md): what is sent, and what each role is offered.
const ORG = 'a'.repeat(24);
const user = { id: 'u1', email: 'noha@example.test', displayName: 'Noha', preferredLanguage: 'ar', emailVerified: false };
const BASE: Permission[] = ['organization.read', 'branch.read', 'dashboard.read'];
const ADMIN: Permission[] = [...BASE, 'inventory.read', 'inventory.manage', 'inventory.move', 'inventory.value.read'];
const DESK: Permission[] = [...BASE, 'inventory.read'];

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
  };
}
const gloves = {
  id: 'i1',
  code: 'GLV-M',
  name: 'Gloves',
  category: '',
  baseUnit: 'piece',
  purchaseUnits: [{ unit: 'box', factor: 100 }],
  tracking: 'none',
  reorderLevel: 100,
  status: 'active',
  onHand: 40,
  belowReorder: true,
  version: 0,
};
const anesthetic = {
  ...gloves,
  id: 'i2',
  code: 'ANS-2',
  name: 'Anesthetic',
  baseUnit: 'cartridge',
  purchaseUnits: [],
  tracking: 'lot',
  reorderLevel: 0,
  onHand: 5,
  belowReorder: false,
};
const stock = {
  [`GET /api/v1/orgs/${ORG}/inventory/items`]: { items: [anesthetic, gloves] },
  [`GET /api/v1/orgs/${ORG}/inventory/warehouses`]: { warehouses: [{ id: 'w1', name: 'Store', branchId: 'b1', status: 'active' }] },
  [`GET /api/v1/orgs/${ORG}/inventory/balances`]: {
    today: '2026-11-10',
    balances: [
      { itemId: 'i2', warehouseId: 'w1', lot: 'L-OLD', expiry: '2026-11-05', qty: 2, expired: true },
      { itemId: 'i1', warehouseId: 'w1', lot: '', expiry: null, qty: 40, expired: false },
    ],
  },
  [`GET /api/v1/orgs/${ORG}/inventory/alerts`]: {
    today: '2026-11-10',
    expiring: [{ itemId: 'i2', warehouseId: 'w1', lot: 'L-OLD', expiry: '2026-11-05', qty: 2, expired: true }],
    reorder: [{ itemId: 'i1', code: 'GLV-M', name: 'Gloves', onHand: 40, reorderLevel: 100, suggested: 160 }],
  },
};
const callsTo = (fetchMock: ReturnType<typeof mockApi>, method: string, suffix: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).split('?')[0]!.endsWith(suffix) && ((init as RequestInit | undefined)?.method ?? 'GET') === method,
  ) as [string, RequestInit][];

describe('inventory', () => {
  it('shows alerts and stock, and records an issue in purchase units with an idempotency key', async () => {
    const fetchMock = mockApi({
      ...shell('admin', ADMIN),
      ...stock,
      [`POST /api/v1/orgs/${ORG}/inventory/operations`]: Response.json({ document: { id: 'd1', number: 'SD-2026-000004' } }, { status: 201 }),
    });
    renderRoute(`/app/${ORG}/inventory`);
    expect(await screen.findByText('اقتراحات إعادة الطلب')).toBeInTheDocument();
    expect(screen.getByText('المقترح: 160')).toBeInTheDocument();
    expect(screen.getByTestId('stock-balances')).toHaveTextContent('L-OLD');
    fireEvent.change(screen.getByLabelText('الصنف'), { target: { value: 'i1' } });
    fireEvent.change(screen.getByLabelText('الكمية'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('الوحدة'), { target: { value: 'box' } });
    fireEvent.change(screen.getByLabelText('السبب'), { target: { value: 'Front desk' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الحركة' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/inventory/operations')).toHaveLength(1));
    const [, init] = callsTo(fetchMock, 'POST', '/inventory/operations')[0]!;
    expect(new Headers(init.headers).get('Idempotency-Key')).toBeTruthy();
    expect(JSON.parse(String(init.body))).toEqual({
      type: 'issue',
      warehouseId: 'w1',
      lines: [{ itemId: 'i1', qty: 2, unit: 'box' }],
      reason: 'Front desk',
    });
  });

  it('offers reading only to roles that cannot move stock', async () => {
    mockApi({ ...shell('receptionist', DESK), ...stock });
    renderRoute(`/app/${ORG}/inventory`);
    expect(await screen.findByTestId('stock-balances')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'حفظ الحركة' })).toBeNull();
  });
});
