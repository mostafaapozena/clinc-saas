import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

// Workspace preparation and specialty experiences (docs/architecture/MODULES.md and
// SPECIALTY_WORKSPACES.md): the preparation state follows the real request, a lost response
// resumes into the workspace, several specialties ask for a context, and each specialty gets its
// own shortcuts.
const ORG = 'a'.repeat(24);
const user = { id: 'u1', email: 'noha@example.test', displayName: 'Noha', preferredLanguage: 'ar', emailVerified: false };
const SPECIALTIES = [
  { code: 'dentistry', name: { ar: 'طب الأسنان', en: 'Dentistry' } },
  { code: 'physiotherapy', name: { ar: 'العلاج الطبيعي', en: 'Physiotherapy' } },
  { code: 'ent', name: { ar: 'الأنف والأذن والحنجرة', en: 'ENT' } },
];
const draft = {
  id: 'd1',
  status: 'draft',
  step: 'review',
  version: 3,
  organizationId: null,
  updatedAt: '2026-11-10T08:00:00.000Z',
  data: {
    organizationType: 'clinic',
    name: 'عيادة الابتسامة',
    timeZone: 'Africa/Cairo',
    specialtyCodes: ['dentistry'],
    branch: { name: 'الفرع', city: 'القاهرة', specialtyCodes: ['dentistry'] },
  },
};
function shell(specialtyCodes: string[], permissions: Permission[], role = 'owner') {
  return {
    'GET /api/v1/specialties': { data: SPECIALTIES },
    'GET /api/v1/auth/session': { user, csrfToken: 'csrf', memberships: [{ organization: { id: ORG, name: 'Clinic' }, role }] },
    [`GET /api/v1/orgs/${ORG}`]: {
      organization: {
        id: ORG,
        name: 'Clinic',
        timeZone: 'Africa/Cairo',
        type: 'medical_center',
        specialtyCodes,
        configVersion: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      membership: { id: 'm1', role, branchScope: { type: 'all', branchIds: [] }, permissions, capabilities: [], practitionerId: null },
      stats: { accessibleBranches: 1 },
    },
    [`GET /api/v1/orgs/${ORG}/branches`]: {
      data: [{ id: 'b1', name: 'North', city: '', status: 'active', specialtyCodes, createdAt: '2026-01-01T00:00:00.000Z' }],
    },
  };
}
afterEach(() => sessionStorage.clear());

describe('workspace preparation', () => {
  it('shows the specialty preparation state while the real setup request runs, and opens the workspace', async () => {
    let finish: (v: Response) => void = () => {};
    const fetchMock = mockApi({
      ...shell(['dentistry'], ['organization.read', 'branch.read', 'dashboard.read']),
      'GET /api/v1/auth/session': { user, csrfToken: 'csrf', memberships: [] },
      'GET /api/v1/onboarding': { draft, completed: null },
      'POST /api/v1/onboarding/d1/complete': () => new Promise<Response>((resolve) => (finish = resolve)),
    });
    const { router } = renderRoute('/onboarding');
    const submit = await screen.findByRole('button', { name: 'إنشاء مساحة العمل' });
    fireEvent.click(submit);
    const status = await screen.findByTestId('preparing-workspace');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveTextContent('جاري تجهيز مساحة عمل طب الأسنان');
    expect(screen.queryByRole('button', { name: 'إنشاء مساحة العمل' })).toBeNull(); // nothing to click twice
    expect(sessionStorage.getItem('raclinic.setup.pending')).toBe('1');
    finish(Response.json({ organization: { id: ORG, name: 'عيادة الابتسامة' }, replayed: false }, { status: 201 }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/${ORG}`));
    expect(fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith('/complete') && (i as RequestInit).method === 'POST')).toHaveLength(1);
    expect(sessionStorage.getItem('raclinic.setup.pending')).toBeNull();
  });

  it('resumes into the workspace when the setup completed but its response was lost', async () => {
    sessionStorage.setItem('raclinic.setup.pending', '1');
    mockApi({
      ...shell(['dentistry'], ['organization.read', 'branch.read', 'dashboard.read']),
      'GET /api/v1/onboarding': { draft: null, completed: { organizationId: ORG } },
    });
    const { router } = renderRoute('/onboarding');
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/${ORG}`));
  });
});

describe('specialty experiences', () => {
  const OWNER: Permission[] = [
    'organization.read',
    'branch.read',
    'dashboard.read',
    'patient.list',
    'appointment.read',
    'appointment.book',
    'queue.read',
  ];

  it('asks a multi-specialty member for a context, then shows that specialty’s shortcuts', async () => {
    mockApi(shell(['dentistry', 'physiotherapy'], OWNER));
    renderRoute(`/app/${ORG}`);
    const chooser = await screen.findByTestId('specialty-chooser');
    expect(screen.queryByTestId('specialty-actions-dentistry')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'العلاج الطبيعي' }));
    await waitFor(() => expect(chooser).not.toBeInTheDocument());
    expect(await screen.findByTestId('specialty-actions-physiotherapy')).toHaveTextContent('جلسات اليوم');
  });

  it('opens a dentistry-only clinic on dental shortcuts, and an ENT clinic on ENT ones', async () => {
    mockApi(shell(['dentistry'], OWNER));
    renderRoute(`/app/${ORG}`);
    expect(await screen.findByTestId('specialty-actions-dentistry')).toHaveTextContent('ملفات المرضى ومخطط الأسنان');
    expect(screen.queryByTestId('specialty-chooser')).toBeNull();
    expect(screen.queryByText('جلسات اليوم')).toBeNull();
    cleanup();
    mockApi(shell(['ent'], OWNER));
    renderRoute(`/app/${ORG}`);
    expect(await screen.findByTestId('specialty-actions-ent')).toHaveTextContent('زيارات اليوم');
    expect(screen.queryByText('ملفات المرضى ومخطط الأسنان')).toBeNull();
  });
});
