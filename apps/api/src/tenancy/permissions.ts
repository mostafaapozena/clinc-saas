/**
 * The single source of truth for authorization. Routes ask for a permission, never a role.
 * Only implemented actions appear here — no clinical permissions until those modules exist.
 */
export const ROLES = ['owner', 'admin', 'doctor', 'receptionist', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** Owner status cannot be granted through ordinary membership changes (no ownership transfer yet). */
export const ASSIGNABLE_ROLES: readonly Role[] = ['admin', 'doctor', 'receptionist', 'viewer'];

/** These roles always have organization-wide branch access. */
export const ORG_WIDE_ROLES: readonly Role[] = ['owner', 'admin'];

const EVERYONE = ROLES;

export const PERMISSION_MATRIX = {
  'organization.read': EVERYONE,
  'organization.update': ['owner'],
  'branch.read': EVERYONE,
  'branch.create': ['owner', 'admin'],
  'branch.update': ['owner', 'admin'],
  'member.read': ['owner', 'admin'],
  'member.add': ['owner', 'admin'],
  'member.update': ['owner', 'admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSION_MATRIX;
export const PERMISSIONS = Object.keys(PERMISSION_MATRIX) as Permission[];

export function hasPermission(role: Role, permission: Permission): boolean {
  return (PERMISSION_MATRIX[permission] as readonly Role[]).includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return PERMISSIONS.filter((permission) => hasPermission(role, permission));
}

export function isOrgWideRole(role: Role): boolean {
  return ORG_WIDE_ROLES.includes(role);
}
