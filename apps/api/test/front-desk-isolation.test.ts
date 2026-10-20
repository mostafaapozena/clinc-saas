import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppointmentModel } from '../src/modules/appointments/appointment.model.js';
import { PatientModel } from '../src/modules/patients/patient.model.js';
import { send, testApp } from './helpers/api.js';
import { TODAY, TOMORROW, act, book, bookOk, buildClinic, createPatient, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

const app = testApp();
let x: Clinic;
let y: Clinic;
// Records in organization Y that X will try to reach.
const Y = { patient: '', appointment: '', phone: '01009090909' };
// In X: a patient registered in both branches with one appointment in each.
const X = { shared: '', onlyB: '', apptA: '', apptB: '', apptBVersion: 0 };

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Not found' } };

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('frontdesk_iso');
  x = await buildClinic(app, 'iso-x');
  y = await buildClinic(app, 'iso-y', 'Asia/Riyadh');

  Y.patient = await createPatient(y.owner, y.orgId, y.branchA, 'Beta Secret Patient', Y.phone);
  Y.appointment = (await bookOk(y.owner, y.orgId, { patientId: Y.patient, practitionerId: y.practitioner2, branchId: y.branchA, date: TOMORROW, time: '10:00' })).id;

  X.shared = await createPatient(x.owner, x.orgId, x.branchA, 'Shared Two Branch');
  await send(x.owner, 'post', `/api/v1/orgs/${x.orgId}/patients/${X.shared}/registrations`, { branchId: x.branchB });
  X.onlyB = await createPatient(x.owner, x.orgId, x.branchB, 'Only Branch B Patient');
  X.apptA = (await bookOk(x.owner, x.orgId, { patientId: X.shared, practitionerId: x.practitioner2, branchId: x.branchA, date: TODAY, time: '09:00' })).id;
  const b = await bookOk(x.owner, x.orgId, { patientId: X.shared, practitionerId: x.practitioner, branchId: x.branchB, date: TODAY, time: '16:00' });
  X.apptB = b.id;
  X.apptBVersion = b.version;
});
afterAll(() => dropTestDatabase());

