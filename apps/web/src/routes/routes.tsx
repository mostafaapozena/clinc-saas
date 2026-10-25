import { lazy, type ComponentType, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import type { Permission } from '../lib/types';
import { NotFoundPage } from '../pages/NotFoundPage';
import { PublicOnly, RequireAuth, RequirePermission, WorkspaceRedirect } from './guards';
import { Loadable } from './Loadable';

// Four lazily loaded chunks, so each audience downloads only its own code:
// - public website (home, solutions, custom projects) — no workspace code;
// - account (sign-in, registration, onboarding, status);
// - clinic workspace (everything under /app/:orgId);
// - platform operator console (/operator), with its own sign-in and session.
// The router, session handling, translations and fonts are shared by all of them.
const publicSite = () => import('../public');
const account = () => import('../account');
const workspace = () => import('../workspace');
const operatorConsole = () => import('../operator');

function named<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}

const PublicSiteLayout = named(publicSite, 'PublicSiteLayout');
const PublicHomePage = named(publicSite, 'PublicHomePage');
const SolutionsPage = named(publicSite, 'SolutionsPage');
const SolutionDetailPage = named(publicSite, 'SolutionDetailPage');
const CustomSolutionsPage = named(publicSite, 'CustomSolutionsPage');
const InquiryPage = named(publicSite, 'InquiryPage');
const PublicNotFound = named(publicSite, 'PublicNotFound');

const StartPage = named(account, 'StartPage');
const LoginPage = named(account, 'LoginPage');
const RegisterPage = named(account, 'RegisterPage');
const OnboardingPage = named(account, 'OnboardingPage');
const StatusPage = named(account, 'StatusPage');

const AppShell = named(workspace, 'AppShell');
const HomePage = named(workspace, 'HomePage');
const AppointmentsPage = named(workspace, 'AppointmentsPage');
const BookAppointmentPage = named(workspace, 'BookAppointmentPage');
const AppointmentDetailPage = named(workspace, 'AppointmentDetailPage');
const RescheduleAppointmentPage = named(workspace, 'RescheduleAppointmentPage');
const EncounterPage = named(workspace, 'EncounterPage');
const RecordPage = named(workspace, 'RecordPage');
const CoveragePage = named(workspace, 'CoveragePage');
const CoverageRecordsPage = named(workspace, 'CoverageRecordsPage');
const ClinicalAuditPage = named(workspace, 'ClinicalAuditPage');
const FinancePage = named(workspace, 'FinancePage');
const ServicesPage = named(workspace, 'ServicesPage');
const PatientAccountPage = named(workspace, 'PatientAccountPage');
const InvoicePage = named(workspace, 'InvoicePage');
const InvoicePrintPage = named(workspace, 'InvoicePrintPage');
const ReceiptPrintPage = named(workspace, 'ReceiptPrintPage');
const QueuePage = named(workspace, 'QueuePage');
const PatientsPage = named(workspace, 'PatientsPage');
const PatientDetailPage = named(workspace, 'PatientDetailPage');
const PractitionersPage = named(workspace, 'PractitionersPage');
const PractitionerDetailPage = named(workspace, 'PractitionerDetailPage');
const BranchesPage = named(workspace, 'BranchesPage');
const TeamPage = named(workspace, 'TeamPage');
const SettingsPage = named(workspace, 'SettingsPage');
const ProfilePage = named(workspace, 'ProfilePage');
const NotFoundInShell = named(workspace, 'NotFoundInShell');
const SubscriptionPage = named(workspace, 'SubscriptionPage');
const SimulatorCheckoutPage = named(workspace, 'SimulatorCheckoutPage');

const OperatorRoot = named(operatorConsole, 'OperatorRoot');
const OperatorOverviewPage = named(operatorConsole, 'OperatorOverviewPage');
const OperatorOrganizationsPage = named(operatorConsole, 'OperatorOrganizationsPage');
const OperatorOrganizationPage = named(operatorConsole, 'OperatorOrganizationPage');
const OperatorPlansPage = named(operatorConsole, 'OperatorPlansPage');
const OperatorInquiriesPage = named(operatorConsole, 'OperatorInquiriesPage');
const OperatorInquiryPage = named(operatorConsole, 'OperatorInquiryPage');
const OperatorOperatorsPage = named(operatorConsole, 'OperatorOperatorsPage');
const OperatorAuditPage = named(operatorConsole, 'OperatorAuditPage');
const OperatorSupportPage = named(operatorConsole, 'OperatorSupportPage');
const OperatorSupportRequestPage = named(operatorConsole, 'OperatorSupportRequestPage');
const OperatorDevMailPage = named(operatorConsole, 'OperatorDevMailPage');
const ForgotPasswordPage = named(account, 'ForgotPasswordPage');
const ResetPasswordPage = named(account, 'ResetPasswordPage');
const VerifyEmailPage = named(account, 'VerifyEmailPage');
const AcceptInvitationPage = named(account, 'AcceptInvitationPage');
const SupportPage = named(workspace, 'SupportPage');
const SupportRequestPage = named(workspace, 'SupportRequestPage');

