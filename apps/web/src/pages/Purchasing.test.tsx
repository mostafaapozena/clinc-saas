import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

// Purchasing pages (docs/architecture/PURCHASING.md): what is sent and what each role is offered.
const ORG = 'a'.repeat(24);
const user = { id: 'u1', email: 'noha@example.test', displayName: 'Noha', preferredLanguage: 'ar', emailVerified: false };
const BASE: Permission[] = ['organization.read', 'branch.read', 'dashboard.read'];
const DOCTOR: Permission[] = [...BASE, 'purchase.request', 'inventory.read'];
const ADMIN: Permission[] = [
  ...BASE,
  'purchase.read',
  'purchase.request',
  'purchase.approve',
  'purchase.order.manage',
  'purchase.receive',
  'purchase.supplier.manage',
  'purchase.bill.manage',
  'inventory.read',
];

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
    [`GET /api/v1/orgs/${ORG}/purchasing/suppliers`]: {
      suppliers: [
        { id: 's1', code: 'MED-1', name: 'Medical One', phone: '', email: '', paymentTermsDays: 30, status: 'active', notes: '', version: 0 },
      ],
    },
    [`GET /api/v1/orgs/${ORG}/inventory/items`]: {
      items: [
        {
          id: 'i1',
          code: 'GLV',
          name: 'Gloves',
          category: '',
          baseUnit: 'piece',
          purchaseUnits: [{ unit: 'box', factor: 100 }],
          tracking: 'none',
          reorderLevel: 0,
          status: 'active',
          onHand: 0,
          belowReorder: false,
          version: 0,
        },
      ],
    },
  };
}
const request = (extra: Record<string, unknown> = {}) => ({
  id: 'r1',
  number: 'PR-2026-000001',
  branchId: 'b1',
  requestedBy: 'u2',
  reason: '',
  estimatedTotal: 150000,
  status: 'submitted',
  decision: null,
  version: 0,
  createdAt: '2026-11-10T08:00:00.000Z',
  lines: [{ itemId: 'i1', description: 'Gloves', unit: 'box', factor: 100, qty: 10, unitPrice: 15000, amount: 150000, expenseAccountId: null }],
  ...extra,
});
const callsTo = (fetchMock: ReturnType<typeof mockApi>, method: string, suffix: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).split('?')[0]!.endsWith(suffix) && ((init as RequestInit | undefined)?.method ?? 'GET') === method,
  ) as [string, RequestInit][];

describe('purchasing', () => {
  it('lets a doctor request supplies in purchase units, without approval or ordering controls', async () => {
    const fetchMock = mockApi({
      ...shell('doctor', DOCTOR),
      [`GET /api/v1/orgs/${ORG}/purchasing/requests`]: { requests: [] },
      [`POST /api/v1/orgs/${ORG}/purchasing/requests`]: Response.json(
        { request: request({ status: 'approved', decision: { by: null, at: '', reason: '', automatic: true } }) },
        { status: 201 },
      ),
    });
    renderRoute(`/app/${ORG}/purchasing`);
    expect(await screen.findByText('طلباتي')).toBeInTheDocument();
    await screen.findByRole('option', { name: 'GLV · Gloves' });
    fireEvent.change(screen.getByLabelText('صنف السطر 1'), { target: { value: 'i1' } });
    fireEvent.change(screen.getByLabelText('وحدة السطر 1'), { target: { value: 'box' } });
    fireEvent.change(screen.getByLabelText('كمية السطر 1'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('سعر السطر 1'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'إرسال الطلب' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/purchasing/requests')).toHaveLength(1));
    const [, init] = callsTo(fetchMock, 'POST', '/purchasing/requests')[0]!;
    expect(new Headers(init.headers).get('Idempotency-Key')).toBeTruthy();
    expect(JSON.parse(String(init.body))).toEqual({ branchId: 'b1', reason: '', lines: [{ itemId: 'i1', unit: 'box', qty: 3, unitPrice: 15000 }] });
    expect(screen.queryByText('سياسة المشتريات')).toBeNull();
  });

  it('shows approvers the pending requests and sends the decision with the version', async () => {
    const fetchMock = mockApi({
      ...shell('admin', ADMIN),
      [`GET /api/v1/orgs/${ORG}/purchasing/requests`]: { requests: [request()] },
      [`POST /api/v1/orgs/${ORG}/purchasing/requests/r1/approve`]: { request: request({ status: 'approved' }) },
    });
    renderRoute(`/app/${ORG}/purchasing`);
    expect(await screen.findByText('1 طلب بانتظار اعتمادك.')).toBeInTheDocument();
    const row = within(screen.getByTestId('purchase-requests'));
    fireEvent.click(row.getByRole('button', { name: 'اعتماد' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/purchasing/requests/r1/approve')).toHaveLength(1));
    expect(JSON.parse(String(callsTo(fetchMock, 'POST', '/purchasing/requests/r1/approve')[0]![1].body))).toEqual({ version: 0, reason: '' });
  });
});
