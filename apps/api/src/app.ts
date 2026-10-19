import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { healthRouter } from './modules/health/health.routes.js';
import { specialtiesRouter } from './modules/specialties/specialty.routes.js';

export type AppOptions = {
  logger?: Logger;
};

export function createApp({ logger }: AppOptions = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  if (logger) app.use(pinoHttp({ logger }));

  // Product modules register their routers here.
  app.use('/api/health', healthRouter);
  app.use('/api/v1/specialties', specialtiesRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    logger?.error({ err }, 'Unhandled request error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  };
  app.use(errorHandler);

  return app;
}
