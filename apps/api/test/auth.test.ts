import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UserModel } from '../src/users/user.model.js';
import { TEST_PASSWORD, register, sessionCookie, testApp, uniqueEmail } from './helpers/api.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

const app = testApp();

beforeAll(() => connectTestDatabase('auth'));
afterAll(() => dropTestDatabase());

describe('registration', () => {
  it('creates an unverified account, starts a session and never returns password data', async () => {
    const email = uniqueEmail('Mixed.Case');
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `  ${email.toUpperCase()} `, password: TEST_PASSWORD, displayName: ' Mona ' });

    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({
      id: expect.any(String),
      email: email.toLowerCase(),
      displayName: 'Mona',
      preferredLanguage: 'ar',
      emailVerified: false,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
    expect(res.body.csrfToken).toEqual(expect.any(String));

    const cookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    expect(cookie).toMatch(/^clinc_sid=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Expires=/);

    const stored = await UserModel.findOne({ email: email.toLowerCase() }).select('+passwordHash');
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored?.emailVerifiedAt).toBeNull();
  });

  it('enforces email uniqueness regardless of case and whitespace', async () => {
    const email = uniqueEmail('dup');
    await request(app).post('/api/v1/auth/register').send({ email, password: TEST_PASSWORD, displayName: 'A' });
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: ` ${email.toUpperCase()}`, password: TEST_PASSWORD, displayName: 'B' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_UNAVAILABLE');
    expect(await UserModel.countDocuments({ email })).toBe(1);
  });

  it('validates every field on the server', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { email: 'invalid_format', password: 'too_short', displayName: 'required' },
    });
  });

  it('ignores client-supplied privileged fields', async () => {
    const email = uniqueEmail('sneaky');
    const res = await request(app).post('/api/v1/auth/register').send({
      email,
      password: TEST_PASSWORD,
      displayName: 'Sneaky',
      emailVerifiedAt: new Date().toISOString(),
      role: 'owner',
    });

    expect(res.status).toBe(201);
    expect(res.body.user.emailVerified).toBe(false);
    expect(res.body.memberships).toEqual([]);
  });
});

describe('login', () => {
  it('signs in with the right password (email is case-insensitive)', async () => {
    const { email } = await register(app, 'login');
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: email.toUpperCase(), password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
    expect(res.body.memberships).toEqual([]);
    expect(sessionCookie(res)).toMatch(/^clinc_sid=/);
  });

  it('gives the same generic error for a wrong password and an unknown account', async () => {
    const { email } = await register(app, 'generic');
    const wrongPassword = await request(app).post('/api/v1/auth/login').send({ email, password: 'nope-nope-nope' });
    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail('ghost'), password: TEST_PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
  });

  it('rejects protected endpoints without a session', async () => {
    const probe = await request(app).get('/api/v1/auth/session');
    expect(probe.status).toBe(200);
    expect(probe.body).toEqual({ user: null, csrfToken: null, memberships: [] });

    for (const res of [
      await request(app).get(`/api/v1/orgs/${'a'.repeat(24)}`),
      await request(app).get('/api/v1/orgs'),
      await request(app).patch('/api/v1/me').send({ displayName: 'x' }),
    ]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });
});
