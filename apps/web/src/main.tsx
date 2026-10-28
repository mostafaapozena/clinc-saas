import '@fontsource-variable/alexandria';
import '@fontsource-variable/inter';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { createQueryClient } from './auth/session';
import './i18n';
import { initTheme } from './lib/theme';
import { routes } from './routes/routes';
import './styles.css';
import './workspace.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

initTheme();
const queryClient = createQueryClient();
const router = createBrowserRouter(routes);

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
