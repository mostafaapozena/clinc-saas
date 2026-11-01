import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from '../auth/session';
import { todayIn } from '../lib/time';
import type { Permission } from '../lib/types';
import { routes } from '../routes/routes';
import { mockApi, renderRoute } from '../test/render';

// Workspace UI polish (docs/UI_POLISH_IMPLEMENTATION.md): feedback, the doctor's path to the record,
// booking safeguards, finalize pre-check and the dashboard. Synthetic data only.
const ORG = 'e'.repeat(24);
const ZONE = 'Africa/Cairo';
const user = { id: 'u1', email: 'desk@example.test', displayName: 'Desk', preferredLanguage: 'ar', emailVerified: false };
const FRONT_DESK: Permission[] = [
  'organization.read', 'branch.read', 'dashboard.read', 'patient.list', 'patient.read', 'patient.create', 'patient.update',
  'patient.registration.manage', 'practitioner.read', 'appointment.read', 'appointment.book', 'appointment.front_desk', 'queue.read',
];
const DOCTOR: Permission[] = [
  'organization.read', 'branch.read', 'dashboard.read', 'patient.read', 'practitioner.read', 'appointment.read', 'appointment.visit', 'queue.read',
  'clinical.encounter.own', 'clinical.documentation_status.read',
];
const branch = (id: string, name: string) => ({ id, name, city: '', status: 'active', specialtyCodes: [], createdAt: '2026-01-01T00:00:00.000Z' });

function shell(role: string, permissions: Permission[], practitionerId: string | null = null) {
  return {
    'GET /api/v1/auth/session': { user, csrfToken: 'csrf', memberships: [{ organization: { id: ORG, name: 'Clinic' }, role }] },
    [`GET /api/v1/orgs/${ORG}`]: {
      organization: { id: ORG, name: 'Clinic', timeZone: ZONE, type: null, specialtyCodes: [], configVersion: 0, createdAt: '2026-01-01T00:00:00.000Z' },
      membership: { id: 'm1', role, branchScope: { type: 'all', branchIds: [] }, permissions, practitionerId },
      stats: { accessibleBranches: 2 },
    },
    [`GET /api/v1/orgs/${ORG}/branches`]: { data: [branch('b1', 'North'), branch('b2', 'South')] },
    [`GET /api/v1/orgs/${ORG}/practitioners`]: { data: [] },
  };
}
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
function appointment(id: string, name: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id, branchId: 'b1', patient: { id: `p-${id}`, patientNumber: 7, fullName: name, phone: '+201001234567' },
    practitioner: { id: 'pr1', displayName: 'Dr. Sami' }, startAt: minutesFromNow(0), endAt: minutesFromNow(30), durationMinutes: 30,
    type: 'new_visit', status, cancellationReason: null, checkedInAt: null, startedAt: null, completedAt: null, cancelledAt: null, noShowAt: null,
    version: 3, createdAt: '2026-01-01T00:00:00.000Z', ...extra,
  };
}

describe('queue', () => {
  it('gives the treating doctor "open the visit record" first, and completing the visit second (UX-031)', async () => {
    mockApi({
      ...shell('doctor', DOCTOR, 'pr1'),
      [`GET /api/v1/orgs/${ORG}/queue`]: { date: todayIn(ZONE), waiting: [], inProgress: [appointment('a3', 'Current Patient', 'in_progress')] },
    });
    renderRoute(`/app/${ORG}/queue`);
    const open = await screen.findByRole('link', { name: 'فتح سجل زيارة Current Patient' });
    expect(open).toHaveAttribute('href', `/app/${ORG}/appointments/a3/record`);
    expect(open).toHaveClass('button--primary');
    expect(screen.getByRole('button', { name: 'إنهاء زيارة Current Patient' })).toHaveClass('button--secondary');
  });

  it('confirms an action in a message that stays after the entry moves to another list (UX-023)', async () => {
    mockApi({
      ...shell('receptionist', FRONT_DESK),
      [`GET /api/v1/orgs/${ORG}/queue`]: { date: todayIn(ZONE), waiting: [], inProgress: [] },
      [`GET /api/v1/orgs/${ORG}/appointments`]: { data: [appointment('a4', 'Not Arrived', 'scheduled')] },
      [`POST /api/v1/orgs/${ORG}/appointments/a4/status`]: { appointment: appointment('a4', 'Not Arrived', 'checked_in') },
    });
    renderRoute(`/app/${ORG}/queue`);
    fireEvent.click(await screen.findByRole('button', { name: 'تسجيل وصول Not Arrived' }));
    expect(await screen.findByText('سُجّل وصول Not Arrived.')).toBeInTheDocument();
    // The cancel action names what it cancels and looks destructive (UX-029).
    expect(screen.getByRole('button', { name: 'إلغاء موعد Not Arrived' })).toHaveTextContent('إلغاء الموعد');
  });
});

