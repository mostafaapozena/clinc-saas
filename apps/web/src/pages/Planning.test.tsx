import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

// Budgets, cash flow and recurring commitments (docs/architecture/PLANNING.md). The API computes
// every amount; these tests check what is sent and what each role is offered.
const ORG = 'a'.repeat(24);
const user = { id: 'u1', email: 'noha@example.test', displayName: 'Noha', preferredLanguage: 'ar', emailVerified: false };
const BASE: Permission[] = ['organization.read', 'branch.read', 'dashboard.read', 'accounting.read'];
const ACCOUNTANT: Permission[] = [...BASE, 'accounting.manage', 'cash.voucher.create'];
const OWNER: Permission[] = [...ACCOUNTANT, 'accounting.settings.manage'];
const P = `/api/v1/orgs/${ORG}`;

function shell(role: string, permissions: Permission[]) {
  return {
    'GET /api/v1/auth/session': { user, csrfToken: 'csrf', memberships: [{ organization: { id: ORG, name: 'Clinic' }, role }] },
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
      membership: { id: 'm1', role, branchScope: { type: 'all', branchIds: [] }, permissions, capabilities: [], practitionerId: null },
      stats: { accessibleBranches: 1 },
    },
    [`GET ${P}/branches`]: {
      data: [{ id: 'b1', name: 'North', city: '', status: 'active', specialtyCodes: [], createdAt: '2026-01-01T00:00:00.000Z' }],
    },
    [`GET ${P}/accounting/settings`]: {
      configured: true,
      settings: {
        currency: 'EGP',
        cutoverDate: '2026-10-01',
        lockedThrough: null,
        template: 'raclinic.clinic@1',
        mappings: {},
        requireCashSession: false,
        version: 0,
      },
      prerequisites: { currency: 'EGP', timeZone: 'Africa/Cairo' },
      template: 'raclinic.clinic@1',
      today: '2026-11-10',
    },
  };
}
const acc = (id: string, code: string, templateKey: string, type: string) => ({ id, code, name: templateKey, templateKey, type, status: 'active' });
const ACCOUNTS = [
  acc('rev', '4100', 'serviceRevenue', 'income'),
  acc('rent', '6100', 'rent', 'expense'),
  acc('paper', '6500', 'officeSupplies', 'expense'),
];
const variance = {
  through: 11,
  currency: 'EGP',
  budget: { status: 'draft' },
  rows: [
    {
      account: ACCOUNTS[1],
      annualBudget: 3_000_000,
      budget: 2_000_000,
      actual: 1_200_000,
      variance: -800_000,
      usedPercent: 60,
      favourable: true,
      unbudgeted: false,
    },
    { account: ACCOUNTS[2], annualBudget: 0, budget: 0, actual: 40_000, variance: 40_000, usedPercent: null, favourable: false, unbudgeted: true },
  ],
  totals: { income: { budget: 0, actual: 0 }, expense: { budget: 2_000_000, actual: 1_240_000 }, result: { budget: -2_000_000, actual: -1_240_000 } },
};

describe('budgets', () => {
  it('spreads an annual amount over the months and saves the draft', async () => {
    let sent: { lines: { accountId: string; months: number[] }[]; version: number | null } | null = null;
    mockApi({
      ...shell('accountant', ACCOUNTANT),
      [`GET ${P}/accounting/budgets`]: { year: 2026, currency: 'EGP', budget: null, accounts: ACCOUNTS },
      [`GET ${P}/accounting/reports/budget-vs-actual`]: variance,
      [`PUT ${P}/accounting/budgets`]: (init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return { budget: { status: 'draft', version: 0, lines: [] } };
      },
    });
    renderRoute(`/app/${ORG}/accounting/budgets`);
    const annual = await screen.findByRole('textbox', { name: /المبلغ السنوي لحساب 6100/ });
    fireEvent.change(annual, { target: { value: '1000.05' } });
    fireEvent.blur(annual);
    expect(screen.queryByRole('button', { name: 'اعتماد الموازنة' })).toBeNull(); // the owner approves
    fireEvent.click(screen.getByRole('button', { name: 'حفظ المسودة' }));
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent!.version).toBeNull();
    const months = sent!.lines.find((l) => l.accountId === 'rent')!.months;
    expect(months).toHaveLength(12);
    expect(months.reduce((s, v) => s + v, 0)).toBe(100_005);
    expect(months[0]).toBe(8333);
    expect(months[11]).toBe(100_005 - 8333 * 11);
    const report = await screen.findByTestId('budget-vs-actual');
    expect(within(report).getByText('غير مدرج في الموازنة')).toBeInTheDocument();
    expect(within(report).getByText('60%')).toBeInTheDocument();
  });

  it('shows an approved budget read-only, with reopen for the owner', async () => {
    mockApi({
      ...shell('owner', OWNER),
      [`GET ${P}/accounting/budgets`]: {
        year: 2026,
        currency: 'EGP',
        budget: { status: 'approved', version: 2, lines: [{ accountId: 'rent', months: Array(12).fill(100_000) }] },
        accounts: ACCOUNTS,
      },
      [`GET ${P}/accounting/reports/budget-vs-actual`]: variance,
    });
    renderRoute(`/app/${ORG}/accounting/budgets`);
    expect(await screen.findByRole('button', { name: 'إعادة فتح للتعديل' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'حفظ المسودة' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /المبلغ السنوي/ })).toBeNull();
  });
});

