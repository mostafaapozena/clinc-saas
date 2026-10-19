import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import i18n, { DEFAULT_LANGUAGE } from './src/i18n';
import { setCsrfToken } from './src/lib/api';

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  setCsrfToken(null);
  await i18n.changeLanguage(DEFAULT_LANGUAGE);
});
