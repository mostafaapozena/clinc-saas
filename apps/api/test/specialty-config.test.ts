import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditEventModel } from '../src/modules/audit/audit-event.model.js';
import { BranchModel } from '../src/modules/branches/branch.model.js';
import { OrganizationModel } from '../src/modules/organizations/organization.model.js';
import { PractitionerModel } from '../src/modules/practitioners/practitioner.model.js';
import { seedSpecialties } from '../src/modules/specialties/specialty.seed.js';
import { addBranch, addMember, configureSpecialties, createOrg, register, send, testApp, type Client } from './helpers/api.js';
import { TODAY, TOMORROW, act, book, bookOk, createPatient, pinClock } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

const app = testApp();
const everyDay = (branchId: string) => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ branchId, weekday, start: '08:00', end: '20:00' }));

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('specialty_config');
  await seedSpecialties();
});
beforeEach(() => {
  pinClock();
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => dropTestDatabase());

function newOrg(owner: Client, body: Record<string, unknown>) {
  return send(owner, 'post', '/api/v1/orgs', { name: 'Spec Clinic', timeZone: 'Africa/Cairo', branch: { name: 'Main' }, ...body });
}

/** A doctor membership with a scheduling profile (all day at its first branch), or the refusal. */
async function practitioner(owner: Client, orgId: string, specialtyCode: string, branchIds: string[], membershipBranches = branchIds) {
  const doctor = await register(app, `doc-${specialtyCode}`);
  const membershipId = await addMember(owner, orgId, doctor, 'doctor', membershipBranches);
  const res = await send(owner, 'post', `/api/v1/orgs/${orgId}/practitioners`, {
    membershipId,
    specialtyCode,
    branchIds,
    defaultDurationMinutes: 30,
  });
  if (res.status !== 201) return { doctor, membershipId, res, id: '' };
  const id = res.body.practitioner.id as string;
  const scheduled = await send(owner, 'put', `/api/v1/orgs/${orgId}/practitioners/${id}/schedule`, {
    weeklySchedule: everyDay(branchIds[0] ?? ''),
    version: res.body.practitioner.version,
  });
  expect(scheduled.status, JSON.stringify(scheduled.body)).toBe(200);
  return { doctor, membershipId, res, id };
}

describe('creating an organization with specialties', () => {
  it('stores type, specialties and the first branch’s subset; the branch defaults to all of them', async () => {
    const owner = await register(app, 'spec-owner');
    const center = await newOrg(owner, {
      type: 'medical_center',
      specialtyCodes: ['dentistry', 'physiotherapy', 'dentistry'],
      branch: { name: 'Downtown', specialtyCodes: ['physiotherapy'] },
    });
    expect(center.status, JSON.stringify(center.body)).toBe(201);
    expect(center.body.organization).toMatchObject({ type: 'medical_center', specialtyCodes: ['dentistry', 'physiotherapy'] });
    expect(center.body.branch.specialtyCodes).toEqual(['physiotherapy']);

    const clinic = await newOrg(owner, { type: 'clinic', specialtyCodes: ['ent'] });
    expect(clinic.body.branch.specialtyCodes).toEqual(['ent']);
    const audit = await AuditEventModel.findOne({ organizationId: clinic.body.organization.id, action: 'organization.created' }).lean();
    expect(audit?.changes).toMatchObject({ type: 'clinic', specialtyCodes: ['ent'] });
  });

  it('rejects unsupported specialties (radiology is not a SaaS specialty) and branches outside the list', async () => {
    const owner = await register(app, 'spec-invalid');
    const radiology = await newOrg(owner, { type: 'medical_center', specialtyCodes: ['radiology'] });
    expect(radiology.status).toBe(400);
    expect(radiology.body.error.fields).toEqual({ specialtyCodes: 'unsupported_specialty' });

    const outside = await newOrg(owner, { specialtyCodes: ['ent'], branch: { name: 'Main', specialtyCodes: ['dentistry'] } });
    expect(outside.body.error.fields).toEqual({ 'branch.specialtyCodes': 'not_in_organization' });
    const injected = await newOrg(owner, { specialtyCodes: [{ $ne: null }] });
    expect(injected.status).toBe(400);
    const badType = await newOrg(owner, { type: 'hospital', specialtyCodes: ['ent'] });
    expect(badType.body.error.fields).toEqual({ type: 'invalid_choice' });
    expect(await OrganizationModel.countDocuments({ createdBy: owner.userId })).toBe(0);
  });
});

describe('the owner’s specialty setup', () => {
  it('replaces organization and branch specialties together, audited, with optimistic versions', async () => {
    const owner = await register(app, 'setup-owner');
    const { orgId, branchId } = await createOrg(owner, 'Setup Clinic', 'Main');
    const second = await addBranch(owner, orgId, 'Second');
    const before = (await owner.agent.get(`/api/v1/orgs/${orgId}`)).body.organization;
    expect(before).toMatchObject({ specialtyCodes: [], type: null });

    const res = await send(owner, 'put', `/api/v1/orgs/${orgId}/specialties`, {
      specialtyCodes: ['dentistry', 'ent'],
      branches: [
        { branchId, specialtyCodes: ['dentistry'] },
        { branchId: second, specialtyCodes: ['ent', 'dentistry'] },
      ],
      configVersion: before.configVersion,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.organization.specialtyCodes).toEqual(['dentistry', 'ent']);
    expect(res.body.branches.map((b: { name: string; specialtyCodes: string[] }) => [b.name, b.specialtyCodes])).toEqual([
      ['Main', ['dentistry']],
      ['Second', ['ent', 'dentistry']],
    ]);
    const stale = await send(owner, 'put', `/api/v1/orgs/${orgId}/specialties`, {
      specialtyCodes: ['dentistry'],
      configVersion: before.configVersion,
    });
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(await AuditEventModel.countDocuments({ organizationId: orgId, action: 'organization.specialties_updated' })).toBe(1);
  });

  it('refuses branches left without (or outside) the specialties, and foreign branch ids', async () => {
    const owner = await register(app, 'setup-invalid');
    const { orgId, branchId } = await createOrg(owner, 'Invalid Setup', 'Main');
    const second = await addBranch(owner, orgId, 'Second');
    const version = (await owner.agent.get(`/api/v1/orgs/${orgId}`)).body.organization.configVersion;
    // "Second" is not listed and has no specialties yet.
    const unlisted = await send(owner, 'put', `/api/v1/orgs/${orgId}/specialties`, {
      specialtyCodes: ['ent'],
      branches: [{ branchId, specialtyCodes: ['ent'] }],
      configVersion: version,
    });
    expect(unlisted.status).toBe(400);
    expect(unlisted.body.error).toMatchObject({ code: 'BRANCH_SPECIALTIES_INVALID', details: { branchIds: [second] } });

    const other = await register(app, 'setup-other');
    const foreign = await createOrg(other, 'Other Org');
    const tampered = await send(owner, 'put', `/api/v1/orgs/${orgId}/specialties`, {
      specialtyCodes: ['ent'],
      branches: [
        { branchId, specialtyCodes: ['ent'] },
        { branchId: second, specialtyCodes: ['ent'] },
        { branchId: foreign.branchId, specialtyCodes: ['ent'] },
      ],
      configVersion: version,
    });
    expect(tampered.body.error.code).toBe('INVALID_BRANCH');
    expect((await BranchModel.findOne({ organizationId: foreign.orgId, _id: foreign.branchId }).lean())?.specialtyCodes).toEqual([]);
    expect((await OrganizationModel.findById(orgId).lean())?.specialtyCodes).toEqual([]);
  });
});

describe('organizations created before phase 4', () => {
  it('keep working unconfigured, and the explicit setup never drops practitioners’ specialties', async () => {
    const owner = await register(app, 'legacy-owner');
    const { orgId, branchId } = await createOrg(owner, 'Legacy Clinic', 'Main');
    // Before setup nothing is enforced: any catalog specialty, no branch specialties.
    const physio = await practitioner(owner, orgId, 'physiotherapy', [branchId]);
    expect(physio.res.status).toBe(201);
    const patient = await createPatient(owner, orgId, branchId);
    const booked = await bookOk(owner, orgId, { patientId: patient, practitionerId: physio.id, branchId, date: TOMORROW, time: '09:00' });
    const premature = await send(owner, 'post', `/api/v1/orgs/${orgId}/branches`, { name: 'Early', specialtyCodes: ['ent'] });
    expect(premature.body.error.code).toBe('SPECIALTIES_NOT_CONFIGURED');

    // Choosing specialties that would leave the physiotherapist outside them is refused, naming them.
    const version = (await owner.agent.get(`/api/v1/orgs/${orgId}`)).body.organization.configVersion;
    const missing = await send(owner, 'put', `/api/v1/orgs/${orgId}/specialties`, {
      specialtyCodes: ['dentistry'],
      branches: [{ branchId, specialtyCodes: ['dentistry'] }],
      configVersion: version,
    });
    expect(missing.status).toBe(409);
    expect(missing.body.error).toMatchObject({
      code: 'SPECIALTY_IN_USE',
      details: { practitioners: [{ id: physio.id, specialtyCode: 'physiotherapy' }] },
    });

    await configureSpecialties(owner, orgId, ['physiotherapy', 'dentistry'], [branchId]);
    // Existing bookings and the front desk keep working after the setup.
    expect((await act(owner, orgId, booked.id, 'cancel', booked.version)).status).toBe(200);
    const again = await book(owner, orgId, { patientId: patient, practitionerId: physio.id, branchId, date: TOMORROW, time: '10:00' });
    expect(again.status).toBe(201);
  });
});

describe('branch and practitioner consistency', () => {
  let owner: Client;
  let orgId: string;
  let dentalBranch: string;
  let mixedBranch: string;
  let dentistId: string;

  beforeAll(async () => {
    owner = await register(app, 'consistency-owner');
    const created = await newOrg(owner, {
      type: 'medical_center',
      specialtyCodes: ['dentistry', 'physiotherapy'],
      branch: { name: 'Dental', specialtyCodes: ['dentistry'] },
    });
    orgId = created.body.organization.id;
    dentalBranch = created.body.branch.id;
    mixedBranch = await addBranch(owner, orgId, 'Mixed', ['dentistry', 'physiotherapy']);
    dentistId = (await practitioner(owner, orgId, 'dentistry', [mixedBranch, dentalBranch])).id;
  });

  it('requires a valid subset for new branches once configured', async () => {
    const without = await send(owner, 'post', `/api/v1/orgs/${orgId}/branches`, { name: 'No specialties' });
    expect(without.body.error.fields).toEqual({ specialtyCodes: 'required' });
    const outside = await send(owner, 'post', `/api/v1/orgs/${orgId}/branches`, { name: 'ENT', specialtyCodes: ['ent'] });
    expect(outside.body.error.fields).toEqual({ specialtyCodes: 'not_in_organization' });
  });

  it('refuses practitioners whose specialty is not enabled or not offered at their branches', async () => {
    const ent = await practitioner(owner, orgId, 'ent', [mixedBranch]);
    expect(ent.res.body.error.code).toBe('SPECIALTY_NOT_ENABLED');
    const physioAtDental = await practitioner(owner, orgId, 'physiotherapy', [dentalBranch]);
    expect(physioAtDental.res.status).toBe(409);
    expect(physioAtDental.res.body.error).toMatchObject({ code: 'SPECIALTY_NOT_OFFERED_AT_BRANCH', details: { branchIds: [dentalBranch] } });

    // The membership allows both branches, so only the specialty rule stands in the way.
    const physio = await practitioner(owner, orgId, 'physiotherapy', [mixedBranch], [mixedBranch, dentalBranch]);
    expect(physio.res.status).toBe(201);
    const profile = (await owner.agent.get(`/api/v1/orgs/${orgId}/practitioners/${physio.id}`)).body.practitioner;
    const move = await send(owner, 'patch', `/api/v1/orgs/${orgId}/practitioners/${physio.id}`, { branchIds: [dentalBranch], version: profile.version });
    expect(move.body.error.code).toBe('SPECIALTY_NOT_OFFERED_AT_BRANCH');
    const respecialize = await send(owner, 'patch', `/api/v1/orgs/${orgId}/practitioners/${physio.id}`, { specialtyCode: 'ent', version: profile.version });
    expect(respecialize.body.error.code).toBe('SPECIALTY_NOT_ENABLED');
  });

  it('refuses to remove a specialty from a branch while a practitioner of it works there', async () => {
    const removal = await send(owner, 'patch', `/api/v1/orgs/${orgId}/branches/${mixedBranch}`, { specialtyCodes: ['physiotherapy'] });
    expect(removal.status).toBe(409);
    expect(removal.body.error.code).toBe('SPECIALTY_IN_USE');
    expect(removal.body.error.details.practitioners.map((p: { id: string }) => p.id)).toContain(dentistId);
    const branch = await BranchModel.findOne({ organizationId: orgId, _id: mixedBranch }).lean();
    expect(branch?.specialtyCodes).toEqual(['dentistry', 'physiotherapy']);
  });

  it('never books a practitioner at a branch that does not offer their specialty', async () => {
    const patient = await createPatient(owner, orgId, mixedBranch);
    // Simulate a configuration that slipped past the rules (e.g. a manual database edit).
    await BranchModel.updateOne({ organizationId: orgId, _id: mixedBranch }, { $set: { specialtyCodes: ['physiotherapy'] } });
    const refused = await book(owner, orgId, { patientId: patient, practitionerId: dentistId, branchId: mixedBranch, date: TOMORROW, time: '11:00' });
    expect(refused.body.error.code).toBe('SPECIALTY_NOT_OFFERED');
    const slots = await owner.agent
      .get(`/api/v1/orgs/${orgId}/appointments/availability`)
      .query({ practitionerId: dentistId, branchId: mixedBranch, date: TOMORROW });
    expect(slots.body.error.code).toBe('SPECIALTY_NOT_OFFERED');
    await BranchModel.updateOne({ organizationId: orgId, _id: mixedBranch }, { $set: { specialtyCodes: ['dentistry', 'physiotherapy'] } });
    const allowed = await book(owner, orgId, { patientId: patient, practitionerId: dentistId, branchId: mixedBranch, date: TOMORROW, time: '11:00' });
    expect(allowed.status).toBe(201);
  });

  it('rejects specialty changes by a suspended admin at once', async () => {
    const admin = await register(app, 'consistency-admin');
    const membershipId = await addMember(owner, orgId, admin, 'admin');
    const allowed = await send(admin, 'patch', `/api/v1/orgs/${orgId}/branches/${mixedBranch}`, { specialtyCodes: ['dentistry', 'physiotherapy'] });
    expect(allowed.status).toBe(200);
    await send(owner, 'patch', `/api/v1/orgs/${orgId}/members/${membershipId}`, { status: 'suspended' });
    const suspended = await send(admin, 'patch', `/api/v1/orgs/${orgId}/branches/${mixedBranch}`, { specialtyCodes: ['dentistry'] });
    expect(suspended.status).toBe(404);
  });
});

describe('specialty filters narrow, never widen', () => {
  it('limits practitioners, appointments, queue and counts to the specialty within the caller’s scope', async () => {
    const owner = await register(app, 'filter-owner');
    const created = await newOrg(owner, {
      type: 'medical_center',
      specialtyCodes: ['dentistry', 'physiotherapy'],
      branch: { name: 'North', specialtyCodes: ['dentistry', 'physiotherapy'] },
    });
    const orgId = created.body.organization.id as string;
    const north = created.body.branch.id as string;
    const south = await addBranch(owner, orgId, 'South', ['dentistry', 'physiotherapy']);
    const dentist = await practitioner(owner, orgId, 'dentistry', [north, south]);
    const physio = await practitioner(owner, orgId, 'physiotherapy', [north]);
    // The dentist also works afternoons at South.
    const profile = (await owner.agent.get(`/api/v1/orgs/${orgId}/practitioners/${dentist.id}`)).body.practitioner;
    const hours = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
      { branchId: north, weekday, start: '08:00', end: '11:00' },
      { branchId: south, weekday, start: '11:00', end: '20:00' },
    ]);
    expect((await send(owner, 'put', `/api/v1/orgs/${orgId}/practitioners/${dentist.id}/schedule`, { weeklySchedule: hours, version: profile.version })).status).toBe(200);

    const receptionist = await register(app, 'filter-reception');
    await addMember(owner, orgId, receptionist, 'receptionist', [north]);
    const viewer = await register(app, 'filter-viewer');
    await addMember(owner, orgId, viewer, 'viewer');

    const [p1, p2, p3] = [await createPatient(owner, orgId, north), await createPatient(owner, orgId, north), await createPatient(owner, orgId, south)];
    const dental = await bookOk(owner, orgId, { patientId: p1!, practitionerId: dentist.id, branchId: north, date: TODAY, time: '10:00' });
    await bookOk(owner, orgId, { patientId: p2!, practitionerId: physio.id, branchId: north, date: TODAY, time: '10:00' });
    await bookOk(owner, orgId, { patientId: p3!, practitionerId: dentist.id, branchId: south, date: TODAY, time: '12:00' });
    await act(owner, orgId, dental.id, 'check_in', dental.version);

    const get = (client: Client, path: string, query: Record<string, string> = {}) => client.agent.get(`/api/v1/orgs/${orgId}${path}`).query(query);
    const count = async (client: Client, query: Record<string, string>) => (await get(client, '/appointments', query)).body.data.length as number;

    expect(await count(owner, { specialty: 'dentistry' })).toBe(2);
    expect(await count(owner, { specialty: 'physiotherapy' })).toBe(1);
    expect(await count(owner, { specialty: 'ent' })).toBe(0);
    // A branch-limited receptionist asking for dentistry still sees only their branch.
    expect(await count(receptionist, { specialty: 'dentistry' })).toBe(1);
    expect((await get(receptionist, '/practitioners', { specialty: 'dentistry' })).body.data).toHaveLength(1);
    expect((await get(owner, '/practitioners', { specialty: 'physiotherapy' })).body.data.map((p: { id: string }) => p.id)).toEqual([physio.id]);
    expect((await get(owner, '/queue', { specialty: 'physiotherapy' })).body.waiting).toEqual([]);
    expect((await get(owner, '/queue', { specialty: 'dentistry' })).body.waiting).toHaveLength(1);

    // The doctor's own restriction stays: another specialty yields nothing, not more.
    expect(await count(dentist.doctor, { specialty: 'physiotherapy' })).toBe(0);
    expect(await count(dentist.doctor, { specialty: 'dentistry' })).toBe(2);
    // Viewers: aggregate counts only, narrowed the same way.
    expect((await get(viewer, '/dashboard', { specialty: 'dentistry' })).body.counts).toMatchObject({ scheduled: 1, waiting: 1 });
    expect((await get(viewer, '/dashboard', { specialty: 'physiotherapy' })).body.counts).toMatchObject({ scheduled: 1, waiting: 0 });
    expect((await get(viewer, '/appointments', { specialty: 'dentistry' })).status).toBe(403);
    // Malformed values are rejected, not interpreted.
    expect((await get(owner, '/appointments', { specialty: '$ne' })).status).toBe(400);
    expect((await get(owner, '/queue', { specialty: 'Dentistry' })).status).toBe(400);
  });
});

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

