import mongoose from 'mongoose';
import { nameTokens } from './normalize.js';

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
