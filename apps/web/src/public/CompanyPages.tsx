import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Icon, type IconName } from '../components/Icon';
import { usePageMeta } from '../lib/pageMeta';
import { Breadcrumb, CtaBlock, FeatureList, IconTile, SectionHeader, SolutionCards } from './shared';
import { useList, useObjects, type TitledItem } from './useList';

// Company pages. Only verified facts: raclinic is a product built by Devware; everything else here
// describes the product as it is implemented (no history, team, customer numbers or certifications).

const PRINCIPLE_ICONS: IconName[] = ['globe', 'lock', 'stethoscope', 'check'];

export function AboutPage() {
  const { t } = useTranslation();
  usePageMeta({ title: t('site.about.metaTitle'), description: t('site.about.metaDescription'), path: '/about' });
  const principles = useObjects<TitledItem>('site.about.principles', ['title', 'body']);
  const facts = useObjects<{ value: string; label: string }>('site.home.facts', ['value', 'label']);
  const status = useList('site.about.statusPoints');
  return (
    <>
      <Breadcrumb items={[{ label: t('site.nav.about') }]} />
      <section className="site-hero site-hero--page" aria-labelledby="about-title">
        <div className="site-container site-hero-center">
          <p className="site-pill">{t('site.about.eyebrow')}</p>
          <h1 id="about-title">{t('site.about.title')}</h1>
          <p className="site-lead">{t('site.about.lead')}</p>
        </div>
        <div className="site-container">
          <ul className="site-stat-row site-stat-row--spaced">
            {facts.map((fact) => (
              <li key={fact.label}>
                <strong>{fact.value}</strong>
                <span>{fact.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="site-section site-section--tight" aria-labelledby="devware-title">
        <div className="site-container site-narrow">
          <div className="site-card site-card--toned">
            <IconTile name="building" size="lg" />
            <h2 id="devware-title" className="site-card-title">
              {t('site.about.devwareTitle')}
            </h2>
            <p>{t('site.about.devwareBody')}</p>
          </div>
        </div>
      </section>

      <section className="site-section site-section--light" aria-labelledby="purpose-title">
        <div className="site-container site-split">
          <div className="site-split-text">
            <p className="site-eyebrow">{t('site.about.purposeEyebrow')}</p>
            <h2 id="purpose-title">{t('site.about.purposeTitle')}</h2>
            <p>{t('site.about.purposeBody')}</p>
            <p>{t('site.about.purposeBody2')}</p>
          </div>
          <ul className="site-grid site-grid--2" aria-label={t('site.about.principlesTitle')}>
            {principles.map((p, i) => (
              <li key={p.title} className="site-card">
                <IconTile name={PRINCIPLE_ICONS[i] ?? 'check'} />
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="site-section" aria-labelledby="offer-title">
        <div className="site-container">
          <SectionHeader id="offer-title" center eyebrow={t('site.about.offerEyebrow')} title={t('site.about.offerTitle')} lead={t('site.about.offerLead')} />
          <SolutionCards />
        </div>
      </section>

      <section className="site-section site-section--navy" aria-labelledby="status-title">
        <div className="site-container site-split">
          <div className="site-split-text">
            <p className="site-eyebrow">{t('site.about.statusEyebrow')}</p>
            <h2 id="status-title">{t('site.about.statusTitle')}</h2>
            <p>{t('site.about.statusBody')}</p>
          </div>
          <div className="site-card site-card--navy">
            <FeatureList items={status} />
            <Link className="site-link-arrow site-link-arrow--on-navy" to="/security">
              {t('site.nav.security')} <Icon name="arrowForward" />
            </Link>
          </div>
        </div>
      </section>

      <CtaBlock title={t('site.about.closingTitle')} body={t('site.about.closingBody')} />
    </>
  );
}

/** A plain-language page made of titled sections (security practices, data handling). */
function ProsePage({ page, path, icon }: { page: 'security' | 'privacy'; path: string; icon: IconName }) {
  const { t } = useTranslation();
  usePageMeta({ title: t(`site.${page}.metaTitle`), description: t(`site.${page}.metaDescription`), path });
  const sections = useObjects<TitledItem>(`site.${page}.sections`, ['title', 'body']);
  return (
    <>
      <Breadcrumb items={[{ label: t(`site.nav.${page}`) }]} />
      <section className="site-hero site-hero--page" aria-labelledby={`${page}-title`}>
        <div className="site-container site-hero-center">
          <IconTile name={icon} size="lg" />
          <h1 id={`${page}-title`}>{t(`site.${page}.title`)}</h1>
          <p className="site-lead">{t(`site.${page}.lead`)}</p>
        </div>
      </section>
      <section className="site-section site-section--light" aria-label={t(`site.${page}.title`)}>
        <div className="site-container site-narrow site-prose">
          {sections.map((section) => (
            <section key={section.title} className="site-card">
              <h2>{section.title}</h2>
              <p>{section.body}</p>
            </section>
          ))}
          <section className="site-card site-card--planned" data-testid={`${page}-pending`}>
            <h2>
              <Icon name="clock" /> {t(`site.${page}.pendingTitle`)}
            </h2>
            <p>{t(`site.${page}.pendingBody`)}</p>
          </section>
          <p className="site-signin-hint">
            {t('site.prose.questions')} <Link to="/contact">{t('site.nav.contact')}</Link>
          </p>
        </div>
      </section>
    </>
  );
}

export function SecurityPage() {
  return <ProsePage page="security" path="/security" icon="shield" />;
}

export function PrivacyPage() {
  return <ProsePage page="privacy" path="/privacy" icon="lock" />;
}
