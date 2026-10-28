import { Router } from 'express';
import { Types } from 'mongoose';
import { authOf, requireAuth } from '../auth/session.middleware.js';
import { SessionModel } from '../auth/session.model.js';
import { conflict, notFound } from '../http/errors.js';

// The signed-in user's own sessions (docs/architecture/AUTH.md#sessions): list, sign out one other
// device, or sign out everywhere else. Session tokens are never returned — only their ids.

export const sessionsRouter = Router();
sessionsRouter.use(requireAuth);

/** Short, non-identifying device hint from the stored User-Agent. */
function deviceLabel(userAgent: string | null | undefined) {
  if (!userAgent) return null;
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : null;
  const os = /Android/.test(userAgent)
    ? 'Android'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  return [browser, os].filter(Boolean).join(' · ') || null;
}

sessionsRouter.get('/', async (req, res) => {
  const { user, session: current } = authOf(req);
  const sessions = await SessionModel.find({ userId: user._id, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.set('Cache-Control', 'no-store');
  res.json({
    data: sessions.map((s) => ({
      id: String(s._id),
      current: s._id.equals(current._id),
      device: deviceLabel(s.userAgent),
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: (s.lastSeenAt ?? s.createdAt).toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    })),
  });
});

sessionsRouter.delete('/:sessionId', async (req, res) => {
  const { user, session: current } = authOf(req);
  const id = Types.ObjectId.isValid(String(req.params.sessionId)) ? new Types.ObjectId(String(req.params.sessionId)) : null;
  if (!id) throw notFound();
  if (id.equals(current._id)) throw conflict('USE_LOGOUT', 'Use sign out to end the current session');
  const result = await SessionModel.deleteOne({ _id: id, userId: user._id });
  if (result.deletedCount !== 1) throw notFound();
  res.status(204).end();
});

sessionsRouter.post('/revoke-others', async (req, res) => {
  const { user, session: current } = authOf(req);
  const result = await SessionModel.deleteMany({ userId: user._id, _id: { $ne: current._id } });
  res.json({ revoked: result.deletedCount });
});
