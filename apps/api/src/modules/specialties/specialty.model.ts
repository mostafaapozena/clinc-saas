import { Schema, model, type InferSchemaType } from 'mongoose';

const localizedNameSchema = new Schema(
  {
    ar: { type: String, required: true, trim: true },
    en: { type: String, required: true, trim: true },
  },
  { _id: false },
);

// Platform-wide reference catalog (not organization data), so it is not tenant-scoped.
const specialtySchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: localizedNameSchema, required: true },
    isActive: { type: Boolean, required: true, default: true },
    sortOrder: { type: Number, required: true, default: 0 },
  },
  { collection: 'specialties', timestamps: true },
);

export type Specialty = InferSchemaType<typeof specialtySchema>;

export const SpecialtyModel = model('Specialty', specialtySchema);
