import path from 'node:path';
import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../db/connection.js';
import { backupDatabase } from '../modules/ops/backup.js';

// Logical backup of the configured database (docs/operations/BACKUP_RESTORE.md).
// Usage: npm run ops:backup -w @clinc/api -- --out /secure/path/raclinic-YYYYMMDD.jsonl.gz
// The file contains all data in clear text: store it encrypted, outside the repository.
const outIndex = process.argv.indexOf('--out');
const out = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
if (!out) {
  console.error('Usage: npm run ops:backup -w @clinc/api -- --out <file.jsonl.gz>');
  process.exit(1);
}
const env = loadEnv();
await connectDatabase(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME });
try {
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database connection');
  const header = await backupDatabase(db, path.resolve(out));
  const total = header.collections.reduce((n, c) => n + c.count, 0);
  console.log(`Backed up ${header.collections.length} collections (${total} documents) of "${header.database}" to ${path.resolve(out)}.`);
} finally {
  await disconnectDatabase();
}
