import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

/**
 * The tenant itself. Not guarded by the tenant plugin: its _id *is* the scope, and every
 * route reaches it only after resolving the caller's membership.
 */
export interface Organization {
  name: string;
  createdBy: Types.ObjectId;
  /** Stable key for development seed data only. */
  seedKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const organizationSchema = new Schema<Organization>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    seedKey: { type: String },
  },
  { collection: 'organizations', timestamps: true },
);
organizationSchema.index({ seedKey: 1 }, { unique: true, sparse: true });

export type OrganizationDocument = HydratedDocument<Organization>;
export const OrganizationModel = model<Organization>('Organization', organizationSchema);
