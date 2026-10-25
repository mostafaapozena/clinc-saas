import mongoose, { type ClientSession } from 'mongoose';
import { HttpError } from '../http/errors.js';

// Bounded transactions (docs/architecture/SCALABILITY_REVIEW.md, S4). Mongoose's
// connection.transaction() retries a conflicting transaction for up to two minutes; under load
// those retries kept running after the client had given up and multiplied the pressure on the
// database. Here a transaction is retried with capped, jittered backoff for at most MAX_ATTEMPTS
// attempts and about MAX_RETRY_MS in total — long enough for an ordinary conflicting transaction to
// commit (so the loser still gets its precise business answer), short enough to fail fast under
// overload with 409 CONCURRENT_UPDATE. Mongoose's wrapper is still used inside, so document state
// is reset between attempts.

export const MAX_ATTEMPTS = 8;
export const MAX_RETRY_MS = 3_000;
const backoff = (attempt: number) =>
  new Promise((r) => setTimeout(r, Math.round(Math.min(400, 20 * 2 ** (attempt - 2)) * (0.5 + Math.random()))));

export function runTransaction<T>(work: (session: ClientSession) => Promise<T>, maxAttempts = MAX_ATTEMPTS): Promise<T> {
  let attempt = 0;
  const started = Date.now();
  return mongoose.connection.transaction(async (session) => {
    attempt += 1;
    if (attempt > maxAttempts || (attempt > 1 && Date.now() - started > MAX_RETRY_MS)) {
      // Not a transient error: the driver stops retrying and the request fails fast.
      throw new HttpError(409, 'CONCURRENT_UPDATE', 'Someone changed this at the same moment; please try again');
    }
    if (attempt > 1) await backoff(attempt);
    return work(session);
  });
}
