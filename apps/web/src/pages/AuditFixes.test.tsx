import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatMoney } from '../lib/finance';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

// Front-end audit (2026-10-27): forms, privacy of titles, URL state, numerals and the mobile drawer.
const ORG = 'c'.repeat(24);
const user = { id: 'u1', email: 'salma@example.test', displayName: 'Salma', preferredLanguage: 'ar', emailVerified: false };
const FRONT_DESK: Permission[] = [
  'organization.read', 'branch.read', 'dashboard.read', 'patient.list', 'patient.read', 'patient.create', 'patient.update',
  'patient.registration.manage', 'practitioner.read', 'appointment.read', 'appointment.book', 'appointment.front_desk', 'queue.read',
];
const branch = (id: string, name: string) => ({ id, name, city: '', status: 'active', specialtyCodes: [], createdAt: '2026-01-01T00:00:00.000Z' });

const shell = {
  'GET /api/v1/auth/session': { user, csrfToken: 'csrf', memberships: [{ organization: { id: ORG, name: 'Clinic' }, role: 'receptionist' }] },
  [`GET /api/v1/orgs/${ORG}`]: {
    organization: { id: ORG, name: 'Clinic', timeZone: 'Africa/Cairo', type: null, specialtyCodes: [], configVersion: 0, createdAt: '2026-01-01T00:00:00.000Z' },
    membership: { id: 'm1', role: 'receptionist', branchScope: { type: 'all', branchIds: [] }, permissions: FRONT_DESK, practitionerId: null },
    stats: { accessibleBranches: 1 },
  },
  [`GET /api/v1/orgs/${ORG}/branches`]: { data: [branch('b1', 'North')] },
  [`GET /api/v1/orgs/${ORG}/practitioners`]: { data: [] },
  [`GET /api/v1/orgs/${ORG}/patients`]: { data: [], page: 1, pageSize: 20, total: 0 },
};

const patient = {
  id: 'np', patientNumber: 42, fullName: 'Mona Adel', phone: { country: 'EG', e164: '+201001234567' },
  registrations: [{ branchId: 'b1', status: 'active', registeredAt: '2026-01-01T00:00:00.000Z', archivedAt: null }],
  secondaryPhone: null, email: null, dateOfBirth: null, sex: 'unspecified', address: null, version: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('forms after a failed submit', () => {
  it('asks for blank required fields (not "too short") and moves focus to the first invalid one', async () => {
    mockApi({
      ...shell,
      [`POST /api/v1/orgs/${ORG}/patients`]: Response.json(
        { error: { code: 'VALIDATION_ERROR', message: 'x', fields: { fullName: 'too_short', 'phone.number': 'too_short' } } },
        { status: 400 },
      ),
    });
    renderRoute(`/app/${ORG}/patients`);
    fireEvent.click(await screen.findByRole('button', { name: 'مريض جديد' }));
    await screen.findAllByRole('option', { name: 'North' });
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل المريض' }));

    expect(await screen.findByText('اكتب اسم المريض.')).toBeInTheDocument();
    expect(screen.getByText('اكتب رقم الهاتف.')).toBeInTheDocument();
    expect(screen.queryByText('القيمة قصيرة جدًا.')).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement?.id).toBe('new-patient-name'));
  });
});

describe('privacy of the page title', () => {
  it('names a patient file by its number, never by the patient name', async () => {
    mockApi({
      ...shell,
      [`GET /api/v1/orgs/${ORG}/patients/np`]: { patient },
      [`GET /api/v1/orgs/${ORG}/patients/np/appointments`]: { data: [], page: 1, pageSize: 20, total: 0 },
    });
    renderRoute(`/app/${ORG}/patients/np`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Mona Adel' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toContain('ملف مريض رقم 42'));
    expect(document.title).not.toContain('Mona Adel');
  });
});

describe('appointments view state', () => {
  it('reads view and date from the URL, writes changes back, and names the time zone readably', async () => {
    const requests: URL[] = [];
    mockApi({
      ...shell,
      [`GET /api/v1/orgs/${ORG}/appointments`]: (_init: RequestInit, url: URL) => {
        requests.push(url);
        return { data: [], truncated: false };
      },
    });
    const { router } = renderRoute(`/app/${ORG}/appointments?view=week&date=2026-11-02`);
    expect(await screen.findByRole('button', { name: '7 أيام', pressed: true })).toBeInTheDocument();
    expect(screen.getByLabelText('التاريخ')).toHaveValue('2026-11-02');
    expect(screen.getByText('الأوقات بتوقيت القاهرة (مصر)')).toBeInTheDocument();
    await waitFor(() => expect(requests.some((u) => u.searchParams.get('from') === '2026-11-02' && u.searchParams.get('to') === '2026-11-08')).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'يوم' }));
    await waitFor(() => expect(router.state.location.search).toBe('?date=2026-11-02'));
  });
});

describe('numerals', () => {
  it('formats Arabic amounts with Latin digits, like every other number in the UI', () => {
    const text = formatMoney(15050, 'EGP', 'ar');
    expect(text).toContain('150.50');
    expect(text).not.toMatch(/[٠-٩]/);
  });
});

describe('mobile navigation drawer', () => {
  it('moves focus into the drawer, makes the page inert, and returns focus to the menu button', async () => {
    mockApi(shell);
    renderRoute(`/app/${ORG}/patients`);
    const menu = await screen.findByRole('button', { name: 'فتح القائمة' });
    fireEvent.click(menu);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'إغلاق القائمة' })));
    expect(document.querySelector('.shell-main')).toHaveAttribute('inert');
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(menu));
    expect(document.querySelector('.shell-main')).not.toHaveAttribute('inert');
  });
});