const load = (element: ReactNode) => <Loadable>{element}</Loadable>;

const guarded = (path: string, permission: Permission, element: ReactNode): RouteObject => ({
  path,
  element: <RequirePermission permission={permission}>{load(element)}</RequirePermission>,
});

// Only implemented pages are routable; there are no placeholders for future modules.
export const routes: RouteObject[] = [
  {
    element: load(<PublicSiteLayout />),
    children: [
      { path: '/', element: load(<PublicHomePage />) },
      { path: '/solutions', element: load(<SolutionsPage />) },
      { path: '/solutions/:slug', element: load(<SolutionDetailPage />) },
      { path: '/custom-solutions', element: load(<CustomSolutionsPage />) },
      { path: '/custom-solutions/request', element: load(<InquiryPage />) },
      { path: '/solutions/*', element: load(<PublicNotFound />) },
    ],
  },
  // "Create your clinic workspace": registration (or straight to onboarding when signed in).
  { path: '/start', element: load(<StartPage />) },
  { path: '/status', element: load(<StatusPage />) },
  // Links from emails: they work signed in or out.
  { path: '/forgot-password', element: load(<ForgotPasswordPage />) },
  { path: '/reset-password', element: load(<ResetPasswordPage />) },
  { path: '/verify-email', element: load(<VerifyEmailPage />) },
  { path: '/invitations/accept', element: load(<AcceptInvitationPage />) },
  {
    element: <PublicOnly />,
    children: [
      { path: '/login', element: load(<LoginPage />) },
      { path: '/register', element: load(<RegisterPage />) },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      { path: '/onboarding', element: load(<OnboardingPage />) },
      { path: '/app', element: <WorkspaceRedirect /> },
      {
        path: '/app/:orgId',
        element: load(<AppShell />),
        children: [
          { index: true, element: load(<HomePage />) },
          guarded('appointments', 'appointment.read', <AppointmentsPage />),
          guarded('appointments/new', 'appointment.book', <BookAppointmentPage />),
          guarded('appointments/:appointmentId', 'appointment.read', <AppointmentDetailPage />),
          guarded('appointments/:appointmentId/reschedule', 'appointment.book', <RescheduleAppointmentPage />),
          guarded('appointments/:appointmentId/record', 'clinical.encounter.own', <EncounterPage />),
          guarded('records/:encounterId', 'clinical.encounter.own', <RecordPage />),
          guarded('coverage', 'clinical.encounter.own', <CoveragePage />),
          guarded('coverage/:coverageId', 'clinical.encounter.own', <CoverageRecordsPage />),
          guarded('clinical-audit', 'clinical.audit.read', <ClinicalAuditPage />),
          guarded('finance', 'finance.account.read', <FinancePage />),
          guarded('finance/services', 'finance.catalog.read', <ServicesPage />),
          guarded('finance/patients/:patientId', 'finance.account.read', <PatientAccountPage />),
          guarded('finance/invoices/:invoiceId', 'finance.account.read', <InvoicePage />),
          guarded('finance/invoices/:invoiceId/print', 'finance.account.read', <InvoicePrintPage />),
          guarded('finance/payments/:paymentId/print', 'finance.account.read', <ReceiptPrintPage />),
          guarded('queue', 'queue.read', <QueuePage />),
          guarded('patients', 'patient.list', <PatientsPage />),
          guarded('patients/:patientId', 'patient.read', <PatientDetailPage />),
          guarded('practitioners', 'practitioner.read', <PractitionersPage />),
          guarded('practitioners/:practitionerId', 'practitioner.read', <PractitionerDetailPage />),
          { path: 'branches', element: load(<BranchesPage />) },
          guarded('team', 'member.read', <TeamPage />),
          guarded('settings', 'organization.update', <SettingsPage />),
          guarded('subscription', 'subscription.read', <SubscriptionPage />),
          guarded('support', 'support.request', <SupportPage />),
          guarded('support/:requestId', 'support.request', <SupportRequestPage />),
          guarded('subscription/checkout/:checkoutId', 'subscription.manage', <SimulatorCheckoutPage />),
          { path: 'profile', element: load(<ProfilePage />) },
          { path: '*', element: load(<NotFoundInShell />) },
        ],
      },
    ],
  },
  {
    path: '/operator',
    element: load(<OperatorRoot />),
    children: [
      { index: true, element: load(<OperatorOverviewPage />) },
      { path: 'organizations', element: load(<OperatorOrganizationsPage />) },
      { path: 'organizations/:orgId', element: load(<OperatorOrganizationPage />) },
      { path: 'plans', element: load(<OperatorPlansPage />) },
      { path: 'inquiries', element: load(<OperatorInquiriesPage />) },
      { path: 'inquiries/:reference', element: load(<OperatorInquiryPage />) },
      { path: 'operators', element: load(<OperatorOperatorsPage />) },
      { path: 'audit', element: load(<OperatorAuditPage />) },
      { path: 'support', element: load(<OperatorSupportPage />) },
      { path: 'support/:reference', element: load(<OperatorSupportRequestPage />) },
      { path: 'dev-mail', element: load(<OperatorDevMailPage />) },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
