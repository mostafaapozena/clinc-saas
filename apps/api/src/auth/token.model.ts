import { createHash, randomBytes } from 'node:crypto';
import { Schema, model, type Types } from 'mongoose';

// Single-use, expiring account tokens (docs/architecture/ACCOUNT_EMAIL.md): email verification,
// password reset and organization invitations. Only a SHA-256 hash is stored; the raw token exists
// in the email (or the development mail sink) and nowhere else. Consuming is one atomic update.

export const TOKEN_PURPOSES = ['email_verification', 'password_reset', 'invitation'] as const;
export type TokenPurpose = (typeof TOKEN_PURPOSES)[number];

export const TOKEN_TTL_MINUTES: Record<TokenPurpose, number> = {
  email_verification: 24 * 60,
  password_reset: 60,
  invitation: 7 * 24 * 60,
};

export interface AccountToken {
  purpose: TokenPurpose;
  tokenHash: string;
  userId: Types.ObjectId | null;
  email: string;
  /** Invitations only. */
  organizationId: Types.ObjectId | null;
  invitation: { role: string; branchScope: { type: 'all' | 'selected'; branchIds: Types.ObjectId[] } } | null;
  createdByUserId: Types.ObjectId | null;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

const tokenSchema = new Schema<AccountToken>(
  {
    purpose: { type: String, enum: TOKEN_PURPOSES, required: true },
    tokenHash: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    email: { type: String, required: true, lowercase: true, maxlength: 254 },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null },
    invitation: {
      type: new Schema(
        {
          role: { type: String, required: true },
          branchScope: {
            type: new Schema(
              {
                type: { type: String, enum: ['all', 'selected'], required: true },
                branchIds: { type: [Schema.Types.ObjectId], default: [] },
              },
              { _id: false },
            ),
            required: true,
          },
        },
        { _id: false },
      ),
      default: null,
    },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { collection: 'account_tokens', timestamps: { createdAt: true, updatedAt: false } },
);
tokenSchema.index({ tokenHash: 1 }, { unique: true });
tokenSchema.index({ purpose: 1, userId: 1 });
tokenSchema.index({ purpose: 1, organizationId: 1, createdAt: -1 });
// Spent or expired tokens are useless; MongoDB removes them a week after expiry.
tokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
export const AccountTokenModel = model<AccountToken>('AccountToken', tokenSchema);

export const hashAccountToken = (raw: string) => createHash('sha256').update(raw).digest('base64url');

/** Creates a token and returns the raw value (to be sent once, never stored). */
export async function issueAccountToken(
  purpose: TokenPurpose,
  fields: Partial<Omit<AccountToken, 'purpose' | 'tokenHash' | 'expiresAt'>> & { email: string },
  now = new Date(),
) {
  const raw = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MINUTES[purpose] * 60_000);
  const doc = await AccountTokenModel.create({ ...fields, purpose, tokenHash: hashAccountToken(raw), expiresAt });
  return { raw, id: doc._id, expiresAt };
}

const usableFilter = (purpose: TokenPurpose, raw: string, now: Date) => ({
  purpose,
  tokenHash: hashAccountToken(typeof raw === 'string' ? raw : ''),
  usedAt: null,
  revokedAt: null,
  expiresAt: { $gt: now },
});

/** Reads a still-usable token without spending it (e.g. to preview an invitation). */
export function findUsableToken(purpose: TokenPurpose, raw: string, now = new Date()) {
  return AccountTokenModel.findOne(usableFilter(purpose, raw, now)).lean();
}

/** Spends a token exactly once; concurrent attempts get null. `extra` narrows the match further. */
export function consumeAccountToken(purpose: TokenPurpose, raw: string, extra: Record<string, unknown> = {}, now = new Date()) {
  return AccountTokenModel.findOneAndUpdate(
    { ...usableFilter(purpose, raw, now), ...extra },
    { $set: { usedAt: now } },
    { returnDocument: 'after' },
  ).lean();
}

/** Revokes every unused token of a purpose for a user (a new reset link replaces older ones). */
export function revokeOpenTokens(purpose: TokenPurpose, filter: Record<string, unknown>, now = new Date()) {
  return AccountTokenModel.updateMany({ purpose, usedAt: null, revokedAt: null, ...filter }, { $set: { revokedAt: now } });
}
