import { Schema, model, type Query, type Types } from 'mongoose';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';
import { clock } from '../../time/clock.js';

/** Record times come from the server clock (the same source as every other timestamp here). */
const currentTime = () => clock.now();

// Clinical visit records (phase 5). See docs/architecture/CLINICAL.md.
//
// Content never leaves these collections through logs, audit events, URLs or other records.
// Schema length limits use messages without the value, so validation errors cannot echo text.

/**
 * General visit sections. Provisional, pending review by practising clinicians (docs/CLINICIAN_REVIEW.md).
 * - reason: presenting complaint / reason for visit
 * - history: relevant history for this visit
 * - examination: examination findings
 * - assessment: assessment recorded by the treating clinician
 * - plan: plan and follow-up instructions
 */
export const ENCOUNTER_SECTIONS = ['reason', 'history', 'examination', 'assessment', 'plan'] as const;
export type EncounterSection = (typeof ENCOUNTER_SECTIONS)[number];
export const SECTION_MAX = 4000;
export const ENCOUNTER_STATUSES = ['draft', 'finalized'] as const;
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number];

export interface Encounter {
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  patientId: Types.ObjectId;
  appointmentId: Types.ObjectId;
  /** The appointment's practitioner at creation; never changes. */
  practitionerId: Types.ObjectId;
  /** The treating doctor's user account (author of the record). */
  authorUserId: Types.ObjectId;
  status: EncounterStatus;
  sections: Record<EncounterSection, string>;
  /**
   * Specialty template the record was created with (id + version, never changed) and its
   * clinician-entered data, validated by exactly that version (templates.ts). Null: general record.
   */
  specialty: { template: string; version: number; data: Record<string, unknown> } | null;
  /** Optimistic concurrency for draft saves and finalization. */
  version: number;
  /** Set when the record was started after the appointment was completed. */
  lateEntry: { reason: string } | null;
  creationKey: string;
  creationHash: string;
  lastEditedAt: Date;
  finalizedAt: Date | null;
  finalizedBy: Types.ObjectId | null;
  finalizationKey: string | null;
  seedKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const sectionField = {
  type: String,
  default: '',
  maxlength: [SECTION_MAX, 'too_long'],
};

const encounterSchema = new Schema<Encounter>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Appointment',
      required: true,
    },
    practitionerId: {
      type: Schema.Types.ObjectId,
      ref: 'Practitioner',
      required: true,
    },
    authorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ENCOUNTER_STATUSES,
      required: true,
      default: 'draft',
    },
    sections: {
      reason: sectionField,
      history: sectionField,
      examination: sectionField,
      assessment: sectionField,
      plan: sectionField,
    },
    specialty: {
      type: new Schema(
        {
          template: { type: String, required: true },
          version: { type: Number, required: true },
          // Validated by the template version before every write (bounded sizes there).
          data: { type: Schema.Types.Mixed, default: () => ({}) },
        },
        { _id: false, minimize: false },
      ),
      default: null,
    },
    version: { type: Number, required: true, default: 0 },
    lateEntry: {
      type: new Schema(
        {
          reason: {
            type: String,
            required: true,
            maxlength: [300, 'too_long'],
          },
        },
        { _id: false },
      ),
      default: null,
    },
    creationKey: { type: String, required: true },
    creationHash: { type: String, required: true },
    lastEditedAt: { type: Date, required: true },
    finalizedAt: { type: Date, default: null },
    finalizedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    finalizationKey: { type: String, default: null },
    seedKey: { type: String },
  },
  { collection: 'clinical_encounters', timestamps: { currentTime } },
);
// Exactly one record per appointment (this phase).
encounterSchema.index({ organizationId: 1, appointmentId: 1 }, { unique: true });
encounterSchema.index({ organizationId: 1, authorUserId: 1, creationKey: 1 }, { unique: true });
encounterSchema.index({
  organizationId: 1,
  practitionerId: 1,
  patientId: 1,
  createdAt: -1,
});
encounterSchema.plugin(tenantGuardPlugin);

export interface Addendum {
  organizationId: Types.ObjectId;
  encounterId: Types.ObjectId;
  authorUserId: Types.ObjectId;
  practitionerId: Types.ObjectId;
  reason: string;
  content: string;
  idempotencyKey: string;
  requestHash: string;
  seedKey?: string;
  createdAt: Date;
}

