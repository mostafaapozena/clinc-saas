import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { MemoryStore, ipKeyGenerator, rateLimit, type ClientRateLimitInfo, type Options, type Store } from 'express-rate-limit';
import { Schema, model } from 'mongoose';
import { HttpError, isDuplicateKeyError } from '../http/errors.js';

// Rate limiting shared by every API replica (docs/architecture/SCALABILITY_REVIEW.md#rate-limits).
// Counters live in MongoDB — the infrastructure the API already depends on — as fixed windows:
// one document per (limiter, hashed client key, window), incremented atomically, removed by a TTL
// index shortly after the window ends. Keys are SHA-256 hashes: no IP address or email is stored.
//
// If the store cannot be reached the request is REFUSED with 503 RATE_LIMIT_UNAVAILABLE. Every
// limited route is sensitive (sign-in, recovery, registration, invitations, inquiries, support),
// so failing open would silently remove the protection.

interface RateLimitCounter {
  _id: string;
  hits: number;
  expiresAt: Date;
}
const counterSchema = new Schema<RateLimitCounter>(
  { _id: { type: String, required: true }, hits: { type: Number, required: true }, expiresAt: { type: Date, required: true } },
  { collection: 'rate_limit_counters', versionKey: false },
);
counterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const RateLimitCounterModel = model<RateLimitCounter>('RateLimitCounter', counterSchema);

const hash = (value: string) => createHash('sha256').update(value).digest('base64url').slice(0, 32);
const unavailable = () => new HttpError(503, 'RATE_LIMIT_UNAVAILABLE', 'Please try again in a moment.');

/** A fixed-window counter store in MongoDB, safe under concurrent increments from any replica. */
export class MongoRateLimitStore implements Store {
  windowMs = 60_000;
  readonly prefix: string;
  constructor(prefix: string) {
    this.prefix = prefix;
  }
  init(options: Options) {
    this.windowMs = options.windowMs;
  }
  private bucket(key: string, now = Date.now()) {
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
    return { id: `${this.prefix}:${hash(key)}:${windowStart}`, resetTime: new Date(windowStart + this.windowMs) };
  }
  async increment(key: string): Promise<ClientRateLimitInfo> {
    const { id, resetTime } = this.bucket(key);
    for (let attempt = 0; ; attempt++) {
      try {
        const doc = await RateLimitCounterModel.findOneAndUpdate(
          { _id: id },
          { $inc: { hits: 1 }, $setOnInsert: { expiresAt: new Date(resetTime.getTime() + 60_000) } },
          { upsert: true, returnDocument: 'after', maxTimeMS: 2_000 },
        ).lean();
        if (!doc) throw new Error('no counter returned');
        return { totalHits: doc.hits, resetTime };
      } catch (err) {
        // Two replicas creating the same window at once: the loser retries as an update.
        if (isDuplicateKeyError(err) && attempt < 2) continue;
        throw unavailable();
      }
    }
  }
  async decrement(key: string) {
    const { id } = this.bucket(key);
    await RateLimitCounterModel.updateOne({ _id: id, hits: { $gt: 0 } }, { $inc: { hits: -1 } }).catch(() => undefined);
  }
  async resetKey(key: string) {
    const { id } = this.bucket(key);
    await RateLimitCounterModel.deleteOne({ _id: id }).catch(() => undefined);
  }
}

export type RateLimitStoreKind = 'mongo' | 'memory';
let storeKind: RateLimitStoreKind = 'mongo';
/** Called once by createApp. 'memory' is for isolated unit tests only (production refuses it). */
export function configureRateLimitStore(kind: RateLimitStoreKind) {
  storeKind = kind;
}

/** Normalized email from the request body, hashed by the store — scoping attempts to one account. */
function accountKey(req: Request): string {
  const body = req.body as { email?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  return email ? `account:${email}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

/**
 * A named limiter. `keyBy: 'ip'` (default) counts per client address (req.ip — set TRUST_PROXY
 * behind a reverse proxy so it is the real client, never a spoofable header otherwise); `'account'`
 * counts attempts against one email address from any address, which stops distributed guessing
 * against a single account. Both answer the same 429, revealing nothing about the account.
 */
export function createRateLimiter({ max, windowMs }: { max: number; windowMs: number }, name: string, keyBy: 'ip' | 'account' = 'ip') {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    identifier: name,
    store: storeKind === 'mongo' ? new MongoRateLimitStore(`rl:${name}`) : new MemoryStore(),
    passOnStoreError: false,
    ...(keyBy === 'account' ? { keyGenerator: accountKey } : {}),
    // Proxy trust is configured explicitly via TRUST_PROXY, so skip the forwarded-header warning;
    validate: { xForwardedForHeader: false },
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
      });
    },
  });
}
