import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// src/config (or dist/config) → repository root
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** An empty value in .env (KEY=) means "not set". */
const blankAsUnset = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

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
    BILLING_SIMULATOR_SECRET: blankAsUnset(z.string().min(32)),
    // Stays "off" until the owner decides the commercial enforcement policy (B4).
    SUBSCRIPTION_ENFORCEMENT: z.enum(['off', 'log', 'on']).default('off'),
    // Milestone 5 — sessions, mail boundary, support contact.
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(0).max(1_440).default(120),
    MAIL_PROVIDER: z.enum(['none', 'dev_sink']).default('none'),
    APP_BASE_URL: z
      .string()
      .optional()
      .transform((v) => (v ? v.replace(/\/$/, '') : undefined))
      .refine((v) => v === undefined || (URL.canParse(v) && new URL(v).origin === v), 'must be an origin like https://host'),
    SUPPORT_CONTACT_EMAIL: blankAsUnset(z.email().max(254)),
    SUPPORT_CONTACT_PHONE: blankAsUnset(z.string().regex(/^\+?[0-9 ()-]{6,30}$/)),
    SUPPORT_HOURS_AR: blankAsUnset(z.string().max(120)),
    SUPPORT_HOURS_EN: blankAsUnset(z.string().max(120)),
    // Rate-limit counters: shared in MongoDB by default; "memory" only for a single local process.
    RATE_LIMIT_STORE: z.enum(['mongo', 'memory']).default('mongo'),
    // Load-test process metrics (event loop, memory, CPU) at /api/health/metrics; refused in production.
    OPS_METRICS: z.stringbool().default(false),
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
    if (env.NODE_ENV === 'production' && env.OPS_METRICS) {
      ctx.addIssue({ code: 'custom', path: ['OPS_METRICS'], message: 'is for load tests only and refused in production' });
    }
    if (env.NODE_ENV === 'production' && env.RATE_LIMIT_STORE === 'memory') {
      ctx.addIssue({ code: 'custom', path: ['RATE_LIMIT_STORE'], message: 'must be "mongo" in production (shared across replicas)' });
    }
    if (env.NODE_ENV === 'production' && env.MAIL_PROVIDER === 'dev_sink') {
      ctx.addIssue({ code: 'custom', path: ['MAIL_PROVIDER'], message: 'the development mail sink is refused in production' });
    }
    if (env.NODE_ENV === 'production' && env.MAIL_PROVIDER !== 'none' && !env.APP_BASE_URL) {
      ctx.addIssue({ code: 'custom', path: ['APP_BASE_URL'], message: 'is required in production when mail is enabled' });
    }
    if ((env.SUPPORT_HOURS_AR === undefined) !== (env.SUPPORT_HOURS_EN === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['SUPPORT_HOURS_EN'], message: 'set both SUPPORT_HOURS_AR and SUPPORT_HOURS_EN, or neither' });
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
