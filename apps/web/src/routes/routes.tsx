import { Navigate, type RouteObject } from 'react-router';
import { AppShell } from '../layouts/AppShell';
import { BranchesPage } from '../pages/BranchesPage';
import { HomePage } from '../pages/HomePage';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundInShell, NotFoundPage } from '../pages/NotFoundPage';
import { OnboardingPage } from '../pages/OnboardingPage';
import { ProfilePage } from '../pages/ProfilePage';
import { RegisterPage } from '../pages/RegisterPage';
import { SettingsPage } from '../pages/SettingsPage';
import { StatusPage } from '../pages/StatusPage';
import { TeamPage } from '../pages/TeamPage';
import { PublicOnly, RequireAuth, RequirePermission, WorkspaceRedirect } from './guards';

// Only implemented pages are routable; there are no placeholders for future modules.
export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/app" replace /> },
  { path: '/status', element: <StatusPage /> },
  {
    element: <PublicOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      { path: '/onboarding', element: <OnboardingPage /> },
      { path: '/app', element: <WorkspaceRedirect /> },
      {
        path: '/app/:orgId',
        element: <AppShell />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'branches', element: <BranchesPage /> },
          {
            path: 'team',
            element: (
              <RequirePermission permission="member.read">
                <TeamPage />
              </RequirePermission>
            ),
          },
          {
            path: 'settings',
            element: (
              <RequirePermission permission="organization.update">
                <SettingsPage />
              </RequirePermission>
            ),
          },
          { path: 'profile', element: <ProfilePage /> },
          { path: '*', element: <NotFoundInShell /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
