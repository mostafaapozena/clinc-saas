import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionModel } from '../src/auth/session.model.js';
import { UserModel } from '../src/users/user.model.js';
import { TEST_PASSWORD, register, send, sessionCookie, testApp } from './helpers/api.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

const app = testApp();

beforeAll(() => connectTestDatabase('session'));
afterAll(() => dropTestDatabase());

describe('session lifecycle', () => {
  it('stores only a hash of the session token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'hash.check@example.test', password: TEST_PASSWORD, displayName: 'Hash' });
    const token = sessionCookie(res).split('=')[1] ?? '';
    const sessions = await SessionModel.find({ userId: res.body.user.id }).lean();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tokenHash).not.toBe(token);
    expect(JSON.stringify(sessions)).not.toContain(token);
  });

  it('logout invalidates the session on the server, not just the cookie', async () => {
    const registered = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'logout@example.test', password: TEST_PASSWORD, displayName: 'Logout' });
    const cookie = sessionCookie(registered);
    const userId = registered.body.user.id;
    expect(await SessionModel.countDocuments({ userId })).toBe(1);

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', registered.body.csrfToken);
    expect(logout.status).toBe(204);
    expect(await SessionModel.countDocuments({ userId })).toBe(0);

    // Replaying the old cookie (as an attacker who copied it would) no longer works.
    const replay = await request(app).get('/api/v1/auth/session').set('Cookie', cookie);
    expect(replay.status).toBe(401);
  });

  it('rotates the session identifier when signing in again', async () => {
    const first = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'rotate@example.test', password: TEST_PASSWORD, displayName: 'Rotate' });
    const firstCookie = sessionCookie(first);

    const second = await request(app)
      .post('/api/v1/auth/login')
      .set('Cookie', firstCookie)
      .send({ email: 'rotate@example.test', password: TEST_PASSWORD });
    const secondCookie = sessionCookie(second);

    expect(secondCookie).not.toBe(firstCookie);
    expect((await request(app).get('/api/v1/auth/session').set('Cookie', firstCookie)).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/session').set('Cookie', secondCookie)).status).toBe(200);
  });

  it('rejects an expired session and clears its cookie', async () => {
    const client = await register(app, 'expired');
    await SessionModel.updateMany({ userId: client.userId }, { expiresAt: new Date(Date.now() - 1000) });

    const res = await client.agent.get('/api/v1/auth/session');

    expect(res.status).toBe(401);
    expect(String(res.headers['set-cookie'])).toMatch(/clinc_sid=;/);
  });

  it('sets the expiry from the configured session lifetime', async () => {
    const shortApp = testApp({ sessionTtlHours: 2 });
    const res = await request(shortApp)
      .post('/api/v1/auth/register')
      .send({ email: 'ttl@example.test', password: TEST_PASSWORD, displayName: 'TTL' });
    const session = await SessionModel.findOne({ userId: res.body.user.id }).lean();
    const hours = ((session?.expiresAt.getTime() ?? 0) - Date.now()) / 3_600_000;

    expect(hours).toBeGreaterThan(1.9);
    expect(hours).toBeLessThanOrEqual(2);
  });

  it('marks cookies Secure with the __Host- prefix when configured for HTTPS', async () => {
    const secureApp = testApp({ cookieSecure: true });
    const res = await request(secureApp)
      .post('/api/v1/auth/register')
      .send({ email: 'secure@example.test', password: TEST_PASSWORD, displayName: 'Secure' });
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';

    expect(cookie).toMatch(/^__Host-clinc_sid=/);
    expect(cookie).toMatch(/Secure/);
  });
});

describe('CSRF protection', () => {
  it('rejects authenticated mutations without a valid CSRF token', async () => {
    const client = await register(app, 'csrf', 'Original');

    const missing = await client.agent.patch('/api/v1/me').send({ displayName: 'Hacked' });
    const wrong = await client.agent
      .patch('/api/v1/me')
      .set('X-CSRF-Token', 'not-the-token')
      .send({ displayName: 'Hacked' });

    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe('CSRF_INVALID');
    expect(wrong.status).toBe(403);
    expect((await UserModel.findById(client.userId))?.displayName).toBe('Original');

    const ok = await send(client, 'patch', '/api/v1/me', { displayName: 'Updated' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.displayName).toBe('Updated');
  });

  it('requires the token for logout too', async () => {
    const client = await register(app, 'csrf-logout');
    const res = await client.agent.post('/api/v1/auth/logout');

    expect(res.status).toBe(403);
    expect((await client.agent.get('/api/v1/auth/session')).status).toBe(200);
  });

  it('rejects cross-site origins even with a valid token', async () => {
    const client = await register(app, 'origin');
    const crossSite = await client.agent
      .patch('/api/v1/me')
      .set('X-CSRF-Token', client.csrf)
      .set('Origin', 'https://evil.example')
      .send({ displayName: 'Hacked' });
    const sameOrigin = await client.agent
      .patch('/api/v1/me')
      .set('X-CSRF-Token', client.csrf)
      .set('Host', 'clinic.example.test')
      .set('Origin', 'https://clinic.example.test')
      .send({ displayName: 'Fine' });

    expect(crossSite.status).toBe(403);
    expect(crossSite.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(sameOrigin.status).toBe(200);
  });

  it('applies the origin check to login and registration', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'x@example.test', password: TEST_PASSWORD });
    const fetchMetadata = await request(app)
      .post('/api/v1/auth/register')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ email: 'y@example.test', password: TEST_PASSWORD, displayName: 'Y' });

    expect(res.status).toBe(403);
    expect(fetchMetadata.status).toBe(403);
  });

  it('allows explicitly configured origins', async () => {
    const trustedApp = testApp({ allowedOrigins: ['https://trusted.example'] });
    const res = await request(trustedApp)
      .post('/api/v1/auth/register')
      .set('Origin', 'https://trusted.example')
      .send({ email: 'trusted@example.test', password: TEST_PASSWORD, displayName: 'T' });

    expect(res.status).toBe(201);
  });
});

describe('rate limiting', () => {
  it('limits repeated login attempts per client', async () => {
    const limitedApp = testApp({ authRateLimit: { max: 3, windowMs: 60_000 } });
    const attempt = () =>
      request(limitedApp).post('/api/v1/auth/login').send({ email: 'brute@example.test', password: 'guess-guess' });

    for (let i = 0; i < 3; i += 1) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['ratelimit-policy']).toBeDefined();
  });

  it('limits registration separately', async () => {
    const limitedApp = testApp({ authRateLimit: { max: 2, windowMs: 60_000 } });
    const attempt = (n: number) =>
      request(limitedApp)
        .post('/api/v1/auth/register')
        .send({ email: `burst${n}@example.test`, password: TEST_PASSWORD, displayName: 'B' });

    expect((await attempt(1)).status).toBe(201);
    expect((await attempt(2)).status).toBe(201);
    expect((await attempt(3)).status).toBe(429);
  });
});
