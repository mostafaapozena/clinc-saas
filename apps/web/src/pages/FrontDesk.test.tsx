import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { todayIn } from '../lib/time';
import type { Permission } from '../lib/types';
import { apiError, mockApi, renderRoute } from '../test/render';

const ORG = 'c'.repeat(24);
const ZONE = 'Africa/Cairo';
const user = { id: 'u1', email: 'salma@example.test', displayName: 'Salma', preferredLanguage: 'ar', emailVerified: false };
const FRONT_DESK: Permission[] = [
  'organization.read', 'branch.read', 'dashboard.read', 'patient.list', 'patient.read', 'patient.create', 'patient.update',
  'patient.registration.manage', 'practitioner.read', 'appointment.read', 'appointment.book', 'appointment.front_desk', 'queue.read',
];
const DOCTOR: Permission[] = ['organization.read', 'branch.read', 'dashboard.read', 'patient.read', 'practitioner.read', 'appointment.read', 'appointment.visit', 'queue.read'];

const branch = (id: string, name: string) => ({ id, name, city: '', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' });
const BRANCHES = [branch('b1', 'North'), branch('b2', 'South')];

function shell(role: string, permissions: Permission[], practitionerId: string | null = null) {
  return {
    'GET /api/v1/auth/session': { user, csrfToken: 'csrf', memberships: [{ organization: { id: ORG, name: 'Clinic' }, role }] },
    [`GET /api/v1/orgs/${ORG}`]: {
      organization: { id: ORG, name: 'Clinic', timeZone: ZONE, createdAt: '2026-01-01T00:00:00.000Z' },
      membership: { id: 'm1', role, branchScope: { type: 'all', branchIds: [] }, permissions, practitionerId },
      stats: { accessibleBranches: 2 },
    },
    [`GET /api/v1/orgs/${ORG}/branches`]: { data: BRANCHES },
    [`GET /api/v1/orgs/${ORG}/practitioners`]: { data: [] },
  };
}

const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
function appointment(id: string, name: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    branchId: 'b1',
    patient: { id: `p-${id}`, patientNumber: 7, fullName: name, phone: '+201001234567' },
    practitioner: { id: 'pr1', displayName: 'Dr. Sami' },
    // "Now" is always today in any zone, so day-dependent actions are offered deterministically.
    startAt: minutesFromNow(0),
    endAt: minutesFromNow(30),
    durationMinutes: 30,
    type: 'new_visit',
    status,
    cancellationReason: null,
    checkedInAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    noShowAt: null,
    version: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

describe('daily queue', () => {
  it('keeps the API order, separates visits in progress and offers front-desk actions only', async () => {
    const fetchMock = mockApi({
      ...shell('receptionist', FRONT_DESK),
      [`GET /api/v1/orgs/${ORG}/queue`]: {
        date: todayIn(ZONE),
        waiting: [
          appointment('a1', 'First Arrival', 'checked_in', { checkedInAt: minutesFromNow(-20) }),
          appointment('a2', 'Second Arrival', 'checked_in', { checkedInAt: minutesFromNow(-10) }),
        ],
        inProgress: [appointment('a3', 'With Doctor', 'in_progress')],
      },
      [`GET /api/v1/orgs/${ORG}/appointments`]: { data: [appointment('a4', 'Not Arrived', 'scheduled')] },
      [`POST /api/v1/orgs/${ORG}/appointments/a4/status`]: { appointment: appointment('a4', 'Not Arrived', 'checked_in') },
    });
    renderRoute(`/app/${ORG}/queue`);

    const waiting = await screen.findByTestId('queue-waiting');
    expect(within(waiting).getAllByTestId('queue-entry').map((e) => within(e).getByRole('link').textContent)).toEqual([
      'First Arrival',
      'Second Arrival',
    ]);
    expect(within(screen.getByTestId('queue-in-progress')).getByText('With Doctor')).toBeInTheDocument();
    // A receptionist cannot start a visit.
    expect(screen.queryByRole('button', { name: /^بدء كشف/ })).not.toBeInTheDocument();

    const expected = await screen.findByTestId('queue-expected');
    fireEvent.click(within(expected).getByRole('button', { name: 'تسجيل وصول Not Arrived' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/appointments/a4/status'))).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/appointments/a4/status')) as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ action: 'check_in', version: 3 });
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf');
  });

  it('offers doctors start and complete, and no front-desk actions', async () => {
    mockApi({
      ...shell('doctor', DOCTOR, 'pr1'),
      [`GET /api/v1/orgs/${ORG}/queue`]: {
        date: todayIn(ZONE),
        waiting: [appointment('a1', 'Waiting Patient', 'checked_in', { checkedInAt: minutesFromNow(-5) })],
        inProgress: [appointment('a3', 'Current Patient', 'in_progress')],
      },
    });
    renderRoute(`/app/${ORG}/queue`);

    expect(await screen.findByRole('button', { name: 'بدء كشف Waiting Patient' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إنهاء زيارة Current Patient' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^إلغاء موعد/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('queue-expected')).not.toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'التنقل الرئيسي' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['الرئيسية', 'المواعيد', 'قائمة الانتظار', 'جدولي', 'الفروع', 'الملف الشخصي']);
  });
});

describe('patient registry', () => {
  it('warns about a possible duplicate and creates only after explicit confirmation', async () => {
    const bodies: unknown[] = [];
    const created = {
      id: 'np', patientNumber: 42, fullName: 'Mona Adel', phone: { country: 'EG', e164: '+201001234567' },
      registrations: [{ branchId: 'b1', status: 'active', registeredAt: '2026-01-01T00:00:00.000Z', archivedAt: null }],
      secondaryPhone: null, email: null, dateOfBirth: null, sex: 'unspecified', address: null, version: 0,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    mockApi({
      ...shell('receptionist', FRONT_DESK),
      [`GET /api/v1/orgs/${ORG}/patients`]: { data: [], page: 1, pageSize: 20, total: 0 },
      [`POST /api/v1/orgs/${ORG}/patients`]: (init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        bodies.push(body);
        return body.confirmDuplicate
          ? Response.json({ patient: created }, { status: 201 })
          : Response.json(
              { error: { code: 'POSSIBLE_DUPLICATE', message: 'x', details: { matches: [{ id: 'old', patientNumber: 5, fullName: 'Mona Adel' }] } } },
              { status: 409 },
            );
      },
      [`GET /api/v1/orgs/${ORG}/patients/np`]: { patient: created },
      [`GET /api/v1/orgs/${ORG}/patients/np/appointments`]: { data: [], page: 1, pageSize: 20, total: 0 },
    });
    renderRoute(`/app/${ORG}/patients`);

    fireEvent.click(await screen.findByRole('button', { name: 'مريض جديد' }));
    await screen.findAllByRole('option', { name: 'North' }); // branches loaded
    fireEvent.change(screen.getByLabelText('الاسم الكامل'), { target: { value: 'Mona Adel' } });
    fireEvent.change(screen.getByLabelText('رقم الهاتف'), { target: { value: '٠١٠٠١٢٣٤٥٦٧' } });
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل المريض' }));

    const warning = await screen.findByTestId('duplicate-warning');
    expect(within(warning).getByRole('link', { name: '#5 — Mona Adel' })).toBeInTheDocument();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ fullName: 'Mona Adel', phone: { country: 'EG', number: '٠١٠٠١٢٣٤٥٦٧' }, branchId: 'b1', confirmDuplicate: false });

    fireEvent.click(within(warning).getByRole('button', { name: 'متأكد — سجّل مريضًا جديدًا' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Mona Adel' })).toBeInTheDocument();
    expect(bodies[1]).toMatchObject({ confirmDuplicate: true });
  });

  it('switching branch shows only that branch and never the previous branch’s rows', async () => {
    const row = (id: string, name: string, branchId: string) => ({
      id, patientNumber: id === 'x' ? 1 : 2, fullName: name, phone: { country: 'EG', e164: '+201001234567' },
      registrations: [{ branchId, status: 'active', registeredAt: '2026-01-01T00:00:00.000Z', archivedAt: null }],
    });
    mockApi({
      ...shell('admin', FRONT_DESK),
      [`GET /api/v1/orgs/${ORG}/patients`]: (_init: RequestInit, url: URL) => {
        const b = url.searchParams.get('branchId');
        const data = [row('x', 'North Person', 'b1'), row('y', 'South Person', 'b2')].filter((p) => !b || p.registrations[0]?.branchId === b);
        return { data, page: 1, pageSize: 20, total: data.length };
      },
    });
    renderRoute(`/app/${ORG}/patients`);

    expect(await screen.findByText('North Person')).toBeInTheDocument();
    expect(screen.getByText('South Person')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: 'b2' } });
    expect(await screen.findByText('South Person')).toBeInTheDocument();
    expect(screen.queryByText('North Person')).not.toBeInTheDocument();
  });
});

describe('booking', () => {
  it('labels repeated wall-clock times with their UTC offset and books the chosen one', async () => {
    const fetchMock = mockApi({
      ...shell('receptionist', FRONT_DESK),
      [`GET /api/v1/orgs/${ORG}/practitioners`]: {
        data: [{ id: 'pr1', membershipId: 'm9', displayName: 'Dr. Sami', specialtyCode: 'ent', status: 'active', branchIds: ['b1'], defaultDurationMinutes: 30, weeklySchedule: [], version: 1 }],
      },
      [`GET /api/v1/orgs/${ORG}/patients/p1`]: {
        patient: {
          id: 'p1', patientNumber: 9, fullName: 'Late Patient', phone: { country: 'EG', e164: '+201001234567' },
          registrations: [{ branchId: 'b1', status: 'active', registeredAt: '2026-01-01T00:00:00.000Z', archivedAt: null }],
          secondaryPhone: null, email: null, dateOfBirth: null, sex: 'unspecified', address: null, version: 0,
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      [`GET /api/v1/orgs/${ORG}/appointments/availability`]: {
        slots: [
          { startAt: '2026-10-29T20:00:00.000Z', endAt: '2026-10-29T20:30:00.000Z', localDate: '2026-10-29', localTime: '23:00', utcOffsetMinutes: 180, repeatedTime: true },
          { startAt: '2026-10-29T21:00:00.000Z', endAt: '2026-10-29T21:30:00.000Z', localDate: '2026-10-29', localTime: '23:00', utcOffsetMinutes: 120, repeatedTime: true },
        ],
      },
      [`POST /api/v1/orgs/${ORG}/appointments`]: apiError(409, 'SLOT_UNAVAILABLE'),
    });
    renderRoute(`/app/${ORG}/appointments/new?patientId=p1`);

    expect(await screen.findByTestId('selected-patient')).toHaveTextContent('Late Patient');
    fireEvent.change(await screen.findByLabelText('الطبيب'), { target: { value: 'pr1' } });
    const slots = await screen.findAllByTestId('slot');
    expect(slots.map((s) => s.textContent)).toEqual([expect.stringContaining('(UTC+3)'), expect.stringContaining('(UTC+2)')]);

    fireEvent.click(slots[1] as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الحجز' }));
    expect(await screen.findByText('تم حجز هذا الوقت للتو. اختر وقتًا آخر من القائمة المحدَّثة.')).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls.find(([url, i]) => String(url).endsWith(`/orgs/${ORG}/appointments`) && i?.method === 'POST') as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ date: '2026-10-29', time: '23:00', utcOffsetMinutes: 120, practitionerId: 'pr1', branchId: 'b1' });
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/.{8,}/);
  });
});

describe('home', () => {
  it('shows real counts for today from the API, in Arabic numerals', async () => {
    mockApi({
      ...shell('doctor', DOCTOR, 'pr1'),
      [`GET /api/v1/orgs/${ORG}/dashboard`]: {
        date: todayIn(ZONE),
        timeZone: ZONE,
        counts: { scheduled: 3, waiting: 2, inProgress: 1, completed: 4, noShow: 0, cancelled: 1 },
      },
    });
    renderRoute(`/app/${ORG}`);

    expect(await screen.findByRole('heading', { name: 'مواعيدي اليوم' })).toBeInTheDocument();
    expect(await screen.findByTestId('today-completed')).toHaveTextContent(new Intl.NumberFormat('ar').format(4));
    expect(screen.getByTestId('today-waiting')).toHaveTextContent(new Intl.NumberFormat('ar').format(2));
  });

  it('asks for a time zone instead of guessing one', async () => {
    const base = shell('owner', [...FRONT_DESK, 'organization.update']);
    mockApi({
      ...base,
      [`GET /api/v1/orgs/${ORG}`]: {
        ...(base[`GET /api/v1/orgs/${ORG}`] as object),
        organization: { id: ORG, name: 'Clinic', timeZone: null, createdAt: '2026-01-01T00:00:00.000Z' },
      },
    });
    renderRoute(`/app/${ORG}`);
    expect(await screen.findByText(/يجب تحديد المنطقة الزمنية/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'افتح الإعدادات' })).toHaveAttribute('href', `/app/${ORG}/settings`);
  });
});
