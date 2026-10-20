export type Language = 'ar' | 'en';
export type Role = 'owner' | 'admin' | 'doctor' | 'receptionist' | 'viewer';
export type Permission =
  | 'organization.read'
  | 'organization.update'
  | 'branch.read'
  | 'branch.create'
  | 'branch.update'
  | 'member.read'
  | 'member.add'
  | 'member.update';

export const ASSIGNABLE_ROLES: Role[] = ['admin', 'doctor', 'receptionist', 'viewer'];
export const ORG_WIDE_ROLES: Role[] = ['owner', 'admin'];

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

export type OrgDetail = {
  organization: { id: string; name: string; createdAt: string };
  membership: { id: string; role: Role; branchScope: BranchScope; permissions: Permission[] };
  stats: { accessibleBranches: number; activeMembers?: number };
};

export type Branch = {
  id: string;
  name: string;
  city: string;
  status: 'active' | 'inactive';
  createdAt: string;
};

export type Member = {
  id: string;
  user: { id: string; displayName: string; email: string } | null;
  role: Role;
  status: 'active' | 'suspended';
  branchScope: BranchScope;
  isSelf: boolean;
  createdAt: string;
};
