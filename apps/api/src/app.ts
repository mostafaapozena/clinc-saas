import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { createAuthRouter } from './auth/auth.routes.js';
import { csrfProtection, originCheck } from './auth/csrf.js';
import { configureRateLimitStore } from './auth/rate-limit.js';
import { loadSession } from './auth/session.middleware.js';
import { defaultAppConfig, type AppConfig } from './config/app-config.js';
import './db/models.js';
import { HttpError } from './http/errors.js';
import { healthRouter } from './modules/health/health.routes.js';
import { createMetricsRouter } from './modules/health/metrics.js';
import { createPublicRouter } from './modules/inquiries/inquiry.routes.js';
import { createOnboardingRouter } from './modules/onboarding/onboarding.routes.js';
import { createOrganizationsRouter } from './modules/organizations/organization.routes.js';
import { specialtiesRouter } from './modules/specialties/specialty.routes.js';
import { meRouter } from './users/me.routes.js';
import { loadOperator } from './modules/platform/operator-auth.js';
import { createPlatformRouter } from './modules/platform/platform.routes.js';
import { createWebhookRouter } from './modules/platform/subscription.routes.js';
import { createAccountRouter } from './auth/account.routes.js';
import { createMailer, type Mailer } from './modules/mail/mailer.js';
import { createInvitationAcceptRouter, createInvitationPreviewRouter } from './modules/memberships/invitation.routes.js';
import { logErrorReporter, type ErrorReporter } from './modules/ops/monitoring.js';
import { sessionsRouter } from './users/sessions.routes.js';

export type AppOptions = {
  logger?: Logger;
  config?: Partial<AppConfig>;
  /** Defaults to the configured mail provider (none or the development sink). */
  mailer?: Mailer;
  /** Defaults to the structured log. */
  errorReporter?: ErrorReporter;
};

function bodyParserStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('type' in err) || !('status' in err)) return;
  return typeof err.type === 'string' && err.type.startsWith('entity.') && typeof err.status === 'number'
    ? err.status
    : undefined;
}

export function createApp({ logger, config: overrides, mailer: givenMailer, errorReporter }: AppOptions = {}) {
  const config: AppConfig = { ...defaultAppConfig, ...overrides };
  const mailer = givenMailer ?? createMailer(config);
  const reporter = errorReporter ?? logErrorReporter(logger);
  // Before any router is built: every limiter picks up the shared store.
  configureRateLimitStore(config.rateLimitStore);
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.use(helmet());
  app.locals.subscriptionEnforcement = config.subscriptionEnforcement;
  // Payment-provider webhooks: before the JSON parser (signatures cover the raw bytes) and outside
  // cookies, sessions and CSRF — they are authenticated by their signature alone.
  app.use('/api/v1/billing/webhooks', (_req, res, next) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  }, createWebhookRouter(config));
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

  if (config.opsMetrics) app.use('/api/health/metrics', createMetricsRouter());
  app.use('/api/health', healthRouter);
  app.use('/api/v1/specialties', specialtiesRouter); // public platform catalog (not tenant data)
  // Anonymous website forms: no session involved, so no CSRF token; the origin check still
  // applies, and each route has its own rate limit.
  app.get('/api/v1/public/support-contact', (_req, res) => {
    res.json({ contact: config.supportContact });
  });
  app.use('/api/v1/public', createPublicRouter(config));
  app.use('/api/v1/auth', createAuthRouter(config));
  app.use('/api/v1/auth', createAccountRouter(config, mailer));
  app.use('/api/v1/invitations', createInvitationPreviewRouter());
  // Platform operator console: its own cookie, session and CSRF header; tenant sessions never
  // authenticate here and operator sessions never authenticate tenant routes.
  app.use('/api/v1/platform', loadOperator(config), createPlatformRouter(config, mailer));

  // Everything below changes state only with a valid CSRF token for the session.
  app.use('/api/v1', csrfProtection);
  app.use('/api/v1/me/sessions', sessionsRouter);
  app.use('/api/v1/me', meRouter);
  app.use('/api/v1/invitations', createInvitationAcceptRouter());
  app.use('/api/v1/onboarding', createOnboardingRouter(config));
  app.use('/api/v1/orgs', createOrganizationsRouter(config, mailer));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
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
    // A query that hit its time limit (maxTimeMS): the database is overloaded; ask to retry.
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === 50) {
      res.status(503).json({ error: { code: 'QUERY_TIMEOUT', message: 'The service is busy. Please try again.' } });
      return;
    }
    const parserStatus = bodyParserStatus(err);
    if (parserStatus) {
      res.status(parserStatus).json({ error: { code: 'VALIDATION_ERROR', message: 'Malformed request body' } });
      return;
    }
    reporter.report(err, { method: req.method, path: req.path, requestId: typeof req.id === 'string' || typeof req.id === 'number' ? String(req.id) : undefined });
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  };
  app.use(errorHandler);

  return app;
}
