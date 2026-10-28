import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

// General ledger and cash pages (docs/architecture/ACCOUNTING.md). The API computes every amount;
// these tests check what is sent and what each role is offered.
const ORG = 'a'.repeat(24);
const user = { id: 'u1', email: 'noha@example.test', displayName: 'Noha', preferredLanguage: 'ar', emailVerified: false };
const BASE: Permission[] = ['organization.read', 'branch.read', 'dashboard.read'];
const OWNER: Permission[] = [
  ...BASE,
  'accounting.read',
  'accounting.manage',
  'accounting.settings.manage',
  'accounting.period.close',
  'accounting.period.reopen',
  'cash.session.operate',
  'cash.session.review',
  'cash.voucher.create',
];
const ACCOUNTANT: Permission[] = [
  ...BASE,
  'accounting.read',
  'accounting.manage',
  'accounting.period.close',
  'cash.session.operate',
  'cash.session.review',
  'cash.voucher.create',
];
const CASHIER: Permission[] = [...BASE, 'cash.session.operate'];

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
const settings = {
  configured: true,
  settings: {
    currency: 'EGP',
    cutoverDate: '2026-10-01',
    lockedThrough: null,
    template: 'raclinic.clinic@1',
    mappings: { receivable: 'acc-ar' },
    requireCashSession: false,
    version: 0,
  },
  prerequisites: { currency: 'EGP', timeZone: 'Africa/Cairo' },
  template: 'raclinic.clinic@1',
  today: '2026-11-10',
};
const account = (id: string, code: string, templateKey: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  code,
  name: templateKey,
  templateKey,
  type,
  isGroup: false,
  parentId: null,
  role: null,
  status: 'active',
  version: 0,
  balance: 0,
  ...extra,
});
const ACCOUNTS = [
  account('acc-rent', '6100', 'rent', 'expense'),
  account('acc-cap', '3100', 'ownerCapital', 'equity'),
  account('acc-ar', '1200', 'patientReceivables', 'asset', { balance: 18000 }),
];
const callsTo = (fetchMock: ReturnType<typeof mockApi>, method: string, suffix: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).split('?')[0]!.endsWith(suffix) && ((init as RequestInit | undefined)?.method ?? 'GET') === method,
  ) as [string, RequestInit][];

