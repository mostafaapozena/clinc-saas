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

// Every run happens at the same time of day, 10:00 UTC (12:00 in Cairo, 13:00 in Riyadh), whenever
// it starts: the API (CLOCK_OFFSET_MS) and every browser context (e2e/fixtures.ts) share one shifted
// clock, so data seeded for "today" never crosses a local midnight during the run. Real time-of-day
// behaviour is tested in the API suite with a pinned clock. E2E_CLOCK_UTC=HH:MM[:SS] rehearses
// another time (for example the Riyadh midnight boundary).
if (process.env.E2E_CLOCK_OFFSET_MS === undefined) {
  const [h = 10, m = 0, s = 0] = (process.env.E2E_CLOCK_UTC ?? '10:00').split(':').map(Number);
  const real = new Date();
  process.env.E2E_CLOCK_OFFSET_MS = String(Date.UTC(real.getUTCFullYear(), real.getUTCMonth(), real.getUTCDate(), h, m, s) - real.getTime());
}

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
        // The clearly labelled payment simulator (milestone 4); never a real provider in tests.
        BILLING_PROVIDER: 'simulator',
        // Development mail sink (milestone 5): nothing is ever sent from tests.
        MAIL_PROVIDER: 'dev_sink',
        CLOCK_OFFSET_MS: process.env.E2E_CLOCK_OFFSET_MS,
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
