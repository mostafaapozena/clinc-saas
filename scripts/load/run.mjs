#!/usr/bin/env node
// Repeatable load test (docs/operations/LOAD_TESTING.md). Builds an ISOLATED synthetic database
// (name must contain "_load_test"), starts dedicated API process(es) on private ports, drives an
// open-model workload (fixed arrival rate per stage, not closed loops) with a weighted scenario mix,
// samples server metrics, stops escalating at protective thresholds, and writes a JSON + Markdown
// report. Never points at the preview database, production or any third-party provider.
//
//   node scripts/load/run.mjs --stages 20,40,80,120 --stage-seconds 60 --warmup-seconds 15 --replicas 1
//   (optional) --large-patients 50000 --small-orgs 19 --small-patients 1000 --past-appointments 40000
//   (optional) --skip-setup  reuse the database built by the previous run
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (acc, a, i, all) =>
        a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]] : acc,
      [],
    ),
);
const num = (k, d) => (args[k] !== undefined ? Number(args[k]) : d);
const CONFIG = {
  stages: (args.stages ?? '20,40,80').split(',').map(Number),
  stageSeconds: num('stage-seconds', 60),
  warmupSeconds: num('warmup-seconds', 15),
  replicas: num('replicas', 1),
  largePatients: num('large-patients', 50_000),
  smallOrgs: num('small-orgs', 19),
  smallPatients: num('small-patients', 1_000),
  pastAppointments: num('past-appointments', 40_000),
  maxInFlight: num('max-in-flight', 400),
  timeoutMs: num('timeout-ms', 10_000),
  // Stop thresholds (protect the Codespace; a stage breaching one ends the escalation).
  stopP95Ms: num('stop-p95-ms', 1500),
  stopServerErrorRate: num('stop-error-rate', 0.01),
  stopEventLoopP99Ms: num('stop-eventloop-p99-ms', 500),
  stopRssMb: num('stop-rss-mb', 1500),
  stopFreeMemMb: num('stop-free-mem-mb', 700),
};
const BASE_URI = process.env.MONGODB_TEST_URI ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017/?directConnection=true';
const DB = args.db ?? 'clinc_load_test';
if (!DB.includes('_load_test')) throw new Error('The load database name must contain "_load_test"');
const PORT0 = 4300;
const PASSWORD = `load-only-${randomUUID()}`;
const ZONE = 'Africa/Cairo';
const OUT = args.out ?? path.join(os.tmpdir(), `raclinic-load-${new Date().toISOString().replace(/\D/g, '').slice(0, 12)}`);
fs.mkdirSync(OUT, { recursive: true });
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

