import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { usePageMeta } from '../lib/pageMeta';
import { FeatureList, SolutionCards, SaasOwnershipComparison } from './shared';
import { useList } from './useList';
import { startPath } from './solutions';

const PROBLEMS = ['booking', 'queue', 'records', 'branches'] as const;
const STEPS = ['account', 'organization', 'specialties', 'workspace'] as const;
const FAQ = ['price', 'clinical', 'specialties', 'ai', 'branches', 'ownership', 'data', 'languages'] as const;

export function PublicHomePage() {
  const { t } = useTranslation();
  const faq = FAQ.map((key) => ({ q: t(`site.home.faq.${key}.q`), a: t(`site.home.faq.${key}.a`) }));
  usePageMeta({
    title: t('site.home.metaTitle'),
    description: t('site.home.metaDescription'),
    path: '/',
    // FAQPage markup describing exactly the questions shown on this page.
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map((item) => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })),
    },
  });
  const available = useList('site.shared');

  return (
    <>
      <section className="site-hero" aria-labelledby="hero-title">
        <div className="site-container site-hero-inner">
          <p className="site-eyebrow">{t('site.home.eyebrow')}</p>
          <h1 id="hero-title">{t('site.home.title')}</h1>
          <p className="site-lead">{t('site.home.lead')}</p>
          <div className="site-cta-row">
            <Link className="button button--primary button--large" to={startPath()} data-testid="hero-create">
              {t('site.cta.create')}
            </Link>
            <span className="site-signin-hint">
              {t('site.home.signInHint')} <Link to="/login">{t('site.nav.signIn')}</Link>
            </span>
          </div>
          <p className="site-dev-notice" role="note">
            {t('site.notice')}
          </p>
        </div>
      </section>

      <section className="site-section" aria-labelledby="problems-title">
        <div className="site-container">
          <h2 id="problems-title">{t('site.home.problemsTitle')}</h2>
          <ul className="site-grid site-grid--4">
            {PROBLEMS.map((key) => (
              <li key={key} className="site-card">
                <h3>{t(`site.home.problems.${key}.title`)}</h3>
                <p>{t(`site.home.problems.${key}.body`)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="site-section site-section--muted" aria-labelledby="paths-title">
        <div className="site-container">
          <h2 id="paths-title">{t('site.home.pathsTitle')}</h2>
          <p className="site-section-lead">{t('site.home.pathsLead')}</p>
          <SolutionCards />
        </div>
      </section>

      <section className="site-section" aria-labelledby="available-title">
        <div className="site-container site-split">
          <div>
            <h2 id="available-title">{t('site.home.availableTitle')}</h2>
            <p className="site-section-lead">{t('site.home.availableLead')}</p>
            <FeatureList items={available} />
          </div>
          <aside className="site-card site-card--planned" aria-labelledby="planned-title">
            <h3 id="planned-title">
              <Icon name="clock" /> {t('site.home.plannedTitle')}
            </h3>
            <p>{t('site.home.plannedBody')}</p>
          </aside>
        </div>
      </section>

      <section className="site-section site-section--muted" aria-labelledby="steps-title">
        <div className="site-container">
          <h2 id="steps-title">{t('site.home.stepsTitle')}</h2>
          <ol className="site-steps">
            {STEPS.map((key) => (
              <li key={key}>
                <h3>{t(`site.home.steps.${key}.title`)}</h3>
                <p>{t(`site.home.steps.${key}.body`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="site-section" aria-labelledby="compare-title">
        <div className="site-container">
          <h2 id="compare-title">{t('site.compare.title')}</h2>
          <SaasOwnershipComparison />
        </div>
      </section>

      <section className="site-section site-section--muted" aria-labelledby="faq-title">
        <div className="site-container site-narrow">
          <h2 id="faq-title">{t('site.home.faqTitle')}</h2>
          <div className="site-faq">
            {faq.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
