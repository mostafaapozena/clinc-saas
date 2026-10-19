import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';
import { checkDatabase, connectDatabase, disconnectDatabase } from '../db/connection.js';

const env = loadEnv();

try {
  await connectDatabase(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME });
  const health = await checkDatabase();
  const info = await mongoose.connection.db?.admin().serverInfo();
  console.log(
    `MongoDB ${info?.version ?? 'unknown'} — database "${mongoose.connection.name}" — ` +
      `ping ${health.status} (${health.latencyMs ?? '-'} ms)`,
  );
  process.exitCode = health.status === 'up' ? 0 : 1;
} catch (err) {
  console.error('MongoDB connection failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
