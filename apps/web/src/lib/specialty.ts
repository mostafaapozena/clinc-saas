import { useQuery } from '@tanstack/react-query';
import { orgKeys, useOrg } from '../org/context';
import { api } from './api';
import { CLINICAL_QUERY } from './clinical';
import type { DentalChart, PhysioCourse, SpecialtySummary } from './templates';

/** The dental chart and plan from finalized visits the caller may read (own or covered). */
export function useDentalChart(patientId: string, enabled = true) {
  const { orgId, can } = useOrg();
  return useQuery({
    queryKey: orgKeys.dentalChart(orgId, patientId),
    queryFn: ({ signal }) => api<DentalChart>(`/orgs/${orgId}/patients/${patientId}/dental-chart`, { signal }),
    enabled: enabled && can('clinical.encounter.own'),
    ...CLINICAL_QUERY,
  });
}

/** Physiotherapy courses (assessment, sessions, discharge) the caller may read. */
export function usePhysioCourses(patientId: string, enabled = true) {
  const { orgId, can } = useOrg();
  return useQuery({
    queryKey: orgKeys.physioCourses(orgId, patientId),
    queryFn: ({ signal }) => api<{ courses: PhysioCourse[]; drafts: number }>(`/orgs/${orgId}/patients/${patientId}/physio-courses`, { signal }),
    enabled: enabled && can('clinical.encounter.own'),
    ...CLINICAL_QUERY,
  });
}

/** Documentation counts (no clinical text): own for doctors, organization-wide for owners/admins. */
export function useSpecialtySummary() {
  const { orgId, can } = useOrg();
  return useQuery({
    queryKey: orgKeys.specialtySummary(orgId),
    queryFn: ({ signal }) => api<SpecialtySummary>(`/orgs/${orgId}/clinical/specialty-summary`, { signal }),
    enabled: can('clinical.documentation_status.read'),
  });
}
