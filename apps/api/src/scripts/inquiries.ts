import { loadEnv } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../db/connection.js';
import { parseReviewArgs, runReview } from '../modules/inquiries/inquiry.review.js';

// Operator review of custom-ownership inquiries. Authorization is access to this server's
// environment and database (MONGODB_URI from .env or the environment) — there is no HTTP
// endpoint. Usage: npm run inquiries -w @clinc/api -- help
const command = parseReviewArgs(process.argv.slice(2));
if (command.kind === 'help') {
  for (const line of await runReview(command)) console.log(line);
  process.exit(command.error ? 1 : 0);
}

const env = loadEnv();
await connectDatabase(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME });
try {
  for (const line of await runReview(command)) console.log(line);
} finally {
  await disconnectDatabase();
}
