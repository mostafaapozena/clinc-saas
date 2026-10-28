import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

// Browser tests run the production builds on dedicated ports so they never collide with
// (or reuse) a running `npm run dev` session, against a database that is reset and seeded
// with synthetic demo data on every run.
const API_PORT = 4100;
const WEB_PORT = 4173;
const E2E_DB_NAME = 'clinc_e2e_test';
const mongoBaseUri = process.env.MONGODB_TEST_URI ?? 'mongodb://localhost:27017/?directConnection=true';

// A fresh random password for the demo accounts of this run only (inherited by test workers).
process.env.E2E_DEMO_PASSWORD ??= randomBytes(12).toString('base64url');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: [
    {
      command: 'npm run seed -w @clinc/api -- --reset && npm run start -w @clinc/api',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn',
        PORT: String(API_PORT),
        MONGODB_URI: mongoBaseUri,
        MONGODB_DB_NAME: E2E_DB_NAME,
        DEMO_PASSWORD: process.env.E2E_DEMO_PASSWORD,
        AUTH_RATE_LIMIT_MAX: '1000',
        SETUP_RATE_LIMIT_MAX: '1000',
        INQUIRY_RATE_LIMIT_MAX: '1000',
      },
      reuseExistingServer: false,
      timeout: 90_000,
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
