import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backfillPatientNameTokens, backfillPatientPhoneTails } from '../src/modules/patients/name-tokens.backfill.js';
import { nameKey, nameTokens } from '../src/modules/patients/normalize.js';
import { PatientModel } from '../src/modules/patients/patient.model.js';
import { COUNT_CAP } from '../src/modules/patients/patient.routes.js';
import { seedSpecialties } from '../src/modules/specialties/specialty.seed.js';
import { createOrg, register, send, testApp, type Client } from './helpers/api.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// Scalability review S1/S2: bounded counts and indexed word-prefix name search.
const app = testApp();
let owner: Client;
let orgId: string;
let branchId: string;

beforeAll(async () => {
  await connectTestDatabase('patient_search_scale');
  await seedSpecialties();
  owner = await register(app, 'scale-owner');
  ({ orgId, branchId } = await createOrg(owner, 'Scale Clinic'));
  const org = new mongoose.Types.ObjectId(orgId);
  const by = new mongoose.Types.ObjectId(owner.userId);
  const now = new Date();
  const docs = Array.from({ length: COUNT_CAP + 50 }, (_, i) => {
    const fullName = i === 0 ? 'محمد أحمد سالم' : `Synthetic Patient ${i}`;
    return {
      organizationId: org,
      patientNumber: i + 1,
      fullName,
      nameKey: nameKey(fullName),
      nameTokens: nameTokens(nameKey(fullName)),
      phone: { country: 'EG', e164: `+2010${String(10_000_000 + i)}` },
      secondaryPhone: null,
      email: null,
      dateOfBirth: null,
      sex: 'unspecified',
      address: null,
      registrations: [
        { branchId: new mongoose.Types.ObjectId(branchId), status: 'active', registeredAt: now, registeredBy: by, archivedAt: null },
      ],
      version: 0,
      scheduleSeq: 0,
      createdBy: by,
      updatedBy: by,
      createdAt: now,
      updatedAt: now,
    };
  });
  await mongoose.connection.db!.collection('patients').insertMany(docs);
  // Keep the patient-number sequence in step with the bulk insert (as real creation does).
  await mongoose.connection
    .db!.collection('counters')
    .updateOne({ organizationId: org, key: 'patient' }, { $set: { seq: docs.length } }, { upsert: true });
});
afterAll(() => dropTestDatabase());

