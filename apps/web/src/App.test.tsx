import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

const specialties = {
  data: [
    { code: 'dentistry', name: { ar: 'طب الأسنان', en: 'Dentistry' } },
    { code: 'ent', name: { ar: 'الأنف والأذن والحنجرة', en: 'Ear, Nose & Throat' } },
  ],
};

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/api/v1/specialties')
          ? Response.json(specialties)
          : Response.json({
              status: 'ok',
              service: 'clinc-saas-api',
              uptimeSeconds: 1,
              database: { status: 'up', latencyMs: 1 },
              timestamp: '2026-01-01T00:00:00.000Z',
            }),
      ),
    ),
  );
}

describe('App', () => {
  it('renders the Arabic starter page with specialties from the API', async () => {
    stubApi();
    render(<App />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('منصة العيادات');
    const items = await screen.findAllByTestId('specialty-item');
    expect(items.map((item) => item.textContent)).toEqual(['طب الأسنان', 'الأنف والأذن والحنجرة']);
  });

  it('switches content and direction to English', async () => {
    stubApi();
    render(<App />);
    await screen.findAllByTestId('specialty-item');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'English' }));
    });

    expect(document.documentElement.dir).toBe('ltr');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Clinics Platform');
    expect(screen.getAllByTestId('specialty-item')[0]).toHaveTextContent('Dentistry');
  });

  it('shows an error when specialties cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('fail', { status: 500 })));
    render(<App />);

    expect(await screen.findByText('تعذّر تحميل التخصصات.')).toBeInTheDocument();
  });
});
