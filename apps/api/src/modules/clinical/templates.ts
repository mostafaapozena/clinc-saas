import { z } from 'zod';

// Specialty templates for visit records (docs/architecture/SPECIALTY_WORKSPACES.md).
//
// A record stores the template id AND version it was created with, and its data is always read and
// validated with that exact version — a later version never reinterprets an older record. New
// versions are added next to old ones; versions are never edited once released.
//
// All content is entered by the clinician: no scores, suggestions, diagnoses or advice are
// generated. Templates are provisional, pending review by practising clinicians.

/** Plain text: line endings normalized, control characters dropped, trimmed. */
function stripControl(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code === 9 || code === 10 || (code >= 32 && code !== 127)) out += ch;
  }
  return out;
}
const text = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => stripControl(value.replace(/\r\n?/g, '\n')).trim());
/** Client-generated stable id for list items (so later records can refer to them). */
const itemId = z.string().regex(/^[A-Za-z0-9_-]{6,40}$/);
const objectId = z.string().regex(/^[a-f\d]{24}$/i);

// ---------------------------------------------------------------------------------------------
// Dentistry — FDI two-digit notation (ISO 3950): quadrant 1–4 permanent (teeth 1–8), 5–8 primary
// (teeth 1–5).
export const PERMANENT_TEETH = [1, 2, 3, 4].flatMap((q) => [1, 2, 3, 4, 5, 6, 7, 8].map((t) => `${q}${t}`));
export const PRIMARY_TEETH = [5, 6, 7, 8].flatMap((q) => [1, 2, 3, 4, 5].map((t) => `${q}${t}`));
export const TEETH = [...PERMANENT_TEETH, ...PRIMARY_TEETH] as [string, ...string[]];
/** Mesial, occlusal/incisal, distal, buccal/labial, lingual/palatal. */
export const SURFACES = ['M', 'O', 'D', 'B', 'L'] as const;
export const PLAN_STATUSES = ['in_progress', 'done', 'cancelled'] as const;

const dentistryVisitV1 = z.object({
  dentition: z.enum(['permanent', 'primary', 'mixed']).default('permanent'),
  findings: z
    .array(
      z.object({
        id: itemId,
        tooth: z.enum(TEETH),
        surfaces: z.array(z.enum(SURFACES)).max(SURFACES.length).default([]),
        note: text(500).pipe(z.string().min(1)),
      }),
    )
    .max(64)
    .default([]),
  procedures: z
    .array(z.object({ id: itemId, tooth: z.enum(TEETH).nullable().default(null), description: text(200).pipe(z.string().min(1)) }))
    .max(32)
    .default([]),
  /** New treatment-plan items recorded at this visit. */
  planItems: z
    .array(z.object({ id: itemId, tooth: z.enum(TEETH).nullable().default(null), description: text(200).pipe(z.string().min(1)) }))
    .max(32)
    .default([]),
  /** Status changes, at this visit, of plan items recorded at earlier (finalized) visits. */
  planUpdates: z
    .array(z.object({ itemId, sourceEncounterId: objectId, status: z.enum(PLAN_STATUSES), note: text(200).default('') }))
    .max(64)
    .default([]),
});

// ---------------------------------------------------------------------------------------------
// Physiotherapy — an initial assessment opens a treatment course; sessions and the discharge
// summary refer to it. Sessions are real appointments (each record belongs to one).
const goal = z.object({ id: itemId, text: text(300).pipe(z.string().min(1)) });
const goalNote = z.object({ goalId: itemId, note: text(300) });

const physioAssessmentV1 = z.object({
  limitations: text(2000).default(''),
  goals: z.array(goal).max(10).default([]),
  plannedSessions: z.number().int().min(1).max(60).nullable().default(null),
  frequency: text(200).default(''),
  courseNotes: text(1000).default(''),
});
const physioSessionV1 = z.object({
  courseEncounterId: objectId.nullable().default(null),
  performed: text(2000).default(''),
  progress: text(2000).default(''),
  goalNotes: z.array(goalNote).max(10).default([]),
});
const physioDischargeV1 = z.object({
  courseEncounterId: objectId.nullable().default(null),
  summary: text(2000).default(''),
  goalNotes: z.array(goalNote).max(10).default([]),
});

