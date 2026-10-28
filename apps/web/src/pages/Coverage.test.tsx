import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

// Synthetic clinical text only.
const ORG = 'e'.repeat(24);
const MARK = 'SYNTHETIC-COVERED';
const user = { id: 'u1', email: 'sami@example.test', displayName: 'Sami', preferredLanguage: 'ar', emailVerified: false };
const DOCTOR: Permission[] = [
  'organization.read', 'branch.read', 'dashboard.read', 'patient.read', 'practitioner.read', 'appointment.read', 'appointment.visit', 'queue.read',
  'clinical.encounter.own', 'clinical.documentation_status.read', 'clinical.coverage.grant',
];
const OWNER: Permission[] = ['organization.read', 'organization.update', 'branch.read', 'dashboard.read', 'member.read', 'member.update', 'member.add'];

function shell(role: string, permissions: Permission[], practitionerId: string | null, capabilities: string[] = []) {
  return {
    'GET /api/v1/auth/session': { user, csrfToken: 'csrf', memberships: [{ organization: { id: ORG, name: 'Clinic' }, role }] },
    [`GET /api/v1/orgs/${ORG}`]: {
      organization: { id: ORG, name: 'Clinic', timeZone: 'Africa/Cairo', type: null, specialtyCodes: [], configVersion: 0, createdAt: '2026-01-01T00:00:00.000Z' },
      membership: { id: 'm1', role, branchScope: { type: 'all', branchIds: [] }, permissions, capabilities, practitionerId },
      stats: { accessibleBranches: 1 },
    },
    [`GET /api/v1/orgs/${ORG}/branches`]: { data: [{ id: 'b1', name: 'North', city: '', status: 'active', specialtyCodes: [], createdAt: '2026-01-01T00:00:00.000Z' }] },
    [`GET /api/v1/orgs/${ORG}/practitioners`]: { data: [] },
  };
}

const sections = { reason: `${MARK} reason`, history: '', examination: '', assessment: '', plan: `${MARK} plan` };
const encounter = (extra: Record<string, unknown> = {}) => ({
  id: 'e1',
  appointmentId: 'a1',
  patientId: 'p1',
  branchId: 'b1',
  author: { practitionerId: 'pr1', displayName: 'Dr. Hala' },
  status: 'finalized',
  sections,
  version: 2,
  lateEntry: null,
  createdAt: '2026-11-10T08:05:00.000Z',
  lastEditedAt: '2026-11-10T08:20:00.000Z',
  finalizedAt: '2026-11-10T08:30:00.000Z',
  addenda: [],
  ...extra,
});
const coverage = (extra: Record<string, unknown> = {}) => ({
  id: 'c1',
  source: { practitionerId: 'pr1', displayName: 'Dr. Hala' },
  grantee: { practitionerId: 'pr2', displayName: 'Dr. Sami' },
  scope: { type: 'patient', encounterId: null, patient: { id: 'p1', fullName: 'Test Patient', patientNumber: 7 } },
  access: 'read',
  reason: 'Covering during leave',
  grantedVia: 'author',
  grantedByMe: true,
  status: 'active',
  startsAt: '2026-11-10T08:00:00.000Z',
  expiresAt: '2026-11-17T08:00:00.000Z',
  revokedAt: null,
  revokeReason: null,
  createdAt: '2026-11-10T08:00:00.000Z',
  ...extra,
});
const calls = (fetchMock: ReturnType<typeof mockApi>, method: string, suffix: string) =>
  fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith(suffix) && ((init as RequestInit | undefined)?.method ?? 'GET') === method) as [
    string,
    RequestInit,
  ][];

