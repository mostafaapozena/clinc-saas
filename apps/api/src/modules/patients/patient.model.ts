import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';
import { PHONE_COUNTRIES, type PhoneCountry } from './normalize.js';

export const PATIENT_SEXES = ['female', 'male', 'unspecified'] as const;
export type PatientSex = (typeof PATIENT_SEXES)[number];
export const REGISTRATION_STATUSES = ['active', 'archived'] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export type StoredPhone = { country: PhoneCountry; e164: string };

export interface BranchRegistration {
  branchId: Types.ObjectId;
  status: RegistrationStatus;
  registeredAt: Date;
  registeredBy: Types.ObjectId;
  archivedAt: Date | null;
}

/**
 * Organization-owned identity of a patient. Branch access comes only from `registrations`:
 * a branch-limited member may see the patient when at least one registration (active or
 * archived) is in their scope, and only those registrations are ever returned to them.
 * Administrative data only — no clinical information and no national identity numbers.
 */
export interface Patient {
  organizationId: Types.ObjectId;
  /** Sequential per organization (see counter.model.ts); never reused. */
  patientNumber: number;
  /** As entered (Arabic or English), never transliterated. */
  fullName: string;
  /** Normalized form of fullName used for search and duplicate warnings. */
  nameKey: string;
  /** Words of nameKey for indexed word-prefix search (see nameTokens). */
  nameTokens: string[];
  /** Endings of the phone numbers' digits for indexed "last digits" search (see phoneTails). */
  phoneTails: string[];
  phone: StoredPhone;
  secondaryPhone: StoredPhone | null;
  email: string | null;
  /** Local calendar date "YYYY-MM-DD". */
  dateOfBirth: string | null;
  sex: PatientSex;
  address: { line: string; city: string } | null;
  registrations: BranchRegistration[];
  version: number;
  /** Bumped by bookings and registration changes so they serialize (see appointment service). */
  scheduleSeq: number;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  /** Stable key for development seed data only. */
  seedKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const phoneSchema = new Schema<StoredPhone>(
  {
    country: { type: String, enum: PHONE_COUNTRIES, required: true },
    e164: { type: String, required: true, match: /^\+\d{6,15}$/ },
  },
  { _id: false },
);

const registrationSchema = new Schema<BranchRegistration>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    status: { type: String, enum: REGISTRATION_STATUSES, required: true, default: 'active' },
    registeredAt: { type: Date, required: true },
    registeredBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    archivedAt: { type: Date, default: null },
  },
  { _id: false },
);

const patientSchema = new Schema<Patient>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    patientNumber: { type: Number, required: true, min: 1 },
    fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    nameKey: { type: String, required: true },
    nameTokens: { type: [String], default: [] },
    phoneTails: { type: [String], default: [] },
    phone: { type: phoneSchema, required: true },
    secondaryPhone: { type: phoneSchema, default: null },
    email: { type: String, default: null, maxlength: 254 },
    dateOfBirth: { type: String, default: null },
    sex: { type: String, enum: PATIENT_SEXES, required: true, default: 'unspecified' },
    address: {
      type: new Schema({ line: { type: String, maxlength: 200 }, city: { type: String, maxlength: 80 } }, { _id: false }),
      default: null,
    },
    registrations: {
      type: [registrationSchema],
      validate: [(v: unknown[]) => v.length > 0 && v.length <= 200, 'registrations'],
    },
    version: { type: Number, required: true, default: 0 },
    scheduleSeq: { type: Number, required: true, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    seedKey: { type: String },
  },
  { collection: 'patients', timestamps: true },
);
patientSchema.index({ organizationId: 1, patientNumber: 1 }, { unique: true });
patientSchema.index({ organizationId: 1, 'registrations.branchId': 1, nameKey: 1 });
patientSchema.index({ organizationId: 1, 'phone.e164': 1 });
patientSchema.index({ organizationId: 1, 'secondaryPhone.e164': 1 });
patientSchema.index({ organizationId: 1, createdAt: -1 });
// Scalability review: indexed name search (word prefixes) and the name sort of the patient list.
patientSchema.index({ organizationId: 1, nameTokens: 1 });
patientSchema.index({ organizationId: 1, phoneTails: 1 });
patientSchema.index({ organizationId: 1, nameKey: 1, _id: 1 });
// The "recent" sort is { createdAt: -1, _id: -1 }; without _id in the index the sort was blocking.
patientSchema.index({ organizationId: 1, createdAt: -1, _id: -1 });
patientSchema.index({ organizationId: 1, seedKey: 1 }, { unique: true, partialFilterExpression: { seedKey: { $type: 'string' } } });
patientSchema.plugin(tenantGuardPlugin);

export type PatientDocument = HydratedDocument<Patient>;
export const PatientModel = model<Patient>('Patient', patientSchema);
