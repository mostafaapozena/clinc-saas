import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, renderRoute } from '../test/render';

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);
const user = { id: 'u1', email: 'reem@example.test', displayName: 'Reem', preferredLanguage: 'ar', emailVerified: false };

function orgDetail(id: string, name: string, role: string, permissions: string[], scope = { type: 'all', branchIds: [] as string[] }) {
  return {
    organization: { id, name, createdAt: '2026-01-01T00:00:00.000Z' },
    membership: { id: `m-${id}`, role, branchScope: scope, permissions },
    stats: { accessibleBranches: 1 },
  };
}
const branch = (id: string, name: string) => ({ id, name, city: '', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' });

describe('application shell', () => {
  it('shows a restricted role only its pages and denies the rest', async () => {
    mockApi({
      'GET /api/v1/auth/session': { user, csrfToken: 't', memberships: [{ organization: { id: A, name: 'Alpha' }, role: 'doctor' }] },
      [`GET /api/v1/orgs/${A}`]: orgDetail(A, 'Alpha', 'doctor', ['organization.read', 'branch.read'], { type: 'selected', branchIds: ['br1'] }),
      [`GET /api/v1/orgs/${A}/branches`]: { data: [branch('br1', 'Alpha North')] },
    });
    renderRoute(`/app/${A}/team`);

    expect(await screen.findByRole('heading', { name: 'لا يمكنك الوصول إلى هذه الصفحة' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'التنقل الرئيسي' });
    const labels = within(nav).getAllByRole('link').map((link) => link.textContent);
    expect(labels).toEqual(['الرئيسية', 'الفروع', 'الملف الشخصي']);
    // A restricted scope gets no "all branches" option.
    const branchSelect = await screen.findByLabelText('الفرع');
    expect(within(branchSelect).getAllByRole('option').map((o) => o.textContent)).toEqual(['Alpha North']);
  });

  it('switching organization removes the previous organization from screen and cache', async () => {
    mockApi({
      'GET /api/v1/auth/session': {
        user,
        csrfToken: 't',
        memberships: [
          { organization: { id: A, name: 'Alpha' }, role: 'admin' },
          { organization: { id: B, name: 'Beta' }, role: 'doctor' },
        ],
      },
      [`GET /api/v1/orgs/${A}`]: orgDetail(A, 'Alpha', 'admin', ['organization.read', 'branch.read', 'member.read']),
      [`GET /api/v1/orgs/${A}/branches`]: { data: [branch('a1', 'Alpha North')] },
      [`GET /api/v1/orgs/${B}`]: orgDetail(B, 'Beta', 'doctor', ['organization.read', 'branch.read']),
      [`GET /api/v1/orgs/${B}/branches`]: { data: [branch('b1', 'Beta Riyadh')] },
    });
    const { queryClient } = renderRoute(`/app/${A}`);

    expect(await screen.findByTestId('home-org-name')).toHaveTextContent('Alpha');
    await screen.findByRole('option', { name: 'Alpha North' });

    fireEvent.change(screen.getByLabelText('المنشأة'), { target: { value: B } });

    await waitFor(() => expect(screen.getByTestId('home-org-name')).toHaveTextContent('Beta'));
    expect(screen.queryByText('Alpha North')).not.toBeInTheDocument();
    expect(screen.getByTestId('home-role')).toHaveTextContent('طبيب');
    await waitFor(() => expect(queryClient.getQueryCache().findAll({ queryKey: ['org', A] })).toHaveLength(0));
  });

  it('treats an inaccessible organization as unavailable without details', async () => {
    mockApi({
      'GET /api/v1/auth/session': { user, csrfToken: 't', memberships: [] },
    });
    renderRoute(`/app/${B}`);

    expect(await screen.findByRole('heading', { name: 'المنشأة غير متاحة' })).toBeInTheDocument();
  });
});
