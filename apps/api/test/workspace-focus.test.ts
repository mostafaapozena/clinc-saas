import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, register, send, testApp, type Client } from './helpers/api.js';
import { TOMORROW, act, bookOk, buildClinic, createPatient, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// Role- and specialty-aware workspace (docs/architecture/SPECIALTY_WORKSPACES.md): each role gets
// only its sections; the doctor's worklist comes from their own records and follows the specialty.
const MARK = 'SYNTHETIC-CLINICAL-TEXT';
const app = testApp();
let c: Clinic;
let accountant: Client;
const url = (path: string) => `/api/v1/orgs/${c.orgId}${path}`;
const withKey = (who: Client, path: string, body: object) =>
  who.agent.post(url(path)).set('X-CSRF-Token', who.csrf).set('Idempotency-Key', randomUUID()).send(body);
const focus = async (who: Client) => {
  const res = await who.agent.get(url('/workspace/focus'));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('focus');
  c = await buildClinic(app, 'focus');
  accountant = await register(app, 'focus-accountant');
  await addMember(c.owner, c.orgId, accountant, 'accountant');
  await send(c.owner, 'put', url('/finance/settings'), { currency: 'EGP' });
  await send(c.owner, 'post', url('/accounting/setup'), { cutoverDate: '2026-10-01' });
});
afterAll(() => dropTestDatabase());

describe("today's focus", () => {
  it('gives each role its own sections, and nothing it may not use', async () => {
    const doctor = await focus(c.doctor);
    expect(doctor.clinical).toMatchObject({ specialty: 'dentistry', draftRecords: 0, worklist: { kind: 'dentistry', total: 0 } });
    expect(doctor.finance).toBeUndefined();
    expect(doctor.frontDesk).toBeUndefined();
    const desk = await focus(c.receptionist);
    expect(desk.frontDesk).toMatchObject({ expected: 0, waiting: 0, pendingCharges: 0, cashSession: null });
    expect(desk.clinical).toBeUndefined();
    expect(desk.finance).toBeUndefined();
    const books = await focus(accountant);
    expect(books.finance).toMatchObject({ ledger: true, openReceivables: 0, monthToClose: '2026-10' });
    expect(books.clinical).toBeUndefined();
    const owner = await focus(c.owner);
    expect(owner.approvals).toMatchObject({ purchaseRequests: 0, directBills: 0, settlements: 0 });
    expect(owner.stock).toEqual({ reorder: 0, expiring: 0, organizationLevel: ['reorder'] });
    expect(owner.clinical).toBeUndefined();
    const viewer = await focus(c.viewer);
    expect(Object.keys(viewer)).toEqual(['role', 'branchId']);
    // The doctor's own specialty is part of the workspace, not of their access.
    expect((await c.doctor.agent.get(url(''))).body.membership.practitionerSpecialty).toBe('dentistry');
  });

  it("lists the dentist's patients with open plan items from their own finalized records only", async () => {
    const patient = await createPatient(c.receptionist, c.orgId, c.branchA, 'Plan Patient');
    let a = await bookOk(c.owner, c.orgId, {
      patientId: patient,
      practitionerId: c.practitioner,
      branchId: c.branchA,
      date: '2026-11-10',
      time: '09:00',
    });
    for (const [action, actor] of [
      ['check_in', c.receptionist],
      ['start', c.doctor],
    ] as const)
      a = (await act(actor, c.orgId, a.id, action, a.version)).body.appointment;
    const started = await withKey(c.doctor, `/appointments/${a.id}/encounter`, {
      sections: { reason: `${MARK} reason` },
      specialtyData: { planItems: [{ id: 'pl-333333', tooth: '36', description: `${MARK} crown` }] },
    });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    expect((await focus(c.doctor)).clinical.draftRecords).toBe(1);
    const saved = await send(c.doctor, 'put', url(`/encounters/${started.body.encounter.id}`), {
      sections: { reason: `${MARK} reason`, plan: `${MARK} plan` },
      version: started.body.encounter.version,
    });
    expect((await withKey(c.doctor, `/encounters/${started.body.encounter.id}/finalize`, { version: saved.body.encounter.version })).status).toBe(
      201,
    );
    await bookOk(c.owner, c.orgId, { patientId: patient, practitionerId: c.practitioner, branchId: c.branchA, date: TOMORROW, time: '09:00' });

    const mine = await focus(c.doctor);
    expect(mine.clinical.worklist).toMatchObject({
      kind: 'dentistry',
      total: 1,
      items: [{ patientId: patient, fullName: 'Plan Patient', openPlanItems: 1 }],
    });
    expect(mine.clinical.worklist.items[0].nextVisit).toBeTruthy();
    expect(JSON.stringify(mine)).not.toContain(MARK);
    // Another dentist does not see this doctor's patients; the owner gets no clinical section.
    expect((await focus(c.doctor2)).clinical.worklist.total).toBe(0);
    expect((await focus(c.owner)).clinical).toBeUndefined();
  });

  it("follows the branch chosen in the header, never beyond the member's branches", async () => {
    const patient = await createPatient(c.receptionistB, c.orgId, c.branchB);
    await bookOk(c.receptionistB, c.orgId, {
      patientId: patient,
      practitionerId: c.practitioner,
      branchId: c.branchB,
      date: '2026-11-10',
      time: '16:00',
    });
    const at = async (who: Client, branchId?: string) => who.agent.get(url('/workspace/focus')).query(branchId ? { branchId } : {});
    const all = (await at(c.owner)).body;
    const inB = (await at(c.owner, c.branchB)).body;
    const inA = (await at(c.owner, c.branchA)).body;
    expect(inB.branchId).toBe(c.branchB);
    expect(all.branchId).toBeNull();
    // Branch figures add up to the organization's, and the chosen branch only counts its own.
    expect(inA.frontDesk.expected + inB.frontDesk.expected).toBe(all.frontDesk.expected);
    expect(inB.frontDesk.expected).toBeGreaterThanOrEqual(1);
    expect(inB.finance.organizationLevel).toContain('monthToClose');
    // A receptionist of branch B may narrow to B, not look at A; foreign or malformed ids are refused.
    expect((await at(c.receptionistB, c.branchB)).status).toBe(200);
    expect((await at(c.receptionistB, c.branchA)).status).toBe(404);
    expect((await at(c.owner, '65f0a0a0a0a0a0a0a0a0a0a0')).status).toBe(404);
    expect((await at(c.owner, 'not-an-id')).status).toBe(400);
  });
});