// ---------------------------------------------------------------------------------------------
// API replicas
function startApi(port) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/server.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
      PORT: String(port),
      MONGODB_URI: BASE_URI,
      MONGODB_DB_NAME: DB,
      // One load-generator address: sign-in limits would throttle the harness, not real clients.
      AUTH_RATE_LIMIT_MAX: '10000',
      SETUP_RATE_LIMIT_MAX: '10000',
      INQUIRY_RATE_LIMIT_MAX: '10000',
      RATE_LIMIT_STORE: 'mongo',
      OPS_METRICS: 'true',
      BILLING_PROVIDER: 'none',
      MAIL_PROVIDER: 'none',
      SESSION_IDLE_MINUTES: '120',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (d) => fs.appendFileSync(path.join(OUT, `api-${port}.log`), d));
  return child;
}
async function waitReady(port) {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health/ready`)).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`API on ${port} not ready`);
}

// ---------------------------------------------------------------------------------------------
// HTTP helper (keeps cookies per virtual session)
let rr = 0;
const ports = () => Array.from({ length: CONFIG.replicas }, (_, i) => PORT0 + i);
async function http(session, method, urlPath, body, extraHeaders = {}) {
  const port = ports()[rr++ % CONFIG.replicas];
  const headers = { 'content-type': 'application/json', ...extraHeaders };
  if (session?.cookie) headers.cookie = session.cookie;
  if (session?.csrf && method !== 'GET') headers['x-csrf-token'] = session.csrf;
  if (session?.opCsrf && method !== 'GET') headers['x-operator-csrf'] = session.opCsrf;
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(CONFIG.timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (session && setCookie.length) session.cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  return { status: res.status, json };
}
const must = async (p, label) => {
  const r = await p;
  if (r.status >= 300) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};

// ---------------------------------------------------------------------------------------------
// Synthetic dataset
const FIRST = [
  'محمد',
  'أحمد',
  'محمود',
  'علي',
  'حسن',
  'يوسف',
  'عمر',
  'خالد',
  'سارة',
  'فاطمة',
  'مريم',
  'نور',
  'هالة',
  'منى',
  'ليلى',
  'ياسمين',
  'Omar',
  'Sara',
  'Lina',
  'Karim',
];
const LAST = [
  'حسن',
  'إبراهيم',
  'عبد الله',
  'مصطفى',
  'السيد',
  'محمود',
  'علي',
  'سعيد',
  'كمال',
  'فؤاد',
  'رشاد',
  'نصر',
  'Adel',
  'Fahmy',
  'Saleh',
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const normKey = (n) =>
  n
    .normalize('NFKC')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dayStartUtc = (d) => new Date(`${d}T00:00:00+02:00`); // Cairo standard offset (synthetic data only)
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function register(label) {
  const s = { email: `${label}.${randomUUID().slice(0, 8)}@load.example.test` };
  const r = await must(
    http(s, 'POST', '/api/v1/auth/register', { email: s.email, password: PASSWORD, displayName: label }),
    `register ${label}`,
  );
  s.csrf = r.csrfToken;
  s.userId = r.user.id;
  return s;
}

async function buildOrg(index, large) {
  const owner = await register(`owner${index}`);
  const org = await must(
    http(owner, 'POST', '/api/v1/orgs', { name: `Load Clinic ${index}`, timeZone: ZONE, branch: { name: 'Main' } }),
    'org',
  );
  const orgId = org.organization.id;
  const branches = [org.branch.id];
  for (let b = 1; b < (large ? 3 : 1); b++)
    branches.push((await must(http(owner, 'POST', `/api/v1/orgs/${orgId}/branches`, { name: `Branch ${b + 1}` }), 'branch')).branch.id);
  const add = async (label, role) => {
    const user = await register(label);
    const m = await must(
      http(owner, 'POST', `/api/v1/orgs/${orgId}/members`, { email: user.email, role, branchScope: { type: 'all' } }),
      `member ${role}`,
    );
    user.membershipId = m.member.id;
    return user;
  };
  const doctors = [];
  for (let d = 0; d < (large ? 6 : 1); d++) {
    const doc = await add(`doctor${index}-${d}`, 'doctor');
    const branchId = branches[d % branches.length];
    const p = await must(
      http(owner, 'POST', `/api/v1/orgs/${orgId}/practitioners`, {
        membershipId: doc.membershipId,
        specialtyCode: 'dentistry',
        branchIds: [branchId],
        defaultDurationMinutes: 15,
      }),
      'practitioner',
    );
    await must(
      http(owner, 'PUT', `/api/v1/orgs/${orgId}/practitioners/${p.practitioner.id}/schedule`, {
        weeklySchedule: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ branchId, weekday, start: '08:00', end: '20:00' })),
        version: p.practitioner.version,
      }),
      'schedule',
    );
    doctors.push({ ...doc, practitionerId: p.practitioner.id, branchId });
  }
  const receptionists = [];
  for (let r = 0; r < (large ? 4 : 1); r++) receptionists.push(await add(`reception${index}-${r}`, 'receptionist'));
  const accountant = await add(`accountant${index}`, 'accountant');
  await must(http(owner, 'PUT', `/api/v1/orgs/${orgId}/finance/settings`, { currency: 'EGP' }), 'finance settings');
  const service = await must(
    http(owner, 'POST', `/api/v1/orgs/${orgId}/finance/services`, { code: 'GEN', name: 'Synthetic consultation', price: 30000 }),
    'service',
  );
  return { orgId, large, owner, doctors, receptionists, accountant, branches, serviceId: service.service.id };
}

async function bulk(org, patientCount, pastAppointments) {
  const db = mongoose.connection.db;
  const orgId = new mongoose.Types.ObjectId(org.orgId);
  const ownerId = new mongoose.Types.ObjectId(org.owner.userId);
  const now = new Date();
  const patients = [];
  for (let n = 1; n <= patientCount; n++) {
    const fullName = `${pick(FIRST)} ${pick(FIRST)} ${pick(LAST)}`;
    patients.push({
      _id: new mongoose.Types.ObjectId(),
      organizationId: orgId,
      patientNumber: n,
      fullName,
      nameKey: normKey(fullName),
      nameTokens: [...new Set(normKey(fullName).split(' '))],
      phone: { country: 'EG', e164: `+2010${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` },
      secondaryPhone: null,
      email: null,
      dateOfBirth: null,
      sex: 'unspecified',
      address: null,
      registrations: [
        {
          branchId: new mongoose.Types.ObjectId(pick(org.branches)),
          status: 'active',
          registeredAt: now,
          registeredBy: ownerId,
          archivedAt: null,
        },
      ],
      version: 0,
      scheduleSeq: 0,
      createdBy: ownerId,
      updatedBy: ownerId,
      createdAt: new Date(now.getTime() - Math.random() * 365 * 86_400_000),
      updatedAt: now,
    });
  }
  for (let i = 0; i < patients.length; i += 5000)
    await db.collection('patients').insertMany(patients.slice(i, i + 5000), { ordered: false });
  await db.collection('counters').updateOne({ organizationId: orgId, key: 'patient' }, { $set: { seq: patientCount } }, { upsert: true });

  // Past (completed) and today's appointments, inserted directly: no slot reservations are needed
  // for history, and load-time bookings target future days only.
  const appts = [];
  const t = today();
  for (let i = 0; i < pastAppointments; i++) {
    const doc = pick(org.doctors);
    const day = addDays(t, -1 - Math.floor(Math.random() * 120));
    const start = new Date(dayStartUtc(day).getTime() + (8 * 60 + 15 * Math.floor(Math.random() * 48)) * 60_000);
    appts.push(apptDoc(orgId, ownerId, doc, pick(patients)._id, start, 'completed'));
  }
  org.today = [];
  org.inProgress = [];
  for (const doc of org.doctors) {
    for (let k = 0; k < 20; k++) {
      const start = new Date(dayStartUtc(t).getTime() + (8 * 60 + 15 * k) * 60_000);
      const status = k < 5 ? 'in_progress' : k < 10 ? 'checked_in' : 'scheduled';
      const a = apptDoc(orgId, ownerId, doc, pick(patients)._id, start, status);
      appts.push(a);
      if (status === 'scheduled') org.today.push({ id: String(a._id), version: 0 });
      if (status === 'in_progress') org.inProgress.push({ id: String(a._id), doctor: doc });
    }
  }
  for (let i = 0; i < appts.length; i += 5000) await db.collection('appointments').insertMany(appts.slice(i, i + 5000), { ordered: false });
  org.patientIds = patients.filter((_, i) => i % Math.ceil(patients.length / 2000) === 0).map((p) => String(p._id));
  // Bookings must use a patient registered at the doctor's branch (otherwise a business refusal).
  org.patientsByBranch = {};
  for (const p of patients.slice(0, 6000)) (org.patientsByBranch[String(p.registrations[0].branchId)] ??= []).push(String(p._id));
  org.searchTerms = patients.slice(0, 500).map((p) => p.fullName.split(' ')[Math.floor(Math.random() * 3)]);
  org.phoneTerms = patients.slice(0, 500).map((p) => `0${p.phone.e164.slice(3)}`);
}
function apptDoc(orgId, ownerId, doc, patientId, start, status) {
  const now = new Date();
  return {
    _id: new mongoose.Types.ObjectId(),
    organizationId: orgId,
    branchId: new mongoose.Types.ObjectId(doc.branchId),
    patientId,
    practitionerId: new mongoose.Types.ObjectId(doc.practitionerId),
    startAt: start,
    endAt: new Date(start.getTime() + 15 * 60_000),
    durationMinutes: 15,
    type: 'new_visit',
    status,
    cancellationReason: null,
    checkedInAt: status === 'scheduled' ? null : start,
    startedAt: status === 'in_progress' || status === 'completed' ? start : null,
    completedAt: status === 'completed' ? new Date(start.getTime() + 15 * 60_000) : null,
    cancelledAt: null,
    noShowAt: null,
    version: 0,
    idempotencyKey: null,
    requestHash: null,
    createdBy: ownerId,
    updatedBy: ownerId,
    createdAt: now,
    updatedAt: now,
  };
}

async function setup() {
  await mongoose.connect(BASE_URI, { dbName: DB });
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  const seed = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '-e',
      `const { connectDatabase, disconnectDatabase } = await import('./apps/api/src/db/connection.ts');
       const { ensureIndexes } = await import('./apps/api/src/db/models.ts');
       const { seedSpecialties } = await import('./apps/api/src/modules/specialties/specialty.seed.ts');
       const { hashPassword } = await import('./apps/api/src/auth/password.ts');
       const { OperatorModel } = await import('./apps/api/src/modules/platform/operator.model.ts');
       await connectDatabase(${JSON.stringify(BASE_URI)}, { dbName: ${JSON.stringify(DB)} });
       await ensureIndexes();
       await seedSpecialties();
       await OperatorModel.create({ email: 'load.operator@load.example.test', displayName: 'Load operator', role: 'platform_admin', passwordHash: await hashPassword(${JSON.stringify(PASSWORD)}) });
       await disconnectDatabase();`,
    ],
    { stdio: 'inherit' },
  );
  if (seed.status !== 0) throw new Error('seeding reference data failed');
}

// ---------------------------------------------------------------------------------------------
// Scenarios (weights sum to 100). `expected` lists business outcomes that are NOT server failures.
const SCENARIOS = [
  {
    name: 'patient_search_name',
    weight: 14,
    role: 'reception',
    run: (o, s) => http(s, 'GET', `/api/v1/orgs/${o.orgId}/patients?q=${encodeURIComponent(pick(o.searchTerms))}`),
  },
  {
    name: 'patient_search_phone',
    weight: 5,
    role: 'reception',
    run: (o, s) => http(s, 'GET', `/api/v1/orgs/${o.orgId}/patients?q=${pick(o.phoneTerms)}`),
  },
  {
    name: 'patient_list',
    weight: 5,
    role: 'reception',
    run: (o, s) => http(s, 'GET', `/api/v1/orgs/${o.orgId}/patients?sort=recent&page=${1 + Math.floor(Math.random() * 5)}`),
  },
  {
    name: 'patient_detail',
    weight: 8,
    role: 'reception',
    run: (o, s) => http(s, 'GET', `/api/v1/orgs/${o.orgId}/patients/${pick(o.patientIds)}`),
  },
  {
    name: 'appointments_today',
    weight: 9,
    role: 'reception',
    run: (o, s) => http(s, 'GET', `/api/v1/orgs/${o.orgId}/appointments?from=${today()}&to=${today()}`),
  },
  {
    name: 'availability',
    weight: 6,
    role: 'reception',
    run: (o, s) => {
      const d = pick(o.doctors);
      return http(
        s,
        'GET',
        `/api/v1/orgs/${o.orgId}/appointments/availability?practitionerId=${d.practitionerId}&branchId=${d.branchId}&date=${addDays(today(), 1 + Math.floor(Math.random() * 30))}`,
      );
    },
  },
  {
    name: 'booking',
    weight: 5,
    role: 'reception',
    expected: ['SLOT_UNAVAILABLE', 'PATIENT_BUSY', 'PATIENT_DOUBLE_BOOKED', 'SCHEDULE_CHANGED', 'CONFLICT'],
    run: (o, s) => {
      const d = pick(o.doctors);
      const minutes = 8 * 60 + 15 * Math.floor(Math.random() * 48);
      const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      return http(
        s,
        'POST',
        `/api/v1/orgs/${o.orgId}/appointments`,
        {
          patientId: pick(o.patientsByBranch[d.branchId] ?? o.patientIds),
          practitionerId: d.practitionerId,
          branchId: d.branchId,
          date: addDays(today(), 1 + Math.floor(Math.random() * 30)),
          time,
          type: 'new_visit',
        },
        { 'idempotency-key': randomUUID() },
      );
    },
  },
  {
    name: 'check_in',
    weight: 3,
    role: 'reception',
    expected: ['APPOINTMENT_CHANGED', 'INVALID_TRANSITION', 'VERSION_CONFLICT'],
    run: async (o, s) => {
      const a = pick(o.today);
      const r = await http(s, 'POST', `/api/v1/orgs/${o.orgId}/appointments/${a.id}/status`, { action: 'check_in', version: a.version });
      if (r.status === 200) a.version = r.json.appointment.version;
      return r;
    },
  },
  { name: 'queue', weight: 9, role: 'doctor', run: (o, s) => http(s, 'GET', `/api/v1/orgs/${o.orgId}/queue`) },
  { name: 'dashboard', weight: 9, role: 'reception', run: (o, s) => http(s, 'GET', `/api/v1/orgs/${o.orgId}/dashboard`) },
  {
    name: 'clinical_read',
    weight: 5,
    role: 'clinical',
    run: (o, s, e) => http(s, 'GET', `/api/v1/orgs/${o.orgId}/encounters/${e.id}`),
  },
  {
    name: 'clinical_save',
    weight: 4,
    role: 'clinical',
    expected: ['ENCOUNTER_CHANGED', 'VERSION_CONFLICT', 'RECORD_CHANGED'],
    run: async (o, s, e) => {
      const r = await http(s, 'PUT', `/api/v1/orgs/${o.orgId}/encounters/${e.id}`, {
        sections: { reason: `Synthetic load note ${Math.random().toString(36).slice(2, 8)}` },
        version: e.version,
      });
      if (r.status === 200) e.version = r.json.encounter.version;
      else if (r.status === 409) {
        const fresh = await http(s, 'GET', `/api/v1/orgs/${o.orgId}/encounters/${e.id}`);
        if (fresh.status === 200) e.version = fresh.json.encounter.version;
      }
      return r;
    },
  },
  {
    name: 'finance_account',
    weight: 5,
    role: 'accountant',
    run: (o, s) => http(s, 'GET', `/api/v1/orgs/${o.orgId}/finance/patients/${pick(o.patientIds)}/account`),
  },
  {
    name: 'finance_charge',
    weight: 3,
    role: 'accountant',
    run: (o, s) => {
      // A patient registered at the charged branch (otherwise a business refusal).
      const branchId = pick(o.branches);
      return http(
        s,
        'POST',
        `/api/v1/orgs/${o.orgId}/finance/charges`,
        { patientId: pick(o.patientsByBranch[branchId] ?? o.patientIds), branchId, serviceId: o.serviceId },
        { 'idempotency-key': randomUUID() },
      );
    },
  },
  { name: 'support_list', weight: 2, role: 'reception', run: (o, s) => http(s, 'GET', `/api/v1/orgs/${o.orgId}/support`) },
  { name: 'operator_orgs', weight: 2, role: 'operator', run: (_o, s) => http(s, 'GET', '/api/v1/platform/organizations') },
  { name: 'operator_support', weight: 2, role: 'operator', run: (_o, s) => http(s, 'GET', '/api/v1/platform/support?status=open') },
];
const TOTAL_WEIGHT = SCENARIOS.reduce((n, s) => n + s.weight, 0);
const pickScenario = () => {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const s of SCENARIOS) if ((r -= s.weight) < 0) return s;
  return SCENARIOS[0];
};

// ---------------------------------------------------------------------------------------------
// Load driver
function newStats() {
  return Object.fromEntries(
    SCENARIOS.map((s) => [
      s.name,
      { latencies: [], ok: 0, expected: 0, clientError: 0, serverError: 0, timeout: 0, network: 0, codes: {} },
    ]),
  );
}
const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};

async function sampler(stopFlag, samples) {
  const db = mongoose.connection.db;
  while (!stopFlag.stop) {
    const at = Date.now();
    const api = [];
    for (const port of ports()) {
      try {
        api.push(await (await fetch(`http://127.0.0.1:${port}/api/health/metrics`, { signal: AbortSignal.timeout(3000) })).json());
      } catch {
        api.push(null);
      }
    }
    let mongo = null;
    try {
      const s = await db.admin().command({ serverStatus: 1 });
      mongo = {
        connections: s.connections?.current,
        opLatencies: s.opLatencies,
        opcounters: s.opcounters,
        writeConflicts: s.metrics?.operation?.writeConflicts ?? null,
        transactions: s.transactions
          ? { committed: s.transactions.totalCommitted, aborted: s.transactions.totalAborted, started: s.transactions.totalStarted }
          : null,
        residentMb: s.mem?.resident,
      };
    } catch {
      /* ignore */
    }
    samples.push({ at, api, mongo, freeMemMb: Math.round(os.freemem() / 1048576), load1: os.loadavg()[0] });
    await new Promise((r) => setTimeout(r, Math.max(0, 2000 - (Date.now() - at))));
  }
}

