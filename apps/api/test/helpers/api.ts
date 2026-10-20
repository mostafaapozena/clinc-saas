import request from 'supertest';
import { expect } from 'vitest';
import { createApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config/app-config.js';
import type { Role } from '../../src/tenancy/permissions.js';

export type App = ReturnType<typeof createApp>;
export type Agent = ReturnType<typeof request.agent>;
export type Client = { agent: Agent; csrf: string; userId: string; email: string };

// Throwaway credential for throwaway test databases only.
export const TEST_PASSWORD = 'test-only-password-123';

/** App with a generous rate limit so suites can register many users; tests override. */
export function testApp(config: Partial<AppConfig> = {}): App {
  return createApp({ config: { authRateLimit: { max: 10_000, windowMs: 60_000 }, ...config } });
}

let counter = 0;
export const uniqueEmail = (label: string) => `${label}.${process.pid}.${++counter}@example.test`;

export async function register(app: App, label: string, displayName = label): Promise<Client> {
  const agent = request.agent(app);
  const email = uniqueEmail(label);
  const res = await agent
    .post('/api/v1/auth/register')
    .send({ email, password: TEST_PASSWORD, displayName });
  expect(res.status).toBe(201);
  return { agent, csrf: res.body.csrfToken, userId: res.body.user.id, email };
}

/** Authenticated mutation with the session's CSRF token. */
export function send(client: Client, method: 'post' | 'patch' | 'put' | 'delete', url: string, body: object = {}) {
  return client.agent[method](url).set('X-CSRF-Token', client.csrf).send(body);
}

export async function createOrg(
  client: Client,
  name = 'Test Clinic',
  branchName = 'Main branch',
  timeZone = 'Africa/Cairo',
) {
  const res = await send(client, 'post', '/api/v1/orgs', { name, timeZone, branch: { name: branchName } });
  expect(res.status).toBe(201);
  return { orgId: res.body.organization.id as string, branchId: res.body.branch.id as string };
}

export async function addBranch(client: Client, orgId: string, name: string): Promise<string> {
  const res = await send(client, 'post', `/api/v1/orgs/${orgId}/branches`, { name });
  expect(res.status).toBe(201);
  return res.body.branch.id;
}

export async function addMember(
  actor: Client,
  orgId: string,
  member: Client,
  role: Role,
  branchIds?: string[],
): Promise<string> {
  const res = await send(actor, 'post', `/api/v1/orgs/${orgId}/members`, {
    email: member.email,
    role,
    branchScope: branchIds ? { type: 'selected', branchIds } : { type: 'all' },
  });
  expect(res.status).toBe(201);
  return res.body.member.id;
}

export function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const cookies = res.headers['set-cookie'] as string[] | undefined;
  const cookie = cookies?.find((c) => c.startsWith('clinc_sid='));
  if (!cookie) throw new Error('No session cookie in response');
  return cookie.split(';')[0] ?? '';
}
