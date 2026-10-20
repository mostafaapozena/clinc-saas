import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditEventModel } from '../src/modules/audit/audit-event.model.js';
import { PatientModel } from '../src/modules/patients/patient.model.js';
import { send, testApp } from './helpers/api.js';
import { TOMORROW, act, bookOk, buildClinic, createPatient, nextPhone, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

const app = testApp();
let c: Clinic;
const url = (path = '') => `/api/v1/orgs/${c.orgId}/patients${path}`;

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('patients');
  c = await buildClinic(app, 'pat');
});
afterAll(() => dropTestDatabase());

describe('creating patients', () => {
  it('requires only a name, a phone with country context and an authorized branch', async () => {
    const res = await send(c.receptionist, 'post', url(), {
      fullName: 'منى عبد الرحمن',
      phone: { country: 'EG', number: '٠١٠٠ ٥٥٥ ١٢٣٤' },
      branchId: c.branchA,
    });
    expect(res.status).toBe(201);
    expect(res.body.patient).toMatchObject({
      fullName: 'منى عبد الرحمن',
      phone: { country: 'EG', e164: '+201005551234' },
      sex: 'unspecified',
      dateOfBirth: null,
      registrations: [{ branchId: c.branchA, status: 'active' }],
    });
    expect(res.body.patient.patientNumber).toBeGreaterThan(0);
  });

  it('validates fields server-side with stable codes', async () => {
    const cases: [object, Record<string, string>][] = [
      [{ fullName: 'X', phone: { country: 'EG', number: nextPhone() }, branchId: c.branchA }, { fullName: 'too_short' }],
      [{ fullName: 'Valid Name', phone: { number: '01001234567' }, branchId: c.branchA }, { 'phone.country': 'required' }],
      [{ fullName: 'Valid Name', phone: { country: 'EG', number: '0100' }, branchId: c.branchA }, { 'phone.number': 'invalid_phone' }],
      [{ fullName: 'Valid Name', phone: { country: 'EG', number: nextPhone() }, branchId: c.branchA, dateOfBirth: '2026-02-30' }, { dateOfBirth: 'invalid_format' }],
      [{ fullName: 'Valid Name', phone: { country: 'EG', number: nextPhone() }, branchId: c.branchA, dateOfBirth: '2030-01-01' }, { dateOfBirth: 'out_of_range' }],
      [{ fullName: 'Valid Name', phone: { country: 'EG', number: nextPhone() }, branchId: c.branchA, sex: 'other' }, { sex: 'invalid_choice' }],
      [{ fullName: 'Valid Name', phone: { country: 'EG', number: nextPhone() }, branchId: c.branchA, email: 'nope' }, { email: 'invalid_format' }],
    ];
    for (const [body, fields] of cases) {
      const res = await send(c.receptionist, 'post', url(), body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.fields).toEqual(fields);
    }
  });

  it('rejects branches outside the caller scope like unknown ids', async () => {
    const outside = await send(c.receptionist, 'post', url(), { fullName: 'Nope', phone: { country: 'EG', number: nextPhone() }, branchId: c.branchB });
    const unknown = await send(c.receptionist, 'post', url(), { fullName: 'Nope', phone: { country: 'EG', number: nextPhone() }, branchId: '0123456789abcdef01234567' });
    expect(outside.status).toBe(400);
    expect(outside.body).toEqual(unknown.body);
    expect(outside.body.error.code).toBe('INVALID_BRANCH');
  });

  it('ignores fields that are not part of the allowlist (no operator injection)', async () => {
    const res = await send(c.owner, 'post', url(), {
      fullName: 'Allowlist Check',
      phone: { country: 'EG', number: nextPhone() },
      branchId: c.branchA,
      organizationId: '0123456789abcdef01234567',
      patientNumber: 1,
      registrations: [{ branchId: c.branchB, status: 'active' }],
      nameKey: { $gt: '' },
    });
    expect(res.status).toBe(201);
    expect(res.body.patient.registrations).toEqual([expect.objectContaining({ branchId: c.branchA })]);
    const search = await c.owner.agent.get(url()).query({ 'q[$ne]': 'x' });
    expect(search.status).toBe(200);
  });

  it('allows shared family phone numbers', async () => {
    const familyPhone = nextPhone();
    await createPatient(c.receptionist, c.orgId, c.branchA, 'Parent Family', familyPhone);
    await createPatient(c.receptionist, c.orgId, c.branchA, 'Child Family', familyPhone);
    const res = await c.receptionist.agent.get(url()).query({ q: familyPhone });
    expect(res.body.data.map((p: { fullName: string }) => p.fullName).sort()).toEqual(['Child Family', 'Parent Family']);
  });

  it('allocates unique patient numbers under concurrent creation', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        send(c.owner, 'post', url(), { fullName: `Concurrent ${i}`, phone: { country: 'EG', number: nextPhone() }, branchId: c.branchA }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.patient.patientNumber as number);
    expect(new Set(numbers).size).toBe(12);
  });
});

