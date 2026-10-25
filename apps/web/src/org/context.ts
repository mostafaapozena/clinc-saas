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
  /** The organization's enabled specialties ([] until an owner completes the setup). */
  specialties: string[];
  /** Specialties that can be chosen as a view filter for the selected branch. */
  specialtyOptions: string[];
  /** 'all' or a specialty code. A view filter: the API only ever narrows by it. */
  selectedSpecialty: string;
  selectSpecialty: (code: string) => void;
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

/** The selected specialty as a filter value (undefined = all specialties). */
export function useSpecialtyFilter(): string | undefined {
  const { selectedSpecialty } = useOrg();
  return selectedSpecialty && selectedSpecialty !== 'all' ? selectedSpecialty : undefined;
}

/**
 * Every organization-scoped cache entry starts with ['org', orgId] so it can be dropped on
 * switch; branch- and specialty-dependent entries also carry them (inside their params), so a
 * switch never shows another branch's or specialty's cached data.
 */
export const orgKeys = {
  all: (orgId: string) => ['org', orgId] as const,
  detail: (orgId: string) => ['org', orgId, 'detail'] as const,
  branches: (orgId: string, query = '') => ['org', orgId, 'branches', query] as const,
  members: (orgId: string) => ['org', orgId, 'members'] as const,
  dashboard: (orgId: string, branch = 'all', specialty = 'all') => ['org', orgId, 'dashboard', branch, specialty] as const,
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
  // Clinical entries: always used with CLINICAL_QUERY (lib/clinical.ts), so they are not kept.
  clinical: (orgId: string) => ['org', orgId, 'clinical'] as const,
  encounter: (orgId: string, appointmentId: string) => ['org', orgId, 'clinical', 'encounter', appointmentId] as const,
  clinicalHistory: (orgId: string, patientId: string) => ['org', orgId, 'clinical', 'history', patientId] as const,
  record: (orgId: string, encounterId: string) => ['org', orgId, 'clinical', 'record', encounterId] as const,
  coverage: (orgId: string) => ['org', orgId, 'clinical', 'coverage'] as const,
  coverageRecords: (orgId: string, coverageId: string) => ['org', orgId, 'clinical', 'coverage', coverageId] as const,
  coverageCandidates: (orgId: string) => ['org', orgId, 'clinical', 'coverage-candidates'] as const,
  clinicalAudit: (orgId: string, params: object) => ['org', orgId, 'clinical', 'audit', params] as const,
  dentalChart: (orgId: string, patientId: string) => ['org', orgId, 'clinical', 'dental-chart', patientId] as const,
  physioCourses: (orgId: string, patientId: string) => ['org', orgId, 'clinical', 'physio-courses', patientId] as const,
  specialtySummary: (orgId: string) => ['org', orgId, 'specialty-summary'] as const,
};
