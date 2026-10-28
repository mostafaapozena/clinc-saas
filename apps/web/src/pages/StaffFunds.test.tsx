import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

// Employee advances and petty-cash custody (docs/architecture/STAFF_FUNDS.md): what is sent and
// what each role is offered. The API posts and computes every amount.
const ORG = 'a'.repeat(24);
const P = `/api/v1/orgs/${ORG}`;
const user = { id: 'u1', email: 'noha@example.test', displayName: 'Noha', preferredLanguage: 'ar', emailVerified: false };
const ACCOUNTANT: Permission[] = [
  'organization.read',
  'branch.read',
  'dashboard.read',
  'accounting.read',
  'accounting.manage',
  'cash.session.operate',
];

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
    [`GET ${P}/branches`]: { data: [] },
    [`GET ${P}/cash/accounts`]: { accounts: [{ id: 'bank', name: 'Bank account', kind: 'bank', status: 'active' }] },
    [`GET ${P}/accounting/staff-funds/members`]: { members: [{ id: 'mem1', name: 'Salma', role: 'receptionist' }] },
  };
}
const custody = {
  id: 'f1',
  number: 'CUS-2026-000001',
  kind: 'custody',
  memberName: 'Salma',
  purpose: 'Front desk petty cash',
  amount: 50_000,
  dueDate: '2026-11-01',
  returned: 0,
  expensed: 0,
  writtenOff: 0,
  outstanding: 50_000,
  overdue: true,
  status: 'open',
  movements: [],
  version: 0,
};

describe('advances and custody', () => {
  it('issues with one request key that a retry reuses', async () => {
    const keys: string[] = [];
    let attempt = 0;
    mockApi({
      ...shell('accountant', ACCOUNTANT),
      [`GET ${P}/accounting/staff-funds`]: { currency: 'EGP', funds: [], totals: { advance: 0, custody: 0 } },
      [`POST ${P}/accounting/staff-funds`]: (init: RequestInit) => {
        keys.push(String((init.headers as Record<string, string>)['Idempotency-Key']));
        attempt += 1;
        return attempt === 1
          ? Response.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 503 })
          : Response.json({ fund: custody, replayed: true });
      },
    });
    renderRoute(`/app/${ORG}/accounting/staff-funds`);
    fireEvent.click(await screen.findByRole('button', { name: 'عهدة' }));
    await screen.findByRole('option', { name: /Salma/ });
    fireEvent.change(screen.getByLabelText('الموظف'), { target: { value: 'mem1' } });
    fireEvent.change(screen.getByLabelText('الخزينة أو البنك'), { target: { value: 'bank' } });
    fireEvent.change(screen.getByLabelText('المبلغ'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('الغرض'), { target: { value: 'Front desk petty cash' } });
    const submit = screen.getAllByRole('button', { name: 'صرف سلفة أو عهدة' }).at(-1)!;
    fireEvent.click(submit);
    await waitFor(() => expect(keys).toHaveLength(1));
    await screen.findByRole('alert').catch(() => undefined);
    fireEvent.click(submit);
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).toBe(keys[1]);
  });

  it('settles custody with receipts; write-off is for the owner only', async () => {
    let sent: { lines: { accountId: string; amount: number; memo: string }[]; version: number } | null = null;
    mockApi({
      ...shell('accountant', ACCOUNTANT),
      [`GET ${P}/accounting/staff-funds`]: { currency: 'EGP', funds: [custody], totals: { advance: 0, custody: 50_000 } },
      [`GET ${P}/accounting/accounts`]: {
        accounts: [
          {
            id: 'paper',
            code: '6500',
            name: 'officeSupplies',
            templateKey: 'officeSupplies',
            type: 'expense',
            isGroup: false,
            parentId: null,
            role: null,
            status: 'active',
            version: 0,
          },
          {
            id: 'cashbox',
            code: '1110',
            name: 'mainCashbox',
            templateKey: 'mainCashbox',
            type: 'asset',
            isGroup: false,
            parentId: null,
            role: 'cash',
            status: 'active',
            version: 0,
          },
        ],
      },
      [`POST ${P}/accounting/staff-funds/f1/expenses`]: (init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return { fund: { ...custody, expensed: 12_000, outstanding: 38_000 } };
      },
    });
    renderRoute(`/app/${ORG}/accounting/staff-funds`);
    const row = within(await screen.findByTestId('staff-funds'));
    expect(row.getByText('متأخرة')).toBeInTheDocument();
    expect(row.queryByRole('button', { name: 'شطب المتبقي' })).toBeNull();
    fireEvent.click(row.getByRole('button', { name: 'تسوية بإيصالات' }));
    const form = within(await screen.findByRole('form', { name: 'تسوية بإيصالات' }));
    const account = form.getByLabelText('الحساب');
    await waitFor(() => expect(within(account).getAllByRole('option')).toHaveLength(2)); // expense accounts only
    fireEvent.change(account, { target: { value: 'paper' } });
    fireEvent.change(form.getByLabelText('المبلغ'), { target: { value: '120' } });
    fireEvent.change(form.getByLabelText('بيان الإيصال'), { target: { value: 'Printer paper' } });
    fireEvent.click(form.getByRole('button', { name: 'تأكيد وترحيل' }));
    await waitFor(() => expect(sent).toEqual({ lines: [{ accountId: 'paper', amount: 12_000, memo: 'Printer paper' }], version: 0 }));
  });
});
