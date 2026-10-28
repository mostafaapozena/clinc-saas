import { Schema, model, type Query, type Types } from 'mongoose';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';
import { clock } from '../../time/clock.js';

// Clinical coverage (docs/architecture/CLINICAL.md#clinical-coverage): an explicit, time-bounded
// grant that lets one practitioner read — or also add addenda to — records written by another
// practitioner, for one patient or one encounter. Grants are never edited except to revoke them
// (and to bump `useSeq`, the write-lock that serializes revocation against covered writes).

export const COVERAGE_ACCESS = ['read', 'author'] as const;
export type CoverageAccess = (typeof COVERAGE_ACCESS)[number];
export const COVERAGE_SCOPES = ['patient', 'encounter'] as const;
export type CoverageScopeType = (typeof COVERAGE_SCOPES)[number];
export const COVERAGE_VIA = ['author', 'clinical_lead'] as const;
/** Upper bound for one grant (engineering default, pending owner confirmation). */
export const MAX_COVERAGE_DAYS = 90;

export interface Coverage {
  organizationId: Types.ObjectId;
  /** Whose records are covered: only records with this practitioner. */
  sourcePractitionerId: Types.ObjectId;
  granteePractitionerId: Types.ObjectId;
  granteeUserId: Types.ObjectId;
  scope: { type: CoverageScopeType; patientId: Types.ObjectId; encounterId: Types.ObjectId | null };
  access: CoverageAccess;
  reason: string;
  startsAt: Date;
  expiresAt: Date;
  grantedBy: Types.ObjectId;
  grantedVia: (typeof COVERAGE_VIA)[number];
  revokedAt: Date | null;
  revokedBy: Types.ObjectId | null;
  revokeReason: string | null;
  useSeq: number;
  idempotencyKey: string;
  requestHash: string;
  createdAt: Date;
}

const coverageSchema = new Schema<Coverage>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    sourcePractitionerId: { type: Schema.Types.ObjectId, ref: 'Practitioner', required: true },
    granteePractitionerId: { type: Schema.Types.ObjectId, ref: 'Practitioner', required: true },
    granteeUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    scope: {
      type: new Schema(
        {
          type: { type: String, enum: COVERAGE_SCOPES, required: true },
          patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
          encounterId: { type: Schema.Types.ObjectId, ref: 'ClinicalEncounter', default: null },
        },
        { _id: false },
      ),
      required: true,
    },
    access: { type: String, enum: COVERAGE_ACCESS, required: true },
    reason: { type: String, required: true, maxlength: [300, 'too_long'] },
    startsAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    grantedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    grantedVia: { type: String, enum: COVERAGE_VIA, required: true },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    revokeReason: { type: String, default: null, maxlength: [300, 'too_long'] },
    useSeq: { type: Number, required: true, default: 0 },
    idempotencyKey: { type: String, required: true },
    requestHash: { type: String, required: true },
  },
  { collection: 'clinical_coverage', timestamps: { createdAt: true, updatedAt: false, currentTime: () => clock.now() } },
);
coverageSchema.index({ organizationId: 1, granteePractitionerId: 1, 'scope.patientId': 1, expiresAt: 1 });
coverageSchema.index({ organizationId: 1, grantedBy: 1, createdAt: -1 });
coverageSchema.index({ organizationId: 1, grantedBy: 1, idempotencyKey: 1 }, { unique: true });
coverageSchema.plugin(tenantGuardPlugin);

// Grants are kept forever (they explain past access). The only updates: revoke (once) and the
// use-lock; anything else, and any delete, is refused. Development seed cleanup is the exception.
const ALLOWED_UPDATE_FIELDS = new Set(['revokedAt', 'revokedBy', 'revokeReason', 'useSeq']);
function guardUpdate(this: Query<unknown, unknown>) {
  if (this.getOptions().allowSeedCleanup === true) return;
  const update = (this.getUpdate() ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const fields = Object.entries(update).flatMap(([op, value]) => (op.startsWith('$') ? Object.keys(value ?? {}) : [op]));
  if (fields.some((f) => !ALLOWED_UPDATE_FIELDS.has(f))) throw new Error('Coverage grants can only be revoked');
}
function blockUnlessSeedCleanup(this: Query<unknown, unknown>) {
  if (this.getOptions().allowSeedCleanup !== true) throw new Error('Coverage grants cannot be deleted or replaced');
}
coverageSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], guardUpdate);
coverageSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne', 'findOneAndReplace'], blockUnlessSeedCleanup);

export const CoverageModel = model<Coverage>('ClinicalCoverage', coverageSchema);
