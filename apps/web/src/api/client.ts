// Mirrors the API response shapes. Move to a shared package once more modules exist.
export type HealthResponse = {
  status: 'ok' | 'degraded';
  service: string;
  uptimeSeconds: number;
  database: { status: 'up' | 'down'; latencyMs: number | null };
  timestamp: string;
};

export type ApiStatus =
  | { state: 'connected'; health: HealthResponse }
  | { state: 'degraded'; health: HealthResponse }
  | { state: 'unreachable'; reason: string };

export type Specialty = {
  code: string;
  name: { ar: string; en: string };
};

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Never throws for network/server problems — they become an `unreachable` status. */
export async function fetchApiStatus(signal?: AbortSignal): Promise<ApiStatus> {
  try {
    const res = await fetch('/api/health', { signal, headers: { Accept: 'application/json' } });
    const health = (await res.json()) as HealthResponse;
    if (res.ok && health.status === 'ok') return { state: 'connected', health };
    if (res.status === 503 && health.status === 'degraded') return { state: 'degraded', health };
    return { state: 'unreachable', reason: `HTTP ${res.status}` };
  } catch (error) {
    if (isAbort(error)) throw error;
    return {
      state: 'unreachable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function fetchSpecialties(signal?: AbortSignal): Promise<Specialty[]> {
  const res = await fetch('/api/v1/specialties', {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { data: Specialty[] };
  return body.data;
}
