import { describe, expect, it, vi } from 'vitest';
import { ApiError, api, setCsrfToken } from './api';

describe('api client', () => {
  it('sends the CSRF token on mutations only, with same-origin credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('csrf-123');

    await api('/things');
    await api('/things', { method: 'POST', body: { a: 1 } });

    const [, getInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [url, postInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((getInit.headers as Record<string, string>)['X-CSRF-Token']).toBeUndefined();
    expect(url).toBe('/api/v1/things');
    expect(postInit.credentials).toBe('same-origin');
    expect((postInit.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-123');
    expect(postInit.body).toBe('{"a":1}');
  });

  it('turns error payloads into ApiError with code and field errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({ error: { code: 'VALIDATION_ERROR', message: 'x', fields: { email: 'invalid_format' } } }, { status: 400 }),
      ),
    );
    const error = await api('/x', { method: 'POST', body: {} }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', fields: { email: 'invalid_format' } });
  });

  it('reports network failures and non-JSON errors with stable codes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<h1>Bad gateway</h1>', { status: 502 })));
    await expect(api('/x')).rejects.toMatchObject({ code: 'UNKNOWN', status: 502 });
  });
});
