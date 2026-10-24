import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DateTime } from 'luxon';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditEventModel } from '../src/modules/audit/audit-event.model.js';
import { AddendumModel, ClinicalAuditModel, EncounterModel } from '../src/modules/clinical/clinical.model.js';
import { CoverageModel } from '../src/modules/clinical/coverage.model.js';
import { TEST_PASSWORD, addMember, register, send, testApp, type App, type Client } from './helpers/api.js';
import { TODAY, act, bookOk, buildClinic, createPatient, createPractitioner, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';
import { clock } from '../src/time/clock.js';

// Clinical coverage and the clinical audit view. Synthetic clinical text only; MARK finds leaks.
const MARK = 'SYNTHETIC-COVERAGE-TEXT';
const app = testApp();
// The same database with the clinical-lead authority switched on (it is off by default, B1).
const leadApp = testApp({ clinicalLeadGrantsEnabled: true });
let c: Clinic;
let doctor3: Client;
let practitioner3: string;
const orgUrl = (path: string) => `/api/v1/orgs/${c.orgId}${path}`;
const everyDay = (branchId: string) => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ branchId, weekday, start: '08:00', end: '20:00' }));

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('coverage');
  c = await buildClinic(app, 'cov');
  doctor3 = await register(app, 'cov-doctor3');
  const membership = await addMember(c.owner, c.orgId, doctor3, 'doctor', [c.branchA]);
  practitioner3 = await createPractitioner(c.owner, c.orgId, membership, [c.branchA], 30, everyDay(c.branchA));
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => dropTestDatabase());

let visitSeq = 0;
/** A finalized (or draft) record by `author` on a fresh visit at branch A. */
async function record(author: Client = c.doctor, practitioner = c.practitioner, finalize = true) {
  const i = visitSeq++;
  const date =
    DateTime.fromISO(TODAY)
      .plus({ days: 1 + Math.floor(i / 10) })
      .toISODate() ?? TODAY;
  const minutes = 8 * 60 + 30 + (i % 10) * 30;
  const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  vi.restoreAllMocks();
  pinClock(`${date}T05:00:00.000Z`);
  const patientId = await createPatient(c.receptionist, c.orgId, c.branchA);
  let a = await bookOk(c.owner, c.orgId, { patientId, practitionerId: practitioner, branchId: c.branchA, date, time });
  for (const [action, actor] of [
    ['check_in', c.receptionist],
    ['start', author],
  ] as const) {
    a = (await act(actor, c.orgId, a.id, action, a.version)).body.appointment;
  }
  const started = await author.agent
    .post(orgUrl(`/appointments/${a.id}/encounter`))
    .set('X-CSRF-Token', author.csrf)
    .set('Idempotency-Key', randomUUID())
    .send({ sections: { reason: `${MARK} reason`, plan: `${MARK} plan` } });
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  let encounter = started.body.encounter as { id: string; version: number };
  if (finalize) {
    const done = await author.agent
      .post(orgUrl(`/encounters/${encounter.id}/finalize`))
      .set('X-CSRF-Token', author.csrf)
      .set('Idempotency-Key', randomUUID())
      .send({ version: encounter.version });
    expect(done.status).toBe(201);
    encounter = done.body.encounter;
  }
  return { patientId, appointmentId: a.id, encounter, date };
}

/** Relative to the server clock (pinned in most tests). */
const inDays = (n: number) => new Date(clock.now().getTime() + n * 86_400_000).toISOString();
function grant(who: Client, body: Record<string, unknown>, key = randomUUID()) {
  return who.agent
    .post(orgUrl('/clinical/coverage'))
    .set('X-CSRF-Token', who.csrf)
    .set('Idempotency-Key', key)
    .send({ access: 'read', reason: 'Covering during leave', expiresAt: inDays(7), ...body });
}
const revoke = (who: Client, id: string, reason = 'Back from leave') =>
  send(who, 'post', orgUrl(`/clinical/coverage/${id}/revoke`), { reason });
