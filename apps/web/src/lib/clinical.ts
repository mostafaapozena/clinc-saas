// Clinical visit records (docs/architecture/CLINICAL.md). Clinical text lives only in memory:
// never in browser storage, URLs, document titles or logs. Clinical queries are dropped from the
// cache as soon as no page shows them, and the whole cache is cleared on sign-out.

import { useOrg } from '../org/context';
import type { Appointment, AppointmentStatus } from './types';

export const ENCOUNTER_SECTIONS = ['reason', 'history', 'examination', 'assessment', 'plan'] as const;
export type EncounterSection = (typeof ENCOUNTER_SECTIONS)[number];
export type Sections = Record<EncounterSection, string>;
export const SECTION_MAX = 4000;

export type DocumentationStatus = 'none' | 'draft' | 'finalized';

export type Addendum = {
  id: string;
  reason: string;
  content: string;
  /** A covering doctor adds addenda under their own name. */
  author: { practitionerId: string; displayName: string };
  createdAt: string;
};

export type Encounter = {
  id: string;
  appointmentId: string;
  patientId: string;
  branchId: string;
  author: { practitionerId: string; displayName: string };
  status: 'draft' | 'finalized';
  sections: Sections;
  version: number;
  lateEntry: { reason: string } | null;
  createdAt: string;
  lastEditedAt: string;
  finalizedAt: string | null;
  addenda: Addendum[];
};

export type EncounterView = {
  encounter: Encounter | null;
  appointmentStatus: AppointmentStatus;
  canStart: boolean;
  lateEntryRequired: boolean;
};

export type ClinicalHistoryItem = {
  id: string;
  appointmentId: string;
  appointmentStartAt: string | null;
  status: 'draft' | 'finalized';
  reason: string;
  lateEntry: boolean;
  finalizedAt: string | null;
  addendaCount: number;
  /** Written by another doctor, visible through coverage. */
  covered?: boolean;
};

/** For every clinical query: nothing kept once unused, no background refetch over an open editor. */
export const CLINICAL_QUERY = { gcTime: 0, staleTime: 0, refetchOnWindowFocus: false } as const;

/** A fresh Idempotency-Key; reused only to retry the very same request. */
export const newRequestKey = () => crypto.randomUUID();

/** Whether the signed-in doctor is this appointment's treating practitioner (the API re-checks). */
export function useIsTreating(appointment: Pick<Appointment, 'practitioner'>): boolean {
  const { can, detail } = useOrg();
  const own = detail.membership.practitionerId;
  return can('clinical.encounter.own') && Boolean(own) && appointment.practitioner?.id === own;
}

export const sameSections = (a: Sections, b: Sections) => ENCOUNTER_SECTIONS.every((s) => a[s] === b[s]);

// Clinical coverage (docs/architecture/CLINICAL.md#clinical-coverage).
export type CoverageAccess = 'read' | 'author';
export type CoverageStatus = 'active' | 'scheduled' | 'expired' | 'revoked';
export type PatientRef = { id: string; fullName: string; patientNumber: number };

export type Coverage = {
  id: string;
  source: { practitionerId: string; displayName: string };
  grantee: { practitionerId: string; displayName: string };
  scope: { type: 'patient' | 'encounter'; encounterId: string | null; patient: PatientRef | null };
  access: CoverageAccess;
  reason: string;
  grantedVia: 'author' | 'clinical_lead';
  grantedByMe: boolean;
  status: CoverageStatus;
  startsAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
};

/** A record opened by id: own, or through coverage (read-only unless addenda are allowed). */
export type RecordView = {
  encounter: Encounter;
  access: 'own' | CoverageAccess;
  canAddAddendum: boolean;
  context: { patient: PatientRef | null; appointment: { id: string; startAt: string; status: AppointmentStatus } | null };
};

export type CoveredRecord = Omit<ClinicalHistoryItem, 'appointmentId'>;

export type ClinicalAuditEntry = {
  id: string;
  action: string;
  actor: { displayName: string; role: string };
  createdAt: string;
  encounterId: string | null;
  appointmentId: string | null;
  patientNumber: number | null;
  metadata: Record<string, unknown>;
};

/** Longest coverage the API accepts (days). */
export const MAX_COVERAGE_DAYS = 90;
