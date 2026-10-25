import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

// Specialty parts of visit records (synthetic data only).
const ORG = 'f'.repeat(24);
const user = { id: 'u1', email: 'hala@example.test', displayName: 'Hala', preferredLanguage: 'ar', emailVerified: false };
const DOCTOR: Permission[] = [
  'organization.read', 'branch.read', 'dashboard.read', 'patient.read', 'practitioner.read', 'appointment.read', 'appointment.visit', 'queue.read',
  'clinical.encounter.own', 'clinical.documentation_status.read', 'clinical.coverage.grant',
];

function shell() {
  return {
    'GET /api/v1/auth/session': { user, csrfToken: 'csrf', memberships: [{ organization: { id: ORG, name: 'Clinic' }, role: 'doctor' }] },
    [`GET /api/v1/orgs/${ORG}`]: {
      organization: { id: ORG, name: 'Clinic', timeZone: 'Africa/Cairo', type: null, specialtyCodes: [], configVersion: 0, createdAt: '2026-01-01T00:00:00.000Z' },
      membership: { id: 'm1', role: 'doctor', branchScope: { type: 'all', branchIds: [] }, permissions: DOCTOR, capabilities: [], practitionerId: 'pr1' },
      stats: { accessibleBranches: 1 },
    },
    [`GET /api/v1/orgs/${ORG}/branches`]: { data: [{ id: 'b1', name: 'North', city: '', status: 'active', specialtyCodes: [], createdAt: '2026-01-01T00:00:00.000Z' }] },
    [`GET /api/v1/orgs/${ORG}/practitioners`]: { data: [] },
    [`GET /api/v1/orgs/${ORG}/appointments/a1`]: {
      appointment: {
        id: 'a1', branchId: 'b1', patient: { id: 'p1', patientNumber: 7, fullName: 'Test Patient', phone: '+201001234567' },
        practitioner: { id: 'pr1', displayName: 'Dr. Hala' }, startAt: '2026-11-10T08:00:00.000Z', endAt: '2026-11-10T08:30:00.000Z',
        durationMinutes: 30, type: 'new_visit', status: 'in_progress', cancellationReason: null, checkedInAt: null, startedAt: null,
        completedAt: null, cancelledAt: null, noShowAt: null, version: 3, createdAt: '2026-01-01T00:00:00.000Z', documentation: 'draft',
      },
    },
  };
}
const encounter = (specialty: unknown, extra: Record<string, unknown> = {}) => ({
  id: 'e2', appointmentId: 'a1', patientId: 'p1', branchId: 'b1', author: { practitionerId: 'pr1', displayName: 'Dr. Hala' }, status: 'draft',
  sections: { reason: 'Synthetic reason', history: '', examination: '', assessment: '', plan: '' }, version: 0, lateEntry: null,
  createdAt: '2026-11-10T08:05:00.000Z', lastEditedAt: '2026-11-10T08:05:00.000Z', finalizedAt: null, addenda: [], specialty, ...extra,
});
const view = (e: unknown) => ({ encounter: e, appointmentStatus: 'in_progress', canStart: false, lateEntryRequired: false, templates: [] });
const lastPut = (fetchMock: ReturnType<typeof mockApi>) => {
  const call = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/encounters/e2') && (init as RequestInit).method === 'PUT').at(-1);
  return JSON.parse(String((call?.[1] as RequestInit).body));
};
const dentalData = { dentition: 'permanent', findings: [], procedures: [], planItems: [], planUpdates: [] };

