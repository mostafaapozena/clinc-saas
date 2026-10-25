// Client for the platform operator console (/api/v1/platform). Deliberately separate from the
// tenant client: its own CSRF token (X-Operator-CSRF, memory only) and its own error class, so an
// operator 401 never signs a clinic user out and a tenant session never reaches the console.
import { ApiError } from './api';

export class OperatorApiError extends ApiError {
  readonly operator = true;
}

let operatorCsrf: string | null = null;
export function setOperatorCsrf(token: string | null) {
  operatorCsrf = token;
}

export async function opApi<T>(
  path: string,
  { method = 'GET', body, signal }: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT'; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && operatorCsrf) headers['X-Operator-CSRF'] = operatorCsrf;
  let res: Response;
  try {
    res = await fetch(`/api/v1/platform${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new OperatorApiError(0, 'NETWORK_ERROR', 'Network request failed');
  }
  if (res.status === 204) return undefined as T;
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // Non-JSON body.
  }
  if (!res.ok) {
    const error = (
      payload as { error?: { code?: string; message?: string; fields?: Record<string, string>; details?: Record<string, unknown> } } | null
    )?.error;
    throw new OperatorApiError(
      res.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? `HTTP ${res.status}`,
      error?.fields ?? {},
      error?.details ?? {},
    );
  }
  return payload as T;
}

export const OPERATOR_SESSION_KEY = ['operator', 'session'] as const;
export const opKeys = {
  overview: ['operator', 'overview'] as const,
  organizations: (q: string) => ['operator', 'organizations', q] as const,
  organization: (id: string) => ['operator', 'organization', id] as const,
  plans: ['operator', 'plans'] as const,
  inquiries: (status: string) => ['operator', 'inquiries', status] as const,
  inquiry: (ref: string) => ['operator', 'inquiry', ref] as const,
  operators: ['operator', 'operators'] as const,
  audit: ['operator', 'audit'] as const,
  events: ['operator', 'events'] as const,
};

export type OperatorRole = 'platform_admin' | 'support';
export type OperatorSession = { id: string; email: string; displayName: string; role: OperatorRole; permissions: string[] };

export type PlanPrice = { currency: 'EGP' | 'SAR'; interval: 'month' | 'year'; amountMinor: number };
export type PlanLimits = { branches: number | null; practitioners: number | null; members: number | null };
export type Plan = {
  id: string;
  code: string;
  version: number;
  name: { ar: string; en: string };
  status: 'draft' | 'active' | 'retired';
  prices: PlanPrice[];
  limits: PlanLimits;
  note?: string;
  revision?: number;
  /** Trial length offered with the plan; null = no trial. */
  trialDays?: number | null;
};

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'restricted' | 'canceled' | 'expired';
export type EffectiveStatus = SubscriptionStatus | 'none';
export type BillingPolicy = { graceDays: number | null; afterGrace: 'none' | 'restricted'; restrictedAccess: 'growth_only' | 'read_only'; revision?: number };
export type Subscription = {
  id: string;
  kind: 'development_grant' | 'commercial';
  status: SubscriptionStatus;
  effectiveStatus: EffectiveStatus;
  plan: { id: string; code: string; version: number; name: { ar: string; en: string } | null };
  limits: PlanLimits | null;
  currentPeriodEnd: string | null;
  price: PlanPrice | null;
  provider: 'simulator' | null;
  restriction: { reason: string; at: string } | null;
  trialEndsAt?: string | null;
  trialUsed?: boolean;
  pastDueSince?: string | null;
  /** Local intent; providerAcknowledged = the provider (today: the simulator) holds the same schedule. */
  cancelRequest?: { requestedAt: string; reason: string; providerAcknowledged: boolean } | null;
  pendingChange?: {
    plan: { id: string; code: string; version: number };
    price: PlanPrice;
    effectiveAt: string;
    requestedAt: string;
    providerAcknowledged: boolean;
  } | null;
  version: number;
  updatedAt: string;
};
export type Usage = { branches: number; practitioners: number; members: number };
export type Checkout = {
  id: string;
  plan: { code: string; version: number };
  price: PlanPrice;
  status: 'open' | 'completed' | 'failed' | 'expired';
  provider: string;
  simulated: boolean;
  expiresAt: string;
};

export const planName = (plan: { name: { ar: string; en: string } | null; code: string }, language: string) =>
  plan.name ? (language === 'en' ? plan.name.en : plan.name.ar) : plan.code;
