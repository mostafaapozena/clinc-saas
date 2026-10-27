import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { usePageMeta } from '../lib/pageMeta';
import { Breadcrumb, CreateLink, Faq } from './shared';
import { useObjects } from './useList';

const CATEGORIES = ['general', 'specialties', 'data', 'account'] as const;
type Category = (typeof CATEGORIES)[number];
type FaqEntry = { q: string; a: string; category: string };

/** Normalizes Arabic spelling variants so a search matches either form (أ/إ/آ → ا, ى → ي, ة → ه). */
const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');

export function FaqPage() {
  const { t } = useTranslation();
  // The questions also shown on the home page come first (same text), then the FAQ-only ones.
  const homeKeys = ['price', 'clinical', 'specialties', 'ai', 'branches', 'ownership', 'data', 'languages'];
  const homeCategories: Record<string, Category> = {
    price: 'account',
    clinical: 'specialties',
    specialties: 'specialties',
    ai: 'general',
    branches: 'general',
    ownership: 'account',
    data: 'data',
    languages: 'general',
  };
  const fromHome: FaqEntry[] = homeKeys.map((key) => ({ q: t(`site.home.faq.${key}.q`), a: t(`site.home.faq.${key}.a`), category: homeCategories[key]! }));
  const extra = useObjects<FaqEntry>('site.faqPage.items', ['q', 'a', 'category']);
  const all = [...fromHome, ...extra];
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [query, setQuery] = useState('');
  usePageMeta({
    title: t('site.faqPage.metaTitle'),
    description: t('site.faqPage.metaDescription'),
    path: '/faq',
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: all.map((item) => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })),
    },
  });
  const needle = fold(query.trim());
  const shown = all.filter((item) => (category === 'all' || item.category === category) && (!needle || fold(`${item.q} ${item.a}`).includes(needle)));
  const count = (c: Category) => all.filter((item) => item.category === c).length;

  return (
    <>
      <Breadcrumb items={[{ label: t('site.nav.faq') }]} />
      <section className="site-hero site-hero--page site-section--mint" aria-labelledby="faq-title">
        <div className="site-container site-hero-center">
          <p className="site-eyebrow">{t('site.faqPage.eyebrow')}</p>
          <h1 id="faq-title">{t('site.faqPage.title')}</h1>
          <p className="site-lead">
            {t('site.faqPage.lead')} <Link to="/contact">{t('site.nav.contact')}</Link>
          </p>
          <label className="site-search">
            <Icon name="search" />
            <span className="visually-hidden">{t('site.faqPage.searchLabel')}</span>
            <input type="search" value={query} placeholder={t('site.faqPage.search')} onChange={(e) => setQuery(e.target.value)} dir="auto" />
          </label>
        </div>
      </section>
      <section className="site-section" aria-label={t('site.faqPage.title')}>
        <div className="site-container site-narrow">
          <div className="site-faq-tools">
            <div className="site-tabs" role="group" aria-label={t('site.faqPage.categoriesLabel')}>
              <button type="button" className="site-tab" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>
                {t('site.faqPage.all')} <span>{all.length}</span>
              </button>
              {CATEGORIES.map((c) => (
                <button key={c} type="button" className="site-tab" aria-pressed={category === c} onClick={() => setCategory(c)}>
                  {t(`site.faqPage.categories.${c}`)} <span>{count(c)}</span>
                </button>
              ))}
            </div>
            <p className="muted small" aria-live="polite">
              {t('site.faqPage.showing', { count: shown.length })}
            </p>
          </div>
          {shown.length ? <Faq items={shown} testId="faq-list" /> : <p className="site-center-link">{t('site.faqPage.noResults')}</p>}
          <div className="site-cta-block site-cta-block--compact">
            <div>
              <h2>{t('site.faqPage.moreTitle')}</h2>
              <p>{t('site.faqPage.moreBody')}</p>
            </div>
            <div className="site-cta-row">
              <Link className="button button--accent" to="/contact">
                {t('site.nav.contact')}
              </Link>
              <CreateLink className="button button--on-navy" />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
