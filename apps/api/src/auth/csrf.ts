import type { RequestHandler } from 'express';
import type { AppConfig } from '../config/app-config.js';
import { forbidden } from '../http/errors.js';
import { constantTimeEqual } from './session.service.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Rejects state-changing browser requests from other sites. The browser-set Origin must
 * match the host the request was sent to (same-origin, also through the dev proxy) or an
 * explicitly configured origin. Requests without Origin (non-browser clients) pass here
 * but still need the CSRF token when they use a session.
 */
export function originCheck(config: AppConfig): RequestHandler {
  return (req, _res, next) => {
    if (!UNSAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (!origin) {
      if (req.get('sec-fetch-site') === 'cross-site') throw forbidden('ORIGIN_NOT_ALLOWED');
      return next();
    }
    if (config.allowedOrigins.includes(origin)) return next();
    if (URL.canParse(origin) && new URL(origin).host === req.get('host')) return next();
    throw forbidden('ORIGIN_NOT_ALLOWED', 'Request origin is not allowed');
  };
}

/** Synchronizer-token check for every state-changing request made with a session cookie. */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (!UNSAFE_METHODS.has(req.method) || !req.auth) return next();
  const token = req.get('x-csrf-token');
  if (!token || !constantTimeEqual(token, req.auth.session.csrfToken)) {
    throw forbidden('CSRF_INVALID', 'Missing or invalid CSRF token');
  }
  next();
};