describe('duplicate warnings', () => {
  it('warns about the same name and phone, and creates only after confirmation', async () => {
    const phone = nextPhone();
    await createPatient(c.receptionist, c.orgId, c.branchA, 'أحمد سالم', phone);
    const body = { fullName: 'احمد سالم', phone: { country: 'EG', number: phone }, branchId: c.branchA };
    const warned = await send(c.receptionist, 'post', url(), body);
    expect(warned.status).toBe(409);
    expect(warned.body.error.code).toBe('POSSIBLE_DUPLICATE');
    expect(warned.body.error.details.matches).toHaveLength(1);
    const confirmed = await send(c.receptionist, 'post', url(), { ...body, confirmDuplicate: true });
    expect(confirmed.status).toBe(201);
  });

  it('never reveals or links a patient registered only in a branch the caller cannot see', async () => {
    const phone = nextPhone();
    const hiddenId = await createPatient(c.receptionistB, c.orgId, c.branchB, 'Hidden Twin', phone);
    const res = await send(c.receptionist, 'post', url(), { fullName: 'Hidden Twin', phone: { country: 'EG', number: phone }, branchId: c.branchA });
    expect(res.status).toBe(201);
    expect(res.body.patient.id).not.toBe(hiddenId);
    expect(JSON.stringify(res.body)).not.toContain(hiddenId);
  });
});

describe('search, filters and pagination', () => {
  it('searches by number, normalized name and phone within scope, with bounded pages', async () => {
    const id = await createPatient(c.receptionist, c.orgId, c.branchA, 'يُوسُف الزيات', '01009998877');
    const patient = (await c.receptionist.agent.get(url(`/${id}`))).body.patient;
    const byNumber = await c.receptionist.agent.get(url()).query({ q: String(patient.patientNumber) });
    const byArabicDigits = await c.receptionist.agent.get(url()).query({ q: '٠١٠٠٩٩٩٨٨٧٧' });
    const byName = await c.receptionist.agent.get(url()).query({ q: 'يوسف الزيات' });
    const byInternational = await c.receptionist.agent.get(url()).query({ q: '+20 100 999 8877' });
    for (const res of [byNumber, byArabicDigits, byName, byInternational]) {
      expect(res.body.data.map((p: { id: string }) => p.id)).toContain(id);
    }
    const regexChars = await c.receptionist.agent.get(url()).query({ q: '.*(' });
    expect(regexChars.status).toBe(200);
    expect(regexChars.body.data).toEqual([]);

    const page1 = await c.owner.agent.get(url()).query({ pageSize: 3, page: 1, sort: 'number' });
    const page2 = await c.owner.agent.get(url()).query({ pageSize: 3, page: 2, sort: 'number' });
    expect(page1.body.data).toHaveLength(3);
    expect(page1.body.total).toBeGreaterThan(6);
    const numbers = [...page1.body.data, ...page2.body.data].map((p: { patientNumber: number }) => p.patientNumber);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(new Set(numbers).size).toBe(6);
    expect((await c.owner.agent.get(url()).query({ pageSize: 500 })).status).toBe(400);
    expect((await c.owner.agent.get(url()).query({ sort: 'phone.e164' })).status).toBe(400);
  });
});

describe('branch visibility', () => {
  it('returns only authorized registrations and hides patients without one', async () => {
    const both = await createPatient(c.owner, c.orgId, c.branchA, 'Two Branch Person');
    expect((await send(c.owner, 'post', url(`/${both}/registrations`), { branchId: c.branchB })).status).toBe(201);
    const onlyB = await createPatient(c.owner, c.orgId, c.branchB, 'Only B Person');

    const seenByA = await c.receptionist.agent.get(url(`/${both}`));
    expect(seenByA.body.patient.registrations.map((r: { branchId: string }) => r.branchId)).toEqual([c.branchA]);
    expect(JSON.stringify(seenByA.body)).not.toContain(c.branchB);
    const hidden = await c.receptionist.agent.get(url(`/${onlyB}`));
    expect(hidden.status).toBe(404);
    expect(hidden.body.error.code).toBe('NOT_FOUND');

    const list = await c.receptionist.agent.get(url()).query({ q: 'Person', status: 'all' });
    expect(list.body.data.map((p: { fullName: string }) => p.fullName)).toEqual(['Two Branch Person']);
    expect((await c.receptionist.agent.get(url()).query({ branchId: c.branchB })).status).toBe(404);
    expect((await c.owner.agent.get(url(`/${onlyB}`))).body.patient.registrations).toHaveLength(1);
  });

  it('adds a branch only when the caller can access both the patient and the branch', async () => {
    const id = await createPatient(c.receptionist, c.orgId, c.branchA, 'Register Elsewhere');
    const toHidden = await send(c.receptionist, 'post', url(`/${id}/registrations`), { branchId: c.branchB });
    expect(toHidden.status).toBe(400);
    const again = await send(c.receptionist, 'post', url(`/${id}/registrations`), { branchId: c.branchA });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_REGISTERED');
    const otherSide = await send(c.receptionistB, 'post', url(`/${id}/registrations`), { branchId: c.branchB });
    expect(otherSide.status).toBe(404);
  });
});

