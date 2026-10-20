import type { ReactNode } from 'react';
import { Navigate, type RouteObject } from 'react-router';
import { AppShell } from '../layouts/AppShell';
import type { Permission } from '../lib/types';
import { AppointmentDetailPage } from '../pages/AppointmentDetailPage';
import { AppointmentsPage } from '../pages/AppointmentsPage';
import { BookAppointmentPage, RescheduleAppointmentPage } from '../pages/BookAppointmentPage';
import { BranchesPage } from '../pages/BranchesPage';
import { HomePage } from '../pages/HomePage';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundInShell, NotFoundPage } from '../pages/NotFoundPage';
import { OnboardingPage } from '../pages/OnboardingPage';
import { PatientDetailPage } from '../pages/PatientDetailPage';
import { PatientsPage } from '../pages/PatientsPage';
import { PractitionerDetailPage } from '../pages/PractitionerDetailPage';
import { PractitionersPage } from '../pages/PractitionersPage';
import { ProfilePage } from '../pages/ProfilePage';
import { QueuePage } from '../pages/QueuePage';
import { RegisterPage } from '../pages/RegisterPage';
import { SettingsPage } from '../pages/SettingsPage';
import { StatusPage } from '../pages/StatusPage';
import { TeamPage } from '../pages/TeamPage';
import { PublicOnly, RequireAuth, RequirePermission, WorkspaceRedirect } from './guards';

const guarded = (path: string, permission: Permission, element: ReactNode): RouteObject => ({
  path,
  element: <RequirePermission permission={permission}>{element}</RequirePermission>,
});

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
          guarded('appointments', 'appointment.read', <AppointmentsPage />),
          guarded('appointments/new', 'appointment.book', <BookAppointmentPage />),
          guarded('appointments/:appointmentId', 'appointment.read', <AppointmentDetailPage />),
          guarded('appointments/:appointmentId/reschedule', 'appointment.book', <RescheduleAppointmentPage />),
          guarded('queue', 'queue.read', <QueuePage />),
          guarded('patients', 'patient.list', <PatientsPage />),
          guarded('patients/:patientId', 'patient.read', <PatientDetailPage />),
          guarded('practitioners', 'practitioner.read', <PractitionersPage />),
          guarded('practitioners/:practitionerId', 'practitioner.read', <PractitionerDetailPage />),
          { path: 'branches', element: <BranchesPage /> },
          guarded('team', 'member.read', <TeamPage />),
          guarded('settings', 'organization.update', <SettingsPage />),
          { path: 'profile', element: <ProfilePage /> },
          { path: '*', element: <NotFoundInShell /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
