import { loadEnv } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../db/connection.js';
import { AUTOMATIC_EXPIRY, retentionReport } from '../modules/ops/retention.js';

// Read-only retention report (docs/operations/RETENTION.md). Deletes nothing.
// Usage: npm run ops:retention-report -w @clinc/api
const env = loadEnv();
await connectDatabase(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME });
try {
  for (const row of await retentionReport(process.env)) {
    const period =
      row.configuredDays === null ? 'not configured (decision E4/P11)' : `${row.configuredDays} days → ${row.olderThanPeriod} older`;
    console.log(`${row.dataClass.padEnd(24)} total ${String(row.total).padStart(7)}  ${period}`);
  }
  console.log('\nAutomatic expiry already in place (no business records):');
  for (const e of AUTOMATIC_EXPIRY) console.log(`  ${e.collection.padEnd(28)} ${e.rule}`);
  console.log('\nNothing was deleted.');
} finally {
  await disconnectDatabase();
}