describe('booking', () => {
  const patient = {
    id: 'p1', patientNumber: 3, fullName: 'Branch Patient', phone: { country: 'EG', e164: '+201000000001' },
    registrations: [{ branchId: 'b2', status: 'active', registeredAt: '2026-01-01T00:00:00.000Z', archivedAt: null }],
    secondaryPhone: null, email: null, dateOfBirth: null, sex: 'unspecified', address: null, version: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('starts in the patient branch, blocks an unregistered branch and registers the patient there (UX-022)', async () => {
    const registrations: unknown[] = [];
    mockApi({
      ...shell('receptionist', FRONT_DESK),
      [`GET /api/v1/orgs/${ORG}/patients/p1`]: { patient },
      [`POST /api/v1/orgs/${ORG}/patients/p1/registrations`]: (init: RequestInit) => {
        registrations.push(JSON.parse(String(init.body)));
        return { patient: { ...patient, registrations: [...patient.registrations, { branchId: 'b1', status: 'active', registeredAt: '2026-01-01T00:00:00.000Z', archivedAt: null }] } };
      },
    });
    renderRoute(`/app/${ORG}/appointments/new?patientId=p1`);
    // The booking form's branch (the header has a branch chooser with the same label).
    await screen.findByTestId('selected-patient');
    const branchSelect = document.getElementById('booking-branch') as HTMLSelectElement;
    expect(branchSelect.value).toBe('b2');
    expect(screen.queryByText(/غير مسجل بشكل نشط/)).not.toBeInTheDocument();

    fireEvent.change(branchSelect, { target: { value: 'b1' } });
    expect(screen.getByText(/غير مسجل بشكل نشط/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تأكيد الحجز' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل المريض في هذا الفرع' }));
    await waitFor(() => expect(registrations).toEqual([{ branchId: 'b1' }]));
    await waitFor(() => expect(screen.queryByText(/غير مسجل بشكل نشط/)).not.toBeInTheDocument());
  });
});

