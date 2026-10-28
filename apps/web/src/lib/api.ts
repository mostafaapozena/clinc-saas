// Same-origin JSON client for /api/v1. Sends the session's CSRF token on every mutation;
// the session itself travels only in the HttpOnly cookie (never stored by this code).

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  /** Extra data the API sends to resolve an error (e.g. conflicting appointments). */
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields: Record<string, string> = {},
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
  }
}

let csrfToken: string | null = null;

/** Kept in memory only; re-read from GET /auth/session after a reload. */
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** A file sent as the raw body with its own type (e.g. an image upload) instead of JSON. */
  raw?: Blob;
};

type ErrorPayload = {
  error?: { code?: string; message?: string; fields?: Record<string, string>; details?: Record<string, unknown> };
};

export async function api<T>(path: string, { method = 'GET', body, signal, headers: extra, raw }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...extra };
  if (raw) headers['Content-Type'] = raw.type;
  else if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      credentials: 'same-origin',
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Network request failed');
  }

  if (res.status === 204) return undefined as T;
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // Non-JSON body (e.g. a proxy error page).
  }
  if (!res.ok) {
    const error = (payload as ErrorPayload | null)?.error;
    throw new ApiError(
      res.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? `HTTP ${res.status}`,
      error?.fields ?? {},
      error?.details ?? {},
    );
  }
  return payload as T;
}

/** Builds a query string from defined values only. */
export function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