async function runStage(rate, seconds, pools, label) {
  const stats = newStats();
  let inFlight = 0;
  let dropped = 0;
  let sent = 0;
  const started = Date.now();
  const pending = [];
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      const elapsed = (Date.now() - started) / 1000;
      if (elapsed >= seconds) {
        clearInterval(timer);
        resolve();
        return;
      }
      const due = Math.floor(rate * elapsed) - sent;
      for (let i = 0; i < due; i++) {
        sent++;
        if (inFlight >= CONFIG.maxInFlight) {
          dropped++;
          continue;
        }
        const scenario = pickScenario();
        const org = Math.random() < 0.5 ? pools.large : pick(pools.small);
        const st = stats[scenario.name];
        let session;
        let extra;
        if (scenario.role === 'operator') session = pools.operator;
        else if (scenario.role === 'clinical') {
          extra = pick(org.encounters);
          session = extra.doctor;
        } else if (scenario.role === 'doctor') session = pick(org.doctors);
        else if (scenario.role === 'accountant') session = org.accountant;
        else session = pick(org.receptionists);
        inFlight++;
        const t0 = performance.now();
        pending.push(
          scenario
            .run(org, session, extra)
            .then((r) => {
              st.latencies.push(performance.now() - t0);
              const code = r.json?.error?.code ?? String(r.status);
              st.codes[code] = (st.codes[code] ?? 0) + 1;
              if (r.status < 400) st.ok++;
              else if (r.status === 409 || (scenario.expected ?? []).includes(code)) st.expected++;
              else if (r.status >= 500) st.serverError++;
              else st.clientError++;
            })
            .catch((err) => {
              st.latencies.push(performance.now() - t0);
              if (err?.name === 'TimeoutError') st.timeout++;
              else st.network++;
            })
            .finally(() => inFlight--),
        );
      }
    }, 10);
  });
  await Promise.allSettled(pending);
  const all = Object.values(stats).flatMap((s) => s.latencies);
  const totals = Object.values(stats).reduce(
    (t, s) => ({
      ok: t.ok + s.ok,
      expected: t.expected + s.expected,
      clientError: t.clientError + s.clientError,
      serverError: t.serverError + s.serverError,
      timeout: t.timeout + s.timeout,
      network: t.network + s.network,
    }),
    { ok: 0, expected: 0, clientError: 0, serverError: 0, timeout: 0, network: 0 },
  );
  const completed = all.length;
  return {
    label,
    targetRps: rate,
    seconds,
    sent,
    completed,
    dropped,
    achievedRps: Math.round((completed / seconds) * 10) / 10,
    p50: pct(all, 50),
    p95: pct(all, 95),
    p99: pct(all, 99),
    totals,
    failureRate: completed ? (totals.serverError + totals.timeout + totals.network) / completed : 0,
    scenarios: Object.fromEntries(
      Object.entries(stats).map(([k, s]) => [
        k,
        {
          n: s.latencies.length,
          p50: pct(s.latencies, 50),
          p95: pct(s.latencies, 95),
          p99: pct(s.latencies, 99),
          ok: s.ok,
          expected: s.expected,
          clientError: s.clientError,
          serverError: s.serverError,
          timeout: s.timeout + s.network,
          codes: s.codes,
        },
      ]),
    ),
  };
}

