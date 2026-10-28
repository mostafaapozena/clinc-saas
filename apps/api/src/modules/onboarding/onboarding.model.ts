import { Schema, model, type Types } from 'mongoose';
import { ORGANIZATION_TYPES, type OrganizationType } from '../organizations/organization.model.js';

export const ONBOARDING_STEPS = ['organization', 'specialties', 'branch', 'review'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export const ONBOARDING_STATUSES = ['draft', 'completed'] as const;

/**
 * A user's organization setup in progress. It belongs to the user, not to a tenant (no
 * organization exists until completion), so it is not tenant-guarded; every query filters by
 * userId. One open draft per user; completion records the organization it created, which makes
 * repeated or concurrent completion requests return that organization instead of another one.
 * Holds organization setup data only — never patient, clinical or payment data.
 */
export interface OnboardingDraft {
  userId: Types.ObjectId;
  status: (typeof ONBOARDING_STATUSES)[number];
  step: OnboardingStep;
  data: {
    organizationType: OrganizationType | null;
    name: string;
    timeZone: string | null;
    specialtyCodes: string[];
    branch: { name: string; city: string; specialtyCodes: string[] };
  };
  organizationId: Types.ObjectId | null;
  completedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const draftSchema = new Schema<OnboardingDraft>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ONBOARDING_STATUSES, required: true, default: 'draft' },
    step: { type: String, enum: ONBOARDING_STEPS, required: true, default: 'organization' },
    data: {
      organizationType: { type: String, enum: [...ORGANIZATION_TYPES, null], default: null },
      name: { type: String, default: '', maxlength: 120 },
      timeZone: { type: String, default: null },
      specialtyCodes: { type: [String], default: [] },
      branch: {
        name: { type: String, default: '', maxlength: 80 },
        city: { type: String, default: '', maxlength: 80 },
        specialtyCodes: { type: [String], default: [] },
      },
    },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null },
    completedAt: { type: Date, default: null },
    version: { type: Number, required: true, default: 0 },
  },
  { collection: 'onboarding_drafts', timestamps: true },
);
// At most one open draft per user; completed drafts stay as the record of what was created.
draftSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: 'draft' } });
draftSchema.index({ userId: 1, createdAt: -1 });

export const OnboardingDraftModel = model<OnboardingDraft>('OnboardingDraft', draftSchema);