describe('cross-organization access and id tampering', () => {
  it('cannot read another organization’s patients, appointments or practitioners by any path', async () => {
    const xo = `/api/v1/orgs/${x.orgId}`;
    const yo = `/api/v1/orgs/${y.orgId}`;
    const checks = [
      await x.owner.agent.get(`${yo}/patients`),
      await x.owner.agent.get(`${yo}/patients/${Y.patient}`),
      await x.owner.agent.get(`${xo}/patients/${Y.patient}`),
      await x.owner.agent.get(`${xo}/patients/${Y.patient}/appointments`),
      await x.owner.agent.get(`${xo}/appointments/${Y.appointment}`),
      await x.owner.agent.get(`${xo}/practitioners/${y.practitioner}`),
      await x.owner.agent.get(`${xo}/practitioners/${y.practitioner}/exceptions`),
      await send(x.owner, 'patch', `${xo}/patients/${Y.patient}`, { fullName: 'Hijacked', version: 0 }),
      await send(x.owner, 'patch', `${xo}/patients/${Y.patient}/registrations/${y.branchA}`, { status: 'archived' }),
      await send(x.owner, 'post', `${xo}/appointments/${Y.appointment}/reschedule`, { date: TOMORROW, time: '11:00', version: 0 }),
      await act(x.owner, x.orgId, Y.appointment, 'cancel', 0),
      await send(x.owner, 'patch', `${xo}/practitioners/${y.practitioner}`, { status: 'inactive', version: 1 }),
      await send(x.owner, 'put', `${xo}/practitioners/${y.practitioner}/schedule`, { weeklySchedule: [], version: 1 }),
    ];
    for (const res of checks) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    }
    const untouched = await AppointmentModel.findOne({ organizationId: y.orgId, _id: Y.appointment }).lean();
    expect(untouched?.status).toBe('scheduled');
    expect((await PatientModel.findOne({ organizationId: y.orgId, _id: Y.patient }).lean())?.fullName).toBe('Beta Secret Patient');
  });

  it('treats foreign ids in request bodies exactly like unknown ids', async () => {
    const unknown = new Types.ObjectId().toString();
    const base = { patientId: X.shared, practitionerId: x.practitioner2, branchId: x.branchA, date: TOMORROW, time: '12:00' };
    for (const [field, foreign] of [
      ['patientId', Y.patient],
      ['practitionerId', y.practitioner2],
      ['branchId', y.branchA],
    ] as const) {
      const withForeign = await book(x.owner, x.orgId, { ...base, [field]: foreign });
      const withUnknown = await book(x.owner, x.orgId, { ...base, [field]: unknown });
      expect(withForeign.status).toBe(400);
      expect(withForeign.body).toEqual(withUnknown.body);
      expect(withForeign.body.error).toMatchObject({ code: 'INVALID_REFERENCE', fields: { [field]: 'not_available' } });
    }
    const foreignAvailability = await x.owner.agent
      .get(`/api/v1/orgs/${x.orgId}/appointments/availability`)
      .query({ practitionerId: y.practitioner2, branchId: x.branchA, date: TOMORROW });
    expect(foreignAvailability.body.error.code).toBe('INVALID_REFERENCE');
    const foreignBranch = await send(x.owner, 'post', `/api/v1/orgs/${x.orgId}/patients`, { fullName: 'Smuggle', phone: { country: 'EG', number: '01005550000' }, branchId: y.branchA });
    expect(foreignBranch.body.error.code).toBe('INVALID_BRANCH');
    const foreignMembership = await send(x.owner, 'post', `/api/v1/orgs/${x.orgId}/practitioners`, { membershipId: y.doctorMembership, specialtyCode: 'ent', branchIds: [x.branchA], defaultDurationMinutes: 15 });
    expect(foreignMembership.body.error.code).toBe('MEMBERSHIP_NOT_ELIGIBLE');
    expect(await AppointmentModel.countDocuments({ organizationId: x.orgId, patientId: Y.patient })).toBe(0);
  });

  it('searches, counts and lists never include the other organization', async () => {
    const xo = `/api/v1/orgs/${x.orgId}`;
    const byName = await x.owner.agent.get(`${xo}/patients`).query({ q: 'Beta Secret', status: 'all' });
    const byPhone = await x.owner.agent.get(`${xo}/patients`).query({ q: Y.phone, status: 'all' });
    expect(byName.body).toMatchObject({ data: [], total: 0 });
    expect(byPhone.body).toMatchObject({ data: [], total: 0 });
    const all = await x.owner.agent.get(`${xo}/patients`).query({ status: 'all', pageSize: 50 });
    expect(all.body.total).toBe(await PatientModel.countDocuments({ organizationId: x.orgId }));
    const week = await x.owner.agent.get(`${xo}/appointments`).query({ from: TODAY, to: '2026-11-16' });
    expect(week.body.data.every((a: { id: string }) => a.id !== Y.appointment)).toBe(true);
    const practitioners = await x.owner.agent.get(`${xo}/practitioners`);
    expect(practitioners.body.data.map((p: { id: string }) => p.id).sort()).toEqual([x.practitioner, x.practitioner2].sort());
    const dashboard = await x.owner.agent.get(`${xo}/dashboard`);
    expect(Object.values(dashboard.body.counts as Record<string, number>).reduce((s, n) => s + n, 0)).toBe(
      await AppointmentModel.countDocuments({ organizationId: x.orgId, startAt: { $gte: new Date('2026-11-09T22:00:00Z'), $lt: new Date('2026-11-10T22:00:00Z') } }),
    );
  });
});

