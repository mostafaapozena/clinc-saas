#!/usr/bin/env node
// Two real API processes sharing one throwaway database (docs/architecture/SCALABILITY_REVIEW.md).
// Checks that protection and correctness do not depend on which replica answers: shared rate
// limits, sessions, idempotency, signed-webhook dedupe, and booking the same slot concurrently.
// Synthetic data only. Usage (inside the Codespace): node scripts/ops/two-process-check.mjs
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';

const BASE_URI = process.env.MONGODB_TEST_URI ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017/?directConnection=true';
const DB = `clinc_replica_check_test_${Date.now()}`;
const SECRET = randomUUID() + randomUUID();
const PORTS = [4201, 4202];
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);

function startReplica(port) {
  // node --import tsx (not npx): SIGTERM must reach the server itself, not a wrapper process.
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/server.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
      PORT: String(port),
      MONGODB_URI: BASE_URI,
      MONGODB_DB_NAME: DB,
      AUTH_RATE_LIMIT_MAX: '4',
      SETUP_RATE_LIMIT_MAX: '100',
      INQUIRY_RATE_LIMIT_MAX: '100',
      RATE_LIMIT_STORE: 'mongo',
      BILLING_PROVIDER: 'simulator',
      BILLING_SIMULATOR_SECRET: SECRET,
      MAIL_PROVIDER: 'none',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.env.DEBUG_REPLICAS && process.stderr.write(`[${port}] ${d}`));
  return child;
}
async function waitReady(port) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health/ready`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`replica ${port} not ready`);
}

const url = (i, path) => `http://127.0.0.1:${PORTS[i % 2]}${path}`;
async function call(i, method, path, { body, cookie, csrf, headers = {} } = {}) {
  const res = await fetch(url(i, path), {
    signal: AbortSignal.timeout(15_000),
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* empty */
  }
  return {
    status: res.status,
    json,
    cookie: res.headers
      .getSetCookie?.()
      .map((c) => c.split(';')[0])
      .join('; '),
  };
}

// The platform specialty catalog (reference data) must exist in the fresh database.
const seed = spawnSync(
  process.execPath,
  [
    '--import',
    'tsx',
    '-e',
    `const { connectDatabase, disconnectDatabase } = await import('./apps/api/src/db/connection.ts');
     const { seedSpecialties } = await import('./apps/api/src/modules/specialties/specialty.seed.ts');
     await connectDatabase(${JSON.stringify(BASE_URI)}, { dbName: ${JSON.stringify(DB)} });
     await seedSpecialties();
     await disconnectDatabase();`,
  ],
  { stdio: 'inherit' },
);
if (seed.status !== 0) throw new Error('could not seed the specialty catalog');

const replicas = PORTS.map(startReplica);
try {
  await Promise.all(PORTS.map(waitReady));
  check('two API processes ready on one database', true, `ports ${PORTS.join(', ')}, pids ${replicas.map((r) => r.pid).join(', ')}`);

  // 1. Shared rate limit.
  const statuses = [];
  for (let i = 0; i < 5; i++)
    statuses.push(
      (await call(i, 'POST', '/api/v1/auth/login', { body: { email: `x${i}@example.test`, password: 'wrong-password-1' } })).status,
    );
  check('login attempts counted across processes (limit 4)', statuses.join(',') === '401,401,401,401,429', statuses.join(','));

  // 2. Session created on A, used and ended on B.
  const email = `owner.${Date.now()}@example.test`;
  const reg = await call(0, 'POST', '/api/v1/auth/register', {
    body: { email, password: 'replica-only-password-1', displayName: 'Replica Owner' },
  });
  const owner = { cookie: reg.cookie, csrf: reg.json?.csrfToken };
  const seenOnB = await call(1, 'GET', '/api/v1/auth/session', { cookie: owner.cookie });
  check('session from process A is valid on process B', seenOnB.json?.user?.email === email);

  // 3. Idempotency across processes.
  const key = randomUUID();
  const inquiry = {
    contactName: 'Replica',
    organizationName: 'Replica Center',
    country: 'EG',
    email: 'r@example.test',
    organizationType: 'clinic',
    interest: 'custom',
    description: 'Synthetic two-process inquiry.',
    language: 'en',
  };
  const [i1, i2] = [
    await call(0, 'POST', '/api/v1/public/ownership-inquiries', { body: inquiry, headers: { 'idempotency-key': key } }),
    await call(1, 'POST', '/api/v1/public/ownership-inquiries', { body: inquiry, headers: { 'idempotency-key': key } }),
  ];
  check(
    'idempotency key replays on the other process',
    i1.status === 201 && i2.json?.replayed === true && i2.json?.reference === i1.json?.reference,
  );

  // 4. Signed webhook: verified by either process; a duplicate delivery to the other is recognized.
  const event = JSON.stringify({
    id: `evt_sim_${randomUUID().replace(/-/g, '')}`,
    type: 'subscription.renewed',
    occurredAt: new Date().toISOString(),
    data: { providerSubscriptionId: 'sub_sim_unknown' },
  });
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${event}`).digest('hex')}`;
  const w1 = await call(0, 'POST', '/api/v1/billing/webhooks/simulator', {
    body: event,
    headers: { 'x-raclinic-simulator-signature': sig },
  });
  const w2 = await call(1, 'POST', '/api/v1/billing/webhooks/simulator', {
    body: event,
    headers: { 'x-raclinic-simulator-signature': sig },
  });
  check(
    'webhook accepted by A, duplicate recognized by B',
    w1.status === 200 && w1.json?.duplicate === false && w2.json?.duplicate === true,
    `${w1.status}/${w2.status}`,
  );

  // 5. The same slot booked concurrently through both processes: exactly one succeeds.
  const zone = 'Africa/Cairo';
  const org = await call(0, 'POST', '/api/v1/orgs', {
    cookie: owner.cookie,
    csrf: owner.csrf,
    body: { name: 'Replica Clinic', timeZone: zone, branch: { name: 'Main' } },
  });
  const orgId = org.json.organization.id;
  const branchId = org.json.branch.id;
  const doctorEmail = `doctor.${Date.now()}@example.test`;
  await call(1, 'POST', '/api/v1/auth/register', {
    body: { email: doctorEmail, password: 'replica-only-password-1', displayName: 'Replica Doctor' },
  });
  const member = await call(1, 'POST', `/api/v1/orgs/${orgId}/members`, {
    cookie: owner.cookie,
    csrf: owner.csrf,
    body: { email: doctorEmail, role: 'doctor', branchScope: { type: 'all' } },
  });
  const pr = await call(0, 'POST', `/api/v1/orgs/${orgId}/practitioners`, {
    cookie: owner.cookie,
    csrf: owner.csrf,
    body: { membershipId: member.json.member.id, specialtyCode: 'dentistry', branchIds: [branchId], defaultDurationMinutes: 30 },
  });
  if (pr.status !== 201) throw new Error(`practitioner: ${JSON.stringify(pr.json)}`);
  const practitioner = pr.json.practitioner;
  await call(1, 'PUT', `/api/v1/orgs/${orgId}/practitioners/${practitioner.id}/schedule`, {
    cookie: owner.cookie,
    csrf: owner.csrf,
    body: {
      weeklySchedule: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ branchId, weekday, start: '00:00', end: '24:00' })),
      version: practitioner.version,
    },
  });
  const patients = [];
  for (const n of [1, 2]) {
    const p = await call(n, 'POST', `/api/v1/orgs/${orgId}/patients`, {
      cookie: owner.cookie,
      csrf: owner.csrf,
      body: { fullName: `Replica Patient ${n}`, phone: { country: 'EG', number: `0100000010${n}` }, branchId },
    });
    patients.push(p.json.patient.id);
  }
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + 2 * 86_400_000),
  );
  const booking = (i) =>
    call(i, 'POST', `/api/v1/orgs/${orgId}/appointments`, {
      cookie: owner.cookie,
      csrf: owner.csrf,
      headers: { 'idempotency-key': randomUUID() },
      body: { patientId: patients[i], practitionerId: practitioner.id, branchId, date, time: '10:00', type: 'new_visit' },
    });
  const [b1, b2] = await Promise.all([booking(0), booking(1)]);
  const codes = [b1.status, b2.status].sort();
  check(
    'same slot booked concurrently through both processes: one wins',
    codes[0] === 201 && codes[1] === 409,
    `${b1.status}/${b2.status} ${b1.status === 409 ? b1.json?.error?.code : b2.json?.error?.code}`,
  );

  // 6. Logout on B ends the session everywhere.
  await call(1, 'POST', '/api/v1/auth/logout', { cookie: owner.cookie, csrf: owner.csrf });
  check('logout on B ends the session on A', (await call(0, 'GET', '/api/v1/auth/session', { cookie: owner.cookie })).json?.user === null);

  // 7. Graceful shutdown: readiness turns 503 on SIGTERM while the other replica keeps serving.
  replicas[0].kill('SIGTERM');
  const during = await fetch(`http://127.0.0.1:${PORTS[0]}/api/health/ready`)
    .then((r) => r.status)
    .catch(() => 'closed');
  const other = await fetch(`http://127.0.0.1:${PORTS[1]}/api/health/ready`).then((r) => r.status);
  check(
    'SIGTERM on A: A stops taking traffic, B stays ready',
    (during === 503 || during === 'closed') && other === 200,
    `A=${during} B=${other}`,
  );
} catch (err) {
  check(`unexpected error: ${err.message}`, false);
} finally {
  for (const r of replicas) r.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));
  await mongoose.connect(BASE_URI, { dbName: DB });
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(results.join('\n'));
  process.exit(results.every((r) => r.startsWith('PASS')) ? 0 : 1);
}
