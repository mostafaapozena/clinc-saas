import type { Request, RequestHandler, Response } from 'express';
import type { AppConfig } from '../config/app-config.js';
import { unauthenticated } from '../http/errors.js';
import { UserModel, type UserDocument } from '../users/user.model.js';
import type { SessionDocument } from './session.model.js';
import { findValidSession } from './session.service.js';

export type AuthContext = {
  user: UserDocument;
  session: SessionDocument;
  token: string;
};

// The __Host- prefix makes browsers enforce Secure, Path=/ and no Domain attribute.
export const sessionCookieName = (config: AppConfig) =>
  config.cookieSecure ? '__Host-clinc_sid' : 'clinc_sid';

function cookieOptions(config: AppConfig) {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/' } as const;
}

export function setSessionCookie(res: Response, config: AppConfig, token: string, expires: Date) {
  res.cookie(sessionCookieName(config), token, { ...cookieOptions(config), expires });
}

export function clearSessionCookie(res: Response, config: AppConfig) {
  res.clearCookie(sessionCookieName(config), cookieOptions(config));
}

/** Resolves the session cookie on every API request. Invalid or expired sessions are cleared. */
export function loadSession(config: AppConfig): RequestHandler {
  return async (req, res, next) => {
    const token: unknown = req.cookies?.[sessionCookieName(config)];
    if (typeof token === 'string' && token.length > 0) {
      const session = await findValidSession(token);
      const user = session ? await UserModel.findById(session.userId) : null;
      if (session && user) {
        req.auth = { user, session, token };
      } else {
        clearSessionCookie(res, config);
      }
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) throw unauthenticated();
  next();
};

export function authOf(req: Request): AuthContext {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}
