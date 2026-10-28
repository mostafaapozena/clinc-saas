import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Icon, type IconName } from '../components/Icon';
import { usePageMeta } from '../lib/pageMeta';
import {
  CreateLink,
  CtaBlock,
  DevNotice,
  Faq,
  FactValue,
  FeatureList,
  Headline,
  IconTile,
  ProductFrame,
  SaasOwnershipComparison,
  SectionHeader,
  SolutionCards,
  Steps,
} from './shared';
import { useList, useObjects, type QuestionItem, type TitledItem } from './useList';

const FAQ = ['price', 'clinical', 'specialties', 'ai', 'branches', 'ownership', 'data', 'languages'] as const;
const PROBLEM_ICONS: Record<string, IconName> = { booking: 'calendar', queue: 'queue', records: 'file', branches: 'building' };
const WORKFLOW_ICONS: IconName[] = ['calendar', 'queue', 'stethoscope', 'wallet'];
const FEATURES = [
  { key: 'scheduling', shot: 'appointments', icon: 'calendar', link: '/tour' },
  { key: 'records', shot: 'record', icon: 'file', link: '/solutions/dentistry' },
  { key: 'finance', shot: 'finance', icon: 'wallet', link: '/tour' },
] as const;
const USE_CASES: { key: string; icon: IconName; to: string }[] = [
  { key: 'clinic', icon: 'stethoscope', to: '/solutions/dentistry' },
  { key: 'center', icon: 'layers', to: '/solutions/medical-centers' },
  { key: 'branches', icon: 'building', to: '/solutions/medical-centers' },
];