// ---------------------------------------------------------------------------------------------
// ENT — region-specific history and examination fields, plus follow-up instructions.
const entVisitV1 = z.object({
  history: z
    .object({ ear: text(1000).default(''), nose: text(1000).default(''), throat: text(1000).default('') })
    .default({ ear: '', nose: '', throat: '' }),
  examination: z
    .object({
      rightEar: text(1000).default(''),
      leftEar: text(1000).default(''),
      nose: text(1000).default(''),
      throat: text(1000).default(''),
      neck: text(1000).default(''),
    })
    .default({ rightEar: '', leftEar: '', nose: '', throat: '', neck: '' }),
  followUp: text(500).default(''),
});

type Problems = Record<string, string>;
type Template = {
  id: TemplateId;
  version: number;
  specialty: 'dentistry' | 'physiotherapy' | 'ent';
  schema: z.ZodType;
  /** Template-specific requirements for finalizing (on top of the general minimum). */
  finalizeProblems: (data: Record<string, unknown>) => Problems;
};

export const TEMPLATE_IDS = [
  'dentistry.visit',
  'physiotherapy.assessment',
  'physiotherapy.session',
  'physiotherapy.discharge',
  'ent.visit',
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

const none = (): Problems => ({});
const TEMPLATES: Template[] = [
  { id: 'dentistry.visit', version: 1, specialty: 'dentistry', schema: dentistryVisitV1, finalizeProblems: none },
  {
    id: 'physiotherapy.assessment',
    version: 1,
    specialty: 'physiotherapy',
    schema: physioAssessmentV1,
    finalizeProblems: (d): Problems => (d.plannedSessions == null ? { 'specialty.plannedSessions': 'required' } : {}),
  },
  {
    id: 'physiotherapy.session',
    version: 1,
    specialty: 'physiotherapy',
    schema: physioSessionV1,
    finalizeProblems: (d): Problems => (d.courseEncounterId ? {} : { 'specialty.courseEncounterId': 'required' }),
  },
  {
    id: 'physiotherapy.discharge',
    version: 1,
    specialty: 'physiotherapy',
    schema: physioDischargeV1,
    finalizeProblems: (d) => ({
      ...(d.courseEncounterId ? {} : { 'specialty.courseEncounterId': 'required' }),
      ...(typeof d.summary === 'string' && d.summary.trim() ? {} : { 'specialty.summary': 'required' }),
    }),
  },
  { id: 'ent.visit', version: 1, specialty: 'ent', schema: entVisitV1, finalizeProblems: none },
];

/** The newest version of each template, used for new records. */
export function latestTemplate(id: TemplateId): Template {
  const versions = TEMPLATES.filter((t) => t.id === id).sort((a, b) => b.version - a.version);
  const latest = versions[0];
  if (!latest) throw new Error(`Unknown template ${id}`);
  return latest;
}

/** Exactly the version a record was created with (old records keep their own rules). */
export function templateVersion(id: string, version: number): Template | null {
  return TEMPLATES.find((t) => t.id === id && t.version === version) ?? null;
}

/** Templates a practitioner of this specialty may start (the first one is the default). */
export function templatesForSpecialty(specialtyCode: string): TemplateId[] {
  return TEMPLATE_IDS.filter((id) => latestTemplate(id).specialty === specialtyCode);
}

/** Validated, normalized template data, or field codes (never the submitted text). */
export function parseTemplateData(
  template: Template,
  data: unknown,
): { ok: true; data: Record<string, unknown> } | { ok: false; fields: Problems } {
  const result = template.schema.safeParse(data ?? {});
  if (result.success) return { ok: true, data: result.data as Record<string, unknown> };
  const fields: Problems = {};
  for (const issue of result.error.issues) {
    const key = ['specialty', ...issue.path.map(String)].join('.');
    fields[key] ??= issue.code === 'too_big' ? 'too_long' : issue.code === 'too_small' ? 'too_short' : 'invalid';
  }
  return { ok: false, fields };
}

export function emptyTemplateData(template: Template): Record<string, unknown> {
  return template.schema.parse({}) as Record<string, unknown>;
}
