import { parseSiteUrl } from './site-url';

// Public-site configuration from build-time environment variables (see README):
// - VITE_PUBLIC_SITE_URL: the public origin, e.g. https://example.com (no trailing slash).
//   Without it there are no canonical URLs, no hreflang alternates and no sitemap.
// - VITE_PUBLIC_INDEXING=true: lets search engines index the public pages. Only honored together
//   with VITE_PUBLIC_SITE_URL. Default: everything is noindex (development, the private
//   Codespaces preview, staging).
export const SITE_URL = parseSiteUrl(import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined);
export const INDEXABLE = SITE_URL !== null && import.meta.env.VITE_PUBLIC_INDEXING === 'true';
