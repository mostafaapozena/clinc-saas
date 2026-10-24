import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditEventModel } from '../src/modules/audit/audit-event.model.js';
import { AddendumModel, ClinicalAuditModel, EncounterModel } from '../src/modules/clinical/clinical.model.js';
import { register, send, testApp, createOrg, type Client } from './helpers/api.js';
import { TODAY, act, bookOk, buildClinic, createPatient, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// Synthetic clinical text only. MARK makes leaks easy to find in audit events, errors and DTOs.
const MARK = 'SYNTHETIC-CLINICAL-TEXT';
const app = testApp();
let c: Clinic;
const orgUrl = (path: string) => `/api/v1/orgs/${c.orgId}${path}`;

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('clinical');
  c = await buildClinic(app, 'clin');
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => dropTestDatabase());

// Each visit gets its own day/slot: the clock is pinned to 07:00 Cairo on that day so the
// appointment can be booked, checked in and started "today".
let visitSeq = 0;
type Visit = { id: string; patientId: string; version: number; date: string };
async function visit(
  options: {
    practitioner?: string;
    starter?: Client;
    stopAt?: 'scheduled' | 'checked_in' | 'in_progress' | 'completed';
  } = {},
): Promise<Visit> {
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
  let a = await bookOk(c.owner, c.orgId, {
    patientId,
    practitionerId: options.practitioner ?? c.practitioner,
    branchId: c.branchA,
    date,
    time,
  });
  const steps: [string, Client][] = [
    ['check_in', c.receptionist],
    ['start', options.starter ?? c.doctor],
    ['complete', options.starter ?? c.doctor],
  ];
  const stopAt = options.stopAt ?? 'in_progress';
  for (const [action, actor] of steps) {
    if (a.status === stopAt) break;
    const res = await act(actor, c.orgId, a.id, action, a.version);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    a = res.body.appointment;
  }
  expect(a.status).toBe(stopAt);
  return { id: a.id, patientId, version: a.version, date };
}

const key = () => randomUUID();
const start = (who: Client, appointmentId: string, body: object = {}, k = key()) =>
  who.agent
    .post(orgUrl(`/appointments/${appointmentId}/encounter`))
    .set('X-CSRF-Token', who.csrf)
    .set('Idempotency-Key', k)
    .send(body);
const save = (who: Client, encounterId: string, sections: object, version: number) =>
  send(who, 'put', orgUrl(`/encounters/${encounterId}`), { sections, version });
const finalize = (who: Client, encounterId: string, version: number, k = key()) =>
  who.agent
    .post(orgUrl(`/encounters/${encounterId}/finalize`))
    .set('X-CSRF-Token', who.csrf)
    .set('Idempotency-Key', k)
    .send({ version });
const addendum = (who: Client, encounterId: string, body: object, k = key()) =>
  who.agent
    .post(orgUrl(`/encounters/${encounterId}/addenda`))
    .set('X-CSRF-Token', who.csrf)
    .set('Idempotency-Key', k)
    .send(body);
const read = (who: Client, appointmentId: string) => who.agent.get(orgUrl(`/appointments/${appointmentId}/encounter`));
const history = (who: Client, patientId: string) => who.agent.get(orgUrl(`/patients/${patientId}/clinical-history`));

