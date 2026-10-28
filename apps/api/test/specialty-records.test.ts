import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EncounterModel } from '../src/modules/clinical/clinical.model.js';
import { clock } from '../src/time/clock.js';
import { addMember, register, send, testApp, type Client } from './helpers/api.js';
import { TODAY, act, bookOk, buildClinic, createPatient, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// Specialty templates on visit records (synthetic data only; MARK finds leaks).
const MARK = 'SYNTHETIC-SPECIALTY';
const app = testApp();
let c: Clinic;
let physio: { client: Client; practitioner: string };
let ent: { client: Client; practitioner: string };
const orgUrl = (path: string) => `/api/v1/orgs/${c.orgId}${path}`;

async function doctorWithSpecialty(label: string, specialtyCode: string) {
  const client = await register(app, label);
  const membership = await addMember(c.owner, c.orgId, client, 'doctor', [c.branchA]);
  const created = await send(c.owner, 'post', orgUrl('/practitioners'), {
    membershipId: membership,
    specialtyCode,
    branchIds: [c.branchA],
    defaultDurationMinutes: 30,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.practitioner.id as string;
  const scheduled = await send(c.owner, 'put', orgUrl(`/practitioners/${id}/schedule`), {
    weeklySchedule: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ branchId: c.branchA, weekday, start: '08:00', end: '20:00' })),
    version: created.body.practitioner.version,
  });
  expect(scheduled.status).toBe(200);
  return { client, practitioner: id };
}

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('specialty');
  c = await buildClinic(app, 'spec');
  physio = await doctorWithSpecialty('spec-physio', 'physiotherapy');
  ent = await doctorWithSpecialty('spec-ent', 'ent');
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => dropTestDatabase());

let seq = 0;
/** A visit in progress (clock pinned to that day, 07:00 Cairo). */
async function visit(doctor: Client, practitioner: string, patientId?: string) {
  const i = seq++;
  const date =
    DateTime.fromISO(TODAY)
      .plus({ days: 1 + Math.floor(i / 10) })
      .toISODate() ?? TODAY;
  const minutes = 8 * 60 + 30 + (i % 10) * 30;
  const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  vi.restoreAllMocks();
  pinClock(`${date}T05:00:00.000Z`);
  const patient = patientId ?? (await createPatient(c.receptionist, c.orgId, c.branchA));
  let a = await bookOk(c.owner, c.orgId, { patientId: patient, practitionerId: practitioner, branchId: c.branchA, date, time });
  for (const [action, actor] of [
    ['check_in', c.receptionist],
    ['start', doctor],
  ] as const) {
    a = (await act(actor, c.orgId, a.id, action, a.version)).body.appointment;
  }
  return { appointmentId: a.id, patientId: patient, date };
}
const start = (who: Client, appointmentId: string, body: object = {}) =>
  who.agent
    .post(orgUrl(`/appointments/${appointmentId}/encounter`))
    .set('X-CSRF-Token', who.csrf)
    .set('Idempotency-Key', randomUUID())
    .send(body);
const save = (who: Client, id: string, version: number, specialtyData: unknown, sections: object = {}) =>
  send(who, 'put', orgUrl(`/encounters/${id}`), {
    sections: { reason: `${MARK} reason`, plan: `${MARK} plan`, ...sections },
    specialtyData,
    version,
  });
const finalize = (who: Client, id: string, version: number) =>
  who.agent
    .post(orgUrl(`/encounters/${id}/finalize`))
    .set('X-CSRF-Token', who.csrf)
    .set('Idempotency-Key', randomUUID())
    .send({ version });

/** Start → save (with data) → finalize; returns the finalized record. */
async function documented(who: Client, appointmentId: string, specialtyData: unknown, template?: string) {
  const started = await start(who, appointmentId, template ? { template } : {});
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  const saved = await save(who, started.body.encounter.id, started.body.encounter.version, specialtyData);
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const done = await finalize(who, saved.body.encounter.id, saved.body.encounter.version);
  expect(done.status, JSON.stringify(done.body)).toBe(201);
  return done.body.encounter as { id: string; specialty: { template: string; version: number; data: Record<string, unknown> } };
}

