import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

// Specialty worklists (docs/architecture/SPECIALTY_WORKSPACES.md): the menu and the page follow the
// doctor's specialty; the data comes from the API (own records only).
const ORG = 'a'.repeat(24);
const user = { id: 'u1', email: 'noha@example.test', displayName: 'Noha', preferredLanguage: 'ar', emailVerified: false };
const DOCTOR: Permission[] = ['organization.read', 'branch.read', 'dashboard.read', 'appointment.read', 'clinical.encounter.own'];

function shell(specialty: string) {
  return {
    'GET /api/v1/auth/session': { user, csrfToken: 'csrf', memberships: [{ organization: { id: ORG, name: 'Clinic' }, role: 'doctor' }] },
    [`GET /api/v1/orgs/${ORG}`]: {
      organization: {
        id: ORG,
        name: 'Clinic',
        timeZone: 'Africa/Cairo',
        type: null,
        specialtyCodes: [specialty],
        configVersion: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      membership: {
        id: 'm1',
        role: 'doctor',
        branchScope: { type: 'all', branchIds: [] },
        permissions: DOCTOR,
        capabilities: [],
        practitionerId: 'p1',
        practitionerSpecialty: specialty,
      },
      stats: { accessibleBranches: 1 },
    },
    [`GET /api/v1/orgs/${ORG}/branches`]: {
      data: [{ id: 'b1', name: 'North', city: '', status: 'active', specialtyCodes: [specialty], createdAt: '2026-01-01T00:00:00.000Z' }],
    },
  };
}
const clinical = (worklist: object) => ({
  role: 'doctor',
  clinical: { specialty: 'x', today: { scheduled: 1, waiting: 0, inProgress: 0, completed: 0 }, draftRecords: 0, worklist },
});

describe('specialty worklists', () => {
  it('shows a physiotherapist their active courses under the courses menu item', async () => {
    mockApi({
      ...shell('physiotherapy'),
      [`GET /api/v1/orgs/${ORG}/workspace/focus`]: clinical({
        kind: 'physiotherapy',
        total: 1,
        items: [
          {
            patientId: 'pt1',
            fullName: 'Course Patient',
            patientNumber: 7,
            courseId: 'c1',
            plannedSessions: 10,
            completedSessions: 3,
            upcomingSessions: 2,
            nextVisit: null,
          },
        ],
      }),
    });
    renderRoute(`/app/${ORG}/worklist`);
    expect(await screen.findByRole('heading', { level: 1, name: 'برامج العلاج' })).toBeInTheDocument();
    const list = within(screen.getByTestId('worklist'));
    expect(list.getByText('Course Patient')).toBeInTheDocument();
    expect(list.getByText(/3 من 10 جلسة · 2 محجوزة/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'برامج العلاج' }).length).toBeGreaterThan(0);
  });

  it('names the menu item for an ENT doctor after follow-ups', async () => {
    mockApi({ ...shell('ent'), [`GET /api/v1/orgs/${ORG}/workspace/focus`]: clinical({ kind: 'ent', total: 0, items: [] }) });
    renderRoute(`/app/${ORG}/worklist`);
    expect(await screen.findByText('كل المتابعات محجوزة.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'المتابعات' }).length).toBeGreaterThan(0);
  });
});
