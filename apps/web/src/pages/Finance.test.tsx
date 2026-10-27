import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { moneyInput, parseMoney } from '../lib/finance';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

const ORG = 'a'.repeat(24);
const user = { id: 'u1', email: 'noha@example.test', displayName: 'Noha', preferredLanguage: 'ar', emailVerified: false };
const DESK: Permission[] = [
  'organization.read', 'branch.read', 'dashboard.read', 'patient.list', 'patient.read', 'appointment.read',
  'finance.catalog.read', 'finance.charge.create', 'finance.invoice.manage', 'finance.payment.record', 'finance.account.read',
];
const ACCOUNTANT: Permission[] = [...DESK, 'finance.discount.apply', 'finance.adjustment.manage', 'finance.report.read'];

function shell(role: string, permissions: Permission[], practitionerId: string | null = null) {
  return {
    'GET /api/v1/auth/session': { user, csrfToken: 'csrf', memberships: [{ organization: { id: ORG, name: 'Clinic' }, role }] },
    [`GET /api/v1/orgs/${ORG}`]: {
      organization: { id: ORG, name: 'Clinic', timeZone: 'Africa/Cairo', type: null, specialtyCodes: [], configVersion: 0, createdAt: '2026-01-01T00:00:00.000Z' },
      membership: { id: 'm1', role, branchScope: { type: 'all', branchIds: [] }, permissions, capabilities: [], practitionerId },
      stats: { accessibleBranches: 1 },
    },
    [`GET /api/v1/orgs/${ORG}/branches`]: { data: [{ id: 'b1', name: 'North', city: '', status: 'active', specialtyCodes: [], createdAt: '2026-01-01T00:00:00.000Z' }] },
    [`GET /api/v1/orgs/${ORG}/practitioners`]: { data: [] },
    [`GET /api/v1/orgs/${ORG}/finance/settings`]: { currency: 'EGP', currencyLocked: true, supportedCurrencies: ['EGP', 'SAR'] },
  };
}
const charge = (id: string, amount: number) => ({
  id, branchId: 'b1', patientId: 'p1', appointmentId: null, serviceId: 's1', description: 'Consultation', quantity: 1, unitPrice: amount, amount,
  currency: 'EGP', status: 'pending', invoiceId: null, source: { type: 'manual', encounterId: null, itemId: null }, voidReason: null, createdAt: '2026-11-10T08:00:00.000Z',
});
const invoice = (extra: Record<string, unknown> = {}) => ({
  id: 'i1', branchId: 'b1', patientId: 'p1', number: 'INV-2026-000007', status: 'issued',
  lines: [{ chargeId: 'c1', description: 'Consultation', quantity: 1, unitPrice: 30000, amount: 30000 }],
  subtotal: 30000, discount: null, total: 30000, paid: 15000, credited: 0, balance: 15000, currency: 'EGP', issuedAt: '2026-11-10T09:00:00.000Z', version: 2,
  createdAt: '2026-11-10T08:30:00.000Z', ...extra,
});
const account = (extra: Record<string, unknown> = {}) => ({
  patient: { id: 'p1', fullName: 'Test Patient', patientNumber: 7 },
  currency: 'EGP',
  charges: [charge('c2', 40000), charge('c3', 12550)],
  invoices: [invoice()],
  payments: [],
  adjustments: [],
  balance: { outstanding: 15000, unallocatedCredit: 0, net: 15000 },
  ...extra,
});
const callsTo = (fetchMock: ReturnType<typeof mockApi>, method: string, suffix: string) =>
  fetchMock.mock.calls.filter(([url, init]) => String(url).split('?')[0]!.endsWith(suffix) && ((init as RequestInit | undefined)?.method ?? 'GET') === method) as [string, RequestInit][];

describe('money parsing (no floating point)', () => {
  it('parses decimal text, Arabic digits and separators into minor units, and refuses the rest', () => {
    expect(parseMoney('750.50')).toBe(75050);
    expect(parseMoney('750.5')).toBe(75050);
    expect(parseMoney('٧٥٠٫٥٠')).toBe(75050);
    expect(parseMoney('1,000')).toBe(100000);
    expect(parseMoney('0.1')).toBe(10);
    expect(parseMoney('0.29')).toBe(29);
    expect(parseMoney('10.555')).toBeNull();
    expect(parseMoney('-1')).toBeNull();
    expect(parseMoney('1e3')).toBeNull();
    expect(moneyInput(75050)).toBe('750.50');
    expect(moneyInput(5)).toBe('0.05');
  });
});

