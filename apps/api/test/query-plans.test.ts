import { MongoServerError } from 'mongodb';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, runTransaction } from '../src/db/transaction.js';
import { HttpError } from '../src/http/errors.js';
import { AppointmentModel } from '../src/modules/appointments/appointment.model.js';
import { PatientModel } from '../src/modules/patients/patient.model.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// Scalability review: fixes found with the load test and the profiler stay fixed.
beforeAll(() => connectTestDatabase('query_plans'));
afterAll(() => dropTestDatabase());

const winning = (explain: unknown) => JSON.stringify((explain as { queryPlanner: { winningPlan: unknown } }).queryPlanner.winningPlan);

describe('bounded transactions (S4)', () => {
  it('gives up after a few attempts with 409 instead of retrying for minutes', async () => {
    let calls = 0;
    const started = Date.now();
    const transient = () => {
      const err = new MongoServerError({ message: 'Write conflict', code: 112, errorLabels: ['TransientTransactionError'] });
      return err;
    };
    const attempt = runTransaction(async () => {
      calls += 1;
      throw transient();
    });
    await expect(attempt).rejects.toSatisfy((e: unknown) => e instanceof HttpError && e.status === 409 && e.code === 'CONCURRENT_UPDATE');
    expect(calls).toBe(MAX_ATTEMPTS);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('still commits normally and passes non-transient errors through at once', async () => {
    expect(await runTransaction(async () => 'ok')).toBe('ok');
    let calls = 0;
    await expect(
      runTransaction(async () => {
        calls += 1;
        throw new HttpError(400, 'VALIDATION_ERROR', 'no');
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(calls).toBe(1);
  });
});

describe('index-eligible lookups (S5) and hinted lists (S3)', () => {
  it('the booking idempotency lookup uses its partial unique index', async () => {
    await AppointmentModel.init();
    const org = new mongoose.Types.ObjectId();
    const filter = {
      organizationId: org,
      createdBy: new mongoose.Types.ObjectId(),
      idempotencyKey: { $eq: 'key-123456', $type: 'string' as const },
    };
    const plan = winning(await AppointmentModel.find(filter).limit(1).explain('queryPlanner'));
    expect(plan).toContain('organizationId_1_createdBy_1_idempotencyKey_1');
  });

  it('the recent-first patient list can be served in index order (no blocking sort)', async () => {
    await PatientModel.init();
    const org = new mongoose.Types.ObjectId();
    const plan = winning(
      await PatientModel.find({ organizationId: org, $and: [{ registrations: { $elemMatch: { status: 'active' } } }] }, null, {
        hint: { organizationId: 1, createdAt: -1, _id: -1 },
      })
        .sort({ createdAt: -1, _id: -1 })
        .limit(20)
        .explain('queryPlanner'),
    );
    expect(plan).toContain('organizationId_1_createdAt_-1__id_-1');
    expect(plan).not.toContain('"stage":"SORT"');
  });
});
