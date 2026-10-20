import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { createQueryClient } from '../auth/session';
import { routes } from '../routes/routes';

type RouteValue = unknown | Response | ((init: RequestInit, url: URL) => unknown);

/** Stubs fetch with "METHOD /path" → JSON body (or Response). Unknown routes answer 404. Handlers also get the URL (query string). */
export function mockApi(table: Record<string, RouteValue>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const route = table[`${(init.method ?? 'GET').toUpperCase()} ${url.pathname}`];
    if (route === undefined) {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
    }
    const value = typeof route === 'function' ? await (route as (i: RequestInit, u: URL) => unknown)(init, url) : route;
    return value instanceof Response ? value : Response.json(value);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function apiError(status: number, code: string) {
  return Response.json({ error: { code, message: code } }, { status });
}

export function renderRoute(path: string) {
  const queryClient = createQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
}
