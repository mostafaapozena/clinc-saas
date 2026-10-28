import { CURRENCY_CODES, type Currency } from '../finance/finance.model.js';
import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { SUPPORTED_TIME_ZONES } from '../../time/local-time.js';

/** How the organization describes itself at setup. Descriptive only: it limits nothing. */
export const ORGANIZATION_TYPES = ['clinic', 'medical_center', 'multi_branch'] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

/**
 * The tenant itself. Not guarded by the tenant plugin: its _id *is* the scope, and every
 * route reaches it only after resolving the caller's membership.
 */
export interface Organization {
  name: string;
  /**
   * IANA zone used to interpret schedules and bookings. Set explicitly during onboarding or in
   * settings; organizations created before phase 3 have none until an owner chooses one.
   */
  timeZone: string | null;
  /** null for organizations created before phase 4 until an owner chooses one. */
  type: OrganizationType | null;
  /**
   * Specialties the organization practices (codes from the platform catalog). Empty means
   * "not configured yet" (organizations created before phase 4); branch and practitioner
   * specialty rules are enforced only once an owner configures them. See
   * docs/architecture/SPECIALTIES.md.
   */
  specialtyCodes: string[];
  /**
   * Incremented inside every transaction that changes specialty configuration (organization,
   * branch or practitioner specialties/branches), so concurrent changes conflict instead of
   * each passing its checks against the other's stale state.
   */
  configVersion: number;
  /** Clinic finances currency (milestone 3); chosen once by an owner. */
  currency: Currency | null;
  /** Enabled shared ERP modules; absent = all (organizations created before modules existed). */
  enabledModules?: string[] | null;
  /** Identity and legal profile shown on documents (docs/architecture/ORGANIZATION_PROFILE.md). */
  profile?: OrganizationProfile | null;
  createdBy: Types.ObjectId;
  /** Stable key for development seed data only. */
  seedKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationProfile {
  legalNameAr: string;
  legalNameEn: string;
  /** As entered by the owner (السجل التجاري); no statutory format is assumed. */
  commercialRegistration: string;
  /** Tax card / registration number (البطاقة الضريبية), as entered. */
  taxRegistration: string;
  address: string;
  phone: string;
  email: string;
  documentFooter: string;
  logoFileId: Types.ObjectId | null;
  version: number;
}

const organizationSchema = new Schema<Organization>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    timeZone: { type: String, enum: [...SUPPORTED_TIME_ZONES, null], default: null },
    type: { type: String, enum: [...ORGANIZATION_TYPES, null], default: null },
    specialtyCodes: { type: [String], default: [] },
    configVersion: { type: Number, required: true, default: 0 },
    currency: { type: String, enum: [...CURRENCY_CODES, null], default: null },
    enabledModules: { type: [String], default: undefined },
    profile: {
      type: new Schema<OrganizationProfile>(
        {
          legalNameAr: { type: String, default: '', maxlength: 160 },
          legalNameEn: { type: String, default: '', maxlength: 160 },
          commercialRegistration: { type: String, default: '', maxlength: 40 },
          taxRegistration: { type: String, default: '', maxlength: 40 },
          address: { type: String, default: '', maxlength: 300 },
          phone: { type: String, default: '', maxlength: 40 },
          email: { type: String, default: '', maxlength: 120 },
          documentFooter: { type: String, default: '', maxlength: 300 },
          logoFileId: { type: Schema.Types.ObjectId, ref: 'StoredFile', default: null },
          version: { type: Number, required: true, default: 0 },
        },
        { _id: false },
      ),
      default: null,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    seedKey: { type: String },
  },
  { collection: 'organizations', timestamps: true },
);
organizationSchema.index({ seedKey: 1 }, { unique: true, sparse: true });

export type OrganizationDocument = HydratedDocument<Organization>;
export const OrganizationModel = model<Organization>('Organization', organizationSchema);

/** Documents written before phase 4 lack the new fields; read them through these helpers. */
export const specialtiesOf = (org: { specialtyCodes?: string[] | null }): string[] => org.specialtyCodes ?? [];
export const isSpecialtyConfigured = (org: { specialtyCodes?: string[] | null }) => specialtiesOf(org).length > 0;
