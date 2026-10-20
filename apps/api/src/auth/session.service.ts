import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Types } from 'mongoose';
import { SessionModel } from './session.model.js';

const newToken = () => randomBytes(32).toString('base64url');
const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

export async function createSession(userId: Types.ObjectId, ttlHours: number) {
  const token = newToken();
  const csrfToken = newToken();
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  await SessionModel.create({ tokenHash: hashToken(token), userId, csrfToken, expiresAt });
  return { token, csrfToken, expiresAt };
}

export function findValidSession(token: string) {
  return SessionModel.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } });
}

export async function destroySession(token: string): Promise<void> {
  await SessionModel.deleteOne({ tokenHash: hashToken(token) });
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