async function draft(v?: Visit) {
  const appointment = v ?? (await visit());
  const res = await start(c.doctor, appointment.id, {
    sections: { reason: `${MARK} reason` },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return {
    appointment,
    encounter: res.body.encounter as { id: string; version: number },
  };
}
async function finalized() {
  const { appointment, encounter } = await draft();
  const saved = await save(c.doctor, encounter.id, { plan: `${MARK} plan` }, encounter.version);
  expect(saved.status).toBe(200);
  const done = await finalize(c.doctor, encounter.id, saved.body.encounter.version);
  expect(done.status, JSON.stringify(done.body)).toBe(201);
  return {
    appointment,
    encounter: done.body.encounter as { id: string; version: number },
  };
}

describe('lifecycle', () => {
  it('starts, saves, finalizes and corrects a record for the treating doctor', async () => {
    const v = await visit();
    const empty = await read(c.doctor, v.id);
    expect(empty.status).toBe(200);
    expect(empty.headers['cache-control']).toBe('no-store');
    expect(empty.body).toMatchObject({
      encounter: null,
      canStart: true,
      lateEntryRequired: false,
      appointmentStatus: 'in_progress',
    });

    const created = await start(c.doctor, v.id, {
      sections: { reason: `${MARK} cough` },
    });
    expect(created.status).toBe(201);
    const e = created.body.encounter;
    expect(e).toMatchObject({
      status: 'draft',
      version: 0,
      appointmentId: v.id,
      patientId: v.patientId,
      lateEntry: null,
    });
    expect(e.sections).toEqual({
      reason: `${MARK} cough`,
      history: '',
      examination: '',
      assessment: '',
      plan: '',
    });

    const saved = await save(c.doctor, e.id, { history: `${MARK} history`, examination: `${MARK} exam` }, 0);
    expect(saved.status).toBe(200);
    expect(saved.body.encounter.version).toBe(1);
    expect(saved.body.encounter.sections.reason).toBe(`${MARK} cough`); // untouched sections are kept

    // Resume: a fresh read returns the saved draft.
    const resumed = await read(c.doctor, v.id);
    expect(resumed.body.encounter).toMatchObject({
      version: 1,
      status: 'draft',
    });
    expect(resumed.body.canStart).toBe(false);

    const done = await finalize(c.doctor, e.id, 1);
    expect(done.status).toBe(201);
    expect(done.body.encounter).toMatchObject({
      status: 'finalized',
      version: 2,
    });
    expect(done.body.encounter.finalizedAt).toEqual(expect.any(String));

    const added = await addendum(c.doctor, e.id, {
      reason: 'Clarification',
      content: `${MARK} addendum`,
    });
    expect(added.status).toBe(201);
    expect(added.body.encounter.addenda).toHaveLength(1);
    expect(added.body.encounter.sections.examination).toBe(`${MARK} exam`); // the original stays as finalized
  });

  it('requires the reason and at least one of examination, assessment or plan to finalize', async () => {
    const { encounter } = await draft();
    let version = encounter.version;
    const noFindings = await finalize(c.doctor, encounter.id, version);
    expect(noFindings.status).toBe(400);
    expect(noFindings.body.error).toMatchObject({
      code: 'ENCOUNTER_INCOMPLETE',
      fields: { sections: 'needs_findings_assessment_or_plan' },
    });

    const cleared = await save(c.doctor, encounter.id, { reason: '   ', assessment: `${MARK} assessment` }, version);
    version = cleared.body.encounter.version;
    const noReason = await finalize(c.doctor, encounter.id, version);
    expect(noReason.body.error).toMatchObject({
      code: 'ENCOUNTER_INCOMPLETE',
      fields: { 'sections.reason': 'required' },
    });
    expect(JSON.stringify(noReason.body)).not.toContain(MARK);
  });

  it('never changes a finalized record', async () => {
    const { encounter } = await finalized();
    const edit = await save(c.doctor, encounter.id, { plan: 'changed' }, encounter.version);
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('ENCOUNTER_FINALIZED');
    const again = await finalize(c.doctor, encounter.id, encounter.version);
    expect(again.body.error.code).toBe('ENCOUNTER_FINALIZED');

    // Also enforced below the API: updates not conditioned on `status: 'draft'`, and deletes, throw.
    await expect(
      EncounterModel.updateOne({ organizationId: c.orgId, _id: encounter.id }, { $set: { 'sections.plan': 'x' } }),
    ).rejects.toThrow();
    await expect(EncounterModel.deleteOne({ organizationId: c.orgId, _id: encounter.id })).rejects.toThrow();
    await expect(AddendumModel.updateMany({ organizationId: c.orgId }, { $set: { content: 'x' } })).rejects.toThrow();
    await expect(ClinicalAuditModel.deleteMany({ organizationId: c.orgId })).rejects.toThrow();
    const stored = await EncounterModel.findOne({
      organizationId: c.orgId,
      _id: encounter.id,
    }).lean();
    expect(stored?.sections.plan).toBe(`${MARK} plan`);
  });

  it('accepts addenda only on finalized records, with a reason', async () => {
    const { encounter } = await draft();
    const onDraft = await addendum(c.doctor, encounter.id, {
      reason: 'Clarification',
      content: 'x',
    });
    expect(onDraft.status).toBe(409);
    expect(onDraft.body.error.code).toBe('ENCOUNTER_NOT_FINALIZED');

    const { encounter: done } = await finalized();
    const noReason = await addendum(c.doctor, done.id, {
      reason: ' ',
      content: 'x',
    });
    expect(noReason.status).toBe(400);
    const empty = await addendum(c.doctor, done.id, {
      reason: 'Clarification',
      content: '',
    });
    expect(empty.status).toBe(400);
  });

  it('starts only from an in-progress visit, or a completed one as a late entry with a reason', async () => {
    for (const stopAt of ['scheduled', 'checked_in'] as const) {
      const v = await visit({ stopAt });
      const res = await start(c.doctor, v.id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ENCOUNTER_NOT_ALLOWED');
      expect((await read(c.doctor, v.id)).body.canStart).toBe(false);
    }

    const done = await visit({ stopAt: 'completed' });
    const info = await read(c.doctor, done.id);
    expect(info.body).toMatchObject({
      canStart: true,
      lateEntryRequired: true,
    });
    const noReason = await start(c.doctor, done.id, {
      sections: { reason: 'x' },
    });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.code).toBe('LATE_ENTRY_REASON_REQUIRED');

    // Real timestamps: the record is created "now", after the completed visit.
    vi.restoreAllMocks();
    pinClock(`${done.date}T15:00:00.000Z`);
    const late = await start(c.doctor, done.id, {
      lateEntryReason: 'Documented after clinic hours',
    });
    expect(late.status).toBe(201);
    expect(late.body.encounter.lateEntry).toEqual({
      reason: 'Documented after clinic hours',
    });
    expect(late.body.encounter.createdAt).toBe(`${done.date}T15:00:00.000Z`);
  });

  it('validates input without echoing clinical text', async () => {
    const v = await visit();
    const noKey = await send(c.doctor, 'post', orgUrl(`/appointments/${v.id}/encounter`), {});
    expect(noKey.status).toBe(400);
    expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const tooLong = await start(c.doctor, v.id, {
      sections: { history: MARK.repeat(400) },
    });
    expect(tooLong.status).toBe(400);
    expect(JSON.stringify(tooLong.body)).not.toContain(MARK);

    const cleaned = await start(c.doctor, v.id, {
      sections: { reason: `  ${MARK}\u0000\u0007 line\r\nnext  ` },
    });
    expect(cleaned.status).toBe(201);
    expect(cleaned.body.encounter.sections.reason).toBe(`${MARK} line\nnext`);
  });
});

describe('idempotency', () => {
  it('replays create, finalize and addendum, and rejects a reused key with a different request', async () => {
    const v = await visit();
    const k = key();
    const body = { sections: { reason: `${MARK} a` } };
    const first = await start(c.doctor, v.id, body, k);
    const replay = await start(c.doctor, v.id, body, k);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({
      replayed: true,
      encounter: { id: first.body.encounter.id },
    });
    const different = await start(c.doctor, v.id, { sections: { reason: `${MARK} b` } }, k);
    expect(different.status).toBe(409);
    expect(different.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const second = await start(c.doctor, v.id, body);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ENCOUNTER_EXISTS');

    const id = first.body.encounter.id as string;
    const saved = await save(c.doctor, id, { plan: `${MARK} plan` }, 0);
    const fk = key();
    expect((await finalize(c.doctor, id, saved.body.encounter.version, fk)).status).toBe(201);
    const finalReplay = await finalize(c.doctor, id, saved.body.encounter.version, fk);
    expect(finalReplay.status).toBe(200);
    expect(finalReplay.body.replayed).toBe(true);

    const ak = key();
    const note = { reason: 'Clarification', content: `${MARK} note` };
    expect((await addendum(c.doctor, id, note, ak)).status).toBe(201);
    const addReplay = await addendum(c.doctor, id, note, ak);
    expect(addReplay.status).toBe(200);
    expect(addReplay.body.encounter.addenda).toHaveLength(1);
    const addDifferent = await addendum(c.doctor, id, { ...note, content: 'other' }, ak);
    expect(addDifferent.status).toBe(409);
    expect(addDifferent.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('concurrency', () => {
  it('creates exactly one record per appointment under parallel requests', async () => {
    const v = await visit();
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => start(c.doctor, v.id, { sections: { reason: `${MARK} ${i}` } })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 201)) expect(r.body.error.code).toBe('ENCOUNTER_EXISTS');
    expect(
      await EncounterModel.countDocuments({
        organizationId: c.orgId,
        appointmentId: v.id,
      }),
    ).toBe(1);
  });

  it('parallel retries of one create return the same record', async () => {
    const v = await visit();
    const k = key();
    const body = { sections: { reason: `${MARK}` } };
    const results = await Promise.all(Array.from({ length: 5 }, () => start(c.doctor, v.id, body, k)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(new Set(results.map((r) => r.body.encounter?.id))).toHaveProperty('size', 1);
  });

  it('a save racing finalization of the same version: exactly one wins, nothing is lost silently', async () => {
    for (let round = 0; round < 3; round++) {
      const { encounter } = await draft();
      const ready = await save(c.doctor, encounter.id, { plan: `${MARK} plan` }, encounter.version);
      const version = ready.body.encounter.version as number;
      const [saved, done] = await Promise.all([
        save(c.doctor, encounter.id, { plan: `${MARK} late change` }, version),
        finalize(c.doctor, encounter.id, version),
      ]);
      const winners = [saved.status, done.status].filter((s) => s < 300);
      expect(winners).toHaveLength(1);
      const stored = await EncounterModel.findOne({
        organizationId: c.orgId,
        _id: encounter.id,
      }).lean();
      if (done.status === 201) {
        expect(saved.status).toBe(409);
        expect(['VERSION_CONFLICT', 'ENCOUNTER_FINALIZED']).toContain(saved.body.error.code);
        expect(stored).toMatchObject({
          status: 'finalized',
          sections: { plan: `${MARK} plan` },
        });
      } else {
        expect(done.status).toBe(409);
        expect(done.body.error.code).toBe('VERSION_CONFLICT');
        expect(stored).toMatchObject({
          status: 'draft',
          sections: { plan: `${MARK} late change` },
        });
      }
    }
  });

  it('two tabs saving the same version: one wins, the other gets a conflict with the current version', async () => {
    const { encounter } = await draft();
    const [a, b] = await Promise.all([
      save(c.doctor, encounter.id, { history: `${MARK} tab A` }, encounter.version),
      save(c.doctor, encounter.id, { history: `${MARK} tab B` }, encounter.version),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error).toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { currentVersion: encounter.version + 1 },
    });
  });

  it('parallel finalizations with different keys finalize once', async () => {
    const { encounter } = await draft();
    const ready = await save(c.doctor, encounter.id, { plan: `${MARK}` }, encounter.version);
    const results = await Promise.all(Array.from({ length: 4 }, () => finalize(c.doctor, encounter.id, ready.body.encounter.version)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      await ClinicalAuditModel.countDocuments({
        organizationId: c.orgId,
        encounterId: encounter.id,
        action: 'encounter.finalized',
      }),
    ).toBe(1);
  });

  it('parallel retries of one addendum add it once', async () => {
    const { encounter } = await finalized();
    const k = key();
    const body = { reason: 'Clarification', content: `${MARK} once` };
    const results = await Promise.all(Array.from({ length: 5 }, () => addendum(c.doctor, encounter.id, body, k)));
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(
      await AddendumModel.countDocuments({
        organizationId: c.orgId,
        encounterId: encounter.id,
      }),
    ).toBe(1);
  });

  it('a suspension racing a save: after both, the suspended doctor can no longer write', async () => {
    const { encounter } = await draft();
    const [, suspended] = await Promise.all([
      save(c.doctor, encounter.id, { history: `${MARK} race` }, encounter.version),
      send(c.owner, 'patch', orgUrl(`/members/${c.doctorMembership}`), {
        status: 'suspended',
      }),
    ]);
    expect(suspended.status).toBe(200);
    try {
      const after = await save(c.doctor, encounter.id, { history: 'after' }, 99);
      expect(after.status).toBe(404);
    } finally {
      expect((await send(c.owner, 'patch', orgUrl(`/members/${c.doctorMembership}`), { status: 'active' })).status).toBe(200);
    }
  });
});

describe('access', () => {
  it('denies other doctors with the same 404 as a missing record, and records the denial', async () => {
    const { appointment, encounter } = await draft();
    const missing = '0123456789abcdef01234567';
    const otherDoctor = [
      await read(c.doctor2, appointment.id),
      await start(c.doctor2, appointment.id),
      await save(c.doctor2, encounter.id, { plan: 'x' }, 0),
      await finalize(c.doctor2, encounter.id, 0),
      await addendum(c.doctor2, encounter.id, {
        reason: 'Clarification',
        content: 'x',
      }),
    ];
    const absent = await read(c.doctor2, missing);
    for (const res of [...otherDoctor, absent]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(absent.body);
    }
    const hist = await history(c.doctor2, appointment.patientId);
    expect(hist.status).toBe(200);
    expect(hist.body.data).toEqual([]);
    const denials = await ClinicalAuditModel.find({
      organizationId: c.orgId,
      action: 'clinical.access_denied',
      appointmentId: appointment.id,
    }).lean();
    expect(denials.length).toBeGreaterThan(0);
    // Unchanged by the attempts.
    expect(
      (
        await EncounterModel.findOne({
          organizationId: c.orgId,
          _id: encounter.id,
        }).lean()
      )?.version,
    ).toBe(0);
  });

  it('gives owners, admins, receptionists and viewers no clinical content', async () => {
    const { appointment, encounter } = await finalized();
    for (const who of [c.owner, c.admin, c.receptionist, c.viewer]) {
      for (const res of [
        await read(who, appointment.id),
        await start(who, appointment.id),
        await save(who, encounter.id, { plan: 'x' }, 0),
        await finalize(who, encounter.id, 0),
        await addendum(who, encounter.id, {
          reason: 'Clarification',
          content: 'x',
        }),
        await history(who, appointment.patientId),
      ]) {
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain(MARK);
      }
    }
  });

  it('shows owners and admins only the documentation status; receptionists not even that', async () => {
    const { appointment } = await finalized();
    const fresh = await visit();
    for (const who of [c.owner, c.admin, c.doctor]) {
      const res = await who.agent.get(orgUrl(`/appointments/${appointment.id}`));
      expect(res.body.appointment.documentation).toBe('finalized');
      expect(JSON.stringify(res.body)).not.toContain(MARK);
      expect((await who.agent.get(orgUrl(`/appointments/${fresh.id}`))).body.appointment.documentation).toBe('none');
    }
    const desk = await c.receptionist.agent.get(orgUrl(`/appointments/${appointment.id}`));
    expect(desk.status).toBe(200);
    expect(desk.body.appointment).not.toHaveProperty('documentation');
    expect((await c.viewer.agent.get(orgUrl(`/appointments/${appointment.id}`))).status).toBe(403);
    const queue = await c.receptionist.agent.get(orgUrl('/queue'));
    expect(JSON.stringify(queue.body)).not.toContain('documentation');
  });

  it('a doctor of another organization gets the generic 404', async () => {
    const { appointment, encounter } = await draft();
    const outsider = await register(app, 'clin-outsider');
    const { orgId: otherOrg } = await createOrg(outsider, 'Other Clinic');
    for (const path of [
      `/api/v1/orgs/${c.orgId}/appointments/${appointment.id}/encounter`,
      `/api/v1/orgs/${otherOrg}/appointments/${appointment.id}/encounter`,
    ]) {
      expect((await outsider.agent.get(path)).status).toBe(path.includes(otherOrg) ? 403 : 404);
    }
    expect((await save(outsider, encounter.id, { plan: 'x' }, 0)).status).toBe(404);
  });

  it('suspension, branch-scope changes and profile deactivation apply immediately', async () => {
    const { appointment, encounter } = await draft();
    const patch = (body: object) => send(c.owner, 'patch', orgUrl(`/members/${c.doctorMembership}`), body);

    expect((await patch({ status: 'suspended' })).status).toBe(200);
    expect((await read(c.doctor, appointment.id)).status).toBe(404);
    expect((await patch({ status: 'active' })).status).toBe(200);
    expect((await read(c.doctor, appointment.id)).status).toBe(200);

    // The visit was at branch A; scoping the doctor to branch B hides it.
    expect(
      (
        await patch({
          branchScope: { type: 'selected', branchIds: [c.branchB] },
        })
      ).status,
    ).toBe(200);
    expect((await read(c.doctor, appointment.id)).status).toBe(404);
    expect((await save(c.doctor, encounter.id, { plan: 'x' }, encounter.version)).status).toBe(404);
    expect((await history(c.doctor, appointment.patientId)).body.data).toEqual([]);
    expect(
      (
        await patch({
          branchScope: { type: 'selected', branchIds: [c.branchA, c.branchB] },
        })
      ).status,
    ).toBe(200);

    // Deactivation needs no future appointments: move the clock past every test visit.
    vi.restoreAllMocks();
    pinClock('2027-03-01T08:00:00.000Z');
    const profile = await c.owner.agent.get(orgUrl(`/practitioners/${c.practitioner}`));
    const off = await send(c.owner, 'patch', orgUrl(`/practitioners/${c.practitioner}`), {
      status: 'inactive',
      version: profile.body.practitioner.version,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    try {
      expect((await read(c.doctor, appointment.id)).status).toBe(404);
    } finally {
      const on = await send(c.owner, 'patch', orgUrl(`/practitioners/${c.practitioner}`), {
        status: 'active',
        version: off.body.practitioner.version,
      });
      expect(on.status).toBe(200);
    }
    expect((await read(c.doctor, appointment.id)).status).toBe(200);
  });

  it('lists only the caller’s own records in a patient’s clinical history', async () => {
    const mine = await finalized();
    // The same patient seen by doctor 2.
    const other = await visit({
      practitioner: c.practitioner2,
      starter: c.doctor2,
    });
    expect((await start(c.doctor2, other.id, { sections: { reason: 'doctor 2' } })).status).toBe(201);
    const res = await history(c.doctor, mine.appointment.patientId);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toEqual([
      expect.objectContaining({
        id: mine.encounter.id,
        status: 'finalized',
        reason: `${MARK} reason`,
        addendaCount: 0,
      }),
    ]);
    expect((await history(c.doctor2, other.patientId)).body.data).toHaveLength(1);
  });
});

describe('audit and privacy', () => {
  it('records clinical events with references and metadata only — never clinical text', async () => {
    const { encounter } = await finalized();
    expect(
      (
        await addendum(c.doctor, encounter.id, {
          reason: `${MARK} why`,
          content: `${MARK} body`,
        })
      ).status,
    ).toBe(201);
    const events = await ClinicalAuditModel.find({
      organizationId: c.orgId,
      encounterId: encounter.id,
    }).lean();
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining(['encounter.created', 'encounter.draft_saved', 'encounter.finalized', 'encounter.addendum_added']),
    );
    const all = await ClinicalAuditModel.find({
      organizationId: c.orgId,
    }).lean();
    expect(JSON.stringify(all)).not.toContain(MARK);
    expect(JSON.stringify(await AuditEventModel.find({ organizationId: c.orgId }).lean())).not.toContain(MARK);
    const saved = events.find((e) => e.action === 'encounter.draft_saved');
    expect(saved?.metadata).toEqual({ version: 1, sectionsChanged: ['plan'] });
  });

  it('records repeated reads once per window', async () => {
    const { appointment, encounter } = await draft();
    for (let i = 0; i < 3; i++) await read(c.doctor, appointment.id);
    expect(
      await ClinicalAuditModel.countDocuments({
        organizationId: c.orgId,
        encounterId: encounter.id,
        action: 'encounter.viewed',
      }),
    ).toBe(1);
  });
});
