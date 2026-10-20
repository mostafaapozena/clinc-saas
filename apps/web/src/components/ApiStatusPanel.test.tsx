import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiStatusPanel } from './ApiStatusPanel';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const healthy = {
  status: 'ok',
  service: 'clinc-saas-api',
  uptimeSeconds: 5,
  database: { status: 'up', latencyMs: 3 },
  timestamp: '2026-01-01T00:00:00.000Z',
};

describe('ApiStatusPanel', () => {
  it('shows connected when the API and database are healthy', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, healthy));
    vi.stubGlobal('fetch', fetchMock);

    render(<ApiStatusPanel />);

    const badge = screen.getByTestId('api-status');
    expect(badge).toHaveAttribute('data-state', 'checking');
    expect(await screen.findByText('متصل')).toHaveAttribute('data-state', 'connected');
    expect(screen.getByTestId('db-status')).toHaveTextContent('متصلة');
    expect(screen.getByText(/3 مللي ثانية/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.anything());
  });

  it('shows degraded when the API is up but the database is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(503, { ...healthy, status: 'degraded', database: { status: 'down', latencyMs: null } }),
      ),
    );

    render(<ApiStatusPanel />);

    expect(await screen.findByText('يعمل، لكن قاعدة البيانات غير متاحة')).toHaveAttribute('data-state', 'degraded');
    expect(screen.getByTestId('db-status')).toHaveTextContent('غير متاحة');
  });

  it('shows unreachable when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    render(<ApiStatusPanel />);

    expect(await screen.findByText('تعذّر الوصول إلى الخادم')).toHaveAttribute('data-state', 'unreachable');
  });

  it('shows unreachable when a proxy returns a non-JSON error page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<h1>Bad gateway</h1>', { status: 502 })));

    render(<ApiStatusPanel />);

    expect(await screen.findByText('تعذّر الوصول إلى الخادم')).toBeInTheDocument();
  });

  it('re-checks when the retry button is pressed', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200, healthy));
    vi.stubGlobal('fetch', fetchMock);

    render(<ApiStatusPanel />);
    await screen.findByText('تعذّر الوصول إلى الخادم');

    fireEvent.click(screen.getByRole('button', { name: 'إعادة الفحص' }));

    expect(await screen.findByText('متصل')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
