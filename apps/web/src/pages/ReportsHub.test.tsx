import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { csvMoney, toCsv } from '../lib/csv';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

// Reports center (docs/REPORTS_CENTER.md) and CSV export.
const ORG = 'a'.repeat(24);
const P = `/api/v1/orgs/${ORG}`;
const user = { id: 'u1', email: 'noha@example.test', displayName: 'Noha', preferredLanguage: 'ar', emailVerified: false };

function shell(permissions: Permission[], scope: 'all' | 'selected' = 'all') {
  return {
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
        branchScope: { type: scope, branchIds: scope === 'all' ? [] : ['b1'] },
        permissions,
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
}

describe('CSV export', () => {
  it('quotes separators, neutralizes formulas and keeps money exact', () => {
    expect(toCsv([['a,b', 'say "hi"', '=SUM(A1)', 12.5, null]])).toBe('"a,b","say ""hi""",\'=SUM(A1),12.5,');
    expect(csvMoney(123456)).toBe('1234.56');
    expect(csvMoney(-5)).toBe('-0.05');
  });
});

describe('reports center', () => {
  it('lists only the reports the role may open, and ledger reports only with organization-wide scope', async () => {
    mockApi(shell(['organization.read', 'branch.read', 'dashboard.read', 'accounting.read', 'inventory.read', 'purchase.bill.manage'], 'selected'));
    renderRoute(`/app/${ORG}/reports`);
    const tabs = await screen.findByRole('tablist', { name: 'فئات التقارير' });
    // Cash reports need organization-wide scope; operations come with dashboard.read.
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['المالية', 'التحصيل والمستحقات', 'المخزون والمشتريات']);
    const financial = within(await screen.findByTestId('reports-financial'));
    expect(financial.getByText('الفترات المحاسبية')).toBeInTheDocument();
    expect(financial.queryByText('ميزان المراجعة')).toBeNull();
    fireEvent.click(within(tabs).getByRole('tab', { name: 'المخزون والمشتريات' }));
    const inventory = within(await screen.findByTestId('reports-inventory'));
    expect(inventory.getByText('المخزون والصلاحية')).toBeInTheDocument();
    expect(inventory.queryByText('أعمار ذمم الموردين')).toBeNull();
  });

  it('draws the financial charts from the summary and trend endpoints, with a table alternative', async () => {
    mockApi({
      ...shell(['organization.read', 'branch.read', 'dashboard.read', 'finance.report.read']),
      [`GET ${P}/finance/reports/summary`]: {
        invoiced: [{ currency: 'EGP', count: 2, subtotal: 90000, discounts: 10000, total: 80000 }],
        collected: [
          { currency: 'EGP', method: 'cash', count: 1, amount: 30000 },
          { currency: 'EGP', method: 'card', count: 1, amount: 10000 },
        ],
        adjustments: [],
        outstanding: [{ currency: 'EGP', amount: 40000 }],
        byService: [{ currency: 'EGP', service: 'Implant', quantity: 1, amount: 80000 }],
      },
      [`GET ${P}/finance/reports/trend`]: {
        months: ['2026-10', '2026-11'],
        series: [{ currency: 'EGP', invoiced: [0, 80000], collected: [0, 40000] }],
      },
    });
    renderRoute(`/app/${ORG}/reports`);
    const kpis = within(await screen.findByTestId('report-kpis'));
    expect(await kpis.findByText(/2 فاتورة صادرة/)).toBeInTheDocument();
    const methods = within(screen.getByTestId('chart-methods'));
    expect(await methods.findByText('نقدًا')).toBeInTheDocument();
    expect(methods.getByText(/75%/)).toBeInTheDocument();
    fireEvent.click(methods.getByRole('button', { name: 'عرض كجدول' }));
    expect(methods.getByRole('table')).toBeInTheDocument();
    expect(await within(screen.getByTestId('chart-trend')).findByRole('img')).toBeInTheDocument();
  });

  it('shows an explicit empty state, never an invented chart, for a period without data', async () => {
    mockApi({
      ...shell(['organization.read', 'branch.read', 'dashboard.read', 'finance.report.read']),
      [`GET ${P}/finance/reports/summary`]: { invoiced: [], collected: [], adjustments: [], outstanding: [], byService: [] },
      [`GET ${P}/finance/reports/trend`]: { months: ['2026-10', '2026-11'], series: [] },
    });
    renderRoute(`/app/${ORG}/reports`);
    const trend = within(await screen.findByTestId('chart-trend'));
    expect(await trend.findByText('لا توجد فواتير ولا تحصيلات في هذه الأشهر.')).toBeInTheDocument();
    expect(trend.queryByRole('img')).toBeNull();
  });
});
