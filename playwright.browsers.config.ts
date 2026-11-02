import { devices } from '@playwright/test';
import base from './playwright.config';

// Firefox and WebKit run of the journeys that differ most between engines (Phase 1, UI-11). Not part
// of `verify`; run it before a release or a layout change with `npm run test:e2e:browsers`, which
// runs one project per Playwright run (scripts/e2e-browsers.mjs): each run seeds its own database,
// so no browser meets the data another browser's tests changed. Running several projects in one
// `playwright test` call shares the seed and is not supported.
//
// Within a run, tests that change a seeded account's saved language restore it through the
// `restoreLanguage` fixture (e2e/fixtures.ts), also when they fail.
export default {
  ...base,
  testMatch: ['front-desk.spec.ts', 'i18n.spec.ts', 'layout.spec.ts', 'public.spec.ts', 'roles.spec.ts'],
  projects: [
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grepInvert: /@mobile/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grepInvert: /@mobile/ },
    { name: 'webkit-phone', use: { ...devices['iPhone 13'] }, grep: /@mobile/ },
  ],
};
