import { Schema, model, type Types } from 'mongoose';
import { isDuplicateKeyError } from '../../http/errors.js';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';

/** Per-organization sequences (currently only patient numbers). */
interface Counter {
  organizationId: Types.ObjectId;
  key: 'patient';
  seq: number;
}

const counterSchema = new Schema<Counter>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    key: { type: String, enum: ['patient'], required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { collection: 'counters' },
);
counterSchema.index({ organizationId: 1, key: 1 }, { unique: true });
counterSchema.plugin(tenantGuardPlugin);

export const CounterModel = model<Counter>('Counter', counterSchema);

/**
 * Atomically reserves the next number. `$inc` on one document is atomic, and the unique index
 * makes concurrent first-time upserts converge on a single counter (a losing upsert retries).
 * A number taken by a request that then fails is not reused, so gaps are possible.
 */
export async function nextPatientNumber(organizationId: Types.ObjectId): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const counter = await CounterModel.findOneAndUpdate(
        { organizationId, key: 'patient' },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after' },
      ).lean();
      if (counter) return counter.seq;
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
    }
  }
  throw new Error('Could not allocate a patient number');
}
