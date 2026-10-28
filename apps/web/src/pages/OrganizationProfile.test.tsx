import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

// Organization identity and legal profile (docs/architecture/ORGANIZATION_PROFILE.md).
const ORG = 'a'.repeat(24);
const P = `/api/v1/orgs/${ORG}`;
const user = { id: 'u1', email: 'noha@example.test', displayName: 'Noha', preferredLanguage: 'ar', emailVerified: false };
const OWNER: Permission[] = ['organization.read', 'organization.update', 'branch.read', 'dashboard.read'];
const profile = {
  legalNameAr: 'عيادة الاختبار للأسنان',
  legalNameEn: 'Test Dental Clinic',
  commercialRegistration: 'CR-000123',
  taxRegistration: '123-456-789',
  address: 'شارع تجريبي',
  phone: '',
  email: '',
  documentFooter: '',
  logoUrl: null,
  version: 1,
};
const shell = (permissions: Permission[]) => ({
  'GET /api/v1/auth/session': { user, csrfToken: 'csrf', memberships: [{ organization: { id: ORG, name: 'Clinic' }, role: 'owner' }] },
  [`GET ${P}`]: {
    organization: {
      id: ORG,
      name: 'Clinic',
      timeZone: 'Africa/Cairo',
      type: 'clinic',
      specialtyCodes: [],
      configVersion: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    membership: { id: 'm1', role: 'owner', branchScope: { type: 'all', branchIds: [] }, permissions, capabilities: [], practitionerId: null },
    stats: { accessibleBranches: 1 },
  },
  [`GET ${P}/branches`]: { data: [] },
  [`GET ${P}/profile`]: { profile },
});

describe('organization profile', () => {
  it('shows the letterhead preview and uploads a raster logo as the raw body', async () => {
    let upload: RequestInit | null = null;
    mockApi({
      ...shell(OWNER),
      [`PUT ${P}/profile/logo`]: (init: RequestInit) => {
        upload = init;
        return { profile: { ...profile, logoUrl: `${P}/profile/logo?v=1`, version: 2 } };
      },
    });
    renderRoute(`/app/${ORG}/settings`);
    const card = within(await screen.findByTestId('organization-profile'));
    const letterhead = within(card.getByTestId('letterhead'));
    expect(letterhead.getByText('عيادة الاختبار للأسنان')).toBeInTheDocument();
    expect(letterhead.getByText(/س\.ت: CR-000123 · ب\.ض: 123-456-789/)).toBeInTheDocument();
    const input = card.getByLabelText('شعار المنشأة');
    fireEvent.change(input, { target: { files: [new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })] } });
    expect(await card.findByText('اختر صورة PNG أو JPEG أو WebP.')).toBeInTheDocument();
    expect(upload).toBeNull();
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [png] } });
    await waitFor(() => expect(upload).not.toBeNull());
    expect((upload!.headers as Record<string, string>)['Content-Type']).toBe('image/png');
    expect(upload!.body).toBe(png);
  });

  it('saves the numbers exactly as typed, with the profile version', async () => {
    let sent: Record<string, unknown> | null = null;
    mockApi({
      ...shell(OWNER),
      [`PUT ${P}/profile`]: (init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return { profile: { ...profile, version: 2 } };
      },
    });
    renderRoute(`/app/${ORG}/settings`);
    const card = within(await screen.findByTestId('organization-profile'));
    fireEvent.change(card.getByLabelText('رقم البطاقة الضريبية'), { target: { value: ' ٣٣٣-abc ' } });
    fireEvent.click(card.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(sent).toMatchObject({ taxRegistration: ' ٣٣٣-abc ', commercialRegistration: 'CR-000123', version: 1 }));
  });
});
