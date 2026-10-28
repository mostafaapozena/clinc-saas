import { randomBytes } from 'node:crypto';
import type { Env } from './env.js';

/** Runtime settings the HTTP app needs. Tests override individual values. */
export type AppConfig = {
  production: boolean;
  sessionTtlHours: number;
  cookieSecure: boolean;
  trustProxy: boolean;
  /** Extra origins allowed to send state-changing requests besides the request's own host. */
  allowedOrigins: string[];
  authRateLimit: { max: number; windowMs: number };
  /** Organization creation and onboarding completion, per IP. */
  setupRateLimit: { max: number; windowMs: number };
  /** Anonymous custom-ownership inquiries, per IP. */
  inquiryRateLimit: { max: number; windowMs: number };
  /**
   * Whether a `clinical_lead` capability may be assigned and used to grant coverage for another
   * doctor's records. Off until the owner decides who holds that authority (blocker B1).
   */
  clinicalLeadGrantsEnabled: boolean;
  /** Platform subscription payments: 'none', or the clearly labelled simulator (never in production). */
  billingProvider: 'none' | 'simulator';
  /** HMAC secret of the simulator's webhooks; random per process unless configured. */
  billingSimulatorSecret: string;
  /** Entitlement enforcement: off (default), log (audit only) or on — on only after decision B4. */
  subscriptionEnforcement: 'off' | 'log' | 'on';
  /** Tenant sessions end after this many minutes without a request (0 = no idle timeout). */
  sessionIdleMinutes: number;
  /** Mail boundary: 'none' (default, nothing sent) or the development mail sink (never in production). */
  mailProvider: 'none' | 'dev_sink';
  /** Origin used in links inside emails, e.g. https://app.example.com ('' = relative links). */
  appBaseUrl: string;
  /** Support contact details shown in the app — only what is configured, nothing invented. */
  supportContact: { email: string | null; phone: string | null; hours: { ar: string; en: string } | null };
  /** Where rate-limit counters live: 'mongo' (shared by all replicas) or 'memory' (single-process tests only). */
  rateLimitStore: 'mongo' | 'memory';
  /** Exposes /api/health/metrics (event loop, memory, CPU) for load tests; never in production. */
  opsMetrics: boolean;
};

export const defaultAppConfig: AppConfig = {
  production: false,
  sessionTtlHours: 168,
  cookieSecure: false,
  trustProxy: false,
  allowedOrigins: [],
  authRateLimit: { max: 10, windowMs: 15 * 60_000 },
  setupRateLimit: { max: 20, windowMs: 60 * 60_000 },
  inquiryRateLimit: { max: 5, windowMs: 60 * 60_000 },
  clinicalLeadGrantsEnabled: false,
  billingProvider: 'none',
  billingSimulatorSecret: randomBytes(32).toString('hex'),
  subscriptionEnforcement: 'off',
  sessionIdleMinutes: 120,
  mailProvider: 'none',
  appBaseUrl: '',
  supportContact: { email: null, phone: null, hours: null },
  rateLimitStore: 'mongo',
  opsMetrics: false,
};

export function appConfigFromEnv(env: Env): AppConfig {
  return {
    production: env.NODE_ENV === 'production',
    sessionTtlHours: env.SESSION_TTL_HOURS,
    cookieSecure: env.SESSION_COOKIE_SECURE,
    trustProxy: env.TRUST_PROXY,
    allowedOrigins: env.APP_ORIGINS,
    authRateLimit: {
      max: env.AUTH_RATE_LIMIT_MAX,
      windowMs: env.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60_000,
    },
    setupRateLimit: { max: env.SETUP_RATE_LIMIT_MAX, windowMs: 60 * 60_000 },
    inquiryRateLimit: { max: env.INQUIRY_RATE_LIMIT_MAX, windowMs: 60 * 60_000 },
    clinicalLeadGrantsEnabled: env.CLINICAL_LEAD_GRANTS_ENABLED,
    billingProvider: env.BILLING_PROVIDER,
    billingSimulatorSecret: env.BILLING_SIMULATOR_SECRET ?? randomBytes(32).toString('hex'),
    subscriptionEnforcement: env.SUBSCRIPTION_ENFORCEMENT,
    sessionIdleMinutes: env.SESSION_IDLE_MINUTES,
    mailProvider: env.MAIL_PROVIDER,
    appBaseUrl: env.APP_BASE_URL ?? '',
    supportContact: {
      email: env.SUPPORT_CONTACT_EMAIL ?? null,
      phone: env.SUPPORT_CONTACT_PHONE ?? null,
      hours: env.SUPPORT_HOURS_AR && env.SUPPORT_HOURS_EN ? { ar: env.SUPPORT_HOURS_AR, en: env.SUPPORT_HOURS_EN } : null,
    },
    rateLimitStore: env.RATE_LIMIT_STORE,
    opsMetrics: env.OPS_METRICS,
  };
}