describe('accounting setup', () => {
  it('lets the owner start the ledger from the first day of the current month', async () => {
    const fetchMock = mockApi({
      ...shell('owner', OWNER),
      [`GET /api/v1/orgs/${ORG}/accounting/settings`]: { ...settings, configured: false, settings: null },
      [`POST /api/v1/orgs/${ORG}/accounting/setup`]: Response.json({ settings: settings.settings }, { status: 201 }),
    });
    renderRoute(`/app/${ORG}/accounting`);
    const date = await screen.findByLabelText('تاريخ بداية الدفاتر');
    expect(date).toHaveValue('2026-11-01');
    expect(screen.getAllByText(/نموذج تنفيذي مبدئي/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'إعداد الحسابات' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/accounting/setup')).toHaveLength(1));
    expect(JSON.parse(String(callsTo(fetchMock, 'POST', '/accounting/setup')[0]![1].body))).toEqual({
      cutoverDate: '2026-11-01',
      requireCashSession: false,
    });
  });
});

describe('manual journal entry', () => {
  it('posts only balanced entries, in minor units, with an idempotency key', async () => {
    const fetchMock = mockApi({
      ...shell('accountant', ACCOUNTANT),
      [`GET /api/v1/orgs/${ORG}/accounting/settings`]: settings,
      [`GET /api/v1/orgs/${ORG}/accounting/accounts`]: { accounts: ACCOUNTS },
      [`GET /api/v1/orgs/${ORG}/accounting/entries`]: { data: [], page: 1, pageSize: 20, total: 0 },
      [`POST /api/v1/orgs/${ORG}/accounting/entries`]: Response.json({ entry: { id: 'e1', number: 'JE-2026-000001' } }, { status: 201 }),
    });
    renderRoute(`/app/${ORG}/accounting/entries`);
    fireEvent.click(await screen.findByRole('button', { name: 'قيد يدوي جديد' }));
    fireEvent.change(await screen.findByLabelText('التاريخ'), { target: { value: '2026-11-05' } });
    fireEvent.change(screen.getByLabelText('البيان'), { target: { value: 'November rent' } });
    fireEvent.change(screen.getByLabelText('حساب السطر 1'), { target: { value: 'acc-rent' } });
    fireEvent.change(screen.getByLabelText('مدين السطر 1'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('حساب السطر 2'), { target: { value: 'acc-cap' } });
    fireEvent.change(screen.getByLabelText('دائن السطر 2'), { target: { value: '4999.99' } });
    const post = screen.getByRole('button', { name: 'ترحيل القيد' });
    expect(post).toBeDisabled();
    expect(screen.getByText(/غير متوازن/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('دائن السطر 2'), { target: { value: '5000' } });
    expect(post).toBeEnabled();
    fireEvent.click(post);
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/accounting/entries')).toHaveLength(1));
    const [, init] = callsTo(fetchMock, 'POST', '/accounting/entries')[0]!;
    expect(new Headers(init.headers).get('Idempotency-Key')).toBeTruthy();
    expect(JSON.parse(String(init.body))).toEqual({
      date: '2026-11-05',
      journal: 'general',
      memo: 'November rent',
      lines: [
        { accountId: 'acc-rent', debit: 500000, credit: 0, branchId: null },
        { accountId: 'acc-cap', debit: 0, credit: 500000, branchId: null },
      ],
    });
  });
});

describe('cash and banks', () => {
  const session = {
    id: 's1',
    number: 'CS-2026-000001',
    branchId: 'b1',
    cashAccountId: 'box1',
    status: 'open',
    openedBy: 'u1',
    openedByName: 'Noha',
    mine: true,
    openedAt: '2026-11-10T07:00:00.000Z',
    openingExpected: 0,
    openingCounted: 0,
    closedAt: null,
    closingExpected: null,
    closingCounted: null,
    difference: null,
    note: '',
  };
  const box = { id: 'box1', name: 'Front desk', kind: 'cash', branchId: 'b1', accountId: 'l1', status: 'active' };

  it('offers a cashier only the cash pages and their own session, and closes it with a counted amount and a note for differences', async () => {
    const fetchMock = mockApi({
      ...shell('receptionist', CASHIER),
      [`GET /api/v1/orgs/${ORG}/accounting/settings`]: settings,
      [`GET /api/v1/orgs/${ORG}/cash/accounts`]: { accounts: [box] },
      [`GET /api/v1/orgs/${ORG}/cash/sessions`]: { sessions: [session] },
      [`GET /api/v1/orgs/${ORG}/cash/sessions/s1`]: {
        session,
        cashAccount: box,
        movements: [
          {
            entryId: 'e1',
            number: 'JE-2026-000004',
            memo: 'RCPT-2026-000003',
            sourceType: 'payment',
            event: 'received',
            amount: 20000,
            at: '2026-11-10T08:00:00.000Z',
          },
        ],
        expectedNow: 20000,
      },
      [`POST /api/v1/orgs/${ORG}/cash/sessions/s1/close`]: { session: { ...session, status: 'closed' } },
    });
    const { router } = renderRoute(`/app/${ORG}/cash`);
    const close = await screen.findByRole('link', { name: 'العد والإقفال' });
    expect(screen.queryByRole('link', { name: 'الحسابات العامة' })).toBeNull();
    expect(screen.getAllByRole('link', { name: 'الخزينة والبنوك' }).length).toBeGreaterThan(0);
    fireEvent.click(close);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/${ORG}/cash/sessions/s1`));
    expect(await screen.findByTestId('session-expected')).toHaveTextContent('200');
    fireEvent.change(screen.getByLabelText('النقدية المعدودة عند الإقفال'), { target: { value: '195' } });
    expect(screen.getByText(/عجز/)).toBeInTheDocument();
    const note = screen.getByLabelText('ملاحظة');
    expect(note).toBeRequired();
    fireEvent.change(note, { target: { value: 'Short by 5' } });
    fireEvent.click(screen.getByRole('button', { name: 'إقفال الوردية' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/cash/sessions/s1/close')).toHaveLength(1));
    expect(JSON.parse(String(callsTo(fetchMock, 'POST', '/cash/sessions/s1/close')[0]![1].body))).toEqual({ counted: 19500, note: 'Short by 5' });
    // No ledger views were requested for the cashier.
    expect(callsTo(fetchMock, 'GET', '/accounting/accounts')).toHaveLength(0);
  });
});
