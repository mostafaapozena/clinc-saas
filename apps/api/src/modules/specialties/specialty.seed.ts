import { SpecialtyModel } from './specialty.model.js';

type SpecialtySeed = {
  code: string;
  name: { ar: string; en: string };
  sortOrder: number;
};

// Initial specialty catalog for the SaaS foundation. Reference data only — no patient data.
export const specialtySeedData: SpecialtySeed[] = [
  { code: 'dentistry', name: { ar: 'طب الأسنان', en: 'Dentistry' }, sortOrder: 1 },
  { code: 'physiotherapy', name: { ar: 'العلاج الطبيعي', en: 'Physiotherapy' }, sortOrder: 2 },
  { code: 'ent', name: { ar: 'الأنف والأذن والحنجرة', en: 'Ear, Nose & Throat' }, sortOrder: 3 },
];

/** Idempotent: upserts by code, so it can be re-run safely. Returns the number of seeded records. */
export async function seedSpecialties(): Promise<number> {
  await SpecialtyModel.bulkWrite(
    specialtySeedData.map((specialty) => ({
      updateOne: {
        filter: { code: specialty.code },
        update: { $set: { ...specialty, isActive: true } },
        upsert: true,
      },
    })),
  );
  return specialtySeedData.length;
}
