import { Router } from 'express';
import { checkDatabase } from '../../db/connection.js';
import { lifecycle } from './lifecycle.js';

const startedAt = Date.now();

export type HealthResponse = {
  status: 'ok' | 'degraded';
  service: 'clinc-saas-api';
  uptimeSeconds: number;
  database: Awaited<ReturnType<typeof checkDatabase>>;
  timestamp: string;
};

export const healthRouter = Router();

/** Liveness: the process answers. Never depends on the database (restarts would not help). */
healthRouter.get('/live', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ status: 'alive' });
});

/** Readiness: send traffic only when the database answers, indexes are built and no shutdown is under way. */
healthRouter.get('/ready', async (_req, res) => {
  const database = await checkDatabase();
  const checks = { database: database.status === 'up', indexes: lifecycle.indexesReady, acceptingTraffic: !lifecycle.shuttingDown };
  const ready = Object.values(checks).every(Boolean);
  res.status(ready ? 200 : 503).set('Cache-Control', 'no-store').json({ status: ready ? 'ready' : 'not_ready', checks });
});

healthRouter.get('/', async (_req, res) => {
  const database = await checkDatabase();
  const ok = database.status === 'up';
  const body: HealthResponse = {
    status: ok ? 'ok' : 'degraded',
    service: 'clinc-saas-api',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    database,
    timestamp: new Date().toISOString(),
  };
  res.status(ok ? 200 : 503).set('Cache-Control', 'no-store').json(body);
});
