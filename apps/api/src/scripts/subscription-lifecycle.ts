import { loadEnv } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../db/connection.js';
import { ensureIndexes } from '../db/models.js';
import { processLifecycle } from '../modules/platform/subscription.lifecycle.js';

// Subscription lifecycle pass (docs/architecture/SUBSCRIPTIONS.md#lifecycle): trials and grants
// whose end passed become expired; past-due subscriptions beyond a configured grace period become
// restricted (only if the policy says so). Dry run by default; --apply to change. Safe to run from a
// scheduler on several hosts: every change is a conditional update, so overlaps apply once.
// Usage: npm run ops:subscriptions -w @clinc/api -- [--apply]
const apply = process.argv.includes('--apply');
const env = loadEnv();
await connectDatabase(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME });
try {
  await ensureIndexes();
  const actions = await processLifecycle(apply);
  for (const a of actions) {
    console.log(
      `${a.organizationId}  ${a.from} → ${a.to ?? '(provider decides)'}  ${a.reason}  ${a.applied ? 'applied' : a.conflict ? 'skipped: changed meanwhile' : apply ? 'not applied' : 'dry run'}`,
    );
  }
  console.log(
    `${actions.length} subscription(s) due; ${actions.filter((a) => a.applied).length} changed.${apply ? '' : ' Dry run — nothing changed (use --apply).'}`,
  );
} finally {
  await disconnectDatabase();
}