function summarizeSamples(samples) {
  const api = samples.flatMap((s) => s.api.filter(Boolean));
  const mx = (xs) => (xs.length ? Math.max(...xs) : null);
  const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const first = samples.find((s) => s.mongo)?.mongo;
  const last = [...samples].reverse().find((s) => s.mongo)?.mongo;
  const delta = (f) => (first && last ? f(last) - f(first) : null);
  return {
    apiCpuPercentAvg: avg(api.map((a) => a.cpuPercent)),
    apiCpuPercentMax: mx(api.map((a) => a.cpuPercent)),
    eventLoopP99MsMax: mx(api.map((a) => a.eventLoopDelayMs.p99)),
    eventLoopMaxMs: mx(api.map((a) => a.eventLoopDelayMs.max)),
    apiRssMbMax: mx(api.map((a) => a.memoryMb.rss)),
    apiHeapUsedMbMax: mx(api.map((a) => a.memoryMb.heapUsed)),
    hostFreeMemMbMin: samples.length ? Math.min(...samples.map((s) => s.freeMemMb)) : null,
    hostLoad1Max: mx(samples.map((s) => s.load1)),
    mongoConnectionsMax: mx(samples.filter((s) => s.mongo).map((s) => s.mongo.connections)),
    mongoResidentMbMax: mx(samples.filter((s) => s.mongo).map((s) => s.mongo.residentMb)),
    mongoWriteConflicts: delta((m) => m.writeConflicts ?? 0),
    mongoTxAborted: delta((m) => m.transactions?.aborted ?? 0),
    mongoTxCommitted: delta((m) => m.transactions?.committed ?? 0),
    mongoReadLatencyUsAvg:
      first && last
        ? Math.round(
            (last.opLatencies.reads.latency - first.opLatencies.reads.latency) /
              Math.max(1, last.opLatencies.reads.ops - first.opLatencies.reads.ops),
          )
        : null,
    mongoWriteLatencyUsAvg:
      first && last
        ? Math.round(
            (last.opLatencies.writes.latency - first.opLatencies.writes.latency) /
              Math.max(1, last.opLatencies.writes.ops - first.opLatencies.writes.ops),
          )
        : null,
  };
}