describe('branch-restricted staff', () => {
  it('see only their branch in appointments, queue, counts, history and availability', async () => {
    const r = x.receptionist; // branch A only
    const xo = `/api/v1/orgs/${x.orgId}`;
    expect((await r.agent.get(`${xo}/appointments/${X.apptB}`)).body).toEqual(NOT_FOUND);
    expect((await r.agent.get(`${xo}/appointments`).query({ branchId: x.branchB })).status).toBe(404);
    expect((await r.agent.get(`${xo}/queue`).query({ branchId: x.branchB })).status).toBe(404);
    expect((await r.agent.get(`${xo}/dashboard`).query({ branchId: x.branchB })).status).toBe(404);
    const availability = await r.agent.get(`${xo}/appointments/availability`).query({ practitionerId: x.practitioner, branchId: x.branchB, date: TOMORROW });
    expect(availability.body.error.code).toBe('INVALID_REFERENCE');

    const list = await r.agent.get(`${xo}/appointments`).query({ from: TODAY, to: TODAY });
    expect(list.body.data.map((a: { branchId: string }) => a.branchId)).toEqual(expect.not.arrayContaining([x.branchB]));
    const history = await r.agent.get(`${xo}/patients/${X.shared}/appointments`).query({ when: 'past' });
    const upcoming = await r.agent.get(`${xo}/patients/${X.shared}/appointments`).query({ when: 'upcoming' });
    const ids = [...history.body.data, ...upcoming.body.data].map((a: { id: string }) => a.id);
    expect(ids).toContain(X.apptA);
    expect(ids).not.toContain(X.apptB);
    expect(history.body.total + upcoming.body.total).toBe(1);

    // Cannot act on the other branch's appointment.
    expect((await act(r, x.orgId, X.apptB, 'check_in', X.apptBVersion)).status).toBe(404);
    // Practitioners only show their branch assignments.
    const practitioner = (await r.agent.get(`${xo}/practitioners/${x.practitioner}`)).body.practitioner;
    expect(practitioner.branchIds).toEqual([x.branchA]);
    expect(practitioner.weeklySchedule.every((i: { branchId: string }) => i.branchId === x.branchA)).toBe(true);
  });

  it('cannot book into another branch or for a patient they cannot see', async () => {
    const intoB = await book(x.receptionist, x.orgId, { patientId: X.shared, practitionerId: x.practitioner, branchId: x.branchB, date: TOMORROW, time: '16:00' });
    expect(intoB.body.error).toMatchObject({ code: 'INVALID_REFERENCE', fields: { branchId: 'not_available' } });
    const hiddenPatient = await book(x.receptionist, x.orgId, { patientId: X.onlyB, practitionerId: x.practitioner2, branchId: x.branchA, date: TOMORROW, time: '16:00' });
    expect(hiddenPatient.body.error).toMatchObject({ code: 'INVALID_REFERENCE', fields: { patientId: 'not_available' } });
  });
});

