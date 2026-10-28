import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { parseSiteUrl, robotsTxt, sitemapXml } from './src/lib/site-url.ts';
import { PUBLIC_PATHS } from './src/public/solutions.ts';

// The browser only ever talks to the web server; /api is proxied to the API.
// This keeps requests same-origin, which works through private Codespaces port
// forwarding without CORS or exposing the API port.
const apiProxyTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000';

const shared = {
  host: true,
  strictPort: true,
  // Codespaces forwards ports through *.app.github.dev hostnames.
  allowedHosts: ['.app.github.dev'],
  proxy: { '/api': { target: apiProxyTarget } },
};

/**
 * Search-engine behavior per environment. Indexing happens only when a build sets both
 * VITE_PUBLIC_SITE_URL (an https origin) and VITE_PUBLIC_INDEXING=true. Otherwise — development,
 * the private Codespaces preview, staging — robots.txt disallows everything, there is no sitemap,
 * the HTML says noindex and every response carries X-Robots-Tag: noindex.
 */
function seo(siteUrl: string | null, indexable: boolean): Plugin {
  const robots = robotsTxt(siteUrl, indexable);
  const sitemap = indexable && siteUrl ? sitemapXml(siteUrl, PUBLIC_PATHS) : null;
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!indexable) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const path = (req.url ?? '').split('?')[0];
    if (path === '/robots.txt') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(robots);
      return;
    }
    if (path === '/sitemap.xml') {
      if (!sitemap) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.end(sitemap);
      return;
    }
    next();
  };
  return {
    name: 'clinc-seo',
    transformIndexHtml: (html) => html.replace('content="noindex, nofollow"', indexable ? 'content="index, follow"' : 'content="noindex, nofollow"'),
    configureServer: (server) => {
      server.middlewares.use(middleware);
    },
    configurePreviewServer: (server) => {
      server.middlewares.use(middleware);
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots });
      if (sitemap) this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const siteUrl = parseSiteUrl(env.VITE_PUBLIC_SITE_URL);
  const indexable = siteUrl !== null && env.VITE_PUBLIC_INDEXING === 'true';
  return {
    plugins: [react(), seo(siteUrl, indexable)],
    server: { ...shared, port: 5173 },
    preview: { ...shared, port: 4173 },
  };
});