describe('patient account', () => {
  it('invoices selected charges and records a payment, keeping any remainder as credit', async () => {
    const fetchMock = mockApi({
      ...shell('receptionist', DESK),
      [`GET /api/v1/orgs/${ORG}/finance/patients/p1/account`]: account(),
      [`GET /api/v1/orgs/${ORG}/finance/patients/p1/statement`]: { patient: account().patient, entries: [], balances: [] },
      [`GET /api/v1/orgs/${ORG}/finance/services`]: { data: [] },
      [`POST /api/v1/orgs/${ORG}/finance/invoices`]: Response.json({ invoice: invoice({ status: 'draft', number: null }) }, { status: 201 }),
      [`POST /api/v1/orgs/${ORG}/finance/payments`]: Response.json({ payment: { id: 'pay1' } }, { status: 201 }),
    });
    renderRoute(`/app/${ORG}/finance/patients/p1`);
    const pending = await screen.findByTestId('pending-charges');
    fireEvent.click(within(pending).getAllByRole('checkbox')[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'إنشاء فاتورة من المحدد' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/finance/invoices')).toHaveLength(1));
    expect(JSON.parse(String(callsTo(fetchMock, 'POST', '/finance/invoices')[0]![1].body))).toEqual({ patientId: 'p1', branchId: 'b1', chargeIds: ['c3'] });

    // 200.00 paid towards an invoice with 150.00 due: 150.00 applied, 50.00 kept as credit.
    fireEvent.change(screen.getByLabelText('المبلغ'), { target: { value: '٢٠٠' } });
    expect(await screen.findByText(/سيبقى .* رصيدًا دائنًا/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'تسجيل دفعة' }).at(-1)!);
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/finance/payments')).toHaveLength(1));
    const [, init] = callsTo(fetchMock, 'POST', '/finance/payments')[0]!;
    expect(JSON.parse(String(init.body))).toMatchObject({ amount: 20000, method: 'cash', allocations: [{ invoiceId: 'i1', amount: 15000 }] });
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(await screen.findByRole('link', { name: 'طباعة الإيصال' })).toHaveAttribute('href', `/app/${ORG}/finance/payments/pay1/print`);
  });

  it('refuses an amount with more than two decimals before sending', async () => {
    const fetchMock = mockApi({
      ...shell('receptionist', DESK),
      [`GET /api/v1/orgs/${ORG}/finance/patients/p1/account`]: account(),
      [`GET /api/v1/orgs/${ORG}/finance/patients/p1/statement`]: { patient: account().patient, entries: [], balances: [] },
    });
    renderRoute(`/app/${ORG}/finance/patients/p1`);
    fireEvent.change(await screen.findByLabelText('المبلغ'), { target: { value: '10.555' } });
    expect(screen.getByText('أدخل مبلغًا بخانتين عشريتين على الأكثر.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'تسجيل دفعة' }).at(-1)).toBeDisabled();
    expect(callsTo(fetchMock, 'POST', '/finance/payments')).toHaveLength(0);
  });
});

describe('invoices', () => {
  it('issues a draft only after confirmation; discounts need their own permission', async () => {
    const draft = invoice({ status: 'draft', number: null, paid: 0, balance: 0, version: 1 });
    const fetchMock = mockApi({
      ...shell('receptionist', DESK),
      [`GET /api/v1/orgs/${ORG}/finance/invoices/i1`]: { invoice: draft, patient: { id: 'p1', fullName: 'Test Patient', patientNumber: 7 }, branch: null, organization: { name: 'Clinic' }, payments: [], creditNotes: [] },
      [`POST /api/v1/orgs/${ORG}/finance/invoices/i1/issue`]: { invoice: invoice() },
    });
    renderRoute(`/app/${ORG}/finance/invoices/i1`);
    fireEvent.click(await screen.findByRole('button', { name: 'إصدار الفاتورة' }));
    expect(screen.queryByLabelText('الخصم')).not.toBeInTheDocument();
    const dialog = await screen.findByRole('alertdialog', { name: 'إصدار هذه الفاتورة؟' });
    expect(callsTo(fetchMock, 'POST', '/finance/invoices/i1/issue')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'نعم، أصدرها' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/finance/invoices/i1/issue')).toHaveLength(1));
    expect(JSON.parse(String(callsTo(fetchMock, 'POST', '/finance/invoices/i1/issue')[0]![1].body))).toEqual({ version: 1 });
  });

  it('prints an issued invoice as an ordinary invoice, clearly not a tax invoice', async () => {
    mockApi({
      ...shell('accountant', ACCOUNTANT),
      [`GET /api/v1/orgs/${ORG}/finance/invoices/i1`]: {
        invoice: invoice(),
        patient: { id: 'p1', fullName: 'Test Patient', patientNumber: 7 },
        branch: { id: 'b1', name: 'North', city: 'Cairo' },
        organization: { name: 'Clinic' },
        payments: [],
        creditNotes: [],
      },
    });
    renderRoute(`/app/${ORG}/finance/invoices/i1/print`);
    const doc = await screen.findByTestId('print-document');
    expect(within(doc).getByText('ليست فاتورة ضريبية ولا فاتورة إلكترونية.')).toBeInTheDocument();
    expect(within(doc).getByRole('img', { name: 'raclinic' })).toBeInTheDocument();
    expect(within(doc).getByTestId('invoice-balance')).toHaveTextContent('150');
  });
});

describe('charging from a dental record', () => {
  it('needs an explicit confirmation and sends no clinical text', async () => {
    const fetchMock = mockApi({
      ...shell('doctor', ['organization.read', 'branch.read', 'appointment.read', 'clinical.encounter.own', 'finance.catalog.read', 'finance.charge.clinical'], 'pr1'),
      [`GET /api/v1/orgs/${ORG}/appointments/a1`]: {
        appointment: {
          id: 'a1', branchId: 'b1', patient: { id: 'p1', patientNumber: 7, fullName: 'Test Patient', phone: '+201001234567' }, practitioner: { id: 'pr1', displayName: 'Dr. Hala' },
          startAt: '2026-11-10T08:00:00.000Z', endAt: '2026-11-10T08:30:00.000Z', durationMinutes: 30, type: 'new_visit', status: 'completed', cancellationReason: null,
          checkedInAt: null, startedAt: null, completedAt: null, cancelledAt: null, noShowAt: null, version: 3, createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
      [`GET /api/v1/orgs/${ORG}/appointments/a1/encounter`]: {
        encounter: {
          id: 'e1', appointmentId: 'a1', patientId: 'p1', branchId: 'b1', author: { practitionerId: 'pr1', displayName: 'Dr. Hala' }, status: 'finalized',
          sections: { reason: 'Synthetic', history: '', examination: '', assessment: '', plan: 'Synthetic' }, version: 2, lateEntry: null,
          createdAt: '2026-11-10T08:05:00.000Z', lastEditedAt: '2026-11-10T08:20:00.000Z', finalizedAt: '2026-11-10T08:30:00.000Z', addenda: [],
          specialty: { template: 'dentistry.visit', version: 1, data: { dentition: 'permanent', findings: [], procedures: [{ id: 'pr-111111', tooth: '16', description: 'Synthetic composite' }], planItems: [], planUpdates: [] } },
        },
        appointmentStatus: 'completed', canStart: false, lateEntryRequired: false, templates: [],
      },
      [`GET /api/v1/orgs/${ORG}/finance/clinical-charges`]: { data: [] },
      [`GET /api/v1/orgs/${ORG}/finance/services`]: { data: [{ id: 's1', code: 'FILL', name: 'Filling', specialtyCode: null, status: 'active', price: 75050, branchPrices: [], currency: 'EGP', version: 0 }] },
      [`POST /api/v1/orgs/${ORG}/finance/charges/clinical`]: Response.json({ charge: charge('c9', 75050) }, { status: 201 }),
      [`GET /api/v1/orgs/${ORG}/clinical/coverage/candidates`]: { data: [] },
    });
    renderRoute(`/app/${ORG}/appointments/a1/record`);
    const panel = await screen.findByTestId('clinical-charges');
    fireEvent.click(within(panel).getByRole('button', { name: /إنشاء رسم لـ/ }));
    fireEvent.change(await within(panel).findByLabelText('الخدمة'), { target: { value: 's1' } });
    const create = within(panel).getByRole('button', { name: 'إنشاء الرسم' });
    expect(create).toBeDisabled();
    fireEvent.click(within(panel).getByLabelText('أؤكد أن هذا يجب أن يُحصَّل.'));
    fireEvent.click(create);
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/finance/charges/clinical')).toHaveLength(1));
    const body = JSON.parse(String(callsTo(fetchMock, 'POST', '/finance/charges/clinical')[0]![1].body));
    expect(body).toEqual({ encounterId: 'e1', itemId: 'pr-111111', kind: 'procedure', serviceId: 's1', confirm: true });
    expect(JSON.stringify(body)).not.toContain('Synthetic composite');
  });
});
