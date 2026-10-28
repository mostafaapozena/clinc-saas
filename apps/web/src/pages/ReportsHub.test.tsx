import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { csvMoney, toCsv } from '../lib/csv';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

// Reports hub (ERP milestone G) and CSV export.
const ORG = 'a'.repeat(24);
const user = { id: 'u1', email: 'noha@example.test', displayName: 'Noha', preferredLanguage: 'ar', emailVerified: false };

function shell(permissions: Permission[], scope: 'all' | 'selected' = 'all') {
  return {
    'GET /api/v1/auth/session': { user, csrfToken: 'csrf', memberships: [{ organization: { id: ORG, name: 'Clinic' }, role: 'accountant' }] },
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
    [`GET /api/v1/orgs/${ORG}/branches`]: {
      data: [{ id: 'b1', name: 'North', city: '', status: 'active', specialtyCodes: [], createdAt: '2026-01-01T00:00:00.000Z' }],
    },
  };
}

describe('CSV export', () => {
  it('quotes separators, neutralizes formulas and keeps money exact', () => {
    expect(toCsv([['a,b', 'say "hi"', '=SUM(A1)', 12.5, null]])).toBe('"a,b","say ""hi""",\'=SUM(A1),12.5,');
    expect(csvMoney(123456)).toBe('1234.56');
    expect(csvMoney(-5)).toBe('-0.05');
  });
});

describe('reports hub', () => {
  it('lists only the reports the role may open, and ledger reports only with organization-wide scope', async () => {
    mockApi(shell(['organization.read', 'branch.read', 'dashboard.read', 'accounting.read', 'inventory.read', 'purchase.bill.manage'], 'selected'));
    renderRoute(`/app/${ORG}/reports`);
    const financial = within(await screen.findByTestId('reports-financial'));
    expect(financial.getByText('الفترات المحاسبية')).toBeInTheDocument();
    expect(financial.queryByText('ميزان المراجعة والقوائم')).toBeNull();
    expect(screen.queryByTestId('reports-cash')).toBeNull(); // payables need organization-wide scope
    expect(within(screen.getByTestId('reports-operations')).getByText('المخزون والصلاحية')).toBeInTheDocument();
  });
});
