import { useSyncExternalStore } from 'react';
import { readStored, writeStored } from './storage';

// One theme for the whole product (public site, sign-in, workspace, operator console), kept in
// this browser only. `public/theme-init.js` applies the same rule before the first paint, so the
// page never flashes the wrong theme; keep the two in sync.

export type ThemePreference = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'clinc.theme';
/** Browser bar color per theme (matches --bg). */
const THEME_COLOR: Record<Theme, string> = { light: '#f5f8fa', dark: '#0d1b2e' };

const listeners = new Set<() => void>();

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function readThemePreference(): ThemePreference {
  const value = readStored(THEME_STORAGE_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** No saved choice follows the operating system; without that signal the product is light. */
export function resolveTheme(preference: ThemePreference): Theme {
  if (preference === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return preference;
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

function notify() {
  applyTheme(resolveTheme(readThemePreference()));
  listeners.forEach((listener) => listener());
}

export function setThemePreference(preference: ThemePreference) {
  writeStored(THEME_STORAGE_KEY, preference === 'system' ? null : preference);
  notify();
}

let watching = false;
function watchOutsideChanges() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  // Another tab changed the choice, or the system theme changed while following it.
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) notify();
  });
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (readThemePreference() === 'system') notify();
    });
  } catch {
    // Old browsers without matchMedia listeners keep the theme chosen at load.
  }
}

function subscribe(listener: () => void) {
  watchOutsideChanges();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => `${readThemePreference()}:${resolveTheme(readThemePreference())}`;

export function useTheme() {
  const value = useSyncExternalStore(subscribe, snapshot, () => 'system:light');
  const [preference, theme] = value.split(':') as [ThemePreference, Theme];
  return { preference, theme, setPreference: setThemePreference };
}

/** Called once at start-up: corrects the attribute if the init script could not run. */
export function initTheme() {
  applyTheme(resolveTheme(readThemePreference()));
  watchOutsideChanges();
}
