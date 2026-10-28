import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { createAuthRouter } from './auth/auth.routes.js';
import { csrfProtection, originCheck } from './auth/csrf.js';
import { loadSession } from './auth/session.middleware.js';
import { defaultAppConfig, type AppConfig } from './config/app-config.js';
import './db/models.js';
import { HttpError } from './http/errors.js';
import { healthRouter } from './modules/health/health.routes.js';
import { createPublicRouter } from './modules/inquiries/inquiry.routes.js';
import { createOnboardingRouter } from './modules/onboarding/onboarding.routes.js';
import { createOrganizationsRouter } from './modules/organizations/organization.routes.js';
import { specialtiesRouter } from './modules/specialties/specialty.routes.js';
import { meRouter } from './users/me.routes.js';

export type AppOptions = {
  logger?: Logger;
  config?: Partial<AppConfig>;
};

function bodyParserStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('type' in err) || !('status' in err)) return;
  return typeof err.type === 'string' && err.type.startsWith('entity.') && typeof err.status === 'number'
    ? err.status
    : undefined;
}

export function createApp({ logger, config: overrides }: AppOptions = {}) {
  const config: AppConfig = { ...defaultAppConfig, ...overrides };
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  if (logger) {
    app.use(
      pinoHttp({
        logger,
        // Request lines only: no headers, and no query string (patient searches carry names and
        // phone numbers there). Bodies are never logged.
        serializers: {
          req: (req: { id?: unknown; method?: string; url?: string }) => ({
            id: req.id,
            method: req.method,
            path: String(req.url ?? '').split('?')[0],
          }),
        },
      }),
    );
  }

  // No CORS middleware on purpose: the web app reaches the API same-origin (via the proxy),
  // so browsers block cross-origin reads, and originCheck blocks cross-site writes.
  // API responses are never meant for search engines, whatever the environment.
  app.use('/api', (_req, res, next) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
  app.use('/api', cookieParser(), loadSession(config), originCheck(config));

  app.use('/api/health', healthRouter);
  app.use('/api/v1/specialties', specialtiesRouter); // public platform catalog (not tenant data)
  // Anonymous website forms: no session involved, so no CSRF token; the origin check still
  // applies, and each route has its own rate limit.
  app.use('/api/v1/public', createPublicRouter(config));
  app.use('/api/v1/auth', createAuthRouter(config));

  // Everything below changes state only with a valid CSRF token for the session.
  app.use('/api/v1', csrfProtection);
  app.use('/api/v1/me', meRouter);
  app.use('/api/v1/onboarding', createOnboardingRouter(config));
  app.use('/api/v1/orgs', createOrganizationsRouter(config));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({
        error: {
          code: err.code,
          message: err.message,
          ...(err.fields ? { fields: err.fields } : {}),
          ...(err.details ? { details: err.details } : {}),
        },
      });
      return;
    }
    const parserStatus = bodyParserStatus(err);
    if (parserStatus) {
      res.status(parserStatus).json({ error: { code: 'VALIDATION_ERROR', message: 'Malformed request body' } });
      return;
    }
    logger?.error({ err }, 'Unhandled request error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  };
  app.use(errorHandler);

  return app;
}
