import { createContext, useContext } from 'react';
import type { Branch, OrgDetail, Permission } from '../lib/types';

export type OrgContextValue = {
  orgId: string;
  detail: OrgDetail;
  can: (permission: Permission) => boolean;
  branches: Branch[];
  /** A branch id, or 'all' for organization-wide views (only offered to org-wide scopes). */
  selectedBranchId: string;
  selectBranch: (branchId: string) => void;
};

export const OrgContext = createContext<OrgContextValue | null>(null);

export function useOrg(): OrgContextValue {
  const value = useContext(OrgContext);
  if (!value) throw new Error('useOrg must be used inside the organization shell');
  return value;
}

/** Every organization-scoped cache entry starts with ['org', orgId] so it can be dropped on switch. */
export const orgKeys = {
  all: (orgId: string) => ['org', orgId] as const,
  detail: (orgId: string) => ['org', orgId, 'detail'] as const,
  branches: (orgId: string, query = '') => ['org', orgId, 'branches', query] as const,
  members: (orgId: string) => ['org', orgId, 'members'] as const,
};