describe('patient list at scale', () => {
  it('stops counting at the cap and says so', async () => {
    const res = await owner.agent.get(`/api/v1/orgs/${orgId}/patients`);
    expect(res.body).toMatchObject({ total: COUNT_CAP, totalCapped: true });
    const small = await owner.agent.get(`/api/v1/orgs/${orgId}/patients?q=${encodeURIComponent('محمد')}`);
    expect(small.body).toMatchObject({ total: 1, totalCapped: false });
  });

  it('matches every typed word against the start of a name word, in any order, with Arabic normalization', async () => {
    const find = async (q: string) =>
      (await owner.agent.get(`/api/v1/orgs/${orgId}/patients?q=${encodeURIComponent(q)}`)).body.data.map(
        (p: { fullName: string }) => p.fullName,
      );
    expect(await find('محم')).toEqual(['محمد أحمد سالم']);
    expect(await find('احمد محمد')).toEqual(['محمد أحمد سالم']); // أ normalized to ا, order free
    expect(await find('سال')).toEqual(['محمد أحمد سالم']);
    // Word-prefix, not substring: the middle of a word does not match (documented behavior change).
    expect(await find('حمد')).toEqual([]);
    expect(await find('محمد خالد')).toEqual([]);
  });

  it('new and renamed patients get search tokens; the backfill fills older ones idempotently', async () => {
    const created = await send(owner, 'post', `/api/v1/orgs/${orgId}/patients`, {
      fullName: 'ليلى حسن',
      phone: { country: 'EG', number: '01099999999' },
      branchId,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.patient.id;
    expect((await PatientModel.findOne({ _id: id, organizationId: orgId }).lean())?.nameTokens).toEqual(['ليلي', 'حسن']);
    const current = await owner.agent.get(`/api/v1/orgs/${orgId}/patients/${id}`);
    await send(owner, 'patch', `/api/v1/orgs/${orgId}/patients/${id}`, {
      fullName: 'ليلى حسن كمال',
      version: current.body.patient.version,
    });
    expect((await PatientModel.findOne({ _id: id, organizationId: orgId }).lean())?.nameTokens).toEqual(['ليلي', 'حسن', 'كمال']);

    await mongoose.connection
      .db!.collection('patients')
      .updateMany({ organizationId: new mongoose.Types.ObjectId(orgId), patientNumber: { $lte: 10 } }, { $unset: { nameTokens: '' } });
    expect(await backfillPatientNameTokens(3)).toBe(10);
    expect(await backfillPatientNameTokens()).toBe(0);
    expect((await owner.agent.get(`/api/v1/orgs/${orgId}/patients?q=${encodeURIComponent('محمد')}`)).body.total).toBe(1);
  });

  it('finds a patient by the last digits of either phone number and by "#file number"', async () => {
    const created = await send(owner, 'post', `/api/v1/orgs/${orgId}/patients`, {
      fullName: 'سارة يوسف',
      phone: { country: 'EG', number: '01001234509' },
      secondaryPhone: { country: 'EG', number: '01112223334' },
      branchId,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const { id, patientNumber, version } = created.body.patient;
    const names = async (q: string) =>
      (await owner.agent.get(`/api/v1/orgs/${orgId}/patients?q=${encodeURIComponent(q)}`)).body.data.map((p: { fullName: string }) => p.fullName);
    expect(await names('1234509')).toEqual(['سارة يوسف']);
    expect(await names('٤٥٠٩')).toEqual(['سارة يوسف']); // Arabic-Indic digits
    expect(await names('2223334')).toEqual(['سارة يوسف']); // secondary number
    expect(await names('509')).not.toContain('سارة يوسف'); // under 4 digits it is a file number only
    expect(await names(`#${patientNumber}`)).toEqual(['سارة يوسف']);

    // A changed number replaces its endings.
    const changed = await send(owner, 'patch', `/api/v1/orgs/${orgId}/patients/${id}`, { phone: { country: 'EG', number: '01009876543' }, version });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(await names('1234509')).toEqual([]);
    expect(await names('9876543')).toEqual(['سارة يوسف']);
    expect(await names('2223334')).toEqual(['سارة يوسف']);
  });

  it('backfills phone endings for older patients idempotently, and the lookup uses its index', async () => {
    // The bulk-inserted patients were written without endings, as before this change.
    expect(await backfillPatientPhoneTails(200)).toBeGreaterThanOrEqual(COUNT_CAP);
    expect(await backfillPatientPhoneTails()).toBe(0);
    const res = await owner.agent.get(`/api/v1/orgs/${orgId}/patients?q=010000007`);
    expect(res.body.data.map((p: { fullName: string }) => p.fullName)).toEqual(['Synthetic Patient 7']);
    const explain = (await PatientModel.find({ organizationId: new mongoose.Types.ObjectId(orgId), phoneTails: '010000007' }).explain(
      'executionStats',
    )) as unknown as { executionStats: { totalDocsExamined: number } };
    expect(explain.executionStats.totalDocsExamined).toBeLessThan(5);
  });

  it('uses indexes for the name search and the capped count (no organization-wide scan)', async () => {
    const filter = {
      organizationId: new mongoose.Types.ObjectId(orgId),
      $and: [{ $or: [{ $and: [{ nameTokens: { $regex: '^محم' } }] }] }],
    };
    const explain = (await PatientModel.find(filter).sort({ createdAt: -1 }).limit(20).explain('executionStats')) as unknown as {
      executionStats: { totalDocsExamined: number };
    };
    expect(explain.executionStats.totalDocsExamined).toBeLessThan(10);
  });
});