describe('sharing a record for coverage', () => {
  it('the treating doctor shares all their records for the patient with a colleague', async () => {
    const fetchMock = mockApi({
      ...shell('doctor', DOCTOR, 'pr1'),
      [`GET /api/v1/orgs/${ORG}/appointments/a1`]: {
        appointment: {
          id: 'a1', branchId: 'b1', patient: { id: 'p1', patientNumber: 7, fullName: 'Test Patient', phone: '+201001234567' },
          practitioner: { id: 'pr1', displayName: 'Dr. Hala' }, startAt: '2026-11-10T08:00:00.000Z', endAt: '2026-11-10T08:30:00.000Z',
          durationMinutes: 30, type: 'new_visit', status: 'completed', cancellationReason: null, checkedInAt: null, startedAt: null,
          completedAt: null, cancelledAt: null, noShowAt: null, version: 3, createdAt: '2026-01-01T00:00:00.000Z', documentation: 'finalized',
        },
      },
      [`GET /api/v1/orgs/${ORG}/appointments/a1/encounter`]: { encounter: encounter(), appointmentStatus: 'completed', canStart: false, lateEntryRequired: false },
      [`GET /api/v1/orgs/${ORG}/clinical/coverage/candidates`]: { data: [{ id: 'pr2', displayName: 'Dr. Sami', specialtyCode: 'dentistry' }] },
      [`POST /api/v1/orgs/${ORG}/clinical/coverage`]: Response.json({ coverage: coverage(), replayed: false }, { status: 201 }),
    });
    renderRoute(`/app/${ORG}/appointments/a1/record`);
    fireEvent.click(await screen.findByRole('button', { name: 'مشاركة…' }));
    fireEvent.change(await screen.findByLabelText('الزميل'), { target: { value: 'pr2' } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Dr. Sami' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('الزميل'), { target: { value: 'pr2' } });
    fireEvent.click(screen.getByLabelText('كل سجلاتي لهذا المريض'));
    fireEvent.click(screen.getByLabelText('قراءة وإضافة ملاحق'));
    fireEvent.change(screen.getByLabelText('المدة'), { target: { value: '14' } });
    fireEvent.change(screen.getByLabelText(/^السبب/), { target: { value: 'Covering during leave' } });
    fireEvent.click(screen.getByRole('button', { name: 'مشاركة' }));
    expect(await screen.findByText(/تمت المشاركة/)).toBeInTheDocument();

    const [, init] = calls(fetchMock, 'POST', '/clinical/coverage')[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ granteePractitionerId: 'pr2', scope: { type: 'patient', patientId: 'p1' }, access: 'author', reason: 'Covering during leave' });
    const days = (Date.parse(body.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    expect((init?.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
  });
});

describe('a covered record', () => {
  it('is read-only with "read" coverage and says whose record it is', async () => {
    mockApi({
      ...shell('doctor', DOCTOR, 'pr2'),
      [`GET /api/v1/orgs/${ORG}/encounters/e1`]: {
        encounter: encounter(),
        access: 'read',
        canAddAddendum: false,
        context: { patient: { id: 'p1', fullName: 'Test Patient', patientNumber: 7 }, appointment: { id: 'a1', startAt: '2026-11-10T08:00:00.000Z', status: 'completed' } },
      },
    });
    renderRoute(`/app/${ORG}/records/e1`);
    expect(await screen.findByText('أنت تقرأ سجلًا كتبه Dr. Hala عبر التغطية (قراءة فقط).')).toBeInTheDocument();
    expect(screen.getByText(`${MARK} plan`)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'إضافة ملحق' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(MARK);
  });

  it('with "author" coverage, addenda are added under the covering doctor’s name', async () => {
    const withAddendum = encounter({
      addenda: [{ id: 'x1', reason: 'Covering note', content: `${MARK} addendum`, author: { practitionerId: 'pr2', displayName: 'Dr. Sami' }, createdAt: '2026-11-11T08:00:00.000Z' }],
    });
    const fetchMock = mockApi({
      ...shell('doctor', DOCTOR, 'pr2'),
      [`GET /api/v1/orgs/${ORG}/encounters/e1`]: { encounter: encounter(), access: 'author', canAddAddendum: true, context: { patient: null, appointment: null } },
      [`POST /api/v1/orgs/${ORG}/encounters/e1/addenda`]: Response.json({ encounter: withAddendum, replayed: false }, { status: 201 }),
    });
    renderRoute(`/app/${ORG}/records/e1`);
    fireEvent.change(await screen.findByLabelText('سبب الملحق'), { target: { value: 'Covering note' } });
    fireEvent.change(screen.getByLabelText('نص الملحق'), { target: { value: `${MARK} addendum` } });
    fireEvent.click(screen.getByRole('button', { name: 'إضافة ملحق' }));
    const added = await screen.findByTestId('addendum');
    expect(within(added).getByText(/Dr\. Sami/)).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/encounters/e1/addenda')).toHaveLength(1);
  });

  it('an expired or revoked share shows "unavailable"', async () => {
    mockApi({
      ...shell('doctor', DOCTOR, 'pr2'),
      [`GET /api/v1/orgs/${ORG}/encounters/e1`]: Response.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 }),
    });
    renderRoute(`/app/${ORG}/records/e1`);
    expect(await screen.findByText(/غير متاحين لك/)).toBeInTheDocument();
  });
});

describe('the coverage page', () => {
  it('lists shares and revokes one with a reason', async () => {
    const fetchMock = mockApi({
      ...shell('doctor', DOCTOR, 'pr1'),
      [`GET /api/v1/orgs/${ORG}/clinical/coverage`]: { granted: [coverage()], received: [coverage({ id: 'c2', grantedByMe: false })], canGrantAsLead: false },
      [`POST /api/v1/orgs/${ORG}/clinical/coverage/c1/revoke`]: { coverage: coverage({ status: 'revoked' }) },
    });
    renderRoute(`/app/${ORG}/coverage`);
    const granted = await screen.findByTestId('coverage-granted');
    expect(within(screen.getByTestId('coverage-received')).getByRole('link', { name: 'فتح السجلات' })).toHaveAttribute('href', `/app/${ORG}/coverage/c2`);
    fireEvent.click(within(granted).getByRole('button', { name: 'سحب' }));
    fireEvent.change(within(granted).getByLabelText('سبب السحب'), { target: { value: 'Back from leave' } });
    fireEvent.click(within(granted).getByRole('button', { name: 'اسحب الآن' }));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/clinical/coverage/c1/revoke')).toHaveLength(1));
    expect(JSON.parse(String(calls(fetchMock, 'POST', '/clinical/coverage/c1/revoke')[0]?.[1].body))).toEqual({ reason: 'Back from leave' });
  });
});

describe('the clinical audit page', () => {
  it('needs the capability; shows metadata only', async () => {
    mockApi({
      ...shell('owner', [...OWNER, 'clinical.audit.read'], null, ['clinical_audit']),
      [`GET /api/v1/orgs/${ORG}/clinical/audit`]: {
        data: [
          {
            id: 'ev1', action: 'clinical.access_denied', actor: { displayName: 'Omar', role: 'receptionist' }, createdAt: '2026-11-10T08:00:00.000Z',
            encounterId: null, appointmentId: 'a1', patientNumber: 7, metadata: { reason: 'no_clinical_permission' },
          },
          {
            id: 'ev2', action: 'encounter.viewed', actor: { displayName: 'Dr. Sami', role: 'doctor' }, createdAt: '2026-11-10T09:00:00.000Z',
            encounterId: 'e1', appointmentId: 'a1', patientNumber: 7, metadata: { via: 'coverage', coverageId: 'c1' },
          },
        ],
        next: null,
      },
    });
    renderRoute(`/app/${ORG}/clinical-audit`);
    const table = await screen.findByTestId('clinical-audit');
    expect(within(table).getByText('رفض وصول')).toBeInTheDocument();
    expect(within(table).getByText('دور بلا وصول سريري')).toBeInTheDocument();
    expect(within(table).getByText('عبر التغطية')).toBeInTheDocument();
  });

  it('is closed without the capability', async () => {
    const fetchMock = mockApi({ ...shell('owner', OWNER, null) });
    renderRoute(`/app/${ORG}/clinical-audit`);
    expect(await screen.findByRole('heading', { name: 'لا يمكنك الوصول إلى هذه الصفحة' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/clinical/'))).toBe(false);
  });
});

describe('team page', () => {
  it('an owner gives a member clinical audit access', async () => {
    const member = (capabilities: string[]) => ({
      id: 'm2', user: { id: 'u2', displayName: 'Karim', email: 'karim@example.test' }, role: 'admin', status: 'active',
      branchScope: { type: 'all', branchIds: [] }, capabilities, isSelf: false, createdAt: '2026-01-01T00:00:00.000Z',
    });
    const fetchMock = mockApi({
      ...shell('owner', OWNER, null),
      [`GET /api/v1/orgs/${ORG}/members`]: { data: [member([])] },
      [`PATCH /api/v1/orgs/${ORG}/members/m2`]: { member: member(['clinical_audit']) },
    });
    renderRoute(`/app/${ORG}/team`);
    fireEvent.click(await screen.findByRole('button', { name: 'منح Karim صلاحية التدقيق السريري' }));
    await waitFor(() => expect(calls(fetchMock, 'PATCH', '/members/m2')).toHaveLength(1));
    expect(JSON.parse(String(calls(fetchMock, 'PATCH', '/members/m2')[0]?.[1].body))).toEqual({ capabilities: ['clinical_audit'] });
  });
});
