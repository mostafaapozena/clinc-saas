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
  };
}