describe('cash flow', () => {
  it('shows the three activities and whether they reconcile with the cash balances', async () => {
    mockApi({
      ...shell('accountant', ACCOUNTANT),
      [`GET ${P}/accounting/reports/cash-flow`]: (_: RequestInit, url: URL) => {
        expect(url.searchParams.get('from')).toBe('2026-11-01');
        return {
          currency: 'EGP',
          opening: 0,
          net: 4_200_000,
          closing: 4_200_000,
          reconciled: true,
          sections: [
            { activity: 'operating', net: -800_000, rows: [{ account: ACCOUNTS[1], inflow: 0, outflow: 800_000, net: -800_000 }] },
            { activity: 'investing', net: 0, rows: [] },
            {
              activity: 'financing',
              net: 5_000_000,
              rows: [{ account: acc('cap', '3100', 'ownerCapital', 'equity'), inflow: 5_000_000, outflow: 0, net: 5_000_000 }],
            },
          ],
        };
      },
    });
    renderRoute(`/app/${ORG}/accounting/cash-flow`);
    const statement = await screen.findByTestId('cash-flow');
    expect(within(statement).getByText('مطابقة مع أرصدة الخزائن والبنوك')).toBeInTheDocument();
    for (const caption of ['الأنشطة التشغيلية', 'الأنشطة الاستثمارية', 'الأنشطة التمويلية'])
      expect(within(statement).getByText(caption)).toBeInTheDocument();
    expect(within(statement).getByText('لا توجد حركة.')).toBeInTheDocument();
  });
});

describe('recurring commitments', () => {
  it('links only a cash-out voucher on the commitment’s account', async () => {
    let sent: Record<string, unknown> | null = null;
    mockApi({
      ...shell('accountant', ACCOUNTANT),
      [`GET ${P}/accounting/budgets`]: { year: 2026, currency: 'EGP', budget: null, accounts: ACCOUNTS },
      [`GET ${P}/accounting/commitments`]: {
        today: '2026-11-10',
        currency: 'EGP',
        monthlyTotal: 1_200_000,
        commitments: [
          {
            id: 'c1',
            name: 'Clinic rent',
            accountId: 'rent',
            amount: 1_200_000,
            frequency: 'monthly',
            monthlyEquivalent: 1_200_000,
            nextDue: '2026-11-05',
            endDate: null,
            status: 'active',
            due: 'overdue',
            version: 0,
          },
        ],
      },
      [`GET ${P}/cash/vouchers`]: {
        vouchers: [
          { id: 'v1', number: 'CV-2026-000001', type: 'out', date: '2026-11-05', counterAccountId: 'rent', amount: 1_200_000, memo: 'November rent' },
          { id: 'v2', number: 'CV-2026-000002', type: 'out', date: '2026-11-06', counterAccountId: 'paper', amount: 40_000, memo: 'Paper' },
          { id: 'v3', number: 'CV-2026-000003', type: 'in', date: '2026-11-06', counterAccountId: 'rent', amount: 5, memo: 'Refund' },
        ],
      },
      [`POST ${P}/accounting/commitments/c1/record`]: (init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return { commitment: {}, recorded: { dueDate: '2026-11-05', amount: 1_200_000 } };
      },
    });
    renderRoute(`/app/${ORG}/accounting/commitments`);
    const row = within(await screen.findByTestId('commitments'));
    expect(row.getByText('متأخر')).toBeInTheDocument();
    fireEvent.click(row.getByRole('button', { name: 'تسجيل الدفع' }));
    const select = await screen.findByRole('combobox', { name: /دُفع بـ/ });
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2));
    expect(within(select).getByRole('option', { name: /November rent/ })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'v:v1' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'تسجيل الدفع' }).at(-1)!);
    await waitFor(() => expect(sent).toEqual({ voucherId: 'v1', billId: null, version: 0 }));
  });
});