export function PublicHomePage() {
  const { t } = useTranslation();
  const faq: QuestionItem[] = FAQ.map((key) => ({ q: t(`site.home.faq.${key}.q`), a: t(`site.home.faq.${key}.a`) }));
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
  const reassure = useList('site.home.reassure');
  const facts = useObjects<{ value: string; label: string }>('site.home.facts', ['value', 'label']);
  const workflow = useObjects<TitledItem>('site.home.workflow.steps', ['title', 'body']);
  const floats = useList('site.home.floats');
  const heroRef = useRef<HTMLElement>(null);

  return (
    <>
      <section className="site-hero" aria-labelledby="hero-title" ref={heroRef}>
        <div className="site-container site-hero-grid">
          <div className="site-hero-text">
            <p className="site-pill">{t('site.home.eyebrow')}</p>
            <h1 id="hero-title">
              <Headline start={t('site.home.titleStart')} emphasis={t('site.home.titleEmphasis')} />
            </h1>
            <p className="site-lead">{t('site.home.lead')}</p>
            <div className="site-cta-row">
              <CreateLink className="button button--primary button--large" testId="hero-create" />
              <Link className="button button--secondary button--large" to="/tour">
                <Icon name="image" /> {t('site.home.tourCta')}
              </Link>
            </div>
            <ul className="site-reassure">
              {reassure.map((item) => (
                <li key={item}>
                  <Icon name="check" /> {item}
                </li>
              ))}
            </ul>
            <span className="site-signin-hint">
              {t('site.home.signInHint')} <Link to="/login">{t('site.nav.signIn')}</Link>
            </span>
            <DevNotice />
          </div>
          <ProductFrame shot="appointments" alt={t('site.home.previewAlt')} label={t('site.home.previewLabel')} floats={floats} priority />
        </div>
      </section>
      <StickyCta watch={heroRef} />

      <section className="site-section site-section--navy site-section--tight" aria-label={t('site.home.factsLabel')}>
        <div className="site-container">
          <ul className="site-facts" data-reveal>
            {facts.map((fact) => (
              <li key={fact.label}>
                <strong>
                  <FactValue value={fact.value} />
                </strong>
                <span>{fact.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="site-section site-section--mint" aria-labelledby="paths-title">
        <div className="site-container">
          <SectionHeader
            id="paths-title"
            center
            eyebrow={t('site.home.pathsEyebrow')}
            title={t('site.home.pathsTitle')}
            emphasis={t('site.home.pathsEmphasis')}
            lead={t('site.home.pathsLead')}
          />
          <SolutionCards />
        </div>
      </section>

      <section className="site-section" aria-labelledby="problems-title">
        <div className="site-container">
          <SectionHeader id="problems-title" eyebrow={t('site.home.problemsEyebrow')} title={t('site.home.problemsTitle')} lead={t('site.home.problemsLead')} />
          <ul className="site-grid site-grid--4" data-reveal>
            {(['booking', 'queue', 'records', 'branches'] as const).map((key) => (
              <li key={key} className="site-card">
                <IconTile name={PROBLEM_ICONS[key]!} />
                <h3>{t(`site.home.problems.${key}.title`)}</h3>
                <p>{t(`site.home.problems.${key}.body`)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="site-section site-section--light" aria-label={t('site.home.featuresLabel')}>
        <div className="site-container">
          {FEATURES.map((feature, index) => (
            <FeatureSplit key={feature.key} feature={feature} reverse={index % 2 === 1} />
          ))}
        </div>
      </section>

      <section className="site-section site-section--navy" aria-labelledby="workflow-title">
        <div className="site-container">
          <SectionHeader
            id="workflow-title"
            center
            eyebrow={t('site.home.workflow.eyebrow')}
            title={t('site.home.workflow.title')}
            emphasis={t('site.home.workflow.emphasis')}
            lead={t('site.home.workflow.lead')}
          />
          <Steps items={workflow} icons={WORKFLOW_ICONS} />
        </div>
      </section>

      <section className="site-section" aria-labelledby="cases-title">
        <div className="site-container">
          <SectionHeader id="cases-title" center eyebrow={t('site.home.cases.eyebrow')} title={t('site.home.cases.title')} lead={t('site.home.cases.lead')} />
          <ul className="site-grid site-grid--3" data-reveal>
            {USE_CASES.map((useCase) => (
              <UseCase key={useCase.key} name={useCase.key} icon={useCase.icon} to={useCase.to} />
            ))}
          </ul>
        </div>
      </section>

      <section className="site-section site-section--light" aria-labelledby="available-title">
        <div className="site-container site-split">
          <div className="site-split-text">
            <p className="site-eyebrow">{t('site.home.availableEyebrow')}</p>
            <h2 id="available-title">{t('site.home.availableTitle')}</h2>
            <p>{t('site.home.availableLead')}</p>
            <FeatureList items={available} />
          </div>
          <aside className="site-card site-card--planned" aria-labelledby="planned-title">
            <h3 id="planned-title">
              <Icon name="clock" /> {t('site.home.plannedTitle')}
            </h3>
            <p>{t('site.home.plannedBody')}</p>
            <Link className="site-link-arrow" to="/faq">
              {t('site.home.plannedLink')} <Icon name="arrowForward" />
            </Link>
          </aside>
        </div>
      </section>

      <section className="site-section" aria-labelledby="compare-title">
        <div className="site-container">
          <SectionHeader id="compare-title" center eyebrow={t('site.compare.eyebrow')} title={t('site.compare.title')} lead={t('site.compare.lead')} />
          <SaasOwnershipComparison />
        </div>
      </section>

      <section className="site-section site-section--mint" aria-labelledby="faq-title">
        <div className="site-container site-narrow">
          <SectionHeader id="faq-title" center eyebrow={t('site.home.faqEyebrow')} title={t('site.home.faqTitle')} />
          <Faq items={faq} />
          <p className="site-center-link">
            <Link className="site-link-arrow" to="/faq">
              {t('site.home.faqMore')} <Icon name="arrowForward" />
            </Link>
          </p>
        </div>
      </section>

      <CtaBlock title={t('site.home.closing.title')} body={t('site.home.closing.body')} />
    </>
  );
}

function FeatureSplit({ feature, reverse }: { feature: (typeof FEATURES)[number]; reverse: boolean }) {
  const { t } = useTranslation();
  const base = `site.home.features.${feature.key}`;
  const points = useList(`${base}.points`);
  return (
    <div className={reverse ? 'site-split site-split--reverse' : 'site-split'} data-reveal>
      <div className="site-split-text">
        <p className="site-eyebrow">
          <Icon name={feature.icon} /> {t(`${base}.eyebrow`)}
        </p>
        <h2>
          <Headline start={t(`${base}.titleStart`)} emphasis={t(`${base}.titleEmphasis`)} />
        </h2>
        <p>{t(`${base}.body`)}</p>
        <FeatureList items={points} />
        <Link className="site-link-arrow" to={feature.link}>
          {t(`${base}.link`)} <Icon name="arrowForward" />
        </Link>
      </div>
      <ProductFrame shot={feature.shot} alt={t(`${base}.alt`)} label={t(`${base}.eyebrow`)} />
    </div>
  );
}

function UseCase({ name, icon, to }: { name: string; icon: IconName; to: string }) {
  const { t } = useTranslation();
  const points = useList(`site.home.cases.${name}.points`);
  return (
    <li className="site-card site-card--toned">
      <IconTile name={icon} size="lg" />
      <h3>{t(`site.home.cases.${name}.title`)}</h3>
      <p>{t(`site.home.cases.${name}.body`)}</p>
      <FeatureList items={points} compact />
      <Link className="site-link-arrow" to={to}>
        {t(`site.home.cases.${name}.link`)} <Icon name="arrowForward" />
      </Link>
    </li>
  );
}

/** Desktop bar that keeps the main actions in reach once the hero has scrolled away; dismissible. */
function StickyCta({ watch }: { watch: RefObject<HTMLElement | null> }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('raclinic.stickyCta') === 'dismissed';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const target = watch.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!entry!.isIntersecting), { threshold: 0 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [watch]);
  if (!visible || dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem('raclinic.stickyCta', 'dismissed');
    } catch {
      // Private browsing: the bar simply stays dismissed for this page view.
    }
  };
  return (
    <div className="site-sticky-cta" role="region" aria-label={t('site.sticky.label')}>
      <div className="site-sticky-cta-inner">
        <span>{t('site.sticky.text')}</span>
        <CreateLink className="button button--primary" />
        <Link className="button button--secondary" to="/contact">
          {t('site.nav.contact')}
        </Link>
        <button type="button" className="icon-button" aria-label={t('site.sticky.dismiss')} onClick={dismiss}>
          <Icon name="close" />
        </button>
      </div>
    </div>
  );
}

