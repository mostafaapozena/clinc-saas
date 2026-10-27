import { Schema, model } from 'mongoose';
import { PHONE_COUNTRIES, type PhoneCountry } from '../patients/normalize.js';
import { INQUIRY_STATUSES, type InquiryStatus } from './inquiry.model.js';

/** Why someone writes from the public contact page. Custom projects and customer support have their own paths. */
export const CONTACT_INTENTS = ['demo', 'question', 'other'] as const;
export type ContactIntent = (typeof CONTACT_INTENTS)[number];

/**
 * A message from the public contact page (general questions, demo requests). Kept apart from
 * custom-ownership inquiries (a different commercial track) and from authenticated support
 * requests (customers, inside the workspace). Platform data: no organizationId, never visible to a
 * tenant; reviewed in the operator console. Contact details are personal data; the form asks people
 * not to include patient information. No email is sent anywhere when a message arrives.
 */
export interface ContactMessage {
  reference: string;
  intent: ContactIntent;
  contactName: string;
  phone: { country: PhoneCountry; e164: string } | null;
  email: string | null;
  organizationName: string | null;
  /** A catalog specialty code, "multi_specialty", or null. */
  specialty: string | null;
  message: string;
  language: 'ar' | 'en';
  status: InquiryStatus;
  /** Client-generated key (Idempotency-Key) so a repeated submit stores one message. */
  submissionKey: string;
  requestHash: string;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const contactSchema = new Schema<ContactMessage>(
  {
    reference: { type: String, required: true },
    intent: { type: String, enum: CONTACT_INTENTS, required: true },
    contactName: { type: String, required: true, maxlength: 80 },
    phone: {
      type: new Schema({ country: { type: String, enum: PHONE_COUNTRIES, required: true }, e164: { type: String, required: true } }, { _id: false }),
      default: null,
    },
    email: { type: String, default: null, maxlength: 254 },
    organizationName: { type: String, default: null, maxlength: 120 },
    specialty: { type: String, default: null, maxlength: 40 },
    message: { type: String, required: true, maxlength: 1500 },
    language: { type: String, enum: ['ar', 'en'], required: true, default: 'ar' },
    status: { type: String, enum: INQUIRY_STATUSES, required: true, default: 'new' },
    submissionKey: { type: String, required: true },
    requestHash: { type: String, required: true },
    reviewedAt: { type: Date, default: null },
  },
  { collection: 'contact_messages', timestamps: true },
);
contactSchema.index({ reference: 1 }, { unique: true });
contactSchema.index({ submissionKey: 1 }, { unique: true });
contactSchema.index({ status: 1, createdAt: -1 });
contactSchema.index({ createdAt: -1 });

export const ContactMessageModel = model<ContactMessage>('ContactMessage', contactSchema);
