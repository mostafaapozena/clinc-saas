// Pure helpers shared by the app and vite.config.ts (no import.meta.env here).

/** Parses the configured public origin; anything but a plain https origin is ignored. */
export function parseSiteUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!URL.canParse(trimmed)) return null;
  const url = new URL(trimmed);
  return url.protocol === 'https:' && url.origin === trimmed ? trimmed : null;
}

/** Paths that are never crawlable, whatever the environment. */
export const PRIVATE_PATH_PREFIXES = ['/app', '/onboarding', '/login', '/register', '/start', '/status', '/api/'] as const;

export function robotsTxt(siteUrl: string | null, indexable: boolean): string {
  if (!indexable || !siteUrl) return 'User-agent: *\nDisallow: /\n';
  return ['User-agent: *', 'Allow: /', ...PRIVATE_PATH_PREFIXES.map((p) => `Disallow: ${p}`), `Sitemap: ${siteUrl}/sitemap.xml`, ''].join('\n');
}

/** Sitemap of the public pages in both languages (Arabic default, English via ?lang=en). */
export function sitemapXml(siteUrl: string, paths: readonly string[]): string {
  const url = (path: string, en: boolean) => `${siteUrl}${path}${en ? '?lang=en' : ''}`.replace(/&/g, '&amp;');
  const entry = (path: string, en: boolean) =>
    [
      '  <url>',
      `    <loc>${url(path, en)}</loc>`,
      `    <xhtml:link rel="alternate" hreflang="ar" href="${url(path, false)}"/>`,
      `    <xhtml:link rel="alternate" hreflang="en" href="${url(path, true)}"/>`,
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${url(path, false)}"/>`,
      '  </url>',
    ].join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...paths.flatMap((path) => [entry(path, false), entry(path, true)]),
    '</urlset>',
    '',
  ].join('\n');
}
