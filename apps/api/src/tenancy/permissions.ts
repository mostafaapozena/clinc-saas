/**
 * The single source of truth for authorization. Routes ask for a permission, never a role.
 * Only implemented actions appear here. Clinical permissions (phase 5) are necessary but never
 * sufficient: clinical access also requires the treating relationship checked in
 * modules/clinical/clinical-access.ts (docs/architecture/CLINICAL.md).
 */
export const ROLES = ['owner', 'admin', 'doctor', 'receptionist', 'accountant', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** Owner status cannot be granted through ordinary membership changes (no ownership transfer yet). */
export const ASSIGNABLE_ROLES: readonly Role[] = ['admin', 'doctor', 'receptionist', 'accountant', 'viewer'];

/** These roles always have organization-wide branch access. */
export const ORG_WIDE_ROLES: readonly Role[] = ['owner', 'admin'];

const EVERYONE = ROLES;
const FRONT_DESK = ['owner', 'admin', 'receptionist'] as const;
/** Who works with clinic money (milestone 3). Accountants see patients' identity, never clinical text. */
const FINANCE_DESK = ['owner', 'admin', 'receptionist', 'accountant'] as const;

export const PERMISSION_MATRIX = {
  'organization.read': EVERYONE,
  'organization.update': ['owner'],
  'branch.read': EVERYONE,
  'branch.create': ['owner', 'admin'],
  'branch.update': ['owner', 'admin'],
  'member.read': ['owner', 'admin'],
  'member.add': ['owner', 'admin'],
  'member.update': ['owner', 'admin'],
  // Phase 3 — front desk. Record-level limits come from RECORD_VISIBILITY below.
  'dashboard.read': EVERYONE,
  'patient.list': [...FRONT_DESK, 'accountant'],
  'patient.read': ['owner', 'admin', 'receptionist', 'doctor', 'accountant'],
  'patient.create': FRONT_DESK,
  'patient.update': FRONT_DESK,
  'patient.registration.manage': FRONT_DESK,
  'practitioner.read': ['owner', 'admin', 'receptionist', 'doctor'],
  'practitioner.manage': ['owner', 'admin'],
  'appointment.read': ['owner', 'admin', 'receptionist', 'doctor', 'accountant'],
  'appointment.book': FRONT_DESK,
  'appointment.front_desk': FRONT_DESK,
  'appointment.visit': ['owner', 'admin', 'doctor'],
  'queue.read': ['owner', 'admin', 'receptionist', 'doctor'],
  // Phase 5 — clinical visit records. Only the treating doctor's own records (relationship
  // checked per record); owners/admins administer the organization but read no clinical text.
  'clinical.encounter.own': ['doctor'],
  // Operational documentation status of an appointment ("none" / "draft" / "finalized"), no text.
  'clinical.documentation_status.read': ['owner', 'admin', 'doctor'],
  // Clinical coverage (milestone 1): a treating doctor shares their own records with a colleague.
  'clinical.coverage.grant': ['doctor'],
  // Granted only through membership capabilities (CAPABILITY_PERMISSIONS), never by role alone.
  'clinical.coverage.lead': [],
  'clinical.audit.read': [],
  // Milestone 3 — clinic finances (separate from clinical permissions and from platform billing).
  'finance.settings.manage': ['owner'],
  'finance.catalog.read': [...FINANCE_DESK, 'doctor'],
  'finance.catalog.manage': ['owner', 'admin'],
  'finance.charge.create': FINANCE_DESK,
  // A doctor charges procedures / plan items of their own records (explicit confirmation).
  'finance.charge.clinical': ['doctor'],
  'finance.invoice.manage': FINANCE_DESK,
  'finance.payment.record': FINANCE_DESK,
  'finance.discount.apply': ['owner', 'admin', 'accountant'],
  'finance.adjustment.manage': ['owner', 'admin', 'accountant'],
  'finance.account.read': FINANCE_DESK,
  'finance.report.read': ['owner', 'admin', 'accountant'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSION_MATRIX;
export const PERMISSIONS = Object.keys(PERMISSION_MATRIX) as Permission[];

/**
 * Capabilities are explicit, per-membership grants on top of the role (docs/architecture/CLINICAL.md):
 * - `clinical_audit`: read the metadata-only clinical audit log (assigned by an owner);
 * - `clinical_lead`: grant coverage for an unavailable doctor's records. Switched off until the
 *   owner decides who may hold it (CLINICAL_LEAD_GRANTS_ENABLED, blocker B1).
 */
export const CAPABILITIES = ['clinical_audit', 'clinical_lead'] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_PERMISSIONS: Record<Capability, readonly Permission[]> = {
  clinical_audit: ['clinical.audit.read'],
  clinical_lead: ['clinical.coverage.lead'],
};

/** Roles that may hold each capability; a role change drops capabilities that no longer fit. */
export const CAPABILITY_ROLES: Record<Capability, readonly Role[]> = {
  clinical_audit: ['owner', 'admin', 'doctor'],
  clinical_lead: ['doctor'],
};

export function capabilityAllowed(capability: Capability, role: Role): boolean {
  return CAPABILITY_ROLES[capability].includes(role);
}

/** Role permissions plus those of the membership's (still eligible) capabilities. */
export function can(role: Role, capabilities: readonly Capability[], permission: Permission): boolean {
  if (hasPermission(role, permission)) return true;
  return capabilities.some((c) => capabilityAllowed(c, role) && CAPABILITY_PERMISSIONS[c].includes(permission));
}

export function effectivePermissions(role: Role, capabilities: readonly Capability[]): Permission[] {
  return PERMISSIONS.filter((permission) => can(role, capabilities, permission));
}

/**
 * Which identifiable patient/appointment records a role may see, on top of its branch scope:
 * - `scope`: every record in the caller's authorized branches;
 * - `own_practitioner`: only appointments of the caller's own practitioner profile, and the
 *   patients linked to them;
 * - `none`: aggregate counts only.
 */
export type RecordVisibility = 'scope' | 'own_practitioner' | 'none';

const RECORD_VISIBILITY: Record<Role, RecordVisibility> = {
  owner: 'scope',
  admin: 'scope',
  receptionist: 'scope',
  accountant: 'scope',
  doctor: 'own_practitioner',
  viewer: 'none',
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return (PERMISSION_MATRIX[permission] as readonly Role[]).includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return PERMISSIONS.filter((permission) => hasPermission(role, permission));
}

export function isOrgWideRole(role: Role): boolean {
  return ORG_WIDE_ROLES.includes(role);
}

export function recordVisibility(role: Role): RecordVisibility {
  return RECORD_VISIBILITY[role];
}
