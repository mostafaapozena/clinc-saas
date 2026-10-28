import { pino, type DestinationStream, type Logger } from 'pino';
import type { Env } from './config/env.js';

export function createLogger(env: Pick<Env, 'LOG_LEVEL'>, destination?: DestinationStream): Logger {
  const options = {
    level: env.LOG_LEVEL,
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      'req.headers["x-operator-csrf"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.csrfToken',
    ],
  };
  return destination ? pino(options, destination) : pino(options);
}
