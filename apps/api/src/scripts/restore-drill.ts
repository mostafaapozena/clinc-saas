import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../db/connection.js';
import { RESTORE_PREFIX, backupDatabase, dropDrillDatabase, restoreInto } from '../modules/ops/backup.js';

// Restore drill (docs/operations/BACKUP_RESTORE.md): restores a backup — or, without --file, a fresh
// backup of the configured database — into a NEW isolated database `clinc_restore_<timestamp>`,
// verifies every collection (document count, content digest, indexes), prints the result and drops
// the drill database unless --keep is given. It never writes to the source database.
// Usage: npm run ops:restore-drill -w @clinc/api -- [--file <backup.jsonl.gz>] [--keep]
const fileIndex = process.argv.indexOf('--file');
const given = fileIndex >= 0 ? process.argv[fileIndex + 1] : undefined;
const keep = process.argv.includes('--keep');

const env = loadEnv();
await connectDatabase(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME });
const target = `${RESTORE_PREFIX}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
const tmp = given ? null : mkdtempSync(path.join(tmpdir(), 'raclinic-drill-'));
let failed: boolean;
try {
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database connection');
  const file = given ? path.resolve(given) : path.join(tmp!, 'backup.jsonl.gz');
  const started = Date.now();
  if (!given) await backupDatabase(db, file);
  const result = await restoreInto(file, target, db.databaseName);
  for (const c of result.collections) {
    console.log(
      `${c.name.padEnd(36)} expected ${String(c.expected).padStart(6)}  restored ${String(c.restored).padStart(6)}  digest ${c.digestMatches ? 'match' : 'MISMATCH'}  indexes ${c.indexesRestored}`,
    );
  }
  console.log(
    `\nRestore drill ${result.ok ? 'PASSED' : 'FAILED'}: ${result.collections.length} collections into "${target}" from "${db.databaseName}" in ${Math.round((Date.now() - started) / 1000)} s.`,
  );
  failed = !result.ok;
} catch (err) {
  failed = true;
  console.error(`Restore drill FAILED: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  if (!keep) await dropDrillDatabase(target).catch(() => undefined);
  else console.log(`Kept "${target}" for inspection; drop it when done.`);
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  await disconnectDatabase();
}
process.exitCode = failed ? 1 : 0;
