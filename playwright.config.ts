import { defineConfig, devices } from '@playwright/test';

// The smoke test runs the production builds on dedicated ports so it never
// collides with (or reuses) a running `npm run dev` session.
const API_PORT = 4100;
const WEB_PORT = 4173;
const E2E_DB_NAME = 'clinc_e2e_test';
const mongoBaseUri = process.env.MONGODB_TEST_URI ?? 'mongodb://localhost:27017';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run seed -w @clinc/api && npm run start -w @clinc/api',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn',
        PORT: String(API_PORT),
        MONGODB_URI: mongoBaseUri,
        MONGODB_DB_NAME: E2E_DB_NAME,
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npm run preview -w @clinc/web',
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