const readRecord = (who: Client, encounterId: string) => who.agent.get(orgUrl(`/encounters/${encounterId}`));
const addendum = (who: Client, encounterId: string, content = `${MARK} addendum`) =>
  who.agent
    .post(orgUrl(`/encounters/${encounterId}/addenda`))
    .set('X-CSRF-Token', who.csrf)
    .set('Idempotency-Key', randomUUID())
    .send({ reason: 'Covering note', content });
const denialReasons = async (encounterId: string) =>
  (await ClinicalAuditModel.find({ organizationId: c.orgId, action: 'clinical.access_denied', encounterId }).lean()).map(
    (e) => e.metadata.reason,
  );

describe('coverage by the treating doctor', () => {
  it('opens one record read-only to the covering doctor, and nothing else', async () => {
    const r = await record();
    const other = await record(); // the same doctor's other patient
    expect((await readRecord(c.doctor2, r.encounter.id)).status).toBe(404);

    const created = await grant(c.doctor, {
      granteePractitionerId: c.practitioner2,
      scope: { type: 'encounter', encounterId: r.encounter.id },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.coverage).toMatchObject({ status: 'active', access: 'read', grantedVia: 'author', scope: { type: 'encounter' } });

    const view = await readRecord(c.doctor2, r.encounter.id);
    expect(view.status).toBe(200);
    expect(view.headers['cache-control']).toBe('no-store');
    expect(view.body).toMatchObject({ access: 'read', canAddAddendum: false, context: { patient: { id: r.patientId } } });
    expect(view.body.encounter.sections.plan).toBe(`${MARK} plan`);
    // Read-only: no addendum, no edits; other records stay closed.
    expect((await addendum(c.doctor2, r.encounter.id)).status).toBe(404);
    expect((await readRecord(c.doctor2, other.encounter.id)).status).toBe(404);
    // Third doctor, owner and receptionist gain nothing.
    expect((await readRecord(doctor3, r.encounter.id)).status).toBe(404);
    expect((await readRecord(c.owner, r.encounter.id)).status).toBe(403);
    expect((await readRecord(c.receptionist, r.encounter.id)).status).toBe(403);

    const viewed = await ClinicalAuditModel.findOne({
      organizationId: c.orgId,
      action: 'encounter.viewed',
      encounterId: r.encounter.id,
      actorUserId: c.doctor2.userId,
    }).lean();
    expect(viewed?.metadata).toMatchObject({ via: 'coverage', coverageId: created.body.coverage.id });
  });

  it('patient-wide "author" coverage lets the covering doctor add addenda under their own name', async () => {
    const r = await record();
    const draft = await record(c.doctor, c.practitioner, false);
    // Same patient for both records is not needed: grant on r's patient only.
    const created = await grant(c.doctor, {
      granteePractitionerId: c.practitioner2,
      access: 'author',
      scope: { type: 'patient', patientId: r.patientId },
    });
    expect(created.status).toBe(201);

    const added = await addendum(c.doctor2, r.encounter.id);
    expect(added.status).toBe(201);
    const last = added.body.encounter.addenda.at(-1);
    expect(last.author.practitionerId).toBe(c.practitioner2);
    // Authorship of the record and its finalized text are unchanged.
    expect(added.body.encounter.author.practitionerId).toBe(c.practitioner);
    const stored = await EncounterModel.findOne({ organizationId: c.orgId, _id: r.encounter.id }).lean();
    expect(stored).toMatchObject({ status: 'finalized', version: r.encounter.version });
    expect(String(stored?.authorUserId)).toBe(c.doctor.userId);
    const event = await ClinicalAuditModel.findOne({
      organizationId: c.orgId,
      action: 'encounter.addendum_added',
      encounterId: r.encounter.id,
    }).lean();
    expect(event?.metadata).toMatchObject({ via: 'coverage', coverageId: created.body.coverage.id });

    // The draft of another patient is not covered; and covered drafts are never editable.
    expect((await readRecord(c.doctor2, draft.encounter.id)).status).toBe(404);
    const sameDraft = await grant(c.doctor, {
      granteePractitionerId: c.practitioner2,
      access: 'author',
      scope: { type: 'encounter', encounterId: draft.encounter.id },
    });
    expect(sameDraft.status).toBe(201);
    const draftView = await readRecord(c.doctor2, draft.encounter.id);
    expect(draftView.body).toMatchObject({ access: 'author', canAddAddendum: false, encounter: { status: 'draft' } });
    expect(
      (
        await send(c.doctor2, 'put', orgUrl(`/encounters/${draft.encounter.id}`), {
          sections: { plan: 'x' },
          version: draft.encounter.version,
        })
      ).status,
    ).toBe(404);
  });

  it('lists the covered records for the covering doctor, only while the grant is active', async () => {
    const r = await record();
    const created = await grant(c.doctor, { granteePractitionerId: c.practitioner2, scope: { type: 'patient', patientId: r.patientId } });
    const id = created.body.coverage.id as string;
    const records = await c.doctor2.agent.get(orgUrl(`/clinical/coverage/${id}/records`));
    expect(records.status).toBe(200);
    expect(records.body.data.map((e: { id: string }) => e.id)).toEqual([r.encounter.id]);
    expect(records.body.patient.id).toBe(r.patientId);
    // Not for the grantor, another doctor or an admin.
    expect((await c.doctor.agent.get(orgUrl(`/clinical/coverage/${id}/records`))).status).toBe(404);
    expect((await doctor3.agent.get(orgUrl(`/clinical/coverage/${id}/records`))).status).toBe(404);
    expect((await c.admin.agent.get(orgUrl(`/clinical/coverage/${id}/records`))).status).toBe(403);

    const mine = await c.doctor2.agent.get(orgUrl('/clinical/coverage'));
    expect(mine.body.received.map((g: { id: string }) => g.id)).toContain(id);
    expect(mine.body.canGrantAsLead).toBe(false);
    const theirs = await c.doctor.agent.get(orgUrl('/clinical/coverage'));
    expect(theirs.body.granted.map((g: { id: string }) => g.id)).toContain(id);
  });

  it('revocation and expiry apply on the next request, and the denial says why', async () => {
    const r = await record();
    const created = await grant(c.doctor, {
      granteePractitionerId: c.practitioner2,
      scope: { type: 'encounter', encounterId: r.encounter.id },
      expiresAt: inDays(2),
    });
    const id = created.body.coverage.id as string;
    expect((await readRecord(c.doctor2, r.encounter.id)).status).toBe(200);
    // Only the grantor (or the record's doctor) may revoke.
    expect((await revoke(c.doctor2, id)).status).toBe(404);
    expect((await revoke(c.admin, id)).status).toBe(403);
    const revoked = await revoke(c.doctor, id);
    expect(revoked.status).toBe(200);
    expect(revoked.body.coverage.status).toBe('revoked');
    expect((await readRecord(c.doctor2, r.encounter.id)).status).toBe(404);
    expect((await revoke(c.doctor, id)).status).toBe(409);
    expect(await denialReasons(r.encounter.id)).toContain('coverage_revoked');
    expect(
      await ClinicalAuditModel.countDocuments({ organizationId: c.orgId, action: 'coverage.revoked', 'metadata.coverageId': id }),
    ).toBe(1);

    const r2 = await record();
    await grant(c.doctor, {
      granteePractitionerId: c.practitioner2,
      scope: { type: 'encounter', encounterId: r2.encounter.id },
      expiresAt: inDays(1),
    });
    expect((await readRecord(c.doctor2, r2.encounter.id)).status).toBe(200);
    const later = inDays(2);
    vi.restoreAllMocks();
    pinClock(later);
    expect((await readRecord(c.doctor2, r2.encounter.id)).status).toBe(404);
    expect(await denialReasons(r2.encounter.id)).toContain('coverage_expired');
  });

  it('suspension of the covering doctor and branch scope apply immediately', async () => {
    const r = await record();
    await grant(c.doctor, { granteePractitionerId: c.practitioner2, scope: { type: 'encounter', encounterId: r.encounter.id } });
    const doctor2Membership = (await c.owner.agent.get(orgUrl('/members'))).body.data.find(
      (m: { user: { id: string } }) => m.user.id === c.doctor2.userId,
    ).id as string;
    const patch = (body: object) => send(c.owner, 'patch', orgUrl(`/members/${doctor2Membership}`), body);
    expect((await patch({ status: 'suspended' })).status).toBe(200);
    expect((await readRecord(c.doctor2, r.encounter.id)).status).toBe(404);
    expect((await patch({ status: 'active' })).status).toBe(200);
    expect((await readRecord(c.doctor2, r.encounter.id)).status).toBe(200);
    // The record is at branch A; scoped to branch B only, the covering doctor loses it.
    expect((await patch({ branchScope: { type: 'selected', branchIds: [c.branchB] } })).status).toBe(200);
    expect((await readRecord(c.doctor2, r.encounter.id)).status).toBe(404);
    expect((await patch({ branchScope: { type: 'selected', branchIds: [c.branchA] } })).status).toBe(200);
  });

  it('refuses grants outside the rules', async () => {
    const r = await record();
    const otherDoctors = await record(c.doctor2, c.practitioner2);
    const encounterScope = { type: 'encounter', encounterId: r.encounter.id };
    // Only doctors grant; only their own records; never to themselves; bounded time.
    expect((await grant(c.owner, { granteePractitionerId: c.practitioner2, scope: encounterScope })).status).toBe(403);
    expect((await grant(c.admin, { granteePractitionerId: c.practitioner2, scope: encounterScope })).status).toBe(403);
    expect(
      (
        await grant(c.doctor, {
          granteePractitionerId: c.practitioner2,
          scope: { type: 'encounter', encounterId: otherDoctors.encounter.id },
        })
      ).status,
    ).toBe(404);
    expect(
      (await grant(c.doctor, { granteePractitionerId: c.practitioner2, scope: { type: 'patient', patientId: otherDoctors.patientId } }))
        .status,
    ).toBe(404);
    const self = await grant(c.doctor, { granteePractitionerId: c.practitioner, scope: encounterScope });
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('COVERAGE_GRANTEE_INVALID');
    expect(
      (await grant(c.doctor, { granteePractitionerId: c.practitioner2, scope: encounterScope, expiresAt: inDays(91) })).body.error.fields,
    ).toEqual({
      expiresAt: 'out_of_range',
    });
    expect((await grant(c.doctor, { granteePractitionerId: c.practitioner2, scope: encounterScope, expiresAt: inDays(-1) })).status).toBe(
      400,
    );
    expect((await grant(c.doctor, { granteePractitionerId: c.practitioner2, scope: encounterScope, reason: 'x' })).status).toBe(400);
    // A practitioner profile that is inactive cannot receive coverage.
    const profile = await c.owner.agent.get(orgUrl(`/practitioners/${practitioner3}`));
    vi.restoreAllMocks();
    pinClock('2027-06-01T08:00:00.000Z');
    const off = await send(c.owner, 'patch', orgUrl(`/practitioners/${practitioner3}`), {
      status: 'inactive',
      version: profile.body.practitioner.version,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    try {
      const inactive = await grant(c.doctor, {
        granteePractitionerId: practitioner3,
        scope: encounterScope,
        expiresAt: '2027-06-05T08:00:00.000Z',
      });
      expect(inactive.body.error?.code).toBe('COVERAGE_GRANTEE_INVALID');
    } finally {
      expect(
        (
          await send(c.owner, 'patch', orgUrl(`/practitioners/${practitioner3}`), {
            status: 'active',
            version: off.body.practitioner.version,
          })
        ).status,
      ).toBe(200);
    }
    // The clinical-lead route is closed while the authority is off.
    vi.restoreAllMocks();
    pinClock();
    const asLead = await grant(c.doctor2, {
      granteePractitionerId: practitioner3,
      sourcePractitionerId: c.practitioner,
      scope: encounterScope,
    });
    expect(asLead.status).toBe(403);
    expect(asLead.body.error.code).toBe('COVERAGE_LEAD_NOT_ENABLED');
    expect(await CoverageModel.countDocuments({ organizationId: c.orgId, 'scope.encounterId': r.encounter.id })).toBe(0);
  });

  it('is idempotent per key and rejects a reused key with a different request', async () => {
    const r = await record();
    const key = randomUUID();
    const body = { granteePractitionerId: c.practitioner2, scope: { type: 'encounter', encounterId: r.encounter.id } };
    const results = await Promise.all([grant(c.doctor, body, key), grant(c.doctor, body, key), grant(c.doctor, body, key)]);
    expect(results.filter((x) => x.status === 201)).toHaveLength(1);
    expect(new Set(results.map((x) => x.body.coverage?.id)).size).toBe(1);
    const reused = await grant(c.doctor, { ...body, access: 'author' }, key);
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('a revocation racing a covered addendum: an addendum is never written after the revocation', async () => {
    vi.restoreAllMocks(); // real clock, so commit order is visible in the timestamps
    for (let round = 0; round < 4; round++) {
      const r = await record();
      vi.restoreAllMocks();
      const created = await grant(c.doctor, {
        granteePractitionerId: c.practitioner2,
        access: 'author',
        scope: { type: 'encounter', encounterId: r.encounter.id },
      });
      const id = created.body.coverage.id as string;
      const [added, revoked] = await Promise.all([addendum(c.doctor2, r.encounter.id, `${MARK} race ${round}`), revoke(c.doctor, id)]);
      expect(revoked.status).toBe(200);
      const coverage = await CoverageModel.findOne({ organizationId: c.orgId, _id: id }).lean();
      const written = await AddendumModel.find({ organizationId: c.orgId, encounterId: r.encounter.id }).lean();
      if (added.status === 201) {
        expect(written).toHaveLength(1);
        expect(written[0]!.createdAt.getTime()).toBeLessThanOrEqual(coverage!.revokedAt!.getTime());
      } else {
        expect(added.status).toBe(404);
        expect(written).toHaveLength(0);
      }
    }
  });

  it('never leaks clinical text into coverage audit events or the administrative audit log', async () => {
    const all = await ClinicalAuditModel.find({ organizationId: c.orgId }).lean();
    expect(all.some((e) => e.action === 'coverage.granted')).toBe(true);
    expect(JSON.stringify(all)).not.toContain(MARK);
    expect(JSON.stringify(await AuditEventModel.find({ organizationId: c.orgId }).lean())).not.toContain(MARK);
    expect(JSON.stringify(await CoverageModel.find({ organizationId: c.orgId }).lean())).not.toContain(MARK);
  });
});

/** A second agent on the lead-enabled app, signed in as an existing test user. */
async function onLeadApp(target: App, client: Client): Promise<Client> {
  const agent = request.agent(target);
  const res = await agent.post('/api/v1/auth/login').send({ email: client.email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return { ...client, agent, csrf: res.body.csrfToken };
}

describe('clinical lead (switched off by default)', () => {
  it('cannot be assigned while off; when enabled, a lead covers an unavailable doctor’s records but never themselves', async () => {
    const members = (await c.owner.agent.get(orgUrl('/members'))).body.data as { id: string; user: { id: string } }[];
    const doctor2Membership = members.find((m) => m.user.id === c.doctor2.userId)!.id;
    const off = await send(c.owner, 'patch', orgUrl(`/members/${doctor2Membership}`), { capabilities: ['clinical_lead'] });
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe('CAPABILITY_NOT_ENABLED');

    const owner = await onLeadApp(leadApp, c.owner);
    const lead = await onLeadApp(leadApp, c.doctor2);
    const on = await owner.agent
      .patch(orgUrl(`/members/${doctor2Membership}`))
      .set('X-CSRF-Token', owner.csrf)
      .send({ capabilities: ['clinical_lead'] });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body.member.capabilities).toEqual(['clinical_lead']);

    const r = await record();
    vi.restoreAllMocks();
    pinClock();
    const leadGrant = (body: object) =>
      lead.agent
        .post(orgUrl('/clinical/coverage'))
        .set('X-CSRF-Token', lead.csrf)
        .set('Idempotency-Key', randomUUID())
        .send({ access: 'read', reason: 'Doctor unavailable', expiresAt: inDays(3), sourcePractitionerId: c.practitioner, ...body });
    // No self-granting, even for a lead.
    const self = await leadGrant({ granteePractitionerId: c.practitioner2, scope: { type: 'encounter', encounterId: r.encounter.id } });
    expect(self.status).toBe(400);
    const ok = await leadGrant({ granteePractitionerId: practitioner3, scope: { type: 'patient', patientId: r.patientId } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.coverage).toMatchObject({ grantedVia: 'clinical_lead', source: { practitionerId: c.practitioner } });
    expect((await readRecord(doctor3, r.encounter.id)).status).toBe(200);
    // The lead itself still cannot read the record.
    expect((await readRecord(c.doctor2, r.encounter.id)).status).toBe(404);
    // The same capability means nothing on the default (switched-off) platform configuration.
    expect(
      (
        await grant(c.doctor2, {
          granteePractitionerId: practitioner3,
          sourcePractitionerId: c.practitioner,
          scope: { type: 'encounter', encounterId: r.encounter.id },
        })
      ).status,
    ).toBe(403);
    // Removing the capability is always possible.
    const removed = await owner.agent
      .patch(orgUrl(`/members/${doctor2Membership}`))
      .set('X-CSRF-Token', owner.csrf)
      .send({ capabilities: [] });
    expect(removed.body.member.capabilities).toEqual([]);
  });
});

describe('clinical audit view', () => {
  it('only explicit capability holders read it; it carries metadata only', async () => {
    const members = (await c.owner.agent.get(orgUrl('/members'))).body.data as { id: string; user: { id: string } }[];
    const idOf = (client: Client) => members.find((m) => m.user.id === client.userId)!.id;
    expect((await c.owner.agent.get(orgUrl('/clinical/audit'))).status).toBe(403);
    expect((await c.admin.agent.get(orgUrl('/clinical/audit'))).status).toBe(403);
    // Admins cannot assign capabilities; receptionists cannot hold this one.
    expect((await send(c.admin, 'patch', orgUrl(`/members/${idOf(c.doctor)}`), { capabilities: ['clinical_audit'] })).body.error.code).toBe(
      'CAPABILITY_OWNER_ONLY',
    );
    expect(
      (await send(c.owner, 'patch', orgUrl(`/members/${idOf(c.receptionist)}`), { capabilities: ['clinical_audit'] })).body.error.code,
    ).toBe('CAPABILITY_NOT_ELIGIBLE');
    const granted = await send(c.owner, 'patch', orgUrl(`/members/${idOf(c.admin)}`), { capabilities: ['clinical_audit'] });
    expect(granted.status).toBe(200);
    const detail = await c.admin.agent.get(`/api/v1/orgs/${c.orgId}`);
    expect(detail.body.membership.permissions).toContain('clinical.audit.read');
    expect(detail.body.membership.capabilities).toEqual(['clinical_audit']);

    const page = await c.admin.agent.get(orgUrl('/clinical/audit')).query({ limit: 20 });
    expect(page.status).toBe(200);
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.body.data.length).toBe(20);
    expect(page.body.next).toEqual(expect.any(String));
    expect(JSON.stringify(page.body)).not.toContain(MARK);
    const next = await c.admin.agent.get(orgUrl('/clinical/audit')).query({ limit: 20, before: page.body.next });
    expect(next.status).toBe(200);
    expect(next.body.data.length).toBeGreaterThan(0);
    // No overlap between pages, even with identical timestamps (the cursor includes the id).
    const firstIds = new Set(page.body.data.map((e: { id: string }) => e.id));
    expect(next.body.data.some((e: { id: string }) => firstIds.has(e.id))).toBe(false);
    const filtered = await c.admin.agent.get(orgUrl('/clinical/audit')).query({ action: 'coverage.revoked' });
    expect(filtered.body.data.every((e: { action: string }) => e.action === 'coverage.revoked')).toBe(true);
    // Reading the clinical audit is itself recorded; the admin still reads no clinical record.
    expect(
      await ClinicalAuditModel.countDocuments({ organizationId: c.orgId, action: 'clinical_audit.viewed', actorUserId: c.admin.userId }),
    ).toBeGreaterThan(0);
    expect(
      (await c.admin.agent.get(orgUrl(`/encounters/${(await EncounterModel.findOne({ organizationId: c.orgId }).lean())!._id}`))).status,
    ).toBe(403);

    // A role change to one that cannot hold it drops the capability (audited).
    expect(
      (
        await send(c.owner, 'patch', orgUrl(`/members/${idOf(c.admin)}`), {
          role: 'receptionist',
          branchScope: { type: 'selected', branchIds: [c.branchA] },
        })
      ).body.member.capabilities,
    ).toEqual([]);
    expect((await c.admin.agent.get(orgUrl('/clinical/audit'))).status).toBe(403);
    expect(await AuditEventModel.countDocuments({ organizationId: c.orgId, action: 'member.capabilities_changed' })).toBeGreaterThanOrEqual(
      2,
    );
    expect((await send(c.owner, 'patch', orgUrl(`/members/${idOf(c.admin)}`), { role: 'admin' })).status).toBe(200);
  });

  it('another organization’s coverage ids answer 404', async () => {
    const other = await buildClinic(app, 'cov-other');
    const otherRecord = await (async () => {
      const prev = c;
      c = other;
      try {
        return await record();
      } finally {
        c = prev;
      }
    })();
    const foreign = await other.doctor.agent
      .post(`/api/v1/orgs/${other.orgId}/clinical/coverage`)
      .set('X-CSRF-Token', other.doctor.csrf)
      .set('Idempotency-Key', randomUUID())
      .send({
        granteePractitionerId: other.practitioner2,
        scope: { type: 'encounter', encounterId: otherRecord.encounter.id },
        access: 'read',
        reason: 'Covering',
        expiresAt: inDays(3),
      });
    expect(foreign.status).toBe(201);
    const id = foreign.body.coverage.id as string;
    expect((await c.doctor2.agent.get(orgUrl(`/clinical/coverage/${id}/records`))).status).toBe(404);
    expect((await revoke(c.doctor, id)).status).toBe(404);
    expect((await readRecord(c.doctor2, otherRecord.encounter.id)).status).toBe(404);
    // Granting over a foreign record or to a foreign practitioner fails too.
    expect(
      (
        await grant(c.doctor, {
          granteePractitionerId: c.practitioner2,
          scope: { type: 'encounter', encounterId: otherRecord.encounter.id },
        })
      ).status,
    ).toBe(404);
    const r = await record();
    expect(
      (await grant(c.doctor, { granteePractitionerId: other.practitioner2, scope: { type: 'encounter', encounterId: r.encounter.id } }))
        .status,
    ).toBe(400);
  });
});
