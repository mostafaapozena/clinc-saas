import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/connection.js';
import { createLogger } from './logger.js';

const env = loadEnv();
const logger = createLogger(env);

try {
  const { connection } = await connectDatabase(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME });
  logger.info({ database: connection.name }, 'Connected to MongoDB');
} catch (err) {
  logger.fatal({ err }, 'Could not connect to MongoDB — is the database running?');
  process.exit(1);
}

const server = createApp({ logger }).listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT}`);
});

function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, 'Shutting down');
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
