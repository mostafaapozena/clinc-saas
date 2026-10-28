import { randomBytes } from 'node:crypto';
import { Schema, model, type Types } from 'mongoose';

// Support requests from a clinic to raclinic (docs/architecture/SUPPORT.md). Tenant data in the
// sense that only the organization (and raclinic operators) see them; the form asks people never
// to include patient information. Messages are append-only.

export const SUPPORT_CATEGORIES = ['account', 'scheduling', 'records', 'finance', 'subscription', 'other'] as const;
export const SUPPORT_STATUSES = ['open', 'answered', 'closed'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export const MAX_SUPPORT_MESSAGES = 100;

export interface SupportMessage {
  author: 'customer' | 'operator';
  userId: Types.ObjectId | null;
  operatorId: Types.ObjectId | null;
  displayName: string;
  body: string;
  at: Date;
}

export interface SupportRequest {
  organizationId: Types.ObjectId;
  reference: string;
  createdByUserId: Types.ObjectId;
  subject: string;
  category: (typeof SUPPORT_CATEGORIES)[number];
  status: SupportStatus;
  messages: SupportMessage[];
  lastActivityAt: Date;
  closedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<SupportMessage>(
  {
    author: { type: String, enum: ['customer', 'operator'], required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    operatorId: { type: Schema.Types.ObjectId, ref: 'PlatformOperator', default: null },
    displayName: { type: String, required: true, maxlength: 80 },
    body: { type: String, required: true, maxlength: 2000 },
    at: { type: Date, required: true },
  },
  { _id: true },
);

const supportSchema = new Schema<SupportRequest>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    reference: { type: String, required: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    subject: { type: String, required: true, maxlength: 120 },
    category: { type: String, enum: SUPPORT_CATEGORIES, required: true },
    status: { type: String, enum: SUPPORT_STATUSES, required: true, default: 'open' },
    messages: { type: [messageSchema], default: [] },
    lastActivityAt: { type: Date, required: true },
    closedAt: { type: Date, default: null },
    version: { type: Number, required: true, default: 0 },
  },
  { collection: 'support_requests', timestamps: true },
);
supportSchema.index({ reference: 1 }, { unique: true });
supportSchema.index({ organizationId: 1, lastActivityAt: -1 });
supportSchema.index({ status: 1, lastActivityAt: -1 });
supportSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], function () {
  if (this.getOptions().allowSeedCleanup !== true) throw new Error('Support requests are not deleted (retention: see RETENTION in docs)');
});
export const SupportRequestModel = model<SupportRequest>('SupportRequest', supportSchema);

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newSupportReference = () => `S-${[...randomBytes(8)].map((b) => ALPHABET[b % ALPHABET.length]).join('')}`;
