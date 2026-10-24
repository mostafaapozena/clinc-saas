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

export type Addendum = { id: string; reason: string; content: string; createdAt: string };

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

export const sameSections =(a: Sections, b: Sections) => ENCOUNTER_SECTIONS.every((s) => a[s] === b[s]);