describe('updating and archiving', () => {
  it('updates allowlisted demographics with optimistic versions and audits field names only', async () => {
    const id = await createPatient(c.receptionist, c.orgId, c.branchA, 'Before Name');
    const current = (await c.receptionist.agent.get(url(`/${id}`))).body.patient;
    const ok = await send(c.receptionist, 'patch', url(`/${id}`), {
      fullName: 'After Name',
      dateOfBirth: '1990-05-20',
      address: { line: 'شارع التجربة 1', city: 'القاهرة' },
      version: current.version,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.patient).toMatchObject({ fullName: 'After Name', dateOfBirth: '1990-05-20', version: current.version + 1 });
    const stale = await send(c.receptionist, 'patch', url(`/${id}`), { fullName: 'Lost Update', version: current.version });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    const events = await AuditEventModel.find({ organizationId: c.orgId, 'target.id': id }).lean();
    expect(events.map((e) => e.action)).toEqual(['patient.created', 'patient.updated']);
    expect(events[1]?.changes).toEqual({ fields: ['fullName', 'dateOfBirth', 'address'] });
    expect(JSON.stringify(events)).not.toContain('After Name');
    expect(JSON.stringify(events)).not.toMatch(/\+20\d+/);
  });

  it('refuses to archive a registration with future appointments, listing them, then allows it after cancellation', async () => {
    const id = await createPatient(c.receptionist, c.orgId, c.branchA, 'Archive Me');
    const appointment = await bookOk(c.receptionist, c.orgId, {
      patientId: id,
      practitionerId: c.practitioner2,
      branchId: c.branchA,
      date: TOMORROW,
      time: '09:00',
    });
    const refused = await send(c.receptionist, 'patch', url(`/${id}/registrations/${c.branchA}`), { status: 'archived' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('FUTURE_APPOINTMENTS_EXIST');
    expect(refused.body.error.details.appointments.map((a: { id: string }) => a.id)).toEqual([appointment.id]);
    expect((await PatientModel.findOne({ organizationId: c.orgId, _id: id }))?.registrations[0]?.status).toBe('active');

    expect((await act(c.receptionist, c.orgId, appointment.id, 'cancel', appointment.version)).status).toBe(200);
    const archived = await send(c.receptionist, 'patch', url(`/${id}/registrations/${c.branchA}`), { status: 'archived' });
    expect(archived.status).toBe(200);
    expect(archived.body.patient.registrations[0]).toMatchObject({ status: 'archived' });
    // History is kept and the patient stays reachable through the archived registration.
    expect((await c.receptionist.agent.get(url(`/${id}/appointments`)).query({ when: 'upcoming' })).body.total).toBe(1);

    // New bookings in an archived branch are refused.
    const booking = await send(c.receptionist, 'post', `/api/v1/orgs/${c.orgId}/appointments`, {});
    expect(booking.status).toBe(400); // missing Idempotency-Key
    const blocked = await c.receptionist.agent
      .post(`/api/v1/orgs/${c.orgId}/appointments`)
      .set('X-CSRF-Token', c.receptionist.csrf)
      .set('Idempotency-Key', 'archived-branch-booking')
      .send({ patientId: id, practitionerId: c.practitioner2, branchId: c.branchA, date: TOMORROW, time: '10:00', type: 'new_visit' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PATIENT_NOT_REGISTERED');

    const reactivated = await send(c.receptionist, 'patch', url(`/${id}/registrations/${c.branchA}`), { status: 'active' });
    expect(reactivated.body.patient.registrations[0]).toMatchObject({ status: 'active', archivedAt: null });
    const actions = (await AuditEventModel.find({ organizationId: c.orgId, 'target.id': id }).lean()).map((e) => e.action);
    expect(actions).toEqual(['patient.created', 'patient.registration_archived', 'patient.registration_reactivated']);
  });
});
