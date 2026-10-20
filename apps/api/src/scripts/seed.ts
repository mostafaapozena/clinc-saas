import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../db/connection.js';
import { seedSpecialties } from '../modules/specialties/specialty.seed.js';

const env = loadEnv();

if (env.NODE_ENV === 'production') {
  console.error('Refusing to seed synthetic data when NODE_ENV=production.');
  process.exit(1);
}

await connectDatabase(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME });
try {
  const count = await seedSpecialties();
  console.log(`Seeded ${count} specialties into database "${mongoose.connection.name}".`);
} finally {
  await disconnectDatabase();
}
