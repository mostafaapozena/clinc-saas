import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import i18n, { DEFAULT_LANGUAGE } from './src/i18n';
import { setCsrfToken } from './src/lib/api';

// The first findBy* of a file also waits for the lazily loaded route chunks; under the full suite
// (API and web tests in parallel on a 2-core machine) that can exceed the 1 s default.
configure({ asyncUtilTimeout: 3000 });

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  setCsrfToken(null);
  await i18n.changeLanguage(DEFAULT_LANGUAGE);
});
