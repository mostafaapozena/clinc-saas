import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Permission } from '../lib/types';
import { mockApi, renderRoute } from '../test/render';

// Safe settings reset (docs/architecture/SETTINGS_RESET.md): preview first, then the
// organization's name, then the reset with the previewed token.
const ORG = 'a'.repeat(24);
const P = `/api/v1/orgs/${ORG}`;
const user = { id: 'u1', email: 'noha@example.test', displayName: 'Noha', preferredLanguage: 'ar', emailVerified: false };
const OWNER: Permission[] = ['organization.read', 'organization.update', 'branch.read', 'dashboard.read', 'accounting.settings.manage'];

describe('settings reset', () => {
  it('resets only after a preview and the organization’s name', async () => {
    let sent: Record<string, unknown> | null = null;
    mockApi({
      'GET /api/v1/auth/session': { user, csrfToken: 'csrf', memberships: [{ organization: { id: ORG, name: 'Clinic' }, role: 'owner' }] },
      [`GET ${P}`]: {
        organization: {
          id: ORG,
          name: 'عيادة النور',
          timeZone: 'Africa/Cairo',
          type: 'clinic',
          specialtyCodes: [],
          configVersion: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        membership: {
          id: 'm1',
          role: 'owner',
          branchScope: { type: 'all', branchIds: [] },
          permissions: OWNER,
          capabilities: [],
          practitionerId: null,
        },
        stats: { accessibleBranches: 1 },
      },
      [`GET ${P}/branches`]: { data: [] },
      [`GET ${P}/profile`]: {
        profile: {
          legalNameAr: '',
          legalNameEn: '',
          commercialRegistration: '',
          taxRegistration: '',
          address: '',
          phone: '',
          email: '',
          documentFooter: '',
          logoUrl: null,
          version: 0,
        },
      },
      [`GET ${P}/settings-reset/snapshots`]: { snapshots: [] },
      [`GET ${P}/settings-reset/preview`]: (_: RequestInit, u: URL) => {
        expect(u.searchParams.get('sections')).toBe('modules,accounting');
        return {
          sections: ['modules', 'accounting'],
          changes: [
            { section: 'modules', key: 'enabledModules', from: 'all', to: ['accounting'] },
            { section: 'accounting', key: 'requireCashSession', from: true, to: false },
          ],
          skipped: [],
          token: 'tok-1234567890',
        };
      },
      [`POST ${P}/settings-reset`]: (init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return {
          snapshot: { id: 's1', kind: 'reset', sections: ['modules'], changes: 2, restoredAt: null, createdAt: '2026-11-10T10:00:00.000Z' },
          changes: [],
          skipped: [],
        };
      },
    });
    renderRoute(`/app/${ORG}/settings`);
    const card = within(await screen.findByTestId('settings-reset'));
    expect(card.queryByRole('button', { name: 'إعادة الضبط الآن' })).toBeNull();
    fireEvent.click(card.getByRole('checkbox', { name: /ربط الحسابات/ }));
    fireEvent.click(card.getByRole('button', { name: 'معاينة التغييرات' }));
    expect(await card.findByText('سيتغير 2 إعداد:')).toBeInTheDocument();
    const confirm = card.getByRole('button', { name: 'إعادة الضبط الآن' });
    expect(confirm).toBeDisabled();
    fireEvent.change(card.getByLabelText(/اكتب اسم المنشأة/), { target: { value: 'عيادة' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(card.getByLabelText(/اكتب اسم المنشأة/), { target: { value: 'عيادة النور' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(sent).toEqual({ sections: ['modules', 'accounting'], token: 'tok-1234567890', confirmName: 'عيادة النور' }));
  });
});
