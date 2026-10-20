import { Router } from 'express';
import { checkDatabase } from '../../db/connection.js';

const startedAt = Date.now();

export type HealthResponse = {
  status: 'ok' | 'degraded';
  service: 'clinc-saas-api';
  uptimeSeconds: number;
  database: Awaited<ReturnType<typeof checkDatabase>>;
  timestamp: string;
};

export const healthRouter = Router();

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
