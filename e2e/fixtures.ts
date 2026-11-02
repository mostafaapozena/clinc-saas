import { test as base, type BrowserContext } from '@playwright/test';
import { DEMO_PASSWORD } from './helpers';

export { expect } from '@playwright/test';

// The browser's clock follows the API's shifted test clock (playwright.config.ts): pages and the
// server agree on "today" and on the time of day, whenever the run starts. Specs import `test` and
// `expect` from here instead of '@playwright/test'.

const offset = Number(process.env.E2E_CLOCK_OFFSET_MS ?? 0);

/**
 * The run's clock in the test process. A spec that computes "today", a time of day or a business
 * date (to query the API or fill a form) uses this, never `new Date()`: the run's day is often not
 * the real day (the shift moves forward to the next 10:00 UTC). Unique names may keep `Date.now()`.
 */
export const testNow = () => new Date(Date.now() + offset);

async function shiftClock(context: BrowserContext) {
  // Time keeps flowing from the shifted start; only its origin moves.
  if (offset) await context.clock.install({ time: new Date(Date.now() + offset) });
}

type Language = 'ar' | 'en';

export const test = base.extend<{ restoreLanguage: (email: string, language: Language) => void }, { shiftedBrowser: void }>({
  context: async ({ context }, use) => {
    await shiftClock(context);
    await use(context);
  },
  // A test that switches a seeded account's saved language registers it here. The seed value is
  // put back through the API after the test, also when the test fails, so the next test and the
  // next browser project in the same run start from the seed.
  restoreLanguage: async ({ playwright, baseURL }, use) => {
    const accounts = new Map<string, Language>();
    await use((email, language) => accounts.set(email, language));
    for (const [email, preferredLanguage] of accounts) {
      const request = await playwright.request.newContext({ baseURL });
      try {
        const signIn = await request.post('/api/v1/auth/login', { data: { email, password: DEMO_PASSWORD } });
        const { csrfToken } = (await signIn.json()) as { csrfToken: string };
        const saved = await request.patch('/api/v1/me', { data: { preferredLanguage }, headers: { 'X-CSRF-Token': csrfToken } });
        if (!saved.ok()) throw new Error(`Could not restore the language of ${email}: ${saved.status()}`);
      } finally {
        await request.dispose();
      }
    }
  },
  // Contexts that a test opens itself (a second user) get the same clock.
  shiftedBrowser: [
    async ({ browser }, use) => {
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        const context = await newContext(options);
        await shiftClock(context);
        return context;
      };
      await use();
    },
    { scope: 'worker', auto: true },
  ],
});
