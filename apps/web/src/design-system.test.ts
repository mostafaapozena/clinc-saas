import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import postcss from 'postcss';
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

  it('lays out actions, card rows, metric lists, filters and tone badges through the primitives (UI-04)', () => {
    const raw = /className="(?:form-actions|card-grid|filters)[" ]|<dl className="metrics|className="badge badge--(?:success|warning|danger|info|neutral)"/;
    const allowed = new Set(['components/layout.tsx', 'components/data.tsx', 'components/ui.tsx']);
    const offenders = files.filter((f) => !allowed.has(f.path) && raw.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('formats money only through lib/money.ts and Money (UI-04)', () => {
    const allowed = new Set(['lib/money.ts', 'lib/finance.ts', 'components/data.tsx']);
    const offenders = files.filter((f) => !allowed.has(f.path) && /formatMoney[(]|function useMoney/.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('puts icons beside wrapping text only through IconLabel / ReportLink (no line breaks inside links)', () => {
    const offenders = files.filter((f) => /<Link[^>]*>[^]*?<br \/>[^]*?<\/Link>/.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe('stylesheets (UI-02)', () => {
  const sheet = (name: string) => postcss.parse(readFileSync(join(ROOT, name), 'utf8'));

  it('defines design tokens on the document root only in tokens.css', () => {
    const offenders: string[] = [];
    for (const name of ['styles.css', 'workspace.css', 'public/public.css']) {
      sheet(name).walkRules((rule) => {
        if (!/^:root/.test(rule.selector)) return;
        rule.walkDecls((d) => {
          if (d.prop.startsWith('--')) offenders.push(`${name}: ${d.prop}`);
        });
      });
    }
    expect(offenders).toEqual([]);
  });

  it('adds no new duplicate selectors (same selector, same media context); 28 order-dependent groups remain', () => {
    const groups = new Map<string, number>();
    for (const name of ['styles.css', 'workspace.css']) {
      sheet(name).walkRules((rule) => {
        if (rule.parent?.type === 'atrule' && (rule.parent as postcss.AtRule).name === 'keyframes') return;
        const media: string[] = [];
        for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) if (p.type === 'atrule') media.unshift((p as postcss.AtRule).params);
        const key = `${media.join('/')}|${rule.selector.replace(/\s+/g, ' ')}`;
        groups.set(key, (groups.get(key) ?? 0) + 1);
      });
    }
    // Lower this number when a group is consolidated; it may never grow.
    expect([...groups.values()].filter((n) => n > 1).length).toBeLessThanOrEqual(28);
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
