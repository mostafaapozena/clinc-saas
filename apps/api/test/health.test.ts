import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

const app = createApp();

describe('GET /api/health without a database connection', () => {
  it('reports degraded with HTTP 503', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: 'degraded',
      service: 'clinc-saas-api',
      database: { status: 'down', latencyMs: null },
    });
  });
});

describe('GET /api/health with a database connection', () => {
  beforeAll(() => connectTestDatabase('health'));
  afterAll(() => dropTestDatabase());

  it('pings MongoDB and reports ok', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.status).toBe('ok');
    expect(res.body.database.status).toBe('up');
    expect(res.body.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(res.body.timestamp)).not.toBeNaN();
  });
});

describe('unknown API routes', () => {
  it('return a JSON 404 with security headers', async () => {
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