describe('visit record', () => {
  const ENC = `/api/v1/orgs/${ORG}/appointments/a1/encounter`;
  const visit = appointment('a1', 'Test Patient', 'in_progress');
  const draft = {
    id: 'e1', appointmentId: 'a1', patientId: 'p1', branchId: 'b1', author: { practitionerId: 'pr1', displayName: 'Dr. Sami' }, status: 'draft',
    sections: { reason: '', history: '', examination: '', assessment: '', plan: '' }, version: 0, lateEntry: null,
    createdAt: '2026-11-10T08:05:00.000Z', lastEditedAt: '2026-11-10T08:05:00.000Z', finalizedAt: null, addenda: [],
  };

  it('starts the draft directly when opened from the queue (UX-031)', async () => {
    const starts: unknown[] = [];
    mockApi({
      ...shell('doctor', DOCTOR, 'pr1'),
      [`GET /api/v1/orgs/${ORG}/appointments/a1`]: { appointment: visit },
      [`GET ${ENC}`]: () => ({ encounter: starts.length ? draft : null, appointmentStatus: 'in_progress', canStart: !starts.length, lateEntryRequired: false, templates: [] }),
      [`POST ${ENC}`]: (init: RequestInit) => {
        starts.push(JSON.parse(String(init.body)));
        return Response.json({ encounter: draft }, { status: 201 });
      },
    });
    const router = createMemoryRouter(routes, { initialEntries: [{ pathname: `/app/${ORG}/appointments/a1/record`, state: { startRecord: true } }] });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(await screen.findByLabelText('سبب الزيارة')).toBeInTheDocument();
    expect(starts).toHaveLength(1);
  });

  it('checks the finalize minimum before asking for confirmation, and points to the fields (UX-032)', async () => {
    mockApi({
      ...shell('doctor', DOCTOR, 'pr1'),
      [`GET /api/v1/orgs/${ORG}/appointments/a1`]: { appointment: visit },
      [`GET ${ENC}`]: { encounter: draft, appointmentStatus: 'in_progress', canStart: false, lateEntryRequired: false },
    });
    renderRoute(`/app/${ORG}/appointments/a1/record`);
    fireEvent.click(await screen.findByRole('button', { name: 'اعتماد السجل' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('سبب الزيارة')).toHaveFocus();
    expect(screen.getByLabelText('سبب الزيارة')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('نتائج الفحص')).toHaveAttribute('aria-invalid', 'true');
    // Filling the reason and an examination finding clears both marks.
    fireEvent.change(screen.getByLabelText('سبب الزيارة'), { target: { value: 'Synthetic reason' } });
    fireEvent.change(screen.getByLabelText('نتائج الفحص'), { target: { value: 'Synthetic finding' } });
    expect(screen.getByLabelText('سبب الزيارة')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('نتائج الفحص')).not.toHaveAttribute('aria-invalid', 'true');
  });
});

describe('dashboard', () => {
  it('shows each count with an icon and a link to the matching appointments (UX-021)', async () => {
    mockApi({
      ...shell('receptionist', FRONT_DESK),
      [`GET /api/v1/orgs/${ORG}/dashboard`]: { date: todayIn(ZONE), counts: { scheduled: 4, waiting: 2, inProgress: 1, completed: 0, noShow: 0, cancelled: 1 } },
    });
    renderRoute(`/app/${ORG}`);
    expect(await screen.findByTestId('today-waiting')).toHaveTextContent('2');
    const link = screen.getByRole('link', { name: 'في الانتظار: اعرض هذه المواعيد' });
    expect(link).toHaveAttribute('href', `/app/${ORG}/appointments?status=checked_in`);
    const card = link.closest('.metric')!;
    expect(within(card as HTMLElement).getByText('في الانتظار')).toBeInTheDocument();
    expect(card.querySelector('.metric-icon svg')).not.toBeNull();
  });

  it('says once that there are no appointments today, with the next step, instead of six zeros (UI-09)', async () => {
    mockApi({
      ...shell('receptionist', FRONT_DESK),
      [`GET /api/v1/orgs/${ORG}/dashboard`]: { date: todayIn(ZONE), counts: { scheduled: 0, waiting: 0, inProgress: 0, completed: 0, noShow: 0, cancelled: 0 } },
    });
    renderRoute(`/app/${ORG}`);
    expect(await screen.findByTestId('today-none')).toBeInTheDocument();
    expect(screen.queryByTestId('today-waiting')).toBeNull();
    const empty = screen.getByTestId('today-none').closest('.empty-state') as HTMLElement;
    expect(within(empty).getByRole('link', { name: 'حجز موعد' })).toHaveAttribute('href', `/app/${ORG}/appointments/new`);
  });

  it('tells apart accounting not set up, and a focus that failed to load (UI-09)', async () => {
    const ACCOUNTANT: Permission[] = ['organization.read', 'branch.read', 'dashboard.read', 'accounting.read'];
    mockApi({
      ...shell('accountant', ACCOUNTANT),
      [`GET /api/v1/orgs/${ORG}/dashboard`]: { date: todayIn(ZONE), counts: { scheduled: 1, waiting: 0, inProgress: 0, completed: 0, noShow: 0, cancelled: 0 } },
      [`GET /api/v1/orgs/${ORG}/workspace/focus`]: {
        role: 'accountant',
        branchId: null,
        finance: { ledger: false, openReceivables: 0, unallocatedReceipts: 0, payablesDueSoon: { amount: 0, bills: 0 }, openCashSessions: 0, monthToClose: null },
      },
    });
    renderRoute(`/app/${ORG}`);
    const unconfigured = await screen.findByTestId('finance-unconfigured');
    expect(within(unconfigured).getByRole('link', { name: 'إعداد المحاسبة' })).toHaveAttribute('href', `/app/${ORG}/accounting`);
  });

  it('shows a retry when the focus cannot load, instead of hiding it (UI-09)', async () => {
    mockApi({
      ...shell('receptionist', FRONT_DESK),
      [`GET /api/v1/orgs/${ORG}/dashboard`]: { date: todayIn(ZONE), counts: { scheduled: 1, waiting: 0, inProgress: 0, completed: 0, noShow: 0, cancelled: 0 } },
      [`GET /api/v1/orgs/${ORG}/workspace/focus`]: () => Response.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 }),
    });
    renderRoute(`/app/${ORG}`);
    // The query retries before it reports a failure.
    const panel = await screen.findByTestId('focus-panel', {}, { timeout: 10_000 });
    expect(await within(panel).findByRole('button', { name: 'إعادة المحاولة' })).toBeInTheDocument();
  });
});
