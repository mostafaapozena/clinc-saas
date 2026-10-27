import { loadEnv } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../db/connection.js';
import { ensureIndexes } from '../db/models.js';
import { backfillPatientNameTokens, backfillPatientPhoneTails } from '../modules/patients/name-tokens.backfill.js';

// Migration for the indexed patient name search (docs/architecture/SCALABILITY_REVIEW.md, S2) and
// the "last digits" phone search. Safe to run while the API serves. Until it has run, patients
// created before the change are found by number and full phone, but not by name or last digits.
// Usage: npm run ops:backfill-patient-search -w @clinc/api
const env = loadEnv();
await connectDatabase(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME });
try {
  await ensureIndexes();
  console.log(`Backfilled name search tokens for ${await backfillPatientNameTokens()} patient(s).`);
  console.log(`Backfilled phone endings for ${await backfillPatientPhoneTails()} patient(s).`);
} finally {
  await disconnectDatabase();
}