/** Starts `first` until it is held, starts `second`, gives it time to collide, then lets `first` finish. */
async function race<A, B>(held: Gate, first: () => PromiseLike<A>, second: () => PromiseLike<B>): Promise<[A, B]> {
  const a = Promise.resolve(first());
  await Promise.race([held.entered, a]);
  const b = Promise.resolve(second());
  await new Promise((resolve) => setTimeout(resolve, 300));
  held.release();
  return Promise.all([a, b]);
}

describe('concurrent configuration changes', () => {
  // A physiotherapist joining a branch and that branch dropping physiotherapy must never both succeed.
  it('serializes a branch specialty removal with a practitioner assignment, in both orders', async () => {
    const owner = await register(app, 'race-config-owner');
    const created = await newOrg(owner, {
      type: 'medical_center',
      specialtyCodes: ['dentistry', 'physiotherapy'],
      branch: { name: 'First', specialtyCodes: ['dentistry', 'physiotherapy'] },
    });
    const orgId = created.body.organization.id as string;
    const first = created.body.branch.id as string;
    const second = await addBranch(owner, orgId, 'Second', ['dentistry', 'physiotherapy']);
    const assignTo = async (branchId: string) => {
      const doctor = await register(app, 'race-physio');
      const membershipId = await addMember(owner, orgId, doctor, 'doctor', [branchId]);
      return () =>
        send(owner, 'post', `/api/v1/orgs/${orgId}/practitioners`, {
          membershipId,
          specialtyCode: 'physiotherapy',
          branchIds: [branchId],
          defaultDurationMinutes: 30,
        });
    };
    const dropPhysio = (branchId: string) => () => send(owner, 'patch', `/api/v1/orgs/${orgId}/branches/${branchId}`, { specialtyCodes: ['dentistry'] });

    // 1. Assignment first: held after its checks, just before the profile is written.
    const assignFirst = await assignTo(first);
    const heldCreate = gate();
    const create = PractitionerModel.create.bind(PractitionerModel);
    vi.spyOn(PractitionerModel, 'create').mockImplementationOnce((async (...args: Parameters<typeof create>) => {
      await heldCreate.enter();
      return create(...args);
    }) as never);
    const [assigned, dropped] = await race(heldCreate, assignFirst, dropPhysio(first));
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
    expect(dropped.status).toBe(409);
    expect(dropped.body.error.code).toBe('SPECIALTY_IN_USE');

    // 2. Removal first: held at its practitioner check, after taking the configuration lock.
    const assignSecond = await assignTo(second);
    const heldFind = gate();
    const find = PractitionerModel.find.bind(PractitionerModel);
    vi.spyOn(PractitionerModel, 'find').mockImplementationOnce(((...args: Parameters<typeof find>) => {
      const query = find(...args);
      const exec = query.exec.bind(query);
      query.exec = (async () => {
        await heldFind.enter();
        return exec();
      }) as typeof query.exec;
      return query;
    }) as never);
    const [removed, refused] = await race(heldFind, dropPhysio(second), assignSecond);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('SPECIALTY_NOT_OFFERED_AT_BRANCH');
    expect(await PractitionerModel.countDocuments({ organizationId: orgId, specialtyCode: 'physiotherapy', branchIds: second })).toBe(0);
  });
});
