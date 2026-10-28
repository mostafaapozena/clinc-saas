import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Types } from 'mongoose';
import { SessionModel } from './session.model.js';

const newToken = () => randomBytes(32).toString('base64url');
const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

export async function createSession(userId: Types.ObjectId, ttlHours: number, userAgent?: string | null) {
  const token = newToken();
  const csrfToken = newToken();
  const now = Date.now();
  const expiresAt = new Date(now + ttlHours * 3_600_000);
  await SessionModel.create({ tokenHash: hashToken(token), userId, csrfToken, expiresAt, lastSeenAt: new Date(now), userAgent: userAgent ? userAgent.slice(0, 160) : null });
  return { token, csrfToken, expiresAt };
}

/** A session that is neither expired nor idle longer than idleMinutes (0 = no idle limit); touches lastSeenAt. */
export async function findValidSession(token: string, idleMinutes = 0) {
  const now = Date.now();
  const filter: Record<string, unknown> = { tokenHash: hashToken(token), expiresAt: { $gt: new Date(now) } };
  // Sessions created before lastSeenAt existed are treated as active once, then tracked.
  if (idleMinutes > 0) filter.$or = [{ lastSeenAt: { $exists: false } }, { lastSeenAt: { $gt: new Date(now - idleMinutes * 60_000) } }];
  const session = await SessionModel.findOne(filter);
  if (session && (!session.lastSeenAt || now - session.lastSeenAt.getTime() > 60_000)) {
    session.lastSeenAt = new Date(now);
    await SessionModel.updateOne({ _id: session._id }, { $set: { lastSeenAt: session.lastSeenAt } });
  }
  return session;
}

export async function destroySession(token: string): Promise<void> {
  await SessionModel.deleteOne({ tokenHash: hashToken(token) });
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
