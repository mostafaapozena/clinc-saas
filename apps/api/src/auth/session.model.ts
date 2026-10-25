import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface Session {
  /** SHA-256 of the opaque cookie token; the token itself is never stored. */
  tokenHash: string;
  userId: Types.ObjectId;
  /** Synchronizer token required on state-changing requests made with this session. */
  csrfToken: string;
  expiresAt: Date;
  /** Last request seen (updated at most once a minute); drives the idle timeout. */
  lastSeenAt?: Date;
  /** Truncated User-Agent, shown to the user as a device hint in their session list. */
  userAgent?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<Session>(
  {
    tokenHash: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    csrfToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date },
    userAgent: { type: String, default: null, maxlength: 160 },
  },
  { collection: 'sessions', timestamps: true },
);
sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ userId: 1 });
// MongoDB removes expired sessions in the background; requests also check expiresAt directly.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type SessionDocument = HydratedDocument<Session>;
export const SessionModel = model<Session>('Session', sessionSchema);
