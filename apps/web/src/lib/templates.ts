// Specialty templates (mirrors apps/api/src/modules/clinical/templates.ts; the API validates).
// The editor supports the template versions listed in EDITABLE; a record made with any other
// version is shown read-only, never rewritten with a newer shape.

export type TemplateId = 'dentistry.visit' | 'physiotherapy.assessment' | 'physiotherapy.session' | 'physiotherapy.discharge' | 'ent.visit';
export type SpecialtyRecord = { template: TemplateId | string; version: number; data: Record<string, unknown> };
export const EDITABLE: Record<TemplateId, number> = {
  'dentistry.visit': 1,
  'physiotherapy.assessment': 1,
  'physiotherapy.session': 1,
  'physiotherapy.discharge': 1,
  'ent.visit': 1,
};
export const isEditable = (s: SpecialtyRecord) => EDITABLE[s.template as TemplateId] === s.version;

/** A stable id for a list item (later records may refer to it). */
export const newItemId = () => crypto.randomUUID();

// Dentistry — FDI two-digit notation. Rows as seen facing the patient: their right on the left.
export const PERMANENT_ROWS = {
  upper: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  lower: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
};
export const PRIMARY_ROWS = {
  upper: [55, 54, 53, 52, 51, 61, 62, 63, 64, 65],
  lower: [85, 84, 83, 82, 81, 71, 72, 73, 74, 75],
};
export const SURFACES = ['M', 'O', 'D', 'B', 'L'] as const;
export type Surface = (typeof SURFACES)[number];
export const PLAN_STATUSES = ['in_progress', 'done', 'cancelled'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export type DentalFinding = { id: string; tooth: string; surfaces: Surface[]; note: string };
export type DentalItem = { id: string; tooth: string | null; description: string };
export type PlanUpdate = { itemId: string; sourceEncounterId: string; status: PlanStatus; note: string };
export type DentistryData = {
  dentition: 'permanent' | 'primary' | 'mixed';
  findings: DentalFinding[];
  procedures: DentalItem[];
  planItems: DentalItem[];
  planUpdates: PlanUpdate[];
};

export type Goal = { id: string; text: string };
export type GoalNote = { goalId: string; note: string };
export type PhysioAssessmentData = { limitations: string; goals: Goal[]; plannedSessions: number | null; frequency: string; courseNotes: string };
export type PhysioSessionData = { courseEncounterId: string | null; performed: string; progress: string; goalNotes: GoalNote[] };
export type PhysioDischargeData = { courseEncounterId: string | null; summary: string; goalNotes: GoalNote[] };

export const ENT_HISTORY = ['ear', 'nose', 'throat'] as const;
export const ENT_EXAMINATION = ['rightEar', 'leftEar', 'nose', 'throat', 'neck'] as const;
export type EntData = {
  history: Record<(typeof ENT_HISTORY)[number], string>;
  examination: Record<(typeof ENT_EXAMINATION)[number], string>;
  followUp: string;
};

/** Missing keys filled like the API's defaults (data from the API is already complete). */
export function withDefaults(template: string, data: Record<string, unknown>): Record<string, unknown> {
  switch (template) {
    case 'dentistry.visit':
      return { dentition: 'permanent', findings: [], procedures: [], planItems: [], planUpdates: [], ...data };
    case 'physiotherapy.assessment':
      return { limitations: '', goals: [], plannedSessions: null, frequency: '', courseNotes: '', ...data };
    case 'physiotherapy.session':
      return { courseEncounterId: null, performed: '', progress: '', goalNotes: [], ...data };
    case 'physiotherapy.discharge':
      return { courseEncounterId: null, summary: '', goalNotes: [], ...data };
    case 'ent.visit':
      return {
        history: { ear: '', nose: '', throat: '' },
        examination: { rightEar: '', leftEar: '', nose: '', throat: '', neck: '' },
        followUp: '',
        ...data,
      };
    default:
      return data;
  }
}

// Derived views from the API (finalized records only).
export type DentalChart = {
  teeth: { tooth: string; entries: { kind: 'finding' | 'procedure'; encounterId: string; date: string; surfaces: string[]; text: string }[] }[];
  planItems: { id: string; sourceEncounterId: string; tooth: string | null; description: string; recordedAt: string; status: 'planned' | PlanStatus; history: { status: PlanStatus; note: string; encounterId: string; at: string }[] }[];
  records: { id: string; date: string; own: boolean }[];
  drafts: number;
};
export type PhysioCourse = {
  assessmentId: string;
  practitioner: string;
  own: boolean;
  startedAt: string;
  plannedSessions: number | null;
  frequency: string;
  goals: Goal[];
  sessions: { id: string; date: string }[];
  completedSessions: number;
  discharge: { id: string; date: string } | null;
  upcomingAppointments: number | null;
};
export type SpecialtySummary = {
  scope: 'own' | 'organization';
  since: string;
  byTemplate: { template: TemplateId | null; finalized: number; draft: number }[];
  own?: { openPlanItems: number; activeCourses: number };
};
