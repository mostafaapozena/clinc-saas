import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppointmentModel, SlotReservationModel } from '../src/modules/appointments/appointment.model.js';
import { AuditEventModel } from '../src/modules/audit/audit-event.model.js';
import { PractitionerModel } from '../src/modules/practitioners/practitioner.model.js';
import { addMember, register, send, testApp } from './helpers/api.js';
import {
  TODAY,
  TOMORROW,
  act,
  book,
  bookOk,
  buildClinic,
  createPatient,
  createPractitioner,
  pinClock,
  type Clinic,
} from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

const app = testApp();
let c: Clinic;
const orgUrl = (path: string) => `/api/v1/orgs/${c.orgId}${path}`;

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('appointments');
  c = await buildClinic(app, 'apt');
});
beforeEach(() => {
  pinClock();
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => dropTestDatabase());

const slotsOf = async (practitionerId: string, branchId: string, date: string, extra: Record<string, string | number> = {}) => {
  const res = await c.receptionist.agent
    .get(orgUrl('/appointments/availability'))
    .query({ practitionerId, branchId, date, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.slots as { localTime: string; utcOffsetMinutes: number; repeatedTime: boolean; startAt: string }[];
};

describe('availability', () => {
  it('derives slots from working hours, duration, existing bookings and the current time', async () => {
    // Pinned now: 08:00 Cairo today. Practitioner 2 works 08:00–20:00 at branch A, 15-minute default.
    const slots = await slotsOf(c.practitioner2, c.branchA, TODAY);
    expect(slots[0]?.localTime).toBe('08:15'); // 08:00 is not in the future any more
    expect(slots.at(-1)?.localTime).toBe('19:45');

    const patient = await createPatient(c.receptionist, c.orgId, c.branchA);
    await bookOk(c.receptionist, c.orgId, { patientId: patient, practitionerId: c.practitioner2, branchId: c.branchA, date: TOMORROW, time: '10:00', durationMinutes: 30 });
    const tomorrow = (await slotsOf(c.practitioner2, c.branchA, TOMORROW)).map((s) => s.localTime);
    expect(tomorrow).toContain('09:45');
    expect(tomorrow).not.toContain('10:00');
    expect(tomorrow).not.toContain('10:15');
    expect(tomorrow).toContain('10:30');
    // A longer appointment needs every cell free.
    const longer = (await slotsOf(c.practitioner2, c.branchA, TOMORROW, { durationMinutes: 45 })).map((s) => s.localTime);
    expect(longer).not.toContain('09:30');
    expect(longer).toContain('09:15');
  });

  it('applies closures and replacement hours, and rejects bookings outside working hours', async () => {
    const date = '2026-11-12';
    const closed = await send(c.owner, 'post', orgUrl(`/practitioners/${c.practitioner2}/exceptions`), { date, kind: 'closed' });
    expect(closed.status).toBe(201);
    expect(await slotsOf(c.practitioner2, c.branchA, date)).toEqual([]);
    const patient = await createPatient(c.receptionist, c.orgId, c.branchA);
    const refused = await book(c.receptionist, c.orgId, { patientId: patient, practitionerId: c.practitioner2, branchId: c.branchA, date, time: '10:00' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('OUTSIDE_WORKING_HOURS');

    const replaced = await send(c.owner, 'post', orgUrl(`/practitioners/${c.practitioner2}/exceptions`), {
      date: '2026-11-13',
      branchId: c.branchA,
      kind: 'hours',
      intervals: [{ start: '12:00', end: '13:00' }],
    });
    expect(replaced.status).toBe(201);
    expect((await slotsOf(c.practitioner2, c.branchA, '2026-11-13')).map((s) => s.localTime)).toEqual(['12:00', '12:15', '12:30', '12:45']);
    const evening = await book(c.receptionist, c.orgId, { patientId: patient, practitionerId: c.practitioner2, branchId: c.branchA, date: TOMORROW, time: '20:00' });
    expect(evening.body.error.code).toBe('OUTSIDE_WORKING_HOURS');
  });

  it('does not offer or accept bookings for inactive practitioners or suspended memberships', async () => {
    const person = await register(app, 'apt-temp-doctor');
    const membership = await addMember(c.owner, c.orgId, person, 'doctor', [c.branchA]);
    const practitioner = await createPractitioner(c.owner, c.orgId, membership, [c.branchA], 15, [{ branchId: c.branchA, weekday: 3, start: '09:00', end: '12:00' }]);
    const patient = await createPatient(c.receptionist, c.orgId, c.branchA);
    expect((await slotsOf(practitioner, c.branchA, TOMORROW)).length).toBeGreaterThan(0);

    await send(c.owner, 'patch', `/api/v1/orgs/${c.orgId}/members/${membership}`, { status: 'suspended' });
    const suspended = await c.receptionist.agent.get(orgUrl('/appointments/availability')).query({ practitionerId: practitioner, branchId: c.branchA, date: TOMORROW });
    expect(suspended.body.error.code).toBe('PRACTITIONER_INACTIVE');
    const bookSuspended = await book(c.receptionist, c.orgId, { patientId: patient, practitionerId: practitioner, branchId: c.branchA, date: TOMORROW, time: '09:00' });
    expect(bookSuspended.body.error.code).toBe('PRACTITIONER_INACTIVE');

    await send(c.owner, 'patch', `/api/v1/orgs/${c.orgId}/members/${membership}`, { status: 'active' });
    const profile = (await c.owner.agent.get(orgUrl(`/practitioners/${practitioner}`))).body.practitioner;
    expect((await send(c.owner, 'patch', orgUrl(`/practitioners/${practitioner}`), { status: 'inactive', version: profile.version })).status).toBe(200);
    const bookInactive = await book(c.receptionist, c.orgId, { patientId: patient, practitionerId: practitioner, branchId: c.branchA, date: TOMORROW, time: '09:00' });
    expect(bookInactive.body.error.code).toBe('PRACTITIONER_INACTIVE');
  });
});

describe('Cairo daylight-saving bookings', () => {
  // A practitioner working late on the transition dates.
  let lateDoctor: string;
  let patient: string;
  beforeAll(async () => {
    pinClock('2026-04-20T08:00:00Z');
    const person = await register(app, 'apt-late');
    const membership = await addMember(c.owner, c.orgId, person, 'doctor', [c.branchB]);
    lateDoctor = await createPractitioner(c.owner, c.orgId, membership, [c.branchB], 30, [
      { branchId: c.branchB, weekday: 4, start: '22:00', end: '24:00' }, // Thursday
      { branchId: c.branchB, weekday: 5, start: '00:00', end: '02:00' }, // Friday
    ]);
    patient = await createPatient(c.receptionistB, c.orgId, c.branchB);
  });

  it('skips the nonexistent hour and rejects a booking inside it', async () => {
    pinClock('2026-04-20T08:00:00Z');
    const res = await c.receptionistB.agent.get(orgUrl('/appointments/availability')).query({ practitionerId: lateDoctor, branchId: c.branchB, date: '2026-04-24', step: 30 });
    expect(res.body.slots.map((s: { localTime: string }) => s.localTime)).toEqual(['01:00', '01:30']);
    const skipped = await book(c.receptionistB, c.orgId, { patientId: patient, practitionerId: lateDoctor, branchId: c.branchB, date: '2026-04-24', time: '00:30' });
    expect(skipped.status).toBe(400);
    expect(skipped.body.error.code).toBe('NONEXISTENT_LOCAL_TIME');
  });

  it('offers the repeated hour twice and requires the offset to book it', async () => {
    pinClock('2026-10-20T08:00:00Z');
    const res = await c.receptionistB.agent.get(orgUrl('/appointments/availability')).query({ practitionerId: lateDoctor, branchId: c.branchB, date: '2026-10-29', step: 30 });
    const slots = res.body.slots as { localTime: string; utcOffsetMinutes: number; repeatedTime: boolean }[];
    expect(slots.map((s) => `${s.localTime}${s.utcOffsetMinutes === 180 ? '+3' : '+2'}`)).toEqual(['22:00+3', '22:30+3', '23:00+3', '23:30+3', '23:00+2', '23:30+2']);
    expect(slots.filter((s) => s.repeatedTime)).toHaveLength(4);

    const ambiguous = await book(c.receptionistB, c.orgId, { patientId: patient, practitionerId: lateDoctor, branchId: c.branchB, date: '2026-10-29', time: '23:00' });
    expect(ambiguous.status).toBe(409);
    expect(ambiguous.body.error).toMatchObject({ code: 'AMBIGUOUS_LOCAL_TIME', details: { utcOffsetMinutes: [180, 120] } });
    const first = await bookOk(c.receptionistB, c.orgId, { patientId: patient, practitionerId: lateDoctor, branchId: c.branchB, date: '2026-10-29', time: '23:00', utcOffsetMinutes: 180 });
    const second = await bookOk(c.receptionistB, c.orgId, { patientId: patient, practitionerId: lateDoctor, branchId: c.branchB, date: '2026-10-29', time: '23:00', utcOffsetMinutes: 120 });
    expect(first.startAt).toBe('2026-10-29T20:00:00.000Z');
    expect(second.startAt).toBe('2026-10-29T21:00:00.000Z');
  });
});

describe('conflict prevention', () => {
  it('allows adjacent bookings and rejects overlaps, also across branches', async () => {
    const p1 = await createPatient(c.owner, c.orgId, c.branchA);
    const p2 = await createPatient(c.owner, c.orgId, c.branchA);
    const p3 = await createPatient(c.owner, c.orgId, c.branchB);
    const base = { practitionerId: c.practitioner, branchId: c.branchA, date: TOMORROW };
    await bookOk(c.owner, c.orgId, { ...base, patientId: p1, time: '09:00' }); // 09:00–09:30
    await bookOk(c.owner, c.orgId, { ...base, patientId: p2, time: '09:30' }); // adjacent
    const overlap = await book(c.owner, c.orgId, { ...base, patientId: p3, branchId: c.branchA, time: '09:15' });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('PATIENT_NOT_REGISTERED'); // p3 is only in branch B

    const p4 = await createPatient(c.owner, c.orgId, c.branchA);
    const overlapping = await book(c.owner, c.orgId, { ...base, patientId: p4, time: '09:15' });
    expect(overlapping.status).toBe(409);
    expect(overlapping.body.error.code).toBe('SLOT_UNAVAILABLE');

    // Working hours never overlap across branches (validated above the database), and the
    // reservation key is the practitioner, not the branch. Force an overlapping legacy schedule
    // directly in the database to prove that second line of defense on its own.
    const saturday = '2026-11-14';
    const legacy = { branchId: c.branchB, weekday: 6, start: '08:00', end: '12:00' };
    await PractitionerModel.updateOne({ organizationId: c.orgId, _id: c.practitioner }, { $push: { weeklySchedule: legacy } });
    await bookOk(c.owner, c.orgId, { ...base, date: saturday, patientId: p1, time: '10:00' });
    const crossBranch = await book(c.owner, c.orgId, { practitionerId: c.practitioner, branchId: c.branchB, date: saturday, patientId: p3, time: '10:15' });
    expect(crossBranch.status).toBe(409);
    expect(crossBranch.body.error.code).toBe('SLOT_UNAVAILABLE');
    await PractitionerModel.updateOne({ organizationId: c.orgId, _id: c.practitioner }, { $pull: { weeklySchedule: legacy } });
  });

  it('rejects a second booking for the same patient at the same time without revealing it', async () => {
    const patient = await createPatient(c.owner, c.orgId, c.branchA);
    await send(c.owner, 'post', `/api/v1/orgs/${c.orgId}/patients/${patient}/registrations`, { branchId: c.branchB });
    // Booked at branch B, which receptionist A cannot see.
    await bookOk(c.receptionistB, c.orgId, { patientId: patient, practitionerId: c.practitioner, branchId: c.branchB, date: TOMORROW, time: '16:00' });
    const res = await book(c.receptionist, c.orgId, { patientId: patient, practitionerId: c.practitioner2, branchId: c.branchA, date: TOMORROW, time: '16:15' });
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ code: 'PATIENT_CONFLICT', message: 'The patient already has an appointment at this time' });
  });

  it('lets exactly one of many concurrent conflicting bookings succeed', async () => {
    const patients = await Promise.all(Array.from({ length: 8 }, () => createPatient(c.owner, c.orgId, c.branchA)));
    const results = await Promise.all(
      patients.map((patientId, i) =>
        book(i % 2 ? c.receptionist : c.admin, c.orgId, { patientId, practitionerId: c.practitioner2, branchId: c.branchA, date: TOMORROW, time: '12:00', durationMinutes: 30 }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'SLOT_UNAVAILABLE')).toBe(true);
    const winner = results.find((r) => r.status === 201)?.body.appointment.id;
    expect(await AppointmentModel.countDocuments({ organizationId: c.orgId, practitionerId: c.practitioner2, startAt: new Date('2026-11-11T10:00:00Z') })).toBe(1);
    // No orphan reservations: only the winner owns cells at that time.
    const cells = await SlotReservationModel.find({ organizationId: c.orgId, resourceType: 'practitioner', resourceId: c.practitioner2, slotStart: { $gte: new Date('2026-11-11T10:00:00Z'), $lt: new Date('2026-11-11T10:30:00Z') } }).lean();
    expect(cells.map((r) => String(r.appointmentId))).toEqual(Array(6).fill(winner));
  });

  it('lets only one of two concurrent reschedules into the same time succeed', async () => {
    const [pa, pb] = await Promise.all([createPatient(c.owner, c.orgId, c.branchA), createPatient(c.owner, c.orgId, c.branchA)]);
    const a = await bookOk(c.owner, c.orgId, { patientId: pa!, practitionerId: c.practitioner2, branchId: c.branchA, date: TOMORROW, time: '14:00' });
    const b = await bookOk(c.owner, c.orgId, { patientId: pb!, practitionerId: c.practitioner2, branchId: c.branchA, date: TOMORROW, time: '14:30' });
    const move = (id: string, version: number) =>
      send(c.owner, 'post', orgUrl(`/appointments/${id}/reschedule`), { date: TOMORROW, time: '15:00', version });
    const [ra, rb] = await Promise.all([move(a.id, a.version), move(b.id, b.version)]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    const loser = ra.status === 409 ? a : b;
    const kept = await AppointmentModel.findOne({ organizationId: c.orgId, _id: loser.id }).lean();
    expect(kept?.startAt.toISOString()).toBe(loser.startAt); // unchanged, still holding its own time
    expect(await SlotReservationModel.countDocuments({ organizationId: c.orgId, appointmentId: loser.id, resourceType: 'practitioner' })).toBe(3);
  });

  it('rolls back the appointment and its reservations when any part of the booking fails', async () => {
    const patient = await createPatient(c.owner, c.orgId, c.branchA);
    const before = await SlotReservationModel.countDocuments({ organizationId: c.orgId });
    // The practitioner's cells are written, then the patient's insert fails.
    const insertMany = SlotReservationModel.insertMany.bind(SlotReservationModel);
    vi.spyOn(SlotReservationModel, 'insertMany')
      .mockImplementationOnce(insertMany as never)
      .mockRejectedValueOnce(new Error('simulated failure'));
    const failed = await book(c.owner, c.orgId, { patientId: patient, practitionerId: c.practitioner2, branchId: c.branchA, date: TOMORROW, time: '17:00' });
    expect(failed.status).toBe(500);
    expect(await AppointmentModel.countDocuments({ organizationId: c.orgId, patientId: patient })).toBe(0);
    expect(await SlotReservationModel.countDocuments({ organizationId: c.orgId })).toBe(before);
    expect(await AuditEventModel.countDocuments({ organizationId: c.orgId, action: 'appointment.booked', 'changes.startAt': new Date('2026-11-11T15:00:00Z') })).toBe(0);
    vi.mocked(SlotReservationModel.insertMany).mockRestore();
    await bookOk(c.owner, c.orgId, { patientId: patient, practitionerId: c.practitioner2, branchId: c.branchA, date: TOMORROW, time: '17:00' });
  });
});

describe('idempotent retries', () => {
  it('returns the original booking for a repeated key, sequentially and concurrently', async () => {
    const patient = await createPatient(c.owner, c.orgId, c.branchA);
    const body = { patientId: patient, practitionerId: c.practitioner2, branchId: c.branchA, date: TOMORROW, time: '18:00' };
    const key = randomUUID();
    const first = await book(c.receptionist, c.orgId, body, key);
    const retry = await book(c.receptionist, c.orgId, body, key);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ replayed: true, appointment: { id: first.body.appointment.id } });

    const other = await book(c.receptionist, c.orgId, { ...body, time: '18:15' }, key);
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const burstKey = randomUUID();
    const burst = await Promise.all(Array.from({ length: 5 }, () => book(c.receptionist, c.orgId, { ...body, time: '18:30' }, burstKey)));
    expect(burst.filter((r) => r.status === 201)).toHaveLength(1);
    expect(new Set(burst.map((r) => r.body.appointment?.id)).size).toBe(1);
    expect(await AppointmentModel.countDocuments({ organizationId: c.orgId, patientId: patient })).toBe(2);
  });

  it('scopes keys to the user: the same key from another user is a different booking', async () => {
    const patient = await createPatient(c.owner, c.orgId, c.branchA);
    const key = randomUUID();
    const mine = await book(c.receptionist, c.orgId, { patientId: patient, practitionerId: c.practitioner2, branchId: c.branchA, date: TOMORROW, time: '19:00' }, key);
    const theirs = await book(c.admin, c.orgId, { patientId: patient, practitionerId: c.practitioner2, branchId: c.branchA, date: TOMORROW, time: '19:00' }, key);
    expect(mine.status).toBe(201);
    expect(theirs.status).toBe(409);
    expect(theirs.body.error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('replays a booking that went through even when its checks would now fail', async () => {
    const patient = await createPatient(c.receptionist, c.orgId, c.branchA);
    const body = { patientId: patient, practitionerId: c.practitioner2, branchId: c.branchA, date: TODAY, time: '11:40' };
    const key = randomUUID();
    const first = await book(c.receptionist, c.orgId, body, key);
    expect(first.status).toBe(201);
    // 12:00 Cairo: the booked start has passed, so a new booking with these details is refused…
    pinClock('2026-11-10T10:00:00Z');
    const fresh = await book(c.receptionist, c.orgId, body);
    expect(fresh.body.error.code).toBe('START_IN_PAST');
    // …but the retry of the original request still gets its appointment back.
    const retry = await book(c.receptionist, c.orgId, body, key);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ replayed: true, appointment: { id: first.body.appointment.id } });
    const changed = await book(c.receptionist, c.orgId, { ...body, time: '12:30' }, key);
    expect(changed.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await AppointmentModel.countDocuments({ organizationId: c.orgId, patientId: patient })).toBe(1);
  });
});

describe('rescheduling and status workflow', () => {
  it('reschedules only scheduled appointments, keeping the previous time in the audit trail', async () => {
    const patient = await createPatient(c.owner, c.orgId, c.branchA);
    const appointment = await bookOk(c.owner, c.orgId, { patientId: patient, practitionerId: c.practitioner2, branchId: c.branchA, date: '2026-11-15', time: '09:00' });
    const moved = await send(c.receptionist, 'post', orgUrl(`/appointments/${appointment.id}/reschedule`), { date: '2026-11-15', time: '11:00', version: appointment.version });
    expect(moved.status).toBe(200);
    expect((await slotsOf(c.practitioner2, c.branchA, '2026-11-15')).map((s) => s.localTime)).toContain('09:00');
    const stale = await send(c.receptionist, 'post', orgUrl(`/appointments/${appointment.id}/reschedule`), { date: '2026-11-15', time: '12:00', version: appointment.version });
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const event = await AuditEventModel.findOne({ organizationId: c.orgId, 'target.id': appointment.id, action: 'appointment.rescheduled' }).lean();
    expect(event?.changes).toMatchObject({ from: { startAt: new Date('2026-11-15T07:00:00Z') }, to: { startAt: new Date('2026-11-15T09:00:00Z') } });

    const cancelled = await act(c.receptionist, c.orgId, appointment.id, 'cancel', moved.body.appointment.version);
    const afterCancel = await send(c.receptionist, 'post', orgUrl(`/appointments/${appointment.id}/reschedule`), { date: '2026-11-15', time: '13:00', version: cancelled.body.appointment.version });
    expect(afterCancel.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('runs the full day: check-in → start → complete, with permissions per action', async () => {
    const patient = await createPatient(c.receptionist, c.orgId, c.branchA);
    const a = await bookOk(c.receptionist, c.orgId, { patientId: patient, practitionerId: c.practitioner, branchId: c.branchA, date: TODAY, time: '10:00' });
    expect((await act(c.doctor, c.orgId, a.id, 'check_in', a.version)).status).toBe(403);
    const checkedIn = await act(c.receptionist, c.orgId, a.id, 'check_in', a.version);
    expect(checkedIn.body.appointment).toMatchObject({ status: 'checked_in', checkedInAt: '2026-11-10T06:00:00.000Z' });
    expect((await act(c.receptionist, c.orgId, a.id, 'start', checkedIn.body.appointment.version)).status).toBe(403);
    expect((await act(c.doctor2, c.orgId, a.id, 'start', checkedIn.body.appointment.version)).status).toBe(404); // not their appointment
    const started = await act(c.doctor, c.orgId, a.id, 'start', checkedIn.body.appointment.version);
    expect(started.body.appointment.status).toBe('in_progress');
    const replay = await act(c.doctor, c.orgId, a.id, 'start', checkedIn.body.appointment.version);
    expect(replay.body.error.code).toBe('VERSION_CONFLICT');
    const completed = await act(c.doctor, c.orgId, a.id, 'complete', started.body.appointment.version);
    expect(completed.body.appointment.status).toBe('completed');
    const again = await act(c.owner, c.orgId, a.id, 'cancel', completed.body.appointment.version, 'late');
    expect(again.body.error.code).toBe('INVALID_TRANSITION');
    // Completed appointments keep their time reserved.
    expect(await SlotReservationModel.countDocuments({ organizationId: c.orgId, appointmentId: a.id })).toBe(12);
  });

  it('enforces no-show timing, cancellation reasons and future-date rules through the API', async () => {
    const patient = await createPatient(c.receptionist, c.orgId, c.branchA);
    const future = await bookOk(c.receptionist, c.orgId, { patientId: patient, practitionerId: c.practitioner2, branchId: c.branchA, date: TOMORROW, time: '08:00' });
    expect((await act(c.receptionist, c.orgId, future.id, 'check_in', future.version)).body.error.code).toBe('NOT_TODAY');
    expect((await act(c.receptionist, c.orgId, future.id, 'no_show', future.version)).body.error.code).toBe('TOO_EARLY');

    const today = await bookOk(c.receptionist, c.orgId, { patientId: patient, practitionerId: c.practitioner2, branchId: c.branchA, date: TODAY, time: '09:00' });
    pinClock('2026-11-10T07:10:00Z'); // 09:10 Cairo — after the start
    const noShow = await act(c.receptionist, c.orgId, today.id, 'no_show', today.version);
    expect(noShow.body.appointment).toMatchObject({ status: 'no_show' });
    // No-show releases the time for a walk-in.
    expect(await SlotReservationModel.countDocuments({ organizationId: c.orgId, appointmentId: today.id })).toBe(0);

    pinClock();
    const other = await bookOk(c.receptionist, c.orgId, { patientId: patient, practitionerId: c.practitioner2, branchId: c.branchA, date: TODAY, time: '11:00' });
    const arrived = await act(c.receptionist, c.orgId, other.id, 'check_in', other.version);
    const noReason = await act(c.receptionist, c.orgId, other.id, 'cancel', arrived.body.appointment.version);
    expect(noReason.body.error.code).toBe('REASON_REQUIRED');
    const withReason = await act(c.receptionist, c.orgId, other.id, 'cancel', arrived.body.appointment.version, 'غادر المريض');
    expect(withReason.body.appointment).toMatchObject({ status: 'cancelled', cancellationReason: 'غادر المريض' });
    const auditEvent = await AuditEventModel.findOne({ organizationId: c.orgId, 'target.id': other.id, 'changes.to': 'cancelled' }).lean();
    expect(auditEvent?.changes).toEqual({ from: 'checked_in', to: 'cancelled', withReason: true });
  });

  it('serializes concurrent status changes: one wins, the other gets a version conflict', async () => {
    const patient = await createPatient(c.receptionist, c.orgId, c.branchA);
    const a = await bookOk(c.receptionist, c.orgId, { patientId: patient, practitionerId: c.practitioner2, branchId: c.branchA, date: TODAY, time: '13:00' });
    const [x, y] = await Promise.all([
      act(c.receptionist, c.orgId, a.id, 'check_in', a.version),
      act(c.admin, c.orgId, a.id, 'cancel', a.version, 'duplicate'),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const loser = x.status === 409 ? x : y;
    expect(loser.body.error.code).toBe('VERSION_CONFLICT');
  });
});

describe('schedule changes that would orphan appointments', () => {
  it('rejects working-hour changes, exceptions, deactivation and branch removal with the affected appointments', async () => {
    const patient = await createPatient(c.owner, c.orgId, c.branchB);
    const booked = await bookOk(c.owner, c.orgId, { patientId: patient, practitionerId: c.practitioner, branchId: c.branchB, date: '2026-11-16', time: '16:00' });
    const profile = (await c.owner.agent.get(orgUrl(`/practitioners/${c.practitioner}`))).body.practitioner;

    const shorter = profile.weeklySchedule.map((i: { branchId: string; start: string; end: string }) =>
      i.branchId === c.branchB ? { ...i, start: '17:00' } : i,
    );
    const hours = await send(c.owner, 'put', orgUrl(`/practitioners/${c.practitioner}/schedule`), { weeklySchedule: shorter, version: profile.version });
    expect(hours.status).toBe(409);
    expect(hours.body.error.code).toBe('SCHEDULE_CONFLICT');
    expect(hours.body.error.details.appointments.map((a: { id: string }) => a.id)).toContain(booked.id);

    const closure = await send(c.owner, 'post', orgUrl(`/practitioners/${c.practitioner}/exceptions`), { date: '2026-11-16', kind: 'closed' });
    expect(closure.body.error.code).toBe('SCHEDULE_CONFLICT');
    const deactivate = await send(c.owner, 'patch', orgUrl(`/practitioners/${c.practitioner}`), { status: 'inactive', version: profile.version });
    expect(deactivate.body.error.code).toBe('FUTURE_APPOINTMENTS_EXIST');
    const removeBranch = await send(c.owner, 'patch', orgUrl(`/practitioners/${c.practitioner}`), { branchIds: [c.branchA], version: profile.version });
    expect(removeBranch.body.error.code).toBe('FUTURE_APPOINTMENTS_EXIST');

    const overlap = profile.weeklySchedule.concat([{ branchId: c.branchB, weekday: 1, start: '13:00', end: '15:30' }]);
    const overlapping = await send(c.owner, 'put', orgUrl(`/practitioners/${c.practitioner}/schedule`), { weeklySchedule: overlap, version: profile.version });
    expect(overlapping.status).toBe(400);
    expect(overlapping.body.error.code).toBe('SCHEDULE_OVERLAP');
    const offGrid = await send(c.owner, 'put', orgUrl(`/practitioners/${c.practitioner}/schedule`), { weeklySchedule: [{ branchId: c.branchA, weekday: 1, start: '08:03', end: '10:00' }], version: profile.version });
    expect(offGrid.status).toBe(400);

    // Nothing changed.
    const after = (await c.owner.agent.get(orgUrl(`/practitioners/${c.practitioner}`))).body.practitioner;
    expect(after).toMatchObject({ status: 'active', version: profile.version, branchIds: profile.branchIds });
  });

  it('rejects off-grid and invalid booking input', async () => {
    const patient = await createPatient(c.owner, c.orgId, c.branchA);
    const offGrid = await book(c.owner, c.orgId, { patientId: patient, practitionerId: c.practitioner2, branchId: c.branchA, date: TOMORROW, time: '09:07' });
    const badDuration = await book(c.owner, c.orgId, { patientId: patient, practitionerId: c.practitioner2, branchId: c.branchA, date: TOMORROW, time: '09:00', durationMinutes: 22 });
    const past = await book(c.owner, c.orgId, { patientId: patient, practitionerId: c.practitioner2, branchId: c.branchA, date: '2026-11-09', time: '09:00' });
    expect(offGrid.body.error.fields).toEqual({ time: 'not_on_grid' });
    expect(badDuration.body.error.fields).toEqual({ durationMinutes: 'not_on_grid' });
    expect(past.body.error.code).toBe('START_IN_PAST');
  });
});

describe('queue and dashboard', () => {
  it('orders waiting patients by arrival, then appointment time; in-progress separately', async () => {
    const [p1, p2, p3] = await Promise.all([1, 2, 3].map(() => createPatient(c.receptionistB, c.orgId, c.branchB)));
    const b = { practitionerId: c.practitioner, branchId: c.branchB, date: TODAY };
    const early = await bookOk(c.receptionistB, c.orgId, { ...b, patientId: p1!, time: '15:00' });
    const late = await bookOk(c.receptionistB, c.orgId, { ...b, patientId: p2!, time: '16:00' });
    const middle = await bookOk(c.receptionistB, c.orgId, { ...b, patientId: p3!, time: '15:30' });
    // The 16:00 patient arrives first; the other two arrive together.
    pinClock('2026-11-10T06:30:00Z');
    await act(c.receptionistB, c.orgId, late.id, 'check_in', late.version);
    pinClock('2026-11-10T06:40:00Z');
    await act(c.receptionistB, c.orgId, middle.id, 'check_in', middle.version);
    const e = await act(c.receptionistB, c.orgId, early.id, 'check_in', early.version);
    const queue = await c.receptionistB.agent.get(orgUrl('/queue')).query({ branchId: c.branchB });
    expect(queue.body.waiting.map((a: { id: string }) => a.id)).toEqual([late.id, early.id, middle.id]);
    await act(c.doctor, c.orgId, early.id, 'start', e.body.appointment.version);
    const after = await c.receptionistB.agent.get(orgUrl('/queue')).query({ branchId: c.branchB });
    expect(after.body.waiting.map((a: { id: string }) => a.id)).toEqual([late.id, middle.id]);
    expect(after.body.inProgress.map((a: { id: string }) => a.id)).toEqual([early.id]);
    const doctorQueue = await c.doctor2.agent.get(orgUrl('/queue'));
    expect(doctorQueue.body.waiting.every((a: { practitioner: { id: string } }) => a.practitioner.id === c.practitioner2)).toBe(true);
  });

  it('counts today by status within scope, precisely', async () => {
    const counts = async (client: typeof c.owner, query: Record<string, string> = {}) =>
      (await client.agent.get(orgUrl('/dashboard')).query(query)).body.counts as Record<string, number>;
    const todayFilter = { organizationId: c.orgId, startAt: { $gte: new Date('2026-11-09T22:00:00Z'), $lt: new Date('2026-11-10T22:00:00Z') } };
    const expected = async (extra: Record<string, unknown> = {}) => {
      const rows = await AppointmentModel.find({ ...todayFilter, ...extra }).lean();
      const n = (s: string) => rows.filter((r) => r.status === s).length;
      return { scheduled: n('scheduled'), waiting: n('checked_in'), inProgress: n('in_progress'), completed: n('completed'), noShow: n('no_show'), cancelled: n('cancelled') };
    };
    expect(await counts(c.owner)).toEqual(await expected());
    expect(await counts(c.viewer)).toEqual(await expected());
    expect(await counts(c.receptionistB)).toEqual(await expected({ branchId: c.branchB }));
    expect(await counts(c.owner, { branchId: c.branchA })).toEqual(await expected({ branchId: c.branchA }));
    expect(await counts(c.doctor2)).toEqual(await expected({ practitionerId: c.practitioner2, branchId: c.branchA }));
    const total = Object.values(await counts(c.owner)).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(5);
  });
});

describe('organization time zone', () => {
  it('cannot change while future appointments exist', async () => {
    const res = await send(c.owner, 'patch', `/api/v1/orgs/${c.orgId}`, { timeZone: 'Asia/Riyadh' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TIME_ZONE_LOCKED');
    expect((await c.owner.agent.get(`/api/v1/orgs/${c.orgId}`)).body.organization.timeZone).toBe('Africa/Cairo');
  });
});
