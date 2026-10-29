import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import ar from './i18n/locales/ar.json';
import en from './i18n/locales/en.json';

// Guards of the design system (docs/DESIGN_SYSTEM.md, docs/UI_CONTRIBUTION_CHECKLIST.md): the layout
// patterns that caused the 2026-10 findings may not come back by hand-assembled markup, and every
// translation key used in the code exists in both languages.
const ROOT = __dirname;
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}
const files = sources(ROOT).map((path) => ({ path: relative(ROOT, path).replace(/\\/g, '/'), text: readFileSync(path, 'utf8') }));

describe('design-system guards', () => {
  it('uses metric lists with a column layout (MetricGrid or a modifier), never a bare "metrics" list', () => {
    const offenders = files.filter((f) => /className="metrics"/.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('builds module navigation only through ModuleTabs', () => {
    const offenders = files.filter((f) => f.path !== 'components/layout.tsx' && /className="module-nav"/.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('puts icons beside wrapping text only through IconLabel / ReportLink (no line breaks inside links)', () => {
    const offenders = files.filter((f) => /<Link[^>]*>[^]*?<br \/>[^]*?<\/Link>/.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe('translation keys', () => {
  const has = (dict: unknown, key: string) => {
    const get = (k: string) => k.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), dict);
    // Strings, plural forms, or lists read with returnObjects.
    return get(key) !== undefined || typeof get(`${key}_one`) === 'string' || typeof get(`${key}_other`) === 'string';
  };
  it('has every literal t() key in Arabic and English', () => {
    const missing: string[] = [];
    for (const f of files) {
      for (const m of f.text.matchAll(/\bt\('([a-zA-Z][\w-]*(?:\.[\w-]+)+)'(\s*,\s*\{[^}]*defaultValue)?/g)) {
        if (m[2]) continue; // a defaultValue is the documented fallback
        const key = m[1]!;
        for (const [lang, dict] of [['ar', ar], ['en', en]] as const) if (!has(dict, key)) missing.push(`${lang}:${key} (${f.path})`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
