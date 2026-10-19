import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// src/config (or dist/config) → repository root
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  MONGODB_URI: z
    .string()
    .regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),
  MONGODB_DB_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, 'may only contain letters, digits, "_" and "-"')
    .optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Loads the repository-root .env (if present) without overriding real environment variables. */
export function loadEnv(): Env {
  dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });
  return parseEnv(process.env);
}
