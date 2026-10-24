import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppointmentModel, SlotReservationModel } from '../src/modules/appointments/appointment.model.js';
import { BranchModel } from '../src/modules/branches/branch.model.js';
import { AddendumModel, ClinicalAuditModel, EncounterModel } from '../src/modules/clinical/clinical.model.js';
import { seedDemoData } from '../src/modules/demo/demo.seed.js';
import { MembershipModel } from '../src/modules/memberships/membership.model.js';
import { OrganizationModel } from '../src/modules/organizations/organization.model.js';
import { PatientModel } from '../src/modules/patients/patient.model.js';
import { PractitionerModel } from '../src/modules/practitioners/practitioner.model.js';
import { UserModel } from '../src/users/user.model.js';
import { todayIn } from '../src/time/local-time.js';
import { testApp } from './helpers/api.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';
import request from 'supertest';

const PASSWORD = 'seed-test-password-1';

beforeAll(() => connectTestDatabase('seed'));
afterAll(() => dropTestDatabase());

describe('demo seed', () => {
  it('creates the documented scenarios and is idempotent', async () => {
    await seedDemoData(PASSWORD);
    await seedDemoData(PASSWORD);

    const orgs = await OrganizationModel.find().lean();
    expect(orgs).toHaveLength(3);
    expect(orgs.map((o) => o.timeZone).sort()).toEqual(['Africa/Cairo', 'Africa/Cairo', 'Asia/Riyadh']);
    const userIds = new Map((await UserModel.find().lean()).map((u) => [u.email, u._id]));
    expect([...userIds.keys()].every((email) => email.endsWith('@demo.test'))).toBe(true);

    const membershipsOf = async (email: string) => {
      const userId = userIds.get(email);
      return MembershipModel.find({ userId }).setOptions({ skipTenantGuard: true }).lean();
    };
    expect(await membershipsOf('multi@demo.test')).toHaveLength(2);
    expect((await membershipsOf('suspended.nour@demo.test'))[0]?.status).toBe('suspended');
    expect((await membershipsOf('doctor.nour@demo.test'))[0]?.branchScope.branchIds).toHaveLength(1);
    expect((await membershipsOf('doctor2.nour@demo.test'))[0]?.branchScope.branchIds).toHaveLength(2);
    expect(await membershipsOf('newcomer@demo.test')).toHaveLength(0);
    for (const org of orgs) {
      expect(await BranchModel.countDocuments({ organizationId: org._id })).toBeGreaterThanOrEqual(2);
    }
  });

  it('seeds specialty configurations that satisfy the consistency rules, plus one legacy organization', async () => {
    const byKey = new Map((await OrganizationModel.find().lean()).map((o) => [o.seedKey, o]));
    expect(byKey.get('demo-nour')).toMatchObject({ type: 'medical_center', specialtyCodes: ['dentistry', 'physiotherapy'] });
    expect(byKey.get('demo-shifa')).toMatchObject({ type: 'multi_branch', specialtyCodes: ['ent'] });
    expect(byKey.get('demo-legacy')).toMatchObject({ type: null, specialtyCodes: [] });

    for (const org of byKey.values()) {
      const branches = await BranchModel.find({ organizationId: org._id }).lean();
      const offered = new Map(branches.map((b) => [String(b._id), b.specialtyCodes]));
      for (const codes of offered.values()) {
        if (org.specialtyCodes.length === 0) expect(codes).toEqual([]);
        else {
          expect(codes.length).toBeGreaterThan(0);
          expect(codes.every((c) => org.specialtyCodes.includes(c))).toBe(true);
        }
      }
      for (const p of await PractitionerModel.find({ organizationId: org._id }).lean()) {
        expect(org.specialtyCodes).toContain(p.specialtyCode);
        for (const b of p.branchIds) expect(offered.get(String(b))).toContain(p.specialtyCode);
      }
    }
  });

  it('seeds front-desk data relative to each organization’s local today, without duplicates', async () => {
    const nour = await OrganizationModel.findOne({ seedKey: 'demo-nour' }).lean();
    const organizationId = nour?._id;
    expect(organizationId).toBeDefined();

    expect(await PatientModel.countDocuments({ organizationId })).toBe(9);
    const numbers = (await PatientModel.find({ organizationId }).lean()).map((p) => p.patientNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    // A shared family phone number is stored for two different patients.
    expect(await PatientModel.countDocuments({ organizationId, 'phone.e164': '+201001234502' })).toBe(2);

    const practitioners = await PractitionerModel.find({ organizationId }).lean();
    expect(practitioners.map((p) => p.branchIds.length).sort()).toEqual([1, 2]);

    const appointments = await AppointmentModel.find({ organizationId }).lean();
    expect(appointments).toHaveLength(22);
    const today = todayIn('Africa/Cairo');
    const statuses = new Set(appointments.map((a) => a.status));
    expect([...statuses].sort()).toEqual(['cancelled', 'checked_in', 'completed', 'in_progress', 'no_show', 'scheduled']);
    expect(appointments.some((a) => todayIn('Africa/Cairo', a.startAt) === today)).toBe(true);
    // Every occupying appointment owns exactly its five-minute cells for practitioner and patient.
    const reservations = await SlotReservationModel.countDocuments({ organizationId });
    const expected = appointments
      .filter((a) => ['scheduled', 'checked_in', 'in_progress', 'completed'].includes(a.status))
      .reduce((sum, a) => sum + (a.durationMinutes / 5) * 2, 0);
    expect(reservations).toBe(expected);
  });

  it('seeds synthetic visit records on the treating doctors’ appointments, once', async () => {
    const nour = await OrganizationModel.findOne({ seedKey: 'demo-nour' }).lean();
    const organizationId = nour?._id;
    const encounters = await EncounterModel.find({ organizationId }).lean();
    expect(encounters.map((e) => e.seedKey).sort()).toEqual(['e01', 'e02', 'e03', 'e04', 'e05']);
    for (const e of encounters) {
      const appointment = await AppointmentModel.findOne({ organizationId, _id: e.appointmentId }).lean();
      expect(appointment?.practitionerId.equals(e.practitionerId)).toBe(true);
      expect(appointment?.patientId.equals(e.patientId)).toBe(true);
      const practitioner = await PractitionerModel.findOne({ organizationId, _id: e.practitionerId }).lean();
      expect(practitioner?.userId?.equals(e.authorUserId)).toBe(true);
    }
    expect(encounters.filter((e) => e.status === 'draft')).toHaveLength(1);
    expect(encounters.filter((e) => e.lateEntry)).toHaveLength(1);
    expect(await AddendumModel.countDocuments({ organizationId })).toBe(1);
    // Seeding writes no clinical audit events: nobody accessed anything.
    expect(await ClinicalAuditModel.countDocuments({ organizationId })).toBe(0);
  });

  it('re-seeding keeps hand-made records and skips a seed booking that would collide', async () => {
    const nour = await OrganizationModel.findOne({ seedKey: 'demo-nour' }).lean();
    const organizationId = nour?._id as Types.ObjectId;
    const seeded = await AppointmentModel.findOne({ organizationId, seedKey: 'a10' }).lean();
    if (!seeded) throw new Error('missing seed appointment');
    // Simulate a manual booking holding the same practitioner time, then re-seed.
    await SlotReservationModel.deleteMany({ organizationId, appointmentId: seeded._id });
    const manual = await AppointmentModel.create({ ...seeded, _id: new Types.ObjectId(), seedKey: undefined });
    await SlotReservationModel.create({
      organizationId,
      resourceType: 'practitioner',
      resourceId: seeded.practitionerId,
      slotStart: seeded.startAt,
      appointmentId: manual._id,
    });

    const result = await seedDemoData(PASSWORD);

    expect(result.skippedAppointments).toEqual(['demo-nour/a10 (time already taken)']);
    expect(await AppointmentModel.exists({ organizationId, _id: manual._id })).not.toBeNull();
    expect(await AppointmentModel.countDocuments({ organizationId, seedKey: { $type: 'string' } })).toBe(21);
  });

  it('demo accounts work in development and are refused in production', async () => {
    const login = (production: boolean) =>
      request(testApp({ production }))
        .post('/api/v1/auth/login')
        .send({ email: 'owner.nour@demo.test', password: PASSWORD });

    expect((await login(false)).status).toBe(200);
    expect((await login(true)).status).toBe(401);
  });
});
