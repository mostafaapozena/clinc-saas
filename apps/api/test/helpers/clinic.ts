import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { seedSpecialties } from '../../src/modules/specialties/specialty.seed.js';
import { clock } from '../../src/time/clock.js';
import { addBranch, addMember, createOrg, register, send, type App, type Client } from './api.js';

/** Pins the server clock. 2026-11-10T06:00Z is Tuesday 08:00 in Cairo (standard time, UTC+2). */
export const DEFAULT_NOW = '2026-11-10T06:00:00.000Z';
export const TODAY = '2026-11-10';
export const TOMORROW = '2026-11-11';

export function pinClock(iso = DEFAULT_NOW) {
  return vi.spyOn(clock, 'now').mockImplementation(() => new Date(iso));
}

export type Clinic = {
  orgId: string;
  branchA: string;
  branchB: string;
  owner: Client;
  admin: Client;
  receptionist: Client;
  receptionistB: Client;
  doctor: Client;
  doctor2: Client;
  viewer: Client;
  /** Works at A (08:00–14:00) and B (15:00–21:00) every day, 30-minute default. */
  practitioner: string;
  /** Works at A (08:00–20:00) every day, 15-minute default. */
  practitioner2: string;
  doctorMembership: string;
};

const everyDay = (branchId: string, start: string, end: string) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ branchId, weekday, start, end }));

/** An organization with two branches, every role, and two scheduled practitioners. */
export async function buildClinic(app: App, label: string, timeZone = 'Africa/Cairo'): Promise<Clinic> {
  await seedSpecialties();
  const owner = await register(app, `${label}-owner`);
  const { orgId, branchId: branchA } = await createOrg(owner, `${label} Clinic`, `${label} Branch A`, timeZone);
  const branchB = await addBranch(owner, orgId, `${label} Branch B`);
  const admin = await register(app, `${label}-admin`);
  const receptionist = await register(app, `${label}-reception`);
  const receptionistB = await register(app, `${label}-receptionB`);
  const doctor = await register(app, `${label}-doctor`);
  const doctor2 = await register(app, `${label}-doctor2`);
  const viewer = await register(app, `${label}-viewer`);
  await addMember(owner, orgId, admin, 'admin');
  await addMember(owner, orgId, receptionist, 'receptionist', [branchA]);
  await addMember(owner, orgId, receptionistB, 'receptionist', [branchB]);
  const doctorMembership = await addMember(owner, orgId, doctor, 'doctor', [branchA, branchB]);
  const doctor2Membership = await addMember(owner, orgId, doctor2, 'doctor', [branchA]);
  await addMember(owner, orgId, viewer, 'viewer');

  const practitioner = await createPractitioner(owner, orgId, doctorMembership, [branchA, branchB], 30, [
    ...everyDay(branchA, '08:00', '14:00'),
    ...everyDay(branchB, '15:00', '21:00'),
  ]);
  const practitioner2 = await createPractitioner(owner, orgId, doctor2Membership, [branchA], 15, everyDay(branchA, '08:00', '20:00'));
  return { orgId, branchA, branchB, owner, admin, receptionist, receptionistB, doctor, doctor2, viewer, practitioner, practitioner2, doctorMembership };
}

export async function createPractitioner(
  actor: Client,
  orgId: string,
  membershipId: string,
  branchIds: string[],
  defaultDurationMinutes: number,
  weeklySchedule: { branchId: string; weekday: number; start: string; end: string }[],
): Promise<string> {
  const created = await send(actor, 'post', `/api/v1/orgs/${orgId}/practitioners`, {
    membershipId,
    specialtyCode: 'dentistry',
    branchIds,
    defaultDurationMinutes,
  });
  expect(created.status).toBe(201);
  const id = created.body.practitioner.id as string;
  const scheduled = await send(actor, 'put', `/api/v1/orgs/${orgId}/practitioners/${id}/schedule`, {
    weeklySchedule,
    version: created.body.practitioner.version,
  });
  expect(scheduled.status).toBe(200);
  return id;
}

let phoneSeq = 1000;
/** A valid, unique synthetic Egyptian mobile number in local format. */
export const nextPhone = () => `0100${String(++phoneSeq).padStart(7, '0')}`;

export async function createPatient(
  actor: Client,
  orgId: string,
  branchId: string,
  fullName = `Patient ${phoneSeq}`,
  phone = nextPhone(),
): Promise<string> {
  const res = await send(actor, 'post', `/api/v1/orgs/${orgId}/patients`, {
    fullName,
    phone: { country: 'EG', number: phone },
    branchId,
  });
  expect(res.status).toBe(201);
  return res.body.patient.id;
}

export type BookingBody = {
  patientId: string;
  practitionerId: string;
  branchId: string;
  date: string;
  time: string;
  durationMinutes?: number;
  utcOffsetMinutes?: number;
  type?: 'new_visit' | 'follow_up';
};

export function book(actor: Client, orgId: string, body: BookingBody, key = randomUUID()) {
  return actor.agent
    .post(`/api/v1/orgs/${orgId}/appointments`)
    .set('X-CSRF-Token', actor.csrf)
    .set('Idempotency-Key', key)
    .send({ type: 'new_visit', ...body });
}

export async function bookOk(actor: Client, orgId: string, body: BookingBody) {
  const res = await book(actor, orgId, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.appointment as { id: string; version: number; status: string; startAt: string };
}

export function act(actor: Client, orgId: string, appointmentId: string, action: string, version: number, reason?: string) {
  return send(actor, 'post', `/api/v1/orgs/${orgId}/appointments/${appointmentId}/status`, { action, version, reason });
}