describe('doctors', () => {
  it('see only their own appointments and the patients linked to them', async () => {
    const xo = `/api/v1/orgs/${x.orgId}`;
    const own = await x.doctor2.agent.get(`${xo}/appointments`).query({ from: TODAY, to: TODAY });
    expect(own.body.data.length).toBeGreaterThan(0);
    expect(own.body.data.every((a: { practitioner: { id: string } }) => a.practitioner.id === x.practitioner2)).toBe(true);
    const others = await x.doctor2.agent.get(`${xo}/appointments`).query({ practitionerId: x.practitioner });
    expect(others.body.data).toEqual([]);
    expect((await x.doctor2.agent.get(`${xo}/appointments/${X.apptB}`)).body).toEqual(NOT_FOUND);

    expect((await x.doctor2.agent.get(`${xo}/patients/${X.shared}`)).status).toBe(200);
    expect((await x.doctor2.agent.get(`${xo}/patients/${X.onlyB}`)).body).toEqual(NOT_FOUND);
    expect((await x.doctor2.agent.get(`${xo}/patients`)).status).toBe(403);
    expect((await send(x.doctor2, 'patch', `${xo}/patients/${X.shared}`, { fullName: 'Doctor Edit', version: 0 })).status).toBe(403);
    const history = await x.doctor2.agent.get(`${xo}/patients/${X.shared}/appointments`).query({ when: 'past' });
    const upcoming = await x.doctor2.agent.get(`${xo}/patients/${X.shared}/appointments`).query({ when: 'upcoming' });
    expect([...history.body.data, ...upcoming.body.data].map((a: { id: string }) => a.id)).toEqual([X.apptA]);

    // Their own profile only.
    const practitioners = await x.doctor2.agent.get(`${xo}/practitioners`);
    expect(practitioners.body.data.map((p: { id: string }) => p.id)).toEqual([x.practitioner2]);
    expect((await x.doctor2.agent.get(`${xo}/practitioners/${x.practitioner}`)).body).toEqual(NOT_FOUND);
    const detail = await x.doctor2.agent.get(xo);
    expect(detail.body.membership.practitionerId).toBe(x.practitioner2);
  });

  it('cannot change other practitioners’ appointments', async () => {
    const res = await act(x.doctor2, x.orgId, X.apptB, 'start', X.apptBVersion);
    expect(res.body).toEqual(NOT_FOUND);
  });
});

describe('viewers', () => {
  it('get aggregate counts and nothing identifiable', async () => {
    const xo = `/api/v1/orgs/${x.orgId}`;
    const dashboard = await x.viewer.agent.get(`${xo}/dashboard`);
    expect(dashboard.status).toBe(200);
    expect(Object.keys(dashboard.body)).toEqual(['date', 'timeZone', 'counts']);
    for (const path of ['/patients', `/patients/${X.shared}`, `/patients/${X.shared}/appointments`, '/appointments', `/appointments/${X.apptA}`, '/queue', '/practitioners']) {
      expect((await x.viewer.agent.get(`${xo}${path}`)).status, path).toBe(403);
    }
  });
});

describe('membership changes take effect immediately', () => {
  it('suspension and role changes apply to the very next request', async () => {
    const xo = `/api/v1/orgs/${x.orgId}`;
    const membershipId = (await x.receptionistB.agent.get(xo)).body.membership.id;
    expect((await x.receptionistB.agent.get(`${xo}/patients`)).status).toBe(200);

    await send(x.owner, 'patch', `${xo}/members/${membershipId}`, { status: 'suspended' });
    for (const path of ['/patients', '/appointments', '/queue', '/dashboard']) {
      expect((await x.receptionistB.agent.get(`${xo}${path}`)).body).toEqual(NOT_FOUND);
    }
    await send(x.owner, 'patch', `${xo}/members/${membershipId}`, { status: 'active', role: 'viewer', branchScope: { type: 'selected', branchIds: [x.branchB] } });
    expect((await x.receptionistB.agent.get(`${xo}/patients`)).status).toBe(403);
    expect((await x.receptionistB.agent.get(`${xo}/dashboard`)).status).toBe(200);
  });

  it('a suspended doctor’s practitioner profile stops taking bookings at once', async () => {
    const xo = `/api/v1/orgs/${x.orgId}`;
    await send(x.owner, 'patch', `${xo}/members/${x.doctorMembership}`, { status: 'suspended' });
    const res = await book(x.owner, x.orgId, { patientId: X.shared, practitionerId: x.practitioner, branchId: x.branchA, date: TOMORROW, time: '09:00' });
    expect(res.body.error.code).toBe('PRACTITIONER_INACTIVE');
    await send(x.owner, 'patch', `${xo}/members/${x.doctorMembership}`, { status: 'active' });
    await bookOk(x.owner, x.orgId, { patientId: X.shared, practitionerId: x.practitioner, branchId: x.branchA, date: TOMORROW, time: '09:00' });
  });
});
