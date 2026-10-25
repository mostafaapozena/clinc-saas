import { createHash, randomBytes } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { createRateLimiter } from '../../auth/rate-limit.js';
import { verifyPassword } from '../../auth/password.js';
import { constantTimeEqual } from '../../auth/session.service.js';
import type { AppConfig } from '../../config/app-config.js';
import { HttpError, forbidden, unauthenticated } from '../../http/errors.js';
import { parseInput } from '../../http/validate.js';
import { clock } from '../../time/clock.js';
import { OperatorModel, OperatorSessionModel, recordPlatformAudit, type OperatorDocument, type OperatorRole } from './operator.model.js';

// Operator authentication — separate from tenant sessions on purpose: its own cookie, CSRF token,
// lifetime (8 h absolute, 30 min idle) and rate limit. A tenant session never authenticates here,
// and an operator session never authenticates tenant routes.

export const OPERATOR_SESSION_HOURS = 8;
export const OPERATOR_IDLE_MINUTES = 30;
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const newToken = () => randomBytes(32).toString('base64url');
const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

export const operatorCookieName = (config: AppConfig) => (config.cookieSecure ? '__Host-clinc_op' : 'clinc_op');
const cookieOptions = (config: AppConfig) => ({ httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/' }) as const;

export type OperatorContext = { operator: OperatorDocument; csrfToken: string; tokenHash: string };

/** Operator permissions (never tenant data): who may do what in the console. */
export const OPERATOR_MATRIX = {
  'platform.overview.read': ['platform_admin', 'support'],
  'platform.organizations.read': ['platform_admin', 'support'],
  'platform.plans.read': ['platform_admin', 'support'],
  'platform.plans.manage': ['platform_admin'],
  'platform.subscriptions.manage': ['platform_admin'],
  'platform.inquiries.read': ['platform_admin', 'support'],
  'platform.inquiries.manage': ['platform_admin', 'support'],
  'platform.support.read': ['platform_admin', 'support'],
  'platform.support.manage': ['platform_admin', 'support'],
  'platform.operators.read': ['platform_admin'],
  'platform.operators.manage': ['platform_admin'],
  'platform.audit.read': ['platform_admin'],
} as const satisfies Record<string, readonly OperatorRole[]>;
export type OperatorPermission = keyof typeof OPERATOR_MATRIX;
export const operatorCan = (role: OperatorRole, permission: OperatorPermission) =>
  (OPERATOR_MATRIX[permission] as readonly OperatorRole[]).includes(role);

declare module 'express-serve-static-core' {
  interface Request {
    operator?: OperatorContext;
  }
}

/** Loads the operator session (fresh operator status, idle timeout) for /api/v1/platform. */
export function loadOperator(config: AppConfig): RequestHandler {
  return async (req, res, next) => {
    const token: unknown = req.cookies?.[operatorCookieName(config)];
    if (typeof token === 'string' && token) {
      const now = clock.now();
      const tokenHash = hashToken(token);
      const session = await OperatorSessionModel.findOneAndUpdate(
        { tokenHash, expiresAt: { $gt: now }, lastSeenAt: { $gt: new Date(now.getTime() - OPERATOR_IDLE_MINUTES * 60_000) } },
        { $set: { lastSeenAt: now } },
        { returnDocument: 'after' },
      ).lean();
      const operator = session ? await OperatorModel.findOne({ _id: session.operatorId, status: 'active' }) : null;
      if (session && operator) req.operator = { operator, csrfToken: session.csrfToken, tokenHash };
      else {
        // Expired, idle, revoked or suspended: the session ends now.
        await OperatorSessionModel.deleteOne({ tokenHash });
        res.clearCookie(operatorCookieName(config), cookieOptions(config));
      }
    }
    next();
  };
}

export const requireOperator: RequestHandler = (req, _res, next) => {
  if (!req.operator) throw unauthenticated();
  if (UNSAFE.has(req.method)) {
    const header = req.get('x-operator-csrf') ?? '';
    if (!header || !constantTimeEqual(header, req.operator.csrfToken)) throw forbidden('CSRF_INVALID', 'Missing or invalid CSRF token');
  }
  next();
};

export function requireOperatorPermission(permission: OperatorPermission): RequestHandler {
  return (req, _res, next) => {
    if (!req.operator) throw unauthenticated();
    if (!operatorCan(req.operator.operator.role, permission)) throw forbidden();
    next();
  };
}

export function operatorOf(req: Request): OperatorContext {
  if (!req.operator) throw unauthenticated();
  return req.operator;
}

const operatorDto = (o: OperatorDocument) => ({
  id: String(o._id),
  email: o.email,
  displayName: o.displayName,
  role: o.role,
  permissions: (Object.keys(OPERATOR_MATRIX) as OperatorPermission[]).filter((p) => operatorCan(o.role, p)),
});

const loginSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(256) });

export function createOperatorAuthRouter(config: AppConfig) {
  const router = Router();
  const limiter = createRateLimiter({ ...config.authRateLimit, max: Math.max(1, Math.floor(config.authRateLimit.max / 2)) }, 'operator-login');
  const accountLimiter = createRateLimiter(config.authRateLimit, 'operator-login-account', 'account');

  router.post('/login', limiter, accountLimiter, async (req, res: Response) => {
    const input = parseInput(loginSchema, req.body);
    const operator = await OperatorModel.findOne({ email: input.email });
    const ok = await verifyPassword(operator?.passwordHash, input.password);
    // Same answer for unknown, wrong password and suspended accounts.
    if (!operator || !ok || operator.status !== 'active') throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    const token = newToken();
    const csrfToken = newToken();
    const now = clock.now();
    const expiresAt = new Date(now.getTime() + OPERATOR_SESSION_HOURS * 3_600_000);
    await OperatorSessionModel.create({ tokenHash: hashToken(token), operatorId: operator._id, csrfToken, expiresAt, lastSeenAt: now });
    operator.lastLoginAt = now;
    await operator.save();
    await recordPlatformAudit({
      operatorId: operator._id,
      actor: 'operator',
      action: 'operator.signed_in',
      target: { type: 'operator', id: String(operator._id) },
      changes: {},
    });
    res.cookie(operatorCookieName(config), token, { ...cookieOptions(config), expires: expiresAt });
    res.json({ operator: operatorDto(operator), csrfToken });
  });

  router.get('/session', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.operator) {
      res.json({ operator: null });
      return;
    }
    res.json({ operator: operatorDto(req.operator.operator), csrfToken: req.operator.csrfToken });
  });

  router.post('/logout', requireOperator, async (req, res) => {
    await OperatorSessionModel.deleteOne({ tokenHash: operatorOf(req).tokenHash });
    res.clearCookie(operatorCookieName(config), cookieOptions(config));
    res.status(204).end();
  });

  return router;
}

/** Ends every session of an operator (suspension, role change). */
export async function revokeOperatorSessions(operatorId: Types.ObjectId) {
  await OperatorSessionModel.deleteMany({ operatorId });
}
