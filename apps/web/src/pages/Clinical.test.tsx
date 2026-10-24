import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

// Synthetic clinical text only.
const ORG = 'd'.repeat(24);
const ZONE = 'Africa/Cairo';
const MARK = 'SYNTHETIC-NOTE';
const user = { id: 'u1', email: 'hala@example.test', displayName: 'Hala', preferredLanguage: 'ar', emailVerified: false };
const DOCTOR: Permission[] = [
  'organization.read', 'branch.read', 'dashboard.read', 'patient.read', 'practitioner.read', 'appointment.read', 'appointment.visit', 'queue.read',
  'clinical.encounter.own', 'clinical.documentation_status.read',
];
const OWNER: Permission[] = [
  'organization.read', 'organization.update', 'branch.read', 'dashboard.read', 'patient.list', 'patient.read', 'practitioner.read', 'appointment.read',
  'appointment.book', 'appointment.front_desk', 'appointment.visit', 'queue.read', 'clinical.documentation_status.read',
];

function shell(role: string, permissions: Permission[], practitionerId: string | null) {
  return {
    'GET /api/v1/auth/session': { user, csrfToken: 'csrf', memberships: [{ organization: { id: ORG, name: 'Clinic' }, role }] },
    [`GET /api/v1/orgs/${ORG}`]: {
      organization: { id: ORG, name: 'Clinic', timeZone: ZONE, type: null, specialtyCodes: [], configVersion: 0, createdAt: '2026-01-01T00:00:00.000Z' },
      membership: { id: 'm1', role, branchScope: { type: 'all', branchIds: [] }, permissions, practitionerId },
      stats: { accessibleBranches: 1 },
    },
    [`GET /api/v1/orgs/${ORG}/branches`]: { data: [{ id: 'b1', name: 'North', city: '', status: 'active', specialtyCodes: [], createdAt: '2026-01-01T00:00:00.000Z' }] },
    [`GET /api/v1/orgs/${ORG}/practitioners`]: { data: [] },
  };
}

function appointment(status: string, documentation?: string) {
  return {
    id: 'a1',
    branchId: 'b1',
    patient: { id: 'p1', patientNumber: 7, fullName: 'Test Patient', phone: '+201001234567' },
    practitioner: { id: 'pr1', displayName: 'Dr. Hala' },
    startAt: '2026-11-10T08:00:00.000Z',
    endAt: '2026-11-10T08:30:00.000Z',
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
    ...(documentation ? { documentation } : {}),
  };
}

const empty = { reason: '', history: '', examination: '', assessment: '', plan: '' };
function encounter(extra: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    appointmentId: 'a1',
    patientId: 'p1',
    branchId: 'b1',
    author: { practitionerId: 'pr1', displayName: 'Dr. Hala' },
    status: 'draft',
    sections: { ...empty },
    version: 0,
    lateEntry: null,
    createdAt: '2026-11-10T08:05:00.000Z',
    lastEditedAt: '2026-11-10T08:05:00.000Z',
    finalizedAt: null,
    addenda: [],
    ...extra,
  };
}

const ENC_URL = `/api/v1/orgs/${ORG}/appointments/a1/encounter`;
const callsTo = (fetchMock: ReturnType<typeof mockApi>, method: string, suffix: string) =>
  fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith(suffix) && ((init as RequestInit | undefined)?.method ?? 'GET') === method) as [
    string,
    RequestInit,
  ][];

