/**
 * The single source of truth for authorization. Routes ask for a permission, never a role.
 * Only implemented actions appear here. Clinical permissions (phase 5) are necessary but never
 * sufficient: clinical access also requires the treating relationship checked in
 * modules/clinical/clinical-access.ts (docs/architecture/CLINICAL.md).
 */
export const ROLES = ['owner', 'admin', 'doctor', 'receptionist', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** Owner status cannot be granted through ordinary membership changes (no ownership transfer yet). */
export const ASSIGNABLE_ROLES: readonly Role[] = ['admin', 'doctor', 'receptionist', 'viewer'];

/** These roles always have organization-wide branch access. */
export const ORG_WIDE_ROLES: readonly Role[] = ['owner', 'admin'];

const EVERYONE = ROLES;
const FRONT_DESK = ['owner', 'admin', 'receptionist'] as const;

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
  'patient.list': FRONT_DESK,
  'patient.read': ['owner', 'admin', 'receptionist', 'doctor'],
  'patient.create': FRONT_DESK,
  'patient.update': FRONT_DESK,
  'patient.registration.manage': FRONT_DESK,
  'practitioner.read': ['owner', 'admin', 'receptionist', 'doctor'],
  'practitioner.manage': ['owner', 'admin'],
  'appointment.read': ['owner', 'admin', 'receptionist', 'doctor'],
  'appointment.book': FRONT_DESK,
  'appointment.front_desk': FRONT_DESK,
  'appointment.visit': ['owner', 'admin', 'doctor'],
  'queue.read': ['owner', 'admin', 'receptionist', 'doctor'],
  // Phase 5 — clinical visit records. Only the treating doctor's own records (relationship
  // checked per record); owners/admins administer the organization but read no clinical text.
  'clinical.encounter.own': ['doctor'],
  // Operational documentation status of an appointment ("none" / "draft" / "finalized"), no text.
  'clinical.documentation_status.read': ['owner', 'admin', 'doctor'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSION_MATRIX;
export const PERMISSIONS = Object.keys(PERMISSION_MATRIX) as Permission[];

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
