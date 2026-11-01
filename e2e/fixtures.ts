import { test as base, type BrowserContext } from '@playwright/test';

export { expect } from '@playwright/test';

// The browser's clock follows the API's shifted test clock (playwright.config.ts): pages and the
// server agree on "today" and on the time of day, whenever the run starts. Specs import `test` and
// `expect` from here instead of '@playwright/test'.

const offset = Number(process.env.E2E_CLOCK_OFFSET_MS ?? 0);

async function shiftClock(context: BrowserContext) {
  // Time keeps flowing from the shifted start; only its origin moves.
  if (offset) await context.clock.install({ time: new Date(Date.now() + offset) });
}

export const test = base.extend<object, { shiftedBrowser: void }>({
  context: async ({ context }, use) => {
    await shiftClock(context);
    await use(context);
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
