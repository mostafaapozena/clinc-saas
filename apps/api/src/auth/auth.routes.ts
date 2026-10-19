import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../config/app-config.js';
import { HttpError, conflict, isDuplicateKeyError, validationError } from '../http/errors.js';
import {
  displayNameSchema,
  emailSchema,
  languageSchema,
  newPasswordSchema,
} from '../http/schemas.js';
import { parseInput } from '../http/validate.js';
import { listActiveMembershipsForUser } from '../modules/memberships/membership.service.js';
import { UserModel, isDemoEmail, toUserDto, type UserDocument } from '../users/user.model.js';
import { csrfProtection } from './csrf.js';
import { hashPassword, verifyPassword } from './password.js';
import { createRateLimiter } from './rate-limit.js';
import { authOf, clearSessionCookie, requireAuth, setSessionCookie } from './session.middleware.js';
import { createSession, destroySession } from './session.service.js';

const registerSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
  displayName: displayNameSchema,
  preferredLanguage: languageSchema.optional(),
});

// Login does not validate email format: any mismatch yields the same generic error.
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(1024),
});

const invalidCredentials = () =>
  new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
const emailUnavailable = () =>
  conflict('EMAIL_UNAVAILABLE', 'This email cannot be used to create an account');

export function createAuthRouter(config: AppConfig) {
  const router = Router();
  const registerLimiter = createRateLimiter(config.authRateLimit);
  const loginLimiter = createRateLimiter(config.authRateLimit);

  /** Issues a brand-new session (rotation): any session the request arrived with is destroyed. */
  async function signIn(req: Request, res: Response, user: UserDocument) {
    if (req.auth) await destroySession(req.auth.token);
    const { token, csrfToken, expiresAt } = await createSession(user._id, config.sessionTtlHours);
    setSessionCookie(res, config, token, expiresAt);
    return csrfToken;
  }

  router.post('/register', registerLimiter, async (req, res) => {
    const input = parseInput(registerSchema, req.body);
    if (config.production && isDemoEmail(input.email)) {
      throw validationError({ email: 'invalid_format' });
    }
    if (await UserModel.exists({ email: input.email })) throw emailUnavailable();

    let user: UserDocument;
    try {
      user = await UserModel.create({
        email: input.email,
        passwordHash: await hashPassword(input.password),
        displayName: input.displayName,
        preferredLanguage: input.preferredLanguage ?? 'ar',
        emailVerifiedAt: null,
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw emailUnavailable();
      throw err;
    }

    const csrfToken = await signIn(req, res, user);
    res.status(201).json({ user: toUserDto(user), csrfToken, memberships: [] });
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const input = parseInput(loginSchema, req.body);
    const user = await UserModel.findOne({ email: input.email }).select('+passwordHash');
    const valid = await verifyPassword(user?.passwordHash, input.password);
    if (!user || !valid || (config.production && isDemoEmail(user.email))) {
      throw invalidCredentials();
    }
    const csrfToken = await signIn(req, res, user);
    res.json({
      user: toUserDto(user),
      csrfToken,
      memberships: await listActiveMembershipsForUser(user._id),
    });
  });

  router.post('/logout', requireAuth, csrfProtection, async (req, res) => {
    await destroySession(authOf(req).token);
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  // Session probe for the web app: answers 200 { user: null } when signed out, so checking
  // "am I signed in?" is not an error. Every other protected endpoint returns 401.
  router.get('/session', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.auth) {
      res.json({ user: null, csrfToken: null, memberships: [] });
      return;
    }
    const { user, session } = req.auth;
    res.json({
      user: toUserDto(user),
      csrfToken: session.csrfToken,
      memberships: await listActiveMembershipsForUser(user._id),
    });
  });

  return router;
}