const addendumSchema = new Schema<Addendum>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    encounterId: {
      type: Schema.Types.ObjectId,
      ref: 'ClinicalEncounter',
      required: true,
    },
    authorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    practitionerId: {
      type: Schema.Types.ObjectId,
      ref: 'Practitioner',
      required: true,
    },
    reason: { type: String, required: true, maxlength: [300, 'too_long'] },
    content: {
      type: String,
      required: true,
      maxlength: [SECTION_MAX, 'too_long'],
    },
    idempotencyKey: { type: String, required: true },
    requestHash: { type: String, required: true },
    seedKey: { type: String },
  },
  {
    collection: 'clinical_addenda',
    timestamps: { createdAt: true, updatedAt: false, currentTime },
  },
);
addendumSchema.index({ organizationId: 1, encounterId: 1, createdAt: 1 });
addendumSchema.index({ organizationId: 1, authorUserId: 1, idempotencyKey: 1 }, { unique: true });
addendumSchema.plugin(tenantGuardPlugin);

export const CLINICAL_AUDIT_ACTIONS = [
  'encounter.created',
  'encounter.viewed',
  'encounter.draft_saved',
  'encounter.finalized',
  'encounter.addendum_added',
  'clinical_history.viewed',
  'clinical.access_denied',
  'coverage.granted',
  'coverage.revoked',
  'clinical_audit.viewed',
] as const;
export type ClinicalAuditAction = (typeof CLINICAL_AUDIT_ACTIONS)[number];

/**
 * Clinical access and change log — separate from the administrative audit log. Metadata only
 * (ids, versions, section names, reason codes); never clinical text. Readable only by members with
 * the `clinical_audit` capability (GET /clinical/audit; docs/architecture/CLINICAL.md).
 */
export interface ClinicalAuditEvent {
  organizationId: Types.ObjectId;
  actorUserId: Types.ObjectId;
  actorRole: string;
  action: ClinicalAuditAction;
  encounterId: Types.ObjectId | null;
  appointmentId: Types.ObjectId | null;
  patientId: Types.ObjectId | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const clinicalAuditSchema = new Schema<ClinicalAuditEvent>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorRole: { type: String, required: true },
    action: { type: String, enum: CLINICAL_AUDIT_ACTIONS, required: true },
    encounterId: { type: Schema.Types.ObjectId, default: null },
    appointmentId: { type: Schema.Types.ObjectId, default: null },
    patientId: { type: Schema.Types.ObjectId, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  {
    collection: 'clinical_audit_events',
    timestamps: { createdAt: true, updatedAt: false, currentTime },
  },
);
clinicalAuditSchema.index({ organizationId: 1, createdAt: -1 });
clinicalAuditSchema.index({
  organizationId: 1,
  actorUserId: 1,
  action: 1,
  createdAt: -1,
});
clinicalAuditSchema.plugin(tenantGuardPlugin);

// No hard deletion of clinical records; addenda and audit events are append-only. The only
// exception is the development seed replacing its own synthetic records (option allowSeedCleanup).
function blockUnlessSeedCleanup(this: Query<unknown, unknown>) {
  if (this.getOptions().allowSeedCleanup !== true) throw new Error('Clinical records cannot be deleted or rewritten');
}
const DELETES = ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const;
const WRITES = ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'] as const;
encounterSchema.pre([...DELETES], blockUnlessSeedCleanup);
addendumSchema.pre([...DELETES, ...WRITES], blockUnlessSeedCleanup);
clinicalAuditSchema.pre([...DELETES, ...WRITES], blockUnlessSeedCleanup);
// Finalized content is immutable: every encounter update must be conditioned on `status: 'draft'`
// (finalization itself is the last such update), so no code path can rewrite a finalized record.
encounterSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function (this: Query<unknown, unknown>) {
  if (this.getOptions().allowSeedCleanup === true) return;
  if ((this.getFilter() as { status?: unknown }).status !== 'draft') throw new Error('Only draft clinical records can be changed');
});
encounterSchema.pre(['replaceOne', 'findOneAndReplace'], blockUnlessSeedCleanup);

export const EncounterModel = model<Encounter>('ClinicalEncounter', encounterSchema);
export const AddendumModel = model<Addendum>('ClinicalAddendum', addendumSchema);
export const ClinicalAuditModel = model<ClinicalAuditEvent>('ClinicalAuditEvent', clinicalAuditSchema);