describe('visit record (treating doctor)', () => {
  it('starts a record, saves the draft, confirms and finalizes it', async () => {
    let current: Record<string, unknown> | null = null;
    const fetchMock = mockApi({
      ...shell('doctor', DOCTOR, 'pr1'),
      [`GET /api/v1/orgs/${ORG}/appointments/a1`]: { appointment: appointment('in_progress', 'none') },
      [`GET ${ENC_URL}`]: () => ({ encounter: current, appointmentStatus: 'in_progress', canStart: !current, lateEntryRequired: false }),
      [`POST ${ENC_URL}`]: () => {
        current = encounter();
        return Response.json({ encounter: current, replayed: false }, { status: 201 });
      },
      [`PUT /api/v1/orgs/${ORG}/encounters/e1`]: (init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        current = encounter({ sections: body.sections, version: body.version + 1 });
        return { encounter: current };
      },
      [`POST /api/v1/orgs/${ORG}/encounters/e1/finalize`]: () => {
        current = encounter({ ...current, status: 'finalized', version: 2, finalizedAt: '2026-11-10T08:30:00.000Z' });
        return Response.json({ encounter: current, replayed: false }, { status: 201 });
      },
    });
    renderRoute(`/app/${ORG}/appointments/a1/record`);

    fireEvent.click(await screen.findByRole('button', { name: 'بدء سجل الزيارة' }));
    const reason = await screen.findByLabelText('سبب الزيارة');
    const [, startInit] = callsTo(fetchMock, 'POST', '/appointments/a1/encounter')[0] ?? [];
    expect((startInit?.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^[A-Za-z0-9_-]{8,100}$/);

    fireEvent.change(reason, { target: { value: `${MARK} reason` } });
    fireEvent.change(screen.getByLabelText('الخطة والمتابعة'), { target: { value: `${MARK} plan` } });
    expect(screen.getByTestId('save-state')).toHaveTextContent('تغييرات غير محفوظة');
    expect(screen.getByRole('button', { name: 'اعتماد السجل' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'حفظ المسودة' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'اعتماد السجل' })).toBeEnabled());
    const [, saveInit] = callsTo(fetchMock, 'PUT', '/encounters/e1')[0] ?? [];
    expect(JSON.parse(String(saveInit?.body))).toEqual({ sections: { ...empty, reason: `${MARK} reason`, plan: `${MARK} plan` }, version: 0 });

    fireEvent.click(screen.getByRole('button', { name: 'اعتماد السجل' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'اعتماد سجل الزيارة؟' });
    expect(callsTo(fetchMock, 'POST', '/encounters/e1/finalize')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'نعم، اعتمد السجل' }));

    expect(await screen.findByRole('heading', { name: 'السجل المعتمد' })).toBeInTheDocument();
    const [, finalInit] = callsTo(fetchMock, 'POST', '/encounters/e1/finalize')[0] ?? [];
    expect(JSON.parse(String(finalInit?.body))).toEqual({ version: 1 });
    expect((finalInit?.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
    // Read-only now: no editable section fields.
    expect(screen.queryByLabelText('سبب الزيارة')).not.toBeInTheDocument();
    expect(screen.getByText(`${MARK} plan`)).toBeInTheDocument();
    expect(screen.getByTestId('record-timeline')).toBeInTheDocument();

    // Clinical text never reaches browser storage or the document title.
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(MARK);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(MARK);
    expect(document.title).not.toContain(MARK);
  });

  it('shows a conflict instead of overwriting a newer version', async () => {
    const fetchMock = mockApi({
      ...shell('doctor', DOCTOR, 'pr1'),
      [`GET /api/v1/orgs/${ORG}/appointments/a1`]: { appointment: appointment('in_progress', 'draft') },
      [`GET ${ENC_URL}`]: { encounter: encounter({ version: 4 }), appointmentStatus: 'in_progress', canStart: false, lateEntryRequired: false },
      [`PUT /api/v1/orgs/${ORG}/encounters/e1`]: Response.json(
        { error: { code: 'VERSION_CONFLICT', message: 'x', details: { currentVersion: 5 } } },
        { status: 409 },
      ),
    });
    renderRoute(`/app/${ORG}/appointments/a1/record`);
    fireEvent.change(await screen.findByLabelText('التقييم'), { target: { value: 'mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ المسودة' }));
    const conflict = await screen.findByTestId('conflict');
    expect(conflict).toHaveTextContent('تغيّر هذا السجل في تبويب أو نافذة أخرى');
    // The typed text is still there, and still unsaved.
    expect(screen.getByLabelText('التقييم')).toHaveValue('mine');
    expect(screen.getByTestId('save-state')).toHaveTextContent('تغييرات غير محفوظة');
    expect(callsTo(fetchMock, 'PUT', '/encounters/e1')).toHaveLength(1);
  });

  it('asks before leaving with unsaved changes', async () => {
    mockApi({
      ...shell('doctor', DOCTOR, 'pr1'),
      [`GET /api/v1/orgs/${ORG}/appointments/a1`]: { appointment: appointment('in_progress', 'draft') },
      [`GET ${ENC_URL}`]: { encounter: encounter(), appointmentStatus: 'in_progress', canStart: false, lateEntryRequired: false },
    });
    const { router } = renderRoute(`/app/${ORG}/appointments/a1/record`);
    fireEvent.change(await screen.findByLabelText('سبب الزيارة'), { target: { value: 'typed' } });
    fireEvent.click(screen.getByRole('link', { name: 'العودة إلى الموعد' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'مغادرة الصفحة دون حفظ؟' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'البقاء في الصفحة' }));
    expect(router.state.location.pathname).toBe(`/app/${ORG}/appointments/a1/record`);
    expect(screen.getByLabelText('سبب الزيارة')).toHaveValue('typed');
  });

  it('requires a reason to start a late entry for a completed visit', async () => {
    const fetchMock = mockApi({
      ...shell('doctor', DOCTOR, 'pr1'),
      [`GET /api/v1/orgs/${ORG}/appointments/a1`]: { appointment: appointment('completed', 'none') },
      [`GET ${ENC_URL}`]: { encounter: null, appointmentStatus: 'completed', canStart: true, lateEntryRequired: true },
      [`POST ${ENC_URL}`]: Response.json({ encounter: encounter({ lateEntry: { reason: 'Written after clinic' } }) }, { status: 201 }),
    });
    renderRoute(`/app/${ORG}/appointments/a1/record`);
    expect(await screen.findByRole('heading', { name: 'توثيق متأخر' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('سبب التوثيق المتأخر'), { target: { value: 'Written after clinic' } });
    fireEvent.click(screen.getByRole('button', { name: 'بدء سجل الزيارة' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/appointments/a1/encounter')).toHaveLength(1));
    const [, init] = callsTo(fetchMock, 'POST', '/appointments/a1/encounter')[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({ lateEntryReason: 'Written after clinic' });
  });
});

describe('visit record (other roles)', () => {
  it('shows owners the documentation status only, and never requests clinical content', async () => {
    const fetchMock = mockApi({
      ...shell('owner', OWNER, null),
      [`GET /api/v1/orgs/${ORG}/appointments/a1`]: { appointment: appointment('completed', 'finalized') },
    });
    renderRoute(`/app/${ORG}/appointments/a1`);
    expect(await screen.findByTestId('documentation-status')).toHaveTextContent('سجل الزيارة: معتمد');
    expect(screen.queryByRole('link', { name: /سجل الزيارة/ })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => /encounter|clinical/.test(String(url)))).toBe(false);
  });

  it('denies the record page to roles without clinical access, without calling the API', async () => {
    const fetchMock = mockApi({ ...shell('owner', OWNER, null) });
    renderRoute(`/app/${ORG}/appointments/a1/record`);
    expect(await screen.findByRole('heading', { name: 'لا يمكنك الوصول إلى هذه الصفحة' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => /encounter|clinical/.test(String(url)))).toBe(false);
  });
});
