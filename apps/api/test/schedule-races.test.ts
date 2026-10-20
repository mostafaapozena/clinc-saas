import type { Response } from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppointmentModel, SlotReservationModel } from '../src/modules/appointments/appointment.model.js';
import { addMember, register, send, testApp } from './helpers/api.js';
import { TOMORROW, act, book, buildClinic, createPatient, createPractitioner, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

/**
 * A booking and a concurrent change to something the booking depends on — working hours, the
 * practitioner's status, the patient's branch registration — must never both succeed.
 *
 * Each race is forced rather than left to timing: the first request's transaction is held open
 * right after its serializing write (scheduleSeq on the practitioner or patient document) until
 * the second request is under way. The second request then hits a write conflict, retries, and
 * must decide on the first one's committed result.
 */

const app = testApp();
let c: Clinic;
/** Dedicated to these races: branch A, 08:00–14:00 every day, 30-minute default. */
let practitioner: string;
const orgUrl = (path: string) => `/api/v1/orgs/${c.orgId}${path}`;
const hoursUntil = (end: string) => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ branchId: c.branchA, weekday, start: '08:00', end }));

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('schedule_races');
  c = await buildClinic(app, 'race');
  const doctor = await register(app, 'race-doctor3');
  const membership = await addMember(c.owner, c.orgId, doctor, 'doctor', [c.branchA]);
  practitioner = await createPractitioner(c.owner, c.orgId, membership, [c.branchA], 30, hoursUntil('14:00'));
});
beforeEach(() => {
  pinClock();
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => dropTestDatabase());

type Gate = { entered: Promise<void>; enter: () => Promise<void>; release: () => void };

function gate(): Gate {
  let release!: () => void;
  let markEntered!: () => void;
  const open = new Promise<void>((resolve) => (release = resolve));
  const entered = new Promise<void>((resolve) => (markEntered = resolve));
  return {
    entered,
    release,
    enter: () => {
      markEntered();
      return open;
    },
  };
}

/** Holds a booking after it has written the practitioner and patient documents, before its cells. */
function holdBooking(): Gate {
  const held = gate();
  const insertMany = SlotReservationModel.insertMany.bind(SlotReservationModel);
  vi.spyOn(SlotReservationModel, 'insertMany').mockImplementationOnce((async (...args: Parameters<typeof insertMany>) => {
    await held.enter();
    return insertMany(...args);
  }) as never);
  return held;
}

/** Holds a schedule, status or archive change at its check for future appointments (after its write). */
function holdFutureAppointmentCheck(): Gate {
  const held = gate();
  const find = AppointmentModel.find.bind(AppointmentModel);
  vi.spyOn(AppointmentModel, 'find').mockImplementationOnce(((...args: Parameters<typeof find>) => {
    const query = find(...args);
    const exec = query.exec.bind(query);
    query.exec = (async () => {
      await held.enter();
      return exec();
    }) as typeof query.exec;
    return query;
  }) as never);
  return held;
}

type Res = Response;

/** Starts `first` until it is held, starts `second`, gives it time to collide, then lets `first` commit. */
async function race(held: Gate, first: () => PromiseLike<Res>, second: () => PromiseLike<Res>): Promise<[Res, Res]> {
  const a = Promise.resolve(first());
  await Promise.race([held.entered, a]);
  const b = Promise.resolve(second());
  await new Promise((resolve) => setTimeout(resolve, 300));
  held.release();
  return Promise.all([a, b]);
}

const bookAt = (patientId: string, time: string) =>
  book(c.receptionist, c.orgId, { patientId, practitionerId: practitioner, branchId: c.branchA, date: TOMORROW, time });
const profile = async () => (await c.owner.agent.get(orgUrl(`/practitioners/${practitioner}`))).body.practitioner as { version: number };
const setHours = (end: string, version: number) =>
  send(c.owner, 'put', orgUrl(`/practitioners/${practitioner}/schedule`), { weeklySchedule: hoursUntil(end), version });
const setStatus = (status: 'active' | 'inactive', version: number) =>
  send(c.owner, 'patch', orgUrl(`/practitioners/${practitioner}`), { status, version });
const archive = (patientId: string) =>
  send(c.receptionist, 'patch', orgUrl(`/patients/${patientId}/registrations/${c.branchA}`), { status: 'archived' });
const appointmentsOf = (patientId: string) => AppointmentModel.countDocuments({ organizationId: c.orgId, patientId });

/** Cancels a race's winning booking so the next race starts from the same schedule. */
async function cancel(booking: Res) {
  const res = await act(c.receptionist, c.orgId, booking.body.appointment.id, 'cancel', booking.body.appointment.version);
  expect(res.status).toBe(200);
}

describe('working-hours change racing a booking', () => {
  it('booking first: the change is refused and lists the new appointment', async () => {
    const patient = await createPatient(c.receptionist, c.orgId, c.branchA);
    const { version } = await profile();
    const [booking, change] = await race(holdBooking(), () => bookAt(patient, '13:00'), () => setHours('12:00', version));
    expect(booking.status, JSON.stringify(booking.body)).toBe(201);
    expect(change.status).toBe(409);
    expect(change.body.error.code).toBe('SCHEDULE_CONFLICT');
    expect(change.body.error.details.appointments.map((a: { id: string }) => a.id)).toEqual([booking.body.appointment.id]);
    expect((await profile()).version).toBe(version);
    await cancel(booking);
  });

  it('change first: the booking is refused as outside the new working hours', async () => {
    const patient = await createPatient(c.receptionist, c.orgId, c.branchA);
    const { version } = await profile();
    const [change, booking] = await race(holdFutureAppointmentCheck(), () => setHours('12:00', version), () => bookAt(patient, '13:00'));
    expect(change.status, JSON.stringify(change.body)).toBe(200);
    expect(booking.status).toBe(409);
    expect(booking.body.error.code).toBe('OUTSIDE_WORKING_HOURS');
    expect(await appointmentsOf(patient)).toBe(0);
    expect(await SlotReservationModel.countDocuments({ organizationId: c.orgId, resourceId: patient })).toBe(0);
    expect((await setHours('14:00', change.body.practitioner.version)).status).toBe(200);
  });
});

describe('practitioner deactivation racing a booking', () => {
  it('booking first: deactivation is refused and lists the new appointment', async () => {
    const patient = await createPatient(c.receptionist, c.orgId, c.branchA);
    const { version } = await profile();
    const [booking, change] = await race(holdBooking(), () => bookAt(patient, '11:00'), () => setStatus('inactive', version));
    expect(booking.status, JSON.stringify(booking.body)).toBe(201);
    expect(change.status).toBe(409);
    expect(change.body.error.code).toBe('FUTURE_APPOINTMENTS_EXIST');
    expect(change.body.error.details.appointments.map((a: { id: string }) => a.id)).toEqual([booking.body.appointment.id]);
    await cancel(booking);
  });

  it('deactivation first: the booking is refused', async () => {
    const patient = await createPatient(c.receptionist, c.orgId, c.branchA);
    const { version } = await profile();
    const [change, booking] = await race(holdFutureAppointmentCheck(), () => setStatus('inactive', version), () => bookAt(patient, '11:00'));
    expect(change.status, JSON.stringify(change.body)).toBe(200);
    expect(booking.status).toBe(409);
    expect(booking.body.error.code).toBe('PRACTITIONER_INACTIVE');
    expect(await appointmentsOf(patient)).toBe(0);
    expect((await setStatus('active', change.body.practitioner.version)).status).toBe(200);
  });
});

describe('registration archiving racing a booking', () => {
  it('booking first: archiving is refused and lists the new appointment', async () => {
    const patient = await createPatient(c.receptionist, c.orgId, c.branchA);
    const [booking, change] = await race(holdBooking(), () => bookAt(patient, '09:00'), () => archive(patient));
    expect(booking.status, JSON.stringify(booking.body)).toBe(201);
    expect(change.status).toBe(409);
    expect(change.body.error.code).toBe('FUTURE_APPOINTMENTS_EXIST');
    expect(change.body.error.details.appointments.map((a: { id: string }) => a.id)).toEqual([booking.body.appointment.id]);
    await cancel(booking);
  });

  it('archiving first: the booking is refused', async () => {
    const patient = await createPatient(c.receptionist, c.orgId, c.branchA);
    const [change, booking] = await race(holdFutureAppointmentCheck(), () => archive(patient), () => bookAt(patient, '09:00'));
    expect(change.status, JSON.stringify(change.body)).toBe(200);
    expect(booking.status).toBe(409);
    expect(booking.body.error.code).toBe('PATIENT_NOT_REGISTERED');
    expect(await appointmentsOf(patient)).toBe(0);
  });
});
