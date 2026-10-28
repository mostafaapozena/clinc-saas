import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// src/config (or dist/config) → repository root
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const envSchema = z
  .object({
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
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
    SESSION_COOKIE_SECURE: z.stringbool().default(false),
    TRUST_PROXY: z.stringbool().default(false),
    APP_ORIGINS: z
      .string()
      .default('')
      .transform((value, ctx) => {
        const origins = value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean);
        for (const origin of origins) {
          if (!URL.canParse(origin) || new URL(origin).origin !== origin) {
            ctx.addIssue({ code: 'custom', message: 'each entry must be an origin like https://host' });
          }
        }
        return origins;
      }),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(10),
    AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1_440).default(15),
    // Per IP and hour.
    SETUP_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(20),
    INQUIRY_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(5),
    // Off until the owner decides who may grant coverage for an unavailable doctor (B1).
    CLINICAL_LEAD_GRANTS_ENABLED: z.stringbool().default(false),
    // Platform subscriptions (milestone 4). The simulator is for development and tests only.
    BILLING_PROVIDER: z.enum(['none', 'simulator']).default('none'),
    BILLING_SIMULATOR_SECRET: z.string().min(32).optional(),
    // Stays "off" until the owner decides the commercial enforcement policy (B4).
    SUBSCRIPTION_ENFORCEMENT: z.enum(['off', 'log', 'on']).default('off'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.SESSION_COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_COOKIE_SECURE'],
        message: 'must be true in production (cookies may only travel over HTTPS)',
      });
    }
    if (env.NODE_ENV === 'production' && env.BILLING_PROVIDER === 'simulator') {
      ctx.addIssue({
        code: 'custom',
        path: ['BILLING_PROVIDER'],
        message: 'the payment simulator is refused in production',
      });
    }
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
