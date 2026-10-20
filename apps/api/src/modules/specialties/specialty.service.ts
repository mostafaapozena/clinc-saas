import { z } from 'zod';
import { validationError } from '../../http/errors.js';
import { SpecialtyModel } from './specialty.model.js';

/** Shape of a specialty code; whether it exists is checked against the catalog. */
export const specialtyCodeSchema = z.string().trim().regex(/^[a-z][a-z0-9_-]{1,39}$/, 'invalid_format');

/** A de-duplicated list of 1–20 specialty codes. */
export const specialtyListSchema = z
  .array(specialtyCodeSchema)
  .min(1)
  .max(20)
  .transform((codes) => [...new Set(codes)]);

/** Active codes of the platform catalog (dentistry, physiotherapy, ENT — see specialty.seed.ts). */
export async function activeSpecialtyCodes(): Promise<Set<string>> {
  const rows = await SpecialtyModel.find({ isActive: true }).select('code').lean();
  return new Set(rows.map((r) => r.code));
}

/** Rejects codes that are not in the active catalog, naming the request field. */
export async function assertCatalogSpecialties(codes: string[], field: string): Promise<void> {
  const catalog = await activeSpecialtyCodes();
  if (codes.some((code) => !catalog.has(code))) throw validationError({ [field]: 'unsupported_specialty' });
}
