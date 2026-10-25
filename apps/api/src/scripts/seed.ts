import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../db/connection.js';
import { ensureIndexes } from '../db/models.js';
import { seedDemoData } from '../modules/demo/demo.seed.js';
import { seedPlatformData } from '../modules/platform/platform.seed.js';
import { seedSpecialties } from '../modules/specialties/specialty.seed.js';

// Usage: npm run seed [-- --reset]   (development and tests only)
const env = loadEnv();
const reset = process.argv.includes('--reset');

if (env.NODE_ENV === 'production') {
  console.error('Refusing to seed synthetic data when NODE_ENV=production.');
  process.exit(1);
}

const providedPassword = process.env.DEMO_PASSWORD;
if (providedPassword !== undefined && providedPassword.length < 10) {
  console.error('DEMO_PASSWORD must be at least 10 characters.');
  process.exit(1);
}
const password = providedPassword || randomBytes(12).toString('base64url');

await connectDatabase(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME });
try {
  const dbName = mongoose.connection.name;
  if (reset) {
    await mongoose.connection.dropDatabase();
    console.log(`Dropped database "${dbName}".`);
  }
  await ensureIndexes();
  const specialties = await seedSpecialties();
  const { accounts, skippedAppointments } = await seedDemoData(password);
  const platform = await seedPlatformData(password);

  console.log(`Seeded ${specialties} specialties and demo data into "${dbName}".`);
  if (skippedAppointments.length > 0) {
    console.log(`Skipped ${skippedAppointments.length} demo appointment(s): ${skippedAppointments.join(', ')}`);
  }
  console.log('\nDemo accounts (synthetic, development only — refused when NODE_ENV=production):');
  for (const account of accounts) console.log(`  ${account.email.padEnd(26)} ${account.summary}`);
  console.log('\nPlatform operators (synthetic, development only; sign in at /operator):');
  for (const operator of platform.operators) console.log(`  ${operator.email.padEnd(26)} ${operator.role}`);
  console.log(`Development grants created for ${platform.grants} demo organization(s).`);
  if (providedPassword) {
    console.log('\nPassword for all demo accounts: the DEMO_PASSWORD value from your environment.');
  } else {
    console.log(`\nPassword for all demo accounts (generated now, shown only here): ${password}`);
    console.log('Set DEMO_PASSWORD in .env to keep a stable development password.');
  }
} finally {
  await disconnectDatabase();
}
