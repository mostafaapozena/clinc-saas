import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

// Installment plans and write-offs on the invoice page (docs/architecture/INSTALLMENTS.md).
const ORG = 'a'.repeat(24);
const P = `/api/v1/orgs/${ORG}`;
const user = { id: 'u1', email: 'noha@example.test', displayName: 'Noha', preferredLanguage: 'ar', emailVerified: false };
const DESK: Permission[] = [
  'organization.read',
  'branch.read',
  'dashboard.read',
  'patient.read',
  'finance.invoice.manage',
  'finance.payment.record',
  'finance.account.read',
];
const shell = (role: string, permissions: Permission[]) => ({
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
  [`GET ${P}/finance/settings`]: { currency: 'EGP', currencyLocked: true, supportedCurrencies: ['EGP', 'SAR'] },
  [`GET ${P}/finance/invoices/i1`]: {
    invoice: {
      id: 'i1',
      branchId: 'b1',
      patientId: 'p1',
      number: 'INV-2026-000007',
      status: 'issued',
      lines: [{ chargeId: 'c1', description: 'Implant', quantity: 1, unitPrice: 1_000_000, amount: 1_000_000 }],
      subtotal: 1_000_000,
      discount: null,
      total: 1_000_000,
      paid: 0,
      credited: 0,
      balance: 1_000_000,
      currency: 'EGP',
      issuedAt: '2026-11-10T09:00:00.000Z',
      version: 2,
      createdAt: '2026-11-10T08:30:00.000Z',
    },
    patient: { id: 'p1', fullName: 'Test Patient', patientNumber: 7 },
    branch: null,
    organization: { name: 'Clinic' },
    payments: [],
    creditNotes: [],
  },
  [`GET ${P}/finance/installment-plans`]: { plans: [] },
});

describe('installments on an invoice', () => {
  it('splits the open balance into exact monthly installments and sends them', async () => {
    let sent: { invoiceId: string; schedule: { dueDate: string; amount: number }[] } | null = null;
    mockApi({
      ...shell('receptionist', DESK),
      [`POST ${P}/finance/installment-plans`]: (init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return { plan: {} };
      },
    });
    renderRoute(`/app/${ORG}/finance/invoices/i1`);
    const card = within(await screen.findByTestId('invoice-installments'));
    expect(card.queryByRole('button', { name: 'شطب كدين معدوم' })).toBeNull(); // the owner writes off
    fireEvent.change(card.getByLabelText('عدد الأقساط'), { target: { value: '3' } });
    fireEvent.change(card.getByLabelText('أول استحقاق'), { target: { value: '2027-01-31' } });
    fireEvent.click(card.getByRole('button', { name: 'توزيع شهري متساوٍ' }));
    expect(card.getByLabelText('تاريخ الاستحقاق 2')).toHaveValue('2027-02-28');
    expect(card.getByLabelText('المبلغ 3')).toHaveValue('3333.34');
    fireEvent.change(card.getByLabelText('المبلغ 3'), { target: { value: '3333.33' } });
    expect(card.getByRole('button', { name: 'إنشاء خطة التقسيط' })).toBeDisabled();
    fireEvent.change(card.getByLabelText('المبلغ 3'), { target: { value: '3333.34' } });
    fireEvent.click(card.getByRole('button', { name: 'إنشاء خطة التقسيط' }));
    await waitFor(() =>
      expect(sent).toEqual({
        invoiceId: 'i1',
        schedule: [
          { dueDate: '2027-01-31', amount: 333_333 },
          { dueDate: '2027-02-28', amount: 333_333 },
          { dueDate: '2027-03-31', amount: 333_334 },
        ],
      }),
    );
  });

  it('offers the owner a write-off with a request key', async () => {
    let headers: Record<string, string> | null = null;
    mockApi({
      ...shell('owner', [...DESK, 'finance.writeoff']),
      [`POST ${P}/finance/invoices/i1/write-offs`]: (init: RequestInit) => {
        headers = init.headers as Record<string, string>;
        return { writeOff: {} };
      },
    });
    renderRoute(`/app/${ORG}/finance/invoices/i1`);
    const card = within(await screen.findByTestId('invoice-installments'));
    fireEvent.click(card.getByRole('button', { name: 'شطب كدين معدوم' }));
    const form = within(card.getByRole('form', { name: 'شطب كدين معدوم' }));
    expect(form.getByLabelText('المبلغ')).toHaveValue('10000.00');
    fireEvent.change(form.getByLabelText('السبب'), { target: { value: 'Agreed loss' } });
    fireEvent.click(form.getByRole('button', { name: 'شطب كدين معدوم' }));
    await waitFor(() => expect(headers?.['Idempotency-Key']).toMatch(/^[A-Za-z0-9_-]{8,100}$/));
  });
});