describe('templates', () => {
  it('follow the practitioner’s specialty, at a recorded version', async () => {
    const dental = await visit(c.doctor, c.practitioner);
    const offer = await c.doctor.agent.get(orgUrl(`/appointments/${dental.appointmentId}/encounter`));
    expect(offer.body.templates).toEqual(['dentistry.visit']);
    const wrong = await start(c.doctor, dental.appointmentId, { template: 'ent.visit' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('TEMPLATE_NOT_ALLOWED');
    const created = await start(c.doctor, dental.appointmentId);
    expect(created.body.encounter.specialty).toMatchObject({
      template: 'dentistry.visit',
      version: 1,
      data: { dentition: 'permanent', findings: [] },
    });

    const p = await visit(physio.client, physio.practitioner);
    expect((await physio.client.agent.get(orgUrl(`/appointments/${p.appointmentId}/encounter`))).body.templates).toEqual([
      'physiotherapy.assessment',
      'physiotherapy.session',
      'physiotherapy.discharge',
    ]);
  });

  it('keep historical records on their own version: an unknown version is never reinterpreted', async () => {
    const v = await visit(c.doctor, c.practitioner);
    const created = await start(c.doctor, v.appointmentId);
    const id = created.body.encounter.id as string;
    // A record from a (hypothetical) other version, stored as-is.
    await EncounterModel.updateOne(
      { organizationId: c.orgId, _id: id, status: 'draft' },
      { $set: { specialty: { template: 'dentistry.visit', version: 99, data: { legacyField: 'kept' } } } },
    );
    const read = await c.doctor.agent.get(orgUrl(`/encounters/${id}`));
    expect(read.body.encounter.specialty).toEqual({ template: 'dentistry.visit', version: 99, data: { legacyField: 'kept' } });
    const rewrite = await save(c.doctor, id, created.body.encounter.version, { findings: [] });
    expect(rewrite.status).toBe(400);
    expect(rewrite.body.error.code).toBe('TEMPLATE_NOT_ALLOWED');
    expect((await EncounterModel.findOne({ organizationId: c.orgId, _id: id }).lean())?.specialty?.data).toEqual({ legacyField: 'kept' });
  });

  it('validate bounded input without echoing clinical text', async () => {
    const v = await visit(ent.client, ent.practitioner);
    const created = await start(ent.client, v.appointmentId);
    expect(created.body.encounter.specialty.template).toBe('ent.visit');
    const tooLong = await save(ent.client, created.body.encounter.id, 0, { examination: { rightEar: MARK.repeat(100) } });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.fields).toEqual({ 'specialty.examination.rightEar': 'too_long' });
    expect(JSON.stringify(tooLong.body)).not.toContain(MARK);
    const unknownTooth = await save(
      c.doctor,
      (await start(c.doctor, (await visit(c.doctor, c.practitioner)).appointmentId)).body.encounter.id,
      0,
      {
        findings: [{ id: 'f-aaaaaa', tooth: '19', note: 'x' }],
      },
    );
    expect(unknownTooth.body.error.fields).toEqual({ 'specialty.findings.0.tooth': 'invalid' });
    const done = await documented(ent.client, (await visit(ent.client, ent.practitioner)).appointmentId, {
      history: { ear: `${MARK} ear history`, nose: '', throat: '' },
      examination: { rightEar: `${MARK} right`, leftEar: '', nose: '', throat: '', neck: '' },
      followUp: `${MARK} follow-up`,
    });
    expect(done.specialty.data).toMatchObject({ followUp: `${MARK} follow-up`, examination: { rightEar: `${MARK} right` } });
    // Finalized specialty data is as immutable as the rest of the record.
    expect((await save(ent.client, done.id, 2, { followUp: 'changed' })).status).toBe(409);
  });
});

describe('dentistry', () => {
  it('builds the chart from finalized visits without overwriting earlier findings, and tracks the plan', async () => {
    const first = await visit(c.doctor, c.practitioner);
    const visit1 = await documented(c.doctor, first.appointmentId, {
      dentition: 'permanent',
      findings: [{ id: 'f-111111', tooth: '16', surfaces: ['O', 'M'], note: `${MARK} caries 16` }],
      planItems: [{ id: 'p-111111', tooth: '16', description: `${MARK} restoration 16` }],
    });
    const second = await visit(c.doctor, c.practitioner, first.patientId);
    // References must point at a real plan item of a finalized visit of this patient.
    const draft2 = await start(c.doctor, second.appointmentId);
    const bad = await save(c.doctor, draft2.body.encounter.id, 0, {
      planUpdates: [{ itemId: 'p-999999', sourceEncounterId: visit1.id, status: 'done' }],
    });
    expect(bad.body.error.fields).toEqual({ 'specialty.planUpdates.0.itemId': 'invalid_reference' });
    const saved = await save(c.doctor, draft2.body.encounter.id, 0, {
      findings: [{ id: 'f-222222', tooth: '16', surfaces: ['O'], note: `${MARK} restored 16` }],
      procedures: [{ id: 'x-222222', tooth: '16', description: `${MARK} composite filling` }],
      planUpdates: [{ itemId: 'p-111111', sourceEncounterId: visit1.id, status: 'done', note: 'completed' }],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await finalize(c.doctor, saved.body.encounter.id, saved.body.encounter.version)).status).toBe(201);

    const chart = await c.doctor.agent.get(orgUrl(`/patients/${first.patientId}/dental-chart`));
    expect(chart.status).toBe(200);
    expect(chart.headers['cache-control']).toBe('no-store');
    const tooth16 = chart.body.teeth.find((t: { tooth: string }) => t.tooth === '16');
    expect(tooth16.entries.map((e: { kind: string; text: string }) => `${e.kind}:${e.text}`)).toEqual([
      `finding:${MARK} caries 16`,
      `finding:${MARK} restored 16`,
      `procedure:${MARK} composite filling`,
    ]);
    expect(chart.body.planItems).toEqual([
      expect.objectContaining({
        id: 'p-111111',
        sourceEncounterId: visit1.id,
        status: 'done',
        history: [expect.objectContaining({ status: 'done' })],
      }),
    ]);
    // Drafts never reach the chart (only finalized visits do).
    const third = await visit(c.doctor, c.practitioner, first.patientId);
    const draft3 = await start(c.doctor, third.appointmentId);
    expect(
      (await save(c.doctor, draft3.body.encounter.id, 0, { findings: [{ id: 'f-777777', tooth: '47', note: `${MARK} draft only` }] }))
        .status,
    ).toBe(200);
    const again = await c.doctor.agent.get(orgUrl(`/patients/${first.patientId}/dental-chart`));
    expect(again.body.teeth.map((x: { tooth: string }) => x.tooth)).toEqual(['16']);
    expect(again.body.drafts).toBe(1);
    // The first visit's own data is unchanged.
    const stored = await EncounterModel.findOne({ organizationId: c.orgId, _id: visit1.id }).lean();
    expect(stored?.specialty?.data.findings).toEqual([{ id: 'f-111111', tooth: '16', surfaces: ['O', 'M'], note: `${MARK} caries 16` }]);
  });

  it('shows the chart only to those who may read the records', async () => {
    const v = await visit(c.doctor, c.practitioner);
    await documented(c.doctor, v.appointmentId, { findings: [{ id: 'f-333333', tooth: '21', note: `${MARK} chip` }] });
    const other = await c.doctor2.agent.get(orgUrl(`/patients/${v.patientId}/dental-chart`));
    expect(other.status).toBe(200);
    expect(other.body.teeth).toEqual([]);
    expect((await c.owner.agent.get(orgUrl(`/patients/${v.patientId}/dental-chart`))).status).toBe(403);
    expect((await c.receptionist.agent.get(orgUrl(`/patients/${v.patientId}/dental-chart`))).status).toBe(403);
    // With patient-wide coverage, the colleague sees the same chart.
    const granted = await c.doctor.agent
      .post(orgUrl('/clinical/coverage'))
      .set('X-CSRF-Token', c.doctor.csrf)
      .set('Idempotency-Key', randomUUID())
      .send({
        granteePractitionerId: c.practitioner2,
        scope: { type: 'patient', patientId: v.patientId },
        access: 'read',
        reason: 'Covering',
        expiresAt: new Date(clock.now().getTime() + 86_400_000).toISOString(),
      });
    expect(granted.status).toBe(201);
    const covered = await c.doctor2.agent.get(orgUrl(`/patients/${v.patientId}/dental-chart`));
    expect(covered.body.teeth.map((t: { tooth: string }) => t.tooth)).toEqual(['21']);
  });
});

describe('physiotherapy', () => {
  it('links sessions and discharge to a finalized assessment, with real appointments as the schedule', async () => {
    const first = await visit(physio.client, physio.practitioner);
    // The assessment needs the planned number of sessions to be finalized.
    const draft = await start(physio.client, first.appointmentId);
    expect(draft.body.encounter.specialty.template).toBe('physiotherapy.assessment');
    const noPlan = await save(physio.client, draft.body.encounter.id, 0, { goals: [{ id: 'g-111111', text: `${MARK} walk 1 km` }] });
    const incomplete = await finalize(physio.client, noPlan.body.encounter.id, noPlan.body.encounter.version);
    expect(incomplete.body.error).toMatchObject({ code: 'ENCOUNTER_INCOMPLETE', fields: { 'specialty.plannedSessions': 'required' } });
    const planned = await save(physio.client, draft.body.encounter.id, noPlan.body.encounter.version, {
      limitations: `${MARK} limited knee flexion`,
      goals: [{ id: 'g-111111', text: `${MARK} walk 1 km` }],
      plannedSessions: 6,
      frequency: 'Twice a week',
    });
    expect((await finalize(physio.client, planned.body.encounter.id, planned.body.encounter.version)).status).toBe(201);
    const assessmentId = draft.body.encounter.id as string;

    // A session must name its course; goal notes must refer to the course's goals.
    const second = await visit(physio.client, physio.practitioner, first.patientId);
    const session = await start(physio.client, second.appointmentId, { template: 'physiotherapy.session' });
    const noCourse = await save(physio.client, session.body.encounter.id, 0, { performed: `${MARK} exercises` });
    expect((await finalize(physio.client, session.body.encounter.id, noCourse.body.encounter.version)).body.error.fields).toMatchObject({
      'specialty.courseEncounterId': 'required',
    });
    const badGoal = await save(physio.client, session.body.encounter.id, noCourse.body.encounter.version, {
      courseEncounterId: assessmentId,
      goalNotes: [{ goalId: 'g-999999', note: 'x' }],
    });
    expect(badGoal.body.error.fields).toEqual({ 'specialty.goalNotes.0.goalId': 'invalid_reference' });
    const okSession = await save(physio.client, session.body.encounter.id, noCourse.body.encounter.version, {
      courseEncounterId: assessmentId,
      performed: `${MARK} exercises`,
      progress: `${MARK} better`,
      goalNotes: [{ goalId: 'g-111111', note: `${MARK} 500 m` }],
    });
    expect((await finalize(physio.client, session.body.encounter.id, okSession.body.encounter.version)).status).toBe(201);

    // A future booking with the same physiotherapist is the course's next visit.
    const later = DateTime.fromISO(TODAY).plus({ days: 20 }).toISODate() ?? TODAY;
    await bookOk(c.owner, c.orgId, {
      patientId: first.patientId,
      practitionerId: physio.practitioner,
      branchId: c.branchA,
      date: later,
      time: '10:00',
    });

    const courses = await physio.client.agent.get(orgUrl(`/patients/${first.patientId}/physio-courses`));
    expect(courses.status).toBe(200);
    expect(courses.body.courses).toEqual([
      expect.objectContaining({
        assessmentId,
        own: true,
        plannedSessions: 6,
        completedSessions: 1,
        discharge: null,
        upcomingAppointments: 1,
      }),
    ]);

    const third = await visit(physio.client, physio.practitioner, first.patientId);
    await documented(
      physio.client,
      third.appointmentId,
      { courseEncounterId: assessmentId, summary: `${MARK} goals reached` },
      'physiotherapy.discharge',
    );
    const after = await physio.client.agent.get(orgUrl(`/patients/${first.patientId}/physio-courses`));
    expect(after.body.courses[0].discharge).not.toBeNull();
    // A course of another patient cannot be referenced.
    const elsewhere = await visit(physio.client, physio.practitioner);
    const foreign = await start(physio.client, elsewhere.appointmentId, { template: 'physiotherapy.session' });
    expect((await save(physio.client, foreign.body.encounter.id, 0, { courseEncounterId: assessmentId })).body.error.fields).toEqual({
      'specialty.courseEncounterId': 'invalid_reference',
    });
  });
});

describe('specialty summary', () => {
  it('gives counts only: own for doctors, organization-wide for owners; nothing for receptionists', async () => {
    vi.restoreAllMocks();
    pinClock(DateTime.fromISO(TODAY).plus({ days: 3 }).toISO() ?? undefined);
    const mine = await physio.client.agent.get(orgUrl('/clinical/specialty-summary'));
    expect(mine.status).toBe(200);
    expect(mine.body.scope).toBe('own');
    const assessments = mine.body.byTemplate.find((t: { template: string }) => t.template === 'physiotherapy.assessment');
    expect(assessments.finalized).toBeGreaterThanOrEqual(1);
    expect(mine.body.own).toEqual({ openPlanItems: 0, activeCourses: 0 });
    const dentist = await c.doctor.agent.get(orgUrl('/clinical/specialty-summary'));
    expect(dentist.body.own.openPlanItems).toBe(0);
    const org = await c.owner.agent.get(orgUrl('/clinical/specialty-summary'));
    expect(org.body.scope).toBe('organization');
    expect(org.body.byTemplate.find((t: { template: string }) => t.template === 'dentistry.visit').finalized).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(org.body)).not.toContain(MARK);
    expect((await c.receptionist.agent.get(orgUrl('/clinical/specialty-summary'))).status).toBe(403);
    expect((await c.viewer.agent.get(orgUrl('/clinical/specialty-summary'))).status).toBe(403);
  });

  it('never stores template data without a template, or for another organization', async () => {
    const id = new Types.ObjectId();
    expect((await send(c.doctor, 'put', orgUrl(`/encounters/${id}`), { sections: {}, specialtyData: {}, version: 0 })).status).toBe(404);
  });
});
