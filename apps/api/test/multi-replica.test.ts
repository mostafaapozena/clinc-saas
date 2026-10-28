import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitCounterModel } from '../src/auth/rate-limit.js';
import { OwnershipInquiryModel } from '../src/modules/inquiries/inquiry.model.js';
import { seedSpecialties } from '../src/modules/specialties/specialty.seed.js';
import { TEST_PASSWORD, register, resetRateLimits, testApp } from './helpers/api.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// Two app instances sharing one database stand in for two API replicas behind a load balancer:
// nothing that protects or identifies a client may live only in one instance's memory.
// (scripts/ops/two-process-check.mjs repeats the key checks with two real OS processes.)

const limits = { authRateLimit: { max: 4, windowMs: 60_000 }, inquiryRateLimit: { max: 50, windowMs: 60_000 } };
const replicaA = testApp(limits);
const replicaB = testApp(limits);
const login = (app: ReturnType<typeof testApp>, email: string, forwardedFor?: string) => {
  const req = request(app).post('/api/v1/auth/login');
  return (forwardedFor ? req.set('X-Forwarded-For', forwardedFor) : req).send({ email, password: 'wrong-password-1' });
};

beforeAll(async () => {
  await connectTestDatabase('multi_replica');
  await seedSpecialties();
});
afterAll(() => dropTestDatabase());
beforeEach(() => resetRateLimits());
afterEach(() => vi.restoreAllMocks());

describe('shared rate limits across replicas', () => {
  it('counts attempts from one client together, whichever replica answers', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await login(i % 2 ? replicaB : replicaA, `nobody${i}@example.test`)).status);
    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    // In-memory counters would have allowed 4 more attempts on each replica.
    expect((await login(replicaB, 'other@example.test')).status).toBe(429);
  });

  it('limits attempts against one account from many addresses, without affecting other accounts', async () => {
    const proxied = { ...limits, trustProxy: true };
    const a = testApp(proxied);
    const b = testApp(proxied);
    const statuses: number[] = [];
    // Each attempt from a different client address: the per-address limit is never reached.
    for (let i = 0; i < 9; i++) statuses.push((await login(i % 2 ? b : a, 'victim@example.test', `203.0.113.${i + 1}`)).status);
    expect(statuses.slice(0, 8).every((s) => s === 401)).toBe(true);
    expect(statuses[8]).toBe(429);
    // Another account from the same addresses is unaffected (no cross-account or cross-tenant leakage).
    expect((await login(a, 'someone-else@example.test', '203.0.113.20')).status).toBe(401);
  });

  it('ignores forwarded-for headers unless a trusted proxy is configured (no evasion by header)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await login(replicaA, `spoof${i}@example.test`, `198.51.100.${i + 1}`)).status);
    expect(statuses.at(-1)).toBe(429);
  });

  it('refuses limited requests with 503 when the shared store fails — never unprotected', async () => {
    vi.spyOn(RateLimitCounterModel, 'findOneAndUpdate').mockImplementation(() => {
      throw new Error('store down');
    });
    const res = await login(replicaA, 'store@example.test');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('RATE_LIMIT_UNAVAILABLE');
    // Unlimited routes keep working.
    expect((await request(replicaA).get('/api/health/live')).status).toBe(200);
  });

  it('stores only hashed keys with a bounded lifetime', async () => {
    await login(replicaA, 'hashed@example.test', undefined);
    const counters = await RateLimitCounterModel.find().lean();
    expect(counters.length).toBeGreaterThan(0);
    for (const c of counters) {
      expect(c._id).not.toMatch(/127\.0\.0\.1|::ffff|@/);
      expect(c.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(2 * 60_000 + 1_000);
    }
  });
});

describe('other shared state across replicas', () => {
  it('a session created on one replica works and ends on the other', async () => {
    const user = await register(replicaA, 'replica-user');
    const cookie = (await request(replicaA).post('/api/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD })).headers[
      'set-cookie'
    ] as unknown as string[];
    const sid = cookie.map((c) => c.split(';')[0]).join('; ');
    const onB = await request(replicaB).get('/api/v1/auth/session').set('Cookie', sid);
    expect(onB.body.user?.email).toBe(user.email);
    await request(replicaB).post('/api/v1/auth/logout').set('Cookie', sid).set('X-CSRF-Token', onB.body.csrfToken);
    expect((await request(replicaA).get('/api/v1/auth/session').set('Cookie', sid)).body.user).toBeNull();
  });

  it('an idempotency key used on one replica replays on the other (one record)', async () => {
    const key = randomUUID();
    const body = {
      contactName: 'Replica Test',
      organizationName: 'Replica Center',
      country: 'EG',
      email: 'replica@example.test',
      organizationType: 'clinic',
      interest: 'custom',
      description: 'Synthetic inquiry sent twice through two replicas.',
      language: 'en',
    };
    const first = await request(replicaA).post('/api/v1/public/ownership-inquiries').set('Idempotency-Key', key).send(body);
    const second = await request(replicaB).post('/api/v1/public/ownership-inquiries').set('Idempotency-Key', key).send(body);
    expect(first.status).toBe(201);
    expect(second.body).toEqual({ reference: first.body.reference, replayed: true });
    expect(await OwnershipInquiryModel.countDocuments({ submissionKey: key })).toBe(1);
  });
});
