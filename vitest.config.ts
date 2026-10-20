import { defineConfig } from 'vitest/config';

// Each app owns its test configuration; `npm test` runs them all.
export default defineConfig({
  test: {
    projects: ['apps/api', 'apps/web'],
  },
});
