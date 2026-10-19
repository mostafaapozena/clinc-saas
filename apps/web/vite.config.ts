import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The browser only ever talks to the web server; /api is proxied to the API.
// This keeps requests same-origin, which works through private Codespaces port
// forwarding without CORS or exposing the API port.
const apiProxyTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000';

const shared = {
  host: true,
  strictPort: true,
  // Codespaces forwards ports through *.app.github.dev hostnames.
  allowedHosts: ['.app.github.dev'],
  proxy: { '/api': { target: apiProxyTarget } },
};

export default defineConfig({
  plugins: [react()],
  server: { ...shared, port: 5173 },
  preview: { ...shared, port: 4173 },
});
