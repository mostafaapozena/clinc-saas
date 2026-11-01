import { createApp } from './app.js';
import { appConfigFromEnv } from './config/app-config.js';
import { loadEnv } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/connection.js';
import { ensureIndexes } from './db/models.js';
import { createLogger } from './logger.js';
import { lifecycle } from './modules/health/lifecycle.js';
import { setClockOffset } from './time/clock.js';

const env = loadEnv();
setClockOffset(env.CLOCK_OFFSET_MS);
const logger = createLogger(env);

try {
  const { connection } = await connectDatabase(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME });
  await ensureIndexes();
  logger.info({ database: connection.name }, 'Connected to MongoDB');
} catch (err) {
  logger.fatal({ err }, 'Could not connect to MongoDB — is the database running?');
  process.exit(1);
}

const server = createApp({ logger, config: appConfigFromEnv(env) }).listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT}`);
});

const SHUTDOWN_GRACE_MS = 10_000;
let stopping = false;

function shutdown(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  // Readiness turns 503 at once; in-flight requests finish; idle keep-alive sockets close now.
  lifecycle.shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  setTimeout(() => {
    logger.error('Graceful shutdown timed out; exiting');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS).unref();
  server.closeIdleConnections();
  server.close(() => {
    disconnectDatabase()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        logger.error({ err }, 'Error while disconnecting from MongoDB');
        process.exit(1);
      });
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
