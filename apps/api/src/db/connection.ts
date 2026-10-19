import mongoose from 'mongoose';

export type DatabaseHealth = {
  status: 'up' | 'down';
  latencyMs: number | null;
};

export async function connectDatabase(uri: string, options: { dbName?: string } = {}) {
  return mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5_000,
    ...(options.dbName ? { dbName: options.dbName } : {}),
  });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

/** Performs a real round trip to MongoDB rather than trusting the cached connection state. */
export async function checkDatabase(): Promise<DatabaseHealth> {
  const { db, readyState } = mongoose.connection;
  if (readyState !== mongoose.ConnectionStates.connected || !db) {
    return { status: 'down', latencyMs: null };
  }
  const started = performance.now();
  try {
    await db.admin().ping();
    return { status: 'up', latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { status: 'down', latencyMs: null };
  }
}