describe('dental visit', () => {
  it('records findings on a selected tooth and updates an earlier plan item, without touching earlier visits', async () => {
    const fetchMock = mockApi({
      ...shell(),
      [`GET /api/v1/orgs/${ORG}/appointments/a1/encounter`]: view(encounter({ template: 'dentistry.visit', version: 1, data: dentalData })),
      [`GET /api/v1/orgs/${ORG}/patients/p1/dental-chart`]: {
        teeth: [{ tooth: '16', entries: [{ kind: 'finding', encounterId: 'e1', date: '2026-11-01T08:00:00.000Z', surfaces: ['O'], text: 'Earlier synthetic finding' }] }],
        planItems: [{ id: 'p-1', sourceEncounterId: 'e1', tooth: '16', description: 'Synthetic restoration', recordedAt: '2026-11-01T08:00:00.000Z', status: 'planned', history: [] }],
        records: [{ id: 'e1', date: '2026-11-01T08:00:00.000Z', own: true }],
        drafts: 1,
      },
      [`PUT /api/v1/orgs/${ORG}/encounters/e2`]: (init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        return { encounter: encounter({ template: 'dentistry.visit', version: 1, data: body.specialtyData }, { version: 1 }) };
      },
    });
    renderRoute(`/app/${ORG}/appointments/a1/record`);
    // The record page loads the lazy workspace chunk and several requests; allow for a busy machine.
    fireEvent.click(await screen.findByRole('button', { name: 'السن 16' }, { timeout: 5000 }));
    const panel = await screen.findByTestId('tooth-panel');
    expect(within(panel).getByText('Earlier synthetic finding')).toBeInTheDocument();
    fireEvent.click(within(panel).getByLabelText('إطباقي / قاطع'));
    fireEvent.change(within(panel).getByLabelText('نتيجة الفحص (بكلماتك)'), { target: { value: 'Synthetic new finding' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'إضافة نتيجة' }));
    expect(screen.getByTestId('save-state')).toHaveTextContent('تغييرات غير محفوظة');
    fireEvent.change(await screen.findByLabelText('تغيير حالة Synthetic restoration'), { target: { value: 'done' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ المسودة' }));
    await waitFor(() => expect(screen.getByTestId('save-state')).not.toHaveTextContent('تغييرات غير محفوظة'));
    const body = lastPut(fetchMock);
    expect(body.specialtyData.findings).toEqual([{ id: expect.any(String), tooth: '16', surfaces: ['O'], note: 'Synthetic new finding' }]);
    expect(body.specialtyData.planUpdates).toEqual([{ itemId: 'p-1', sourceEncounterId: 'e1', status: 'done', note: '' }]);
  });

  it('a record made with an unknown template version is shown, never rewritten', async () => {
    const fetchMock = mockApi({
      ...shell(),
      [`GET /api/v1/orgs/${ORG}/appointments/a1/encounter`]: view(encounter({ template: 'dentistry.visit', version: 99, data: { legacy: 'x' } })),
      [`PUT /api/v1/orgs/${ORG}/encounters/e2`]: (init: RequestInit) => ({ encounter: encounter({ template: 'dentistry.visit', version: 99, data: { legacy: 'x' } }, { version: 1, sections: JSON.parse(String(init.body)).sections }) }),
    });
    renderRoute(`/app/${ORG}/appointments/a1/record`);
    expect(await screen.findByText(/الإصدار 99/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('التقييم'), { target: { value: 'Synthetic assessment' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ المسودة' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/encounters/e2') && (init as RequestInit).method === 'PUT')).toBe(true));
    expect(lastPut(fetchMock)).not.toHaveProperty('specialtyData');
  });
});

describe('physiotherapy session', () => {
  it('links the session to a course and notes progress per goal', async () => {
    const fetchMock = mockApi({
      ...shell(),
      [`GET /api/v1/orgs/${ORG}/appointments/a1/encounter`]: view(
        encounter({ template: 'physiotherapy.session', version: 1, data: { courseEncounterId: null, performed: '', progress: '', goalNotes: [] } }),
      ),
      [`GET /api/v1/orgs/${ORG}/patients/p1/physio-courses`]: {
        courses: [
          {
            assessmentId: 'as1', practitioner: 'Dr. Hala', own: true, startedAt: '2026-11-01T08:00:00.000Z', plannedSessions: 6, frequency: 'Weekly',
            goals: [{ id: 'g-1', text: 'Synthetic goal' }], sessions: [], completedSessions: 0, discharge: null, upcomingAppointments: 2,
          },
        ],
        drafts: 1,
      },
      [`PUT /api/v1/orgs/${ORG}/encounters/e2`]: (init: RequestInit) => ({
        encounter: encounter({ template: 'physiotherapy.session', version: 1, data: JSON.parse(String(init.body)).specialtyData }, { version: 1 }),
      }),
    });
    renderRoute(`/app/${ORG}/appointments/a1/record`);
    const course = await screen.findByLabelText('خطة العلاج');
    await waitFor(() => expect(within(course).getAllByRole('option')).toHaveLength(2));
    fireEvent.change(course, { target: { value: 'as1' } });
    fireEvent.change(await screen.findByLabelText('Synthetic goal'), { target: { value: 'Synthetic: 500 m' } });
    fireEvent.change(screen.getByLabelText('العلاج المنفّذ'), { target: { value: 'Synthetic exercises' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ المسودة' }));
    await waitFor(() => expect(lastPut(fetchMock).specialtyData).toMatchObject({ courseEncounterId: 'as1', performed: 'Synthetic exercises', goalNotes: [{ goalId: 'g-1', note: 'Synthetic: 500 m' }] }));
  });
});

describe('finalized ENT record', () => {
  it('shows the region fields read-only', async () => {
    mockApi({
      ...shell(),
      [`GET /api/v1/orgs/${ORG}/appointments/a1/encounter`]: view(
        encounter(
          { template: 'ent.visit', version: 1, data: { history: { ear: 'Synthetic ear history', nose: '', throat: '' }, examination: { rightEar: 'Synthetic right ear', leftEar: '', nose: '', throat: '', neck: '' }, followUp: 'Synthetic follow-up' } },
          { status: 'finalized', finalizedAt: '2026-11-10T08:30:00.000Z', version: 2 },
        ),
      ),
    });
    renderRoute(`/app/${ORG}/appointments/a1/record`);
    const specialty = await screen.findByTestId('specialty-view');
    expect(within(specialty).getByText('Synthetic right ear')).toBeInTheDocument();
    expect(within(specialty).getByText('الأذن اليمنى')).toBeInTheDocument();
    expect(screen.queryByLabelText('الأذن اليمنى')).not.toBeInTheDocument();
  });
});
