import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/db/connection.js';

const TEST_DB_MARKER = '_test_';

/** Connects to a fresh, uniquely named database that is dropped by `dropTestDatabase`. */
export async function connectTestDatabase(label: string): Promise<string> {
  const uri = process.env.MONGODB_TEST_URI ?? 'mongodb://localhost:27017';
  const dbName = `clinc${TEST_DB_MARKER}${label}_${process.pid}_${Date.now()}`;
  await connectDatabase(uri, { dbName });
  return dbName;
}

export async function dropTestDatabase(): Promise<void> {
  const { name } = mongoose.connection;
  // Guard: never drop anything that is not a throwaway test database.
  if (!name.includes(TEST_DB_MARKER)) {
    throw new Error(`Refusing to drop non-test database "${name}"`);
  }
  await mongoose.connection.dropDatabase();
  await disconnectDatabase();
}
