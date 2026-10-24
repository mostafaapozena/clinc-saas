import { Schema, model } from 'mongoose';
import { PHONE_COUNTRIES, type PhoneCountry } from '../patients/normalize.js';

export const INQUIRY_COUNTRIES = ['EG', 'SA', 'other'] as const;
export const INQUIRY_ORGANIZATION_TYPES = ['clinic', 'medical_center', 'multi_branch', 'other'] as const;
/** Besides catalog specialty codes: several specialties together, or a separately scoped system. */
export const INQUIRY_EXTRA_INTERESTS = ['multi_specialty', 'custom'] as const;
export const INQUIRY_STATUSES = ['new', 'reviewed', 'closed'] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

/**
 * A request for a separately scoped custom-ownership project, sent from the public website.
 * Platform data: no organizationId, never visible to any tenant role, readable only through the
 * operator review script (src/scripts/inquiries.ts). Contact details are personal data; the form
 * asks people not to include patient information. Retention: see docs/architecture/INQUIRIES.md.
 */
export interface OwnershipInquiry {
  reference: string;
  contactName: string;
  organizationName: string;
  country: (typeof INQUIRY_COUNTRIES)[number];
  phone: { country: PhoneCountry; e164: string } | null;
  email: string | null;
  organizationType: (typeof INQUIRY_ORGANIZATION_TYPES)[number];
  interest: string;
  description: string;
  language: 'ar' | 'en';
  status: InquiryStatus;
  /** Client-generated key (Idempotency-Key) so a repeated submit stores one inquiry. */
  submissionKey: string;
  requestHash: string;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const inquirySchema = new Schema<OwnershipInquiry>(
  {
    reference: { type: String, required: true },
    contactName: { type: String, required: true, maxlength: 80 },
    organizationName: { type: String, required: true, maxlength: 120 },
    country: { type: String, enum: INQUIRY_COUNTRIES, required: true },
    phone: {
      type: new Schema({ country: { type: String, enum: PHONE_COUNTRIES, required: true }, e164: { type: String, required: true } }, { _id: false }),
      default: null,
    },
    email: { type: String, default: null, maxlength: 254 },
    organizationType: { type: String, enum: INQUIRY_ORGANIZATION_TYPES, required: true },
    interest: { type: String, required: true, maxlength: 40 },
    description: { type: String, required: true, maxlength: 1500 },
    language: { type: String, enum: ['ar', 'en'], required: true, default: 'ar' },
    status: { type: String, enum: INQUIRY_STATUSES, required: true, default: 'new' },
    submissionKey: { type: String, required: true },
    requestHash: { type: String, required: true },
    reviewedAt: { type: Date, default: null },
  },
  { collection: 'ownership_inquiries', timestamps: true },
);
inquirySchema.index({ reference: 1 }, { unique: true });
inquirySchema.index({ submissionKey: 1 }, { unique: true });
inquirySchema.index({ status: 1, createdAt: -1 });
inquirySchema.index({ createdAt: -1 });

export const OwnershipInquiryModel = model<OwnershipInquiry>('OwnershipInquiry', inquirySchema);
