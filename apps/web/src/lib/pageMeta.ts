import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { INDEXABLE, SITE_URL } from './site';

// Head metadata. Public pages describe themselves (title, description, canonical URL, language
// alternates, social sharing); every other page is marked noindex and carries none of that.
// Language: the same path serves Arabic (default) and English (`?lang=en`), so those are the
// alternate URLs.

const MANAGED = 'data-page-meta';

function setMeta(attribute: 'name' | 'property', key: string, content: string | null) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (content === null) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.append(element);
  }
  element.content = content;
}

function clearManaged() {
  for (const element of document.head.querySelectorAll(`[${MANAGED}]`)) element.remove();
}

function addLink(rel: string, href: string, hreflang?: string) {
  const link = document.createElement('link');
  link.rel = rel;
  link.href = href;
  if (hreflang) link.hreflang = hreflang;
  link.setAttribute(MANAGED, '');
  document.head.append(link);
}

export const publicUrl = (path: string, language: 'ar' | 'en') => `${SITE_URL}${path}${language === 'en' ? '?lang=en' : ''}`;

export type PageMeta = {
  title: string;
  description: string;
  /** Public path of this page (e.g. "/solutions/dentistry"). */
  path: string;
  /** JSON-LD describing only real page content (e.g. the FAQ). */
  structuredData?: object;
};

/** For public pages. Indexable only when the build enables indexing for a configured URL. */
export function usePageMeta({ title, description, path, structuredData }: PageMeta) {
  const { t, i18n } = useTranslation();
  const language: 'ar' | 'en' = i18n.resolvedLanguage === 'en' ? 'en' : 'ar';
  const json = structuredData ? JSON.stringify(structuredData) : null;

  useEffect(() => {
    const siteName = t('app.name');
    document.title = `${title} · ${siteName}`;
    clearManaged();
    setMeta('name', 'description', description);
    setMeta('name', 'robots', INDEXABLE ? 'index, follow' : 'noindex, nofollow');
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:site_name', siteName);
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:locale', language === 'ar' ? 'ar_AR' : 'en_US');
    setMeta('name', 'twitter:card', 'summary');
    if (SITE_URL) {
      const canonical = publicUrl(path, language);
      addLink('canonical', canonical);
      addLink('alternate', publicUrl(path, 'ar'), 'ar');
      addLink('alternate', publicUrl(path, 'en'), 'en');
      addLink('alternate', publicUrl(path, 'ar'), 'x-default');
      setMeta('property', 'og:url', canonical);
    } else {
      setMeta('property', 'og:url', null);
    }
    if (json) {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.textContent = json;
      script.setAttribute(MANAGED, '');
      document.head.append(script);
    }
  }, [title, description, path, language, json, t]);
}

/** For sign-in, onboarding and workspace pages: never indexed, no public metadata. */
export function usePrivatePageMeta(title: string) {
  const { t } = useTranslation();
  useEffect(() => {
    document.title = `${title} · ${t('app.name')}`;
    clearManaged();
    setMeta('name', 'robots', 'noindex, nofollow');
    for (const key of ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:locale', 'og:url']) setMeta('property', key, null);
    setMeta('name', 'description', null);
    setMeta('name', 'twitter:card', null);
  }, [title, t]);
}
