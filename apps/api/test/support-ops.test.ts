import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password.js';
import { SessionModel } from '../src/auth/session.model.js';
import { AccountTokenModel, issueAccountToken } from '../src/auth/token.model.js';
import { parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/logger.js';
import { AuditEventModel } from '../src/modules/audit/audit-event.model.js';
import { lifecycle } from '../src/modules/health/lifecycle.js';
import { DevMailModel, type MailTemplate } from '../src/modules/mail/mailer.js';
import { MembershipModel } from '../src/modules/memberships/membership.model.js';
import { backupDatabase, dropDrillDatabase, restoreInto } from '../src/modules/ops/backup.js';
import { retentionReport } from '../src/modules/ops/retention.js';
import { OperatorModel, PlatformAuditModel } from '../src/modules/platform/operator.model.js';
import { seedSpecialties } from '../src/modules/specialties/specialty.seed.js';
import { SupportRequestModel } from '../src/modules/support/support.model.js';
import { TEST_PASSWORD, addMember, createOrg, register, send, testApp, uniqueEmail, type Client } from './helpers/api.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

const app = testApp({ mailProvider: 'dev_sink', appBaseUrl: 'https://app.example.test' });

const tokenFrom = async (to: string, template: MailTemplate) => {
  const mail = await DevMailModel.findOne({ to, template }).sort({ createdAt: -1 }).lean();
  const match = mail ? /token=([A-Za-z0-9_-]+)/.exec(mail.text) : null;
  if (!match?.[1]) throw new Error(`No ${template} mail for ${to}`);
  return match[1];
};
async function loginAs(email: string, password = TEST_PASSWORD): Promise<Client> {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { agent, csrf: res.body.csrfToken, userId: res.body.user.id, email };
}

let owner: Client;
let orgId: string;
let branchId: string;

beforeAll(async () => {
  await connectTestDatabase('support_ops');
  await seedSpecialties();
  owner = await register(app, 'ops-owner');
  ({ orgId, branchId } = await createOrg(owner, 'Ops Clinic'));
});
afterAll(() => dropTestDatabase());

describe('password recovery', () => {
  it('answers the same for unknown and known addresses and sends a link only to real accounts', async () => {
    const user = await register(app, 'reset-user');
    const unknown = await request(app).post('/api/v1/auth/password-reset/request').send({ email: 'nobody.here@example.test' });
    const known = await request(app).post('/api/v1/auth/password-reset/request').send({ email: user.email });
    expect(unknown.status).toBe(202);
    expect(known.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    expect(await DevMailModel.countDocuments({ to: 'nobody.here@example.test' })).toBe(0);
    const mail = await DevMailModel.findOne({ to: user.email, template: 'password_reset' }).lean();
    expect(mail?.text).toContain('https://app.example.test/reset-password?token=');
  });

  it('resets once with a single-use hashed token, ends every session, and a newer link replaces older ones', async () => {
    const user = await register(app, 'reset-flow');
    const other = await loginAs(user.email);
    await request(app).post('/api/v1/auth/password-reset/request').send({ email: user.email });
    const first = await tokenFrom(user.email, 'password_reset');
    await request(app).post('/api/v1/auth/password-reset/request').send({ email: user.email });
    const second = await tokenFrom(user.email, 'password_reset');
    expect(second).not.toBe(first);
    // Only hashes are stored.
    expect(await AccountTokenModel.exists({ tokenHash: second })).toBeNull();

    expect(
      (await request(app).post('/api/v1/auth/password-reset/confirm').send({ token: first, password: 'a-new-password-1' })).body.error.code,
    ).toBe('TOKEN_INVALID');
    expect((await request(app).post('/api/v1/auth/password-reset/confirm').send({ token: second, password: 'short' })).status).toBe(400);
    const results = await Promise.all(
      [1, 2].map(() => request(app).post('/api/v1/auth/password-reset/confirm').send({ token: second, password: 'a-new-password-1' })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);

    expect((await user.agent.get('/api/v1/auth/session')).body.user).toBeNull();
    expect((await other.agent.get('/api/v1/auth/session')).body.user).toBeNull();
    expect((await request(app).post('/api/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD })).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'a-new-password-1' })).status).toBe(200);
  });

  it('refuses expired tokens', async () => {
    const user = await register(app, 'reset-expired');
    const { raw } = await issueAccountToken(
      'password_reset',
      { userId: new mongoose.Types.ObjectId(user.userId), email: user.email },
      new Date(Date.now() - 2 * 3_600_000),
    );
    expect(
      (await request(app).post('/api/v1/auth/password-reset/confirm').send({ token: raw, password: 'a-new-password-1' })).body.error.code,
    ).toBe('TOKEN_INVALID');
  });
});

describe('email verification', () => {
  it('requires a session and CSRF to request, and confirms only the address it was sent to', async () => {
    const user = await register(app, 'verify-user');
    expect((await request(app).post('/api/v1/auth/email-verification/request')).status).toBe(401);
    expect((await user.agent.post('/api/v1/auth/email-verification/request')).status).toBe(403);
    expect((await send(user, 'post', '/api/v1/auth/email-verification/request')).status).toBe(202);
    const token = await tokenFrom(user.email, 'email_verification');
    expect((await request(app).post('/api/v1/auth/email-verification/confirm').send({ token })).body).toEqual({ verified: true });
    expect((await user.agent.get('/api/v1/auth/session')).body.user.emailVerified).toBe(true);
    expect((await request(app).post('/api/v1/auth/email-verification/confirm').send({ token })).status).toBe(400);
    expect((await send(user, 'post', '/api/v1/auth/email-verification/request')).body).toEqual({ alreadyVerified: true });
  });
});

describe('invitations', () => {
  it('invites an address with a role; only that address can accept, once', async () => {
    const email = uniqueEmail('invitee');
    const res = await send(owner, 'post', `/api/v1/orgs/${orgId}/invitations`, {
      email,
      role: 'receptionist',
      branchScope: { type: 'selected', branchIds: [branchId] },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const token = await tokenFrom(email, 'invitation');
    const preview = await request(app).post('/api/v1/invitations/preview').send({ token });
    expect(preview.body).toMatchObject({ organizationName: 'Ops Clinic', role: 'receptionist', email });

    const stranger = await register(app, 'not-invited');
    // The read-only preview works for a signed-in browser without its CSRF token (found by e2e).
    expect((await stranger.agent.post('/api/v1/invitations/preview').send({ token })).status).toBe(200);
    expect((await send(stranger, 'post', '/api/v1/invitations/accept', { token })).body.error.code).toBe('INVITATION_EMAIL_MISMATCH');

    const agent = request.agent(app);
    const reg = await agent.post('/api/v1/auth/register').send({ email, password: TEST_PASSWORD, displayName: 'Invitee' });
    const invitee: Client = { agent, csrf: reg.body.csrfToken, userId: reg.body.user.id, email };
    const accepted = await send(invitee, 'post', '/api/v1/invitations/accept', { token });
    expect(accepted.body).toEqual({ organizationId: orgId });
    const membership = await MembershipModel.findOne({ organizationId: orgId, userId: invitee.userId }).lean();
    expect(membership).toMatchObject({ role: 'receptionist', status: 'active', branchScope: { type: 'selected' } });
    expect((await send(invitee, 'post', '/api/v1/invitations/accept', { token })).body.error.code).toBe('TOKEN_INVALID');
    expect((await send(owner, 'post', `/api/v1/orgs/${orgId}/invitations`, { email, role: 'viewer' })).body.error.code).toBe(
      'ALREADY_MEMBER',
    );
  });

  it('only owners and admins invite; the owner role cannot be invited; revoked invitations stop working', async () => {
    const reception = await register(app, 'inv-reception');
    await addMember(owner, orgId, reception, 'receptionist', [branchId]);
    expect((await send(reception, 'post', `/api/v1/orgs/${orgId}/invitations`, { email: uniqueEmail('x'), role: 'viewer' })).status).toBe(
      403,
    );
    expect((await send(owner, 'post', `/api/v1/orgs/${orgId}/invitations`, { email: uniqueEmail('x'), role: 'owner' })).status).toBe(400);
    const email = uniqueEmail('revoked');
    const created = await send(owner, 'post', `/api/v1/orgs/${orgId}/invitations`, { email, role: 'viewer' });
    const token = await tokenFrom(email, 'invitation');
    expect((await owner.agent.get(`/api/v1/orgs/${orgId}/invitations`)).body.data.map((i: { email: string }) => i.email)).toContain(email);
    expect((await send(owner, 'post', `/api/v1/orgs/${orgId}/invitations/${created.body.invitation.id}/revoke`)).status).toBe(204);
    expect((await request(app).post('/api/v1/invitations/preview').send({ token })).status).toBe(400);
    // Audit has no addresses.
    const audits = await AuditEventModel.find({ organizationId: orgId, action: 'member.invited' }).lean();
    expect(JSON.stringify(audits)).not.toContain(email);
  });
});

describe('support requests', () => {
  let reception: Client;
  let reception2: Client;
  let reference: string;
  let requestId: string;

  it('anyone in the organization asks; people see their own, owners and admins see all', async () => {
    reception = await register(app, 'sup-reception');
    reception2 = await register(app, 'sup-reception2');
    await addMember(owner, orgId, reception, 'receptionist', [branchId]);
    await addMember(owner, orgId, reception2, 'receptionist', [branchId]);
    const created = await send(reception, 'post', `/api/v1/orgs/${orgId}/support`, {
      subject: 'Cannot print receipts',
      category: 'finance',
      body: 'Synthetic: the print page is blank.',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.request).toMatchObject({ status: 'open', reference: expect.stringMatching(/^S-[A-Z2-9]{8}$/), messageCount: 1 });
    ({ reference, id: requestId } = created.body.request);

    expect((await reception2.agent.get(`/api/v1/orgs/${orgId}/support`)).body.data).toEqual([]);
    expect((await reception2.agent.get(`/api/v1/orgs/${orgId}/support/${requestId}`)).status).toBe(404);
    expect((await owner.agent.get(`/api/v1/orgs/${orgId}/support`)).body.data.map((r: { reference: string }) => r.reference)).toContain(
      reference,
    );

    const outsider = await register(app, 'sup-outsider');
    const { orgId: otherOrg } = await createOrg(outsider, 'Other Org');
    expect((await outsider.agent.get(`/api/v1/orgs/${otherOrg}/support/${requestId}`)).status).toBe(404);
    expect(
      (await send(reception, 'post', `/api/v1/orgs/${orgId}/support`, { subject: 'Too long', category: 'other', body: 'x'.repeat(2001) }))
        .status,
    ).toBe(400);
  });

  it('operators work the queue across organizations with masked requester contact; audits carry no message text', async () => {
    await OperatorModel.create({
      email: 'support.queue@example.test',
      displayName: 'Queue',
      role: 'support',
      passwordHash: await hashPassword(TEST_PASSWORD),
    });
    const op = request.agent(app);
    const login = await op.post('/api/v1/platform/auth/login').send({ email: 'support.queue@example.test', password: TEST_PASSWORD });
    const csrf = login.body.csrfToken as string;
    const queue = await op.get('/api/v1/platform/support?status=open');
    expect(queue.body.data.find((r: { reference: string }) => r.reference === reference)).toMatchObject({
      organization: { name: 'Ops Clinic' },
    });
    const detail = await op.get(`/api/v1/platform/support/${reference}`);
    expect(detail.body.request.requester.email).toMatch(/^s•••@example\.test$/);
    const replied = await op
      .post(`/api/v1/platform/support/${reference}/messages`)
      .set('X-Operator-CSRF', csrf)
      .send({ body: 'Synthetic reply: please retry.' });
    expect(replied.body.request).toMatchObject({ status: 'answered', messageCount: 2 });

    const seen = await reception.agent.get(`/api/v1/orgs/${orgId}/support/${requestId}`);
    expect(seen.body.request.messages[1]).toMatchObject({ author: 'operator', displayName: 'raclinic' });
    expect((await send(reception, 'post', `/api/v1/orgs/${orgId}/support/${requestId}/close`)).body.request.status).toBe('closed');
    expect(
      (await send(reception, 'post', `/api/v1/orgs/${orgId}/support/${requestId}/messages`, { body: 'Synthetic: it happened again.' })).body
        .request.status,
    ).toBe('open');

    const platformAudit = await PlatformAuditModel.find({ 'target.id': reference }).lean();
    const tenantAudit = await AuditEventModel.find({
      organizationId: orgId,
      action: { $in: ['support.request_created', 'support.request_closed'] },
    }).lean();
    expect(platformAudit.map((e) => e.action)).toContain('support.replied');
    expect(JSON.stringify([platformAudit, tenantAudit])).not.toMatch(/Synthetic/);
    await expect(SupportRequestModel.deleteOne({ reference })).rejects.toThrow(/not deleted/);
  });
});

describe('sessions', () => {
  it('lists the user own sessions, signs out others, and refuses to end the current one this way', async () => {
    const user = await register(app, 'sess-user');
    const second = await loginAs(user.email);
    const list = await user.agent.get('/api/v1/me/sessions');
    expect(list.body.data).toHaveLength(2);
    const current = list.body.data.find((s: { current: boolean }) => s.current);
    const other = list.body.data.find((s: { current: boolean }) => !s.current);
    expect(JSON.stringify(list.body)).not.toMatch(/token/i);
    expect((await send(user, 'delete', `/api/v1/me/sessions/${current.id}`)).body.error.code).toBe('USE_LOGOUT');
    expect((await send(user, 'delete', `/api/v1/me/sessions/${other.id}`)).status).toBe(204);
    expect((await second.agent.get('/api/v1/auth/session')).body.user).toBeNull();
    const third = await loginAs(user.email);
    expect((await send(user, 'post', '/api/v1/me/sessions/revoke-others')).body).toEqual({ revoked: 1 });
    expect((await third.agent.get('/api/v1/auth/session')).body.user).toBeNull();
    // Another user's session id is not found.
    expect((await send(owner, 'delete', `/api/v1/me/sessions/${current.id}`)).status).toBe(404);
  });

  it('ends sessions idle for longer than the configured timeout and deletes them', async () => {
    const idleApp = testApp({ sessionIdleMinutes: 30 });
    const user = await register(idleApp, 'idle-user');
    expect((await user.agent.get('/api/v1/auth/session')).body.user).not.toBeNull();
    await SessionModel.updateMany({ userId: user.userId }, { $set: { lastSeenAt: new Date(Date.now() - 31 * 60_000) } });
    expect((await user.agent.get('/api/v1/auth/session')).body.user).toBeNull();
    expect(await SessionModel.countDocuments({ userId: user.userId })).toBe(0);
  });
});

describe('operational endpoints and configuration', () => {
  it('liveness, readiness and shutdown', async () => {
    expect((await request(app).get('/api/health/live')).status).toBe(200);
    expect((await request(app).get('/api/health/ready')).body).toEqual({
      status: 'ready',
      checks: { database: true, indexes: true, acceptingTraffic: true },
    });
    lifecycle.shuttingDown = true;
    try {
      expect((await request(app).get('/api/health/ready')).status).toBe(503);
    } finally {
      lifecycle.shuttingDown = false;
    }
  });

  it('shows only configured support contact details — nothing invented', async () => {
    expect((await request(app).get('/api/v1/public/support-contact')).body).toEqual({ contact: { email: null, phone: null, hours: null } });
    const configured = testApp({ supportContact: { email: 'help@example.test', phone: null, hours: null } });
    expect((await request(configured).get('/api/v1/public/support-contact')).body.contact.email).toBe('help@example.test');
  });

  it('validates environment: no dev mail sink in production, blank values unset, hours in both languages', () => {
    const base = { MONGODB_URI: 'mongodb://localhost:27017', NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'true' };
    expect(() => parseEnv({ ...base, MAIL_PROVIDER: 'dev_sink' })).toThrow(/mail sink is refused/);
    expect(parseEnv({ ...base, SUPPORT_CONTACT_EMAIL: '', BILLING_SIMULATOR_SECRET: '' })).toMatchObject({
      SUPPORT_CONTACT_EMAIL: undefined,
      BILLING_SIMULATOR_SECRET: undefined,
      SESSION_IDLE_MINUTES: 120,
    });
    expect(() => parseEnv({ ...base, SUPPORT_HOURS_AR: 'من 9 إلى 5' })).toThrow(/SUPPORT_HOURS_AR and SUPPORT_HOURS_EN/);
  });

  it('redacts secrets from structured logs', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const logger = createLogger({ LOG_LEVEL: 'info' }, stream);
    logger.info({ body: { password: 'p@ss-secret', token: 'tok-secret' }, user: { passwordHash: 'hash-secret' } }, 'x');
    expect(lines.join('')).not.toMatch(/p@ss-secret|tok-secret|hash-secret/);
  });
});

describe('backup and restore drill', () => {
  it('restores into an isolated database with identical content and indexes, and refuses unsafe targets', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'raclinic-test-'));
    const file = path.join(dir, 'b.jsonl.gz');
    const target = `clinc_restore_test_${process.pid}`;
    try {
      const db = mongoose.connection.db!;
      const header = await backupDatabase(db, file);
      expect(header.collections.find((c) => c.name === 'users')?.count).toBeGreaterThan(0);
      const result = await restoreInto(file, target, db.databaseName);
      expect(result.ok, JSON.stringify(result.collections.filter((c) => !c.digestMatches || c.expected !== c.restored))).toBe(true);
      const restoredUsers = await mongoose.connection.useDb(target, { useCache: false }).collection('users').indexes();
      expect(restoredUsers.some((i) => i.unique && 'email' in i.key)).toBe(true);
      await expect(restoreInto(file, target, db.databaseName)).rejects.toThrow(/non-empty/);
      await expect(restoreInto(file, db.databaseName, db.databaseName)).rejects.toThrow(/clinc_restore_/);
    } finally {
      await dropDrillDatabase(target);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the retention report counts and never deletes', async () => {
    const before = await SupportRequestModel.countDocuments();
    const rows = await retentionReport({ RETENTION_SUPPORT_DAYS: '1' }, new Date(Date.now() + 3 * 86_400_000));
    expect(rows.find((r) => r.dataClass === 'support_requests')).toMatchObject({ configuredDays: 1, olderThanPeriod: before });
    expect(rows.find((r) => r.dataClass === 'audit_events')).toMatchObject({ configuredDays: null, olderThanPeriod: null });
    expect(await SupportRequestModel.countDocuments()).toBe(before);
  });
});
