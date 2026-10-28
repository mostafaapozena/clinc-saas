import mongoose from 'mongoose';
import { nameTokens, phoneTails } from './normalize.js';

/**
 * Fills `nameTokens` from `nameKey` for patients written before indexed name search existed
 * (docs/architecture/SCALABILITY_REVIEW.md, S2). Idempotent and batched; only adds a derived field.
 */
export async function backfillPatientNameTokens(batchSize = 1000): Promise<number> {
  const patients = mongoose.connection.db!.collection('patients');
  let updated = 0;
  for (;;) {
    const batch = await patients
      .find({ $or: [{ nameTokens: { $exists: false } }, { nameTokens: { $size: 0 } }], nameKey: { $type: 'string', $ne: '' } })
      .project({ nameKey: 1 })
      .limit(batchSize)
      .toArray();
    if (batch.length === 0) return updated;
    const res = await patients.bulkWrite(
      batch.map((p) => ({ updateOne: { filter: { _id: p._id }, update: { $set: { nameTokens: nameTokens(String(p.nameKey)) } } } })),
      { ordered: false },
    );
    updated += res.modifiedCount;
  }
}

/**
 * Fills `phoneTails` for patients written before "last digits" phone search existed.
 * Idempotent and batched; only adds a derived field.
 */
export async function backfillPatientPhoneTails(batchSize = 1000): Promise<number> {
  const patients = mongoose.connection.db!.collection('patients');
  let updated = 0;
  for (;;) {
    const batch = await patients
      .find({ $or: [{ phoneTails: { $exists: false } }, { phoneTails: { $size: 0 } }], 'phone.e164': { $type: 'string' } })
      .project({ phone: 1, secondaryPhone: 1 })
      .limit(batchSize)
      .toArray();
    if (batch.length === 0) return updated;
    const res = await patients.bulkWrite(
      batch.map((p) => ({
        updateOne: { filter: { _id: p._id }, update: { $set: { phoneTails: phoneTails(p.phone as { e164: string }, p.secondaryPhone as { e164: string } | null) } } },
      })),
      { ordered: false },
    );
    updated += res.modifiedCount;
  }
}