// ---------------------------------------------------------------------------------------------
const replicas = [];
let exitCode = 0;
try {
  const env = {
    node: process.version,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model,
    totalMemMb: Math.round(os.totalmem() / 1048576),
    platform: `${os.type()} ${os.release()}`,
    mongo: null,
    replicas: CONFIG.replicas,
    loadGenerator: 'same host as the API (shares CPU)',
  };
  if (args['skip-setup'] !== 'true') {
    log('dropping and seeding reference data in', DB);
    await setup();
  }
  for (const port of ports()) replicas.push(startApi(port));
  await Promise.all(ports().map(waitReady));
  await mongoose.connect(BASE_URI, { dbName: DB });
  env.mongo = (await mongoose.connection.db.admin().command({ buildInfo: 1 })).version;

  log('building organizations through the API');
  const large = await buildOrg(0, true);
  const small = [];
  for (let i = 1; i <= CONFIG.smallOrgs; i++) small.push(await buildOrg(i, false));
  log('bulk inserting patients and appointments');
  await bulk(large, CONFIG.largePatients, CONFIG.pastAppointments);
  for (const o of small) await bulk(o, CONFIG.smallPatients, Math.round(CONFIG.pastAppointments / 40));
  log('creating draft visit records through the API');
  for (const o of [large, ...small]) {
    o.encounters = [];
    for (const a of o.inProgress) {
      const r = await must(
        http(
          a.doctor,
          'POST',
          `/api/v1/orgs/${o.orgId}/appointments/${a.id}/encounter`,
          { sections: { reason: 'Synthetic load draft' } },
          { 'idempotency-key': randomUUID() },
        ),
        'encounter',
      );
      o.encounters.push({ id: r.encounter.id, version: r.encounter.version, doctor: a.doctor });
    }
  }
  const operator = {};
  const opLogin = await must(
    http(operator, 'POST', '/api/v1/platform/auth/login', { email: 'load.operator@load.example.test', password: PASSWORD }),
    'operator login',
  );
  operator.opCsrf = opLogin.csrfToken;
  const pools = { large, small, operator };
  const counts = await Promise.all(
    ['users', 'sessions', 'patients', 'appointments', 'clinical_encounters', 'organizations'].map(async (c) => [
      c,
      await mongoose.connection.db.collection(c).estimatedDocumentCount(),
    ]),
  );
  const dataset = {
    ...Object.fromEntries(counts),
    largeOrg: { patients: CONFIG.largePatients, branches: 3, doctors: 6, receptionists: 4 },
    smallOrgs: { count: CONFIG.smallOrgs, patientsEach: CONFIG.smallPatients, doctorsEach: 1 },
    trafficSplit: '50% large organization, 50% spread over small ones',
  };
  log('dataset', JSON.stringify(dataset));

  // Optional: MongoDB profiler on the LOAD database only, to see what the server spends time on.
  const profileMs = args['profile-ms'] !== undefined ? Number(args['profile-ms']) : null;
  if (profileMs !== null) {
    await mongoose.connection.db.command({ profile: 0 });
    await mongoose.connection.db
      .collection('system.profile')
      .drop()
      .catch(() => undefined);
    await mongoose.connection.db.command({ profile: 1, slowms: profileMs });
  }
  const stopFlag = { stop: false };
  const samples = [];
  const samplerDone = sampler(stopFlag, samples);
  const results = [];
  log(`warm-up ${CONFIG.warmupSeconds}s at ${CONFIG.stages[0]} rps (not reported)`);
  await runStage(CONFIG.stages[0], CONFIG.warmupSeconds, pools, 'warmup');
  for (const rate of CONFIG.stages) {
    const from = samples.length;
    const r = await runStage(rate, CONFIG.stageSeconds, pools, `${rate} rps`);
    r.server = summarizeSamples(samples.slice(from));
    results.push(r);
    log(
      `${rate} rps → achieved ${r.achievedRps}, p50 ${r.p50} p95 ${r.p95} p99 ${r.p99} ms, failures ${(r.failureRate * 100).toFixed(2)}%, dropped ${r.dropped}, cpu ${r.server.apiCpuPercentAvg}% loop p99 ${r.server.eventLoopP99MsMax} ms`,
    );
    const breach = [
      r.p95 > CONFIG.stopP95Ms && `p95 ${r.p95} > ${CONFIG.stopP95Ms} ms`,
      r.failureRate > CONFIG.stopServerErrorRate && `failures ${(r.failureRate * 100).toFixed(2)}%`,
      (r.server.eventLoopP99MsMax ?? 0) > CONFIG.stopEventLoopP99Ms && `event loop p99 ${r.server.eventLoopP99MsMax} ms`,
      (r.server.apiRssMbMax ?? 0) > CONFIG.stopRssMb && `RSS ${r.server.apiRssMbMax} MB`,
      (r.server.hostFreeMemMbMin ?? Infinity) < CONFIG.stopFreeMemMb && `free memory ${r.server.hostFreeMemMbMin} MB`,
      r.dropped > 0 && `${r.dropped} requests not sent (client in-flight cap)`,
    ].filter(Boolean);
    if (breach.length) {
      r.stoppedBecause = breach;
      log('stop threshold reached:', breach.join('; '));
      break;
    }
  }
  stopFlag.stop = true;
  await samplerDone;
  let profile = null;
  if (profileMs !== null) {
    await mongoose.connection.db.command({ profile: 0 });
    profile = await mongoose.connection.db
      .collection('system.profile')
      .aggregate([
        {
          $group: {
            _id: {
              ns: '$ns',
              op: '$op',
              plan: '$planSummary',
              cmd: { $first: { $map: { input: { $objectToArray: '$command' }, as: 'c', in: '$$c.k' } } },
            },
            n: { $sum: 1 },
            totalMs: { $sum: '$millis' },
            maxMs: { $max: '$millis' },
            docsExamined: { $sum: { $ifNull: ['$docsExamined', 0] } },
            writeConflicts: { $sum: { $ifNull: ['$writeConflicts', 0] } },
          },
        },
        { $sort: { totalMs: -1 } },
        { $limit: 20 },
        {
          $project: {
            _id: 0,
            ns: '$_id.ns',
            op: '$_id.op',
            plan: '$_id.plan',
            command: '$_id.cmd',
            n: 1,
            totalMs: 1,
            maxMs: 1,
            docsExamined: 1,
            writeConflicts: 1,
          },
        },
      ])
      .toArray();
  }
  const report = { at: new Date().toISOString(), config: CONFIG, environment: env, dataset, results, profile };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  log('report written to', path.join(OUT, 'report.json'));
} catch (err) {
  exitCode = 1;
  console.error('load test failed:', err);
} finally {
  for (const r of replicas) r.kill('SIGTERM');
  await mongoose.disconnect().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 1500));
  process.exit(exitCode);
}
