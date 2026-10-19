import { pino, type Logger } from 'pino';
import type { Env } from './config/env.js';

export function createLogger(env: Pick<Env, 'LOG_LEVEL'>): Logger {
  return pino({
    level: env.LOG_LEVEL,
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
    ],
  });
}
