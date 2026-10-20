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
  /** The organization's IANA time zone, or null until an owner sets it. */
  timeZone: string | null;
};

export const OrgContext = createContext<OrgContextValue | null>(null);

export function useOrg(): OrgContextValue {
  const value = useContext(OrgContext);
  if (!value) throw new Error('useOrg must be used inside the organization shell');
  return value;
}

/** The selected branch as a filter value (undefined = all accessible branches). */
export function useBranchFilter(): string | undefined {
  const { selectedBranchId } = useOrg();
  return selectedBranchId && selectedBranchId !== 'all' ? selectedBranchId : undefined;
}

/**
 * Every organization-scoped cache entry starts with ['org', orgId] so it can be dropped on
 * switch; branch-dependent entries also carry the branch, so a branch switch never shows
 * another branch's cached data.
 */
export const orgKeys = {
  all: (orgId: string) => ['org', orgId] as const,
  detail: (orgId: string) => ['org', orgId, 'detail'] as const,
  branches: (orgId: string, query = '') => ['org', orgId, 'branches', query] as const,
  members: (orgId: string) => ['org', orgId, 'members'] as const,
  dashboard: (orgId: string, branch = 'all') => ['org', orgId, 'dashboard', branch] as const,
  patients: (orgId: string, params: object = {}) => ['org', orgId, 'patients', params] as const,
  patient: (orgId: string, id: string) => ['org', orgId, 'patient', id] as const,
  patientAppointments: (orgId: string, id: string, params: object) => ['org', orgId, 'patient', id, 'appointments', params] as const,
  practitioners: (orgId: string, params: object = {}) => ['org', orgId, 'practitioners', params] as const,
  practitioner: (orgId: string, id: string) => ['org', orgId, 'practitioner', id] as const,
  exceptions: (orgId: string, id: string) => ['org', orgId, 'practitioner', id, 'exceptions'] as const,
  candidates: (orgId: string) => ['org', orgId, 'practitioner-candidates'] as const,
  appointments: (orgId: string, params: object) => ['org', orgId, 'appointments', params] as const,
  appointment: (orgId: string, id: string) => ['org', orgId, 'appointment', id] as const,
  availability: (orgId: string, params: object) => ['org', orgId, 'availability', params] as const,
  queue: (orgId: string, params: object) => ['org', orgId, 'queue', params] as const,
};
