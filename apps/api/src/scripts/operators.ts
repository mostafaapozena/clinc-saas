import { loadEnv } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../db/connection.js';
import { ensureIndexes } from '../db/models.js';
import { parseOperatorArgs, runOperatorsCommand } from '../modules/platform/operator.cli.js';

// Platform operator provisioning — the only way to create operators (no public registration).
// Usage: npm run operators -w @clinc/api -- help
const command = parseOperatorArgs(process.argv.slice(2));
if (command.kind === 'help') {
  for (const line of await runOperatorsCommand(command)) console.log(line);
  process.exit(command.error ? 1 : 0);
}

const env = loadEnv();
await connectDatabase(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME });
try {
  await ensureIndexes();
  const lines = await runOperatorsCommand(command, { OPERATOR_PASSWORD: process.env.OPERATOR_PASSWORD });
  for (const line of lines) console.log(line);
  if (lines[0]?.startsWith('Error')) process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
