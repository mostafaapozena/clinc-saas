import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../config/app-config.js';
import { HttpError } from '../http/errors.js';
import { emailSchema, newPasswordSchema } from '../http/schemas.js';
import { parseInput } from '../http/validate.js';
import type { Mailer } from '../modules/mail/mailer.js';
import { UserModel, isDemoEmail } from '../users/user.model.js';
import { csrfProtection } from './csrf.js';
import { hashPassword } from './password.js';
import { createRateLimiter } from './rate-limit.js';
import { authOf, clearSessionCookie, requireAuth } from './session.middleware.js';
import { SessionModel } from './session.model.js';
import { consumeAccountToken, issueAccountToken, revokeOpenTokens } from './token.model.js';

// Password recovery and email verification (docs/architecture/ACCOUNT_EMAIL.md). Responses never
// reveal whether an account exists; tokens are single-use, expiring and stored hashed.

const tokenSchema = z.string().trim().min(20).max(200);
const tokenInvalid = () => new HttpError(400, 'TOKEN_INVALID', 'This link is invalid, expired or already used');

export function createAccountRouter(config: AppConfig, mailer: Mailer) {
  const router = Router();
  const limiter = createRateLimiter(config.authRateLimit, 'account-email');
  const resetAccountLimiter = createRateLimiter({ ...config.authRateLimit, max: config.authRateLimit.max * 2 }, 'password-reset-account', 'account');

  router.post('/password-reset/request', limiter, resetAccountLimiter, async (req, res) => {
    const { email } = parseInput(z.object({ email: emailSchema }), req.body);
    const user = await UserModel.findOne({ email });
    if (user && !(config.production && isDemoEmail(user.email))) {
      await revokeOpenTokens('password_reset', { userId: user._id });
      const { raw } = await issueAccountToken('password_reset', { userId: user._id, email: user.email });
      await mailer.send({ to: user.email, template: 'password_reset', language: user.preferredLanguage, vars: { token: raw } });
    }
    // The same answer whether or not the account exists.
    res.status(202).json({ accepted: true });
  });

  router.post('/password-reset/confirm', limiter, async (req, res) => {
    const input = parseInput(z.object({ token: tokenSchema, password: newPasswordSchema }), req.body);
    const passwordHash = await hashPassword(input.password);
    const token = await consumeAccountToken('password_reset', input.token);
    if (!token?.userId) throw tokenInvalid();
    await UserModel.updateOne({ _id: token.userId }, { $set: { passwordHash } });
    // A new password ends every session of the account, including any on this device.
    await SessionModel.deleteMany({ userId: token.userId });
    if (req.auth?.user._id.equals(token.userId)) clearSessionCookie(res, config);
    res.json({ reset: true });
  });

  router.post('/email-verification/request', limiter, requireAuth, csrfProtection, async (req, res) => {
    const { user } = authOf(req);
    if (user.emailVerifiedAt) {
      res.json({ alreadyVerified: true });
      return;
    }
    await revokeOpenTokens('email_verification', { userId: user._id });
    const { raw } = await issueAccountToken('email_verification', { userId: user._id, email: user.email });
    await mailer.send({ to: user.email, template: 'email_verification', language: user.preferredLanguage, vars: { token: raw } });
    res.status(202).json({ accepted: true, mailer: mailer.name });
  });

  router.post('/email-verification/confirm', limiter, async (req, res) => {
    const { token: raw } = parseInput(z.object({ token: tokenSchema }), req.body);
    const token = await consumeAccountToken('email_verification', raw);
    if (!token?.userId) throw tokenInvalid();
    // Only the address the link was sent to is confirmed.
    await UserModel.updateOne({ _id: token.userId, email: token.email }, { $set: { emailVerifiedAt: new Date() } });
    res.json({ verified: true });
  });

  return router;
}
