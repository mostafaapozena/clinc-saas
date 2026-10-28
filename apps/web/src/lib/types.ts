export type Language = 'ar' | 'en';
export type Role = 'owner' | 'admin' | 'doctor' | 'receptionist' | 'accountant' | 'viewer';
export type Permission =
  | 'organization.read'
  | 'organization.update'
  | 'branch.read'
  | 'branch.create'
  | 'branch.update'
  | 'member.read'
  | 'member.add'
  | 'member.update'
  | 'dashboard.read'
  | 'patient.list'
  | 'patient.read'
  | 'patient.create'
  | 'patient.update'
  | 'patient.registration.manage'
  | 'practitioner.read'
  | 'practitioner.manage'
  | 'appointment.read'
  | 'appointment.book'
  | 'appointment.front_desk'
  | 'appointment.visit'
  | 'queue.read'
  | 'clinical.encounter.own'
  | 'clinical.documentation_status.read'
  | 'clinical.coverage.grant'
  | 'clinical.coverage.lead'
  | 'clinical.audit.read'
  | 'finance.settings.manage'
  | 'finance.catalog.read'
  | 'finance.catalog.manage'
  | 'finance.charge.create'
  | 'finance.charge.clinical'
  | 'finance.invoice.manage'
  | 'finance.payment.record'
  | 'finance.discount.apply'
  | 'finance.adjustment.manage'
  | 'finance.account.read'
  | 'finance.report.read';

/** Explicit per-membership grants on top of the role (assigned by owners). */
export type Capability = 'clinical_audit' | 'clinical_lead';

export const ASSIGNABLE_ROLES: Role[] = ['admin', 'doctor', 'receptionist', 'accountant', 'viewer'];
export const ORG_WIDE_ROLES: Role[] = ['owner', 'admin'];

/** Mirrors the API's supported list; the API validates independently. */
export const TIME_ZONES = [
  'Africa/Cairo',
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Kuwait',
  'Asia/Qatar',
  'Asia/Bahrain',
  'Asia/Muscat',
  'Asia/Amman',
] as const;
export const DEFAULT_TIME_ZONE = 'Africa/Cairo';

export const PHONE_COUNTRIES = ['EG', 'SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'JO'] as const;
export type PhoneCountry = (typeof PHONE_COUNTRIES)[number];

export type User = {
  id: string;
  email: string;
  displayName: string;
  preferredLanguage: Language;
  emailVerified: boolean;
};

export type MembershipSummary = { organization: { id: string; name: string }; role: Role };

export type SessionData = { user: User; csrfToken: string; memberships: MembershipSummary[] };

export type BranchScope = { type: 'all' | 'selected'; branchIds: string[] };

export const ORGANIZATION_TYPES = ['clinic', 'medical_center', 'multi_branch'] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export type Organization = {
  id: string;
  name: string;
  timeZone: string | null;
  /** null / [] for organizations created before phase 4 until the owner completes the setup. */
  type: OrganizationType | null;
  specialtyCodes: string[];
  configVersion: number;
  createdAt: string;
};

export type OrgDetail = {
  organization: Organization;
  membership: {
    id: string;
    role: Role;
    branchScope: BranchScope;
    permissions: Permission[];
    capabilities: Capability[];
    practitionerId: string | null;
  };
  stats: { accessibleBranches: number; activeMembers?: number };
};

export type Branch = {
  id: string;
  name: string;
  city: string;
  status: 'active' | 'inactive';
  /** Specialties offered here (a subset of the organization's); [] before the setup. */
  specialtyCodes: string[];
  createdAt: string;
};

export const ONBOARDING_STEPS = ['organization', 'specialties', 'branch', 'review'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export type OnboardingData = {
  organizationType: OrganizationType | null;
  name: string;
  timeZone: string | null;
  specialtyCodes: string[];
  branch: { name: string; city: string; specialtyCodes: string[] };
};

export type OnboardingDraft = {
  id: string;
  status: 'draft' | 'completed';
  step: OnboardingStep;
  data: OnboardingData;
  organizationId: string | null;
  version: number;
  updatedAt: string;
};

export type Member = {
  id: string;
  user: { id: string; displayName: string; email: string } | null;
  role: Role;
  status: 'active' | 'suspended';
  branchScope: BranchScope;
  capabilities: Capability[];
  isSelf: boolean;
  createdAt: string;
};

export type Phone = { country: PhoneCountry; e164: string };
export type Sex = 'female' | 'male' | 'unspecified';

export type Registration = {
  branchId: string;
  status: 'active' | 'archived';
  registeredAt: string;
  archivedAt: string | null;
};

export type PatientSummary = {
  id: string;
  patientNumber: number;
  fullName: string;
  phone: Phone;
  registrations: Registration[];
};

export type Patient = PatientSummary & {
  secondaryPhone: Phone | null;
  email: string | null;
  dateOfBirth: string | null;
  sex: Sex;
  address: { line: string; city: string } | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type Page<T> = { data: T[]; page: number; pageSize: number; total: number };

export type WeeklyInterval = { branchId: string; weekday: number; start: string; end: string };

export type Practitioner = {
  id: string;
  membershipId: string;
  displayName: string;
  specialtyCode: string;
  status: 'active' | 'inactive';
  branchIds: string[];
  defaultDurationMinutes: number;
  weeklySchedule: WeeklyInterval[];
  version: number;
};

export type ScheduleException = {
  id: string;
  date: string;
  branchId: string | null;
  kind: 'closed' | 'hours';
  intervals: { start: string; end: string }[];
};

export type AppointmentStatus = 'scheduled' | 'checked_in' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
export const APPOINTMENT_STATUSES: AppointmentStatus[] = ['scheduled', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'];
export type AppointmentType = 'new_visit' | 'follow_up';
export type StatusAction = 'check_in' | 'start' | 'complete' | 'cancel' | 'no_show';

export type Appointment = {
  id: string;
  branchId: string;
  patient: { id: string; patientNumber: number; fullName: string; phone: string } | null;
  practitioner: { id: string; displayName: string } | null;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  type: AppointmentType;
  status: AppointmentStatus;
  cancellationReason: string | null;
  checkedInAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  noShowAt: string | null;
  version: number;
  createdAt: string;
  /** Visit-record status, only for roles allowed to see it (never clinical text). */
  documentation?: 'none' | 'draft' | 'finalized';
};

/** A conflicting appointment named in an error's details. */
export type AppointmentRef = { id: string; branchId: string; startAt: string; endAt: string; status: AppointmentStatus };

export type Slot = {
  startAt: string;
  endAt: string;
  localDate: string;
  localTime: string;
  utcOffsetMinutes: number;
  repeatedTime: boolean;
};

export type DashboardCounts = {
  scheduled: number;
  waiting: number;
  inProgress: number;
  completed: number;
  noShow: number;
  cancelled: number;
};
