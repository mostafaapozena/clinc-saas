import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CountUp } from '../components/CountUp';
import { Icon, type IconName } from '../components/Icon';
import { SOLUTIONS, inquiryPath, productShot, productShotSet, startPath, type Solution } from './solutions';
import { useList, type QuestionItem, type TitledItem } from './useList';

// Building blocks of the public website (docs/FRONTEND_REDESIGN_IMPLEMENTATION.md). Content comes
// from the locale files; product visuals are real workspace screenshots with synthetic data.

export function FeatureList({ items, testId, compact }: { items: string[]; testId?: string; compact?: boolean }) {
  return (
    <ul className={compact ? 'site-checklist site-checklist--compact' : 'site-checklist'} data-testid={testId}>
      {items.map((item) => (
        <li key={item}>
          <Icon name="check" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** A headline whose second part is emphasized (turquoise family, underline). */
export function Headline({ start, emphasis }: { start: string; emphasis?: string }) {
  return (
    <>
      {start}
      {emphasis && (
        <>
          {' '}
          <span className="site-em">{emphasis}</span>
        </>
      )}
    </>
  );
}

export function SectionHeader({
  id,
  eyebrow,
  title,
  emphasis,
  lead,
  center,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  emphasis?: string;
  lead?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={center ? 'site-section-header site-section-header--center' : 'site-section-header'} data-reveal>
      {eyebrow && <p className="site-eyebrow">{eyebrow}</p>}
      <h2 id={id}>
        <Headline start={title} emphasis={emphasis} />
      </h2>
      {lead && <p>{lead}</p>}
    </div>
  );
}

/**
 * A real workspace screenshot (synthetic data) in a window frame, optionally with floating labels.
 * `priority` for the hero image: loaded at once and early (it is the largest paint), never lazily.
 */
export function ProductFrame({ shot, alt, label, floats = [], priority }: { shot: string; alt: string; label?: string; floats?: string[]; priority?: boolean }) {
  const { i18n } = useTranslation();
  return (
    <figure className="site-frame">
      <div className="site-frame-window">
        <div className="site-frame-bar" aria-hidden="true">
          <span />
          <span />
          <span />
          {label && <em>{label}</em>}
        </div>
        <img
          src={productShot(shot, i18n.resolvedLanguage ?? 'ar')}
          srcSet={productShotSet(shot, i18n.resolvedLanguage ?? 'ar')}
          alt={alt}
          width={1280}
          height={800}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
        />
      </div>
      {floats[0] && <span className="site-float site-float--top">{floats[0]}</span>}
      {floats[1] && <span className="site-float site-float--bottom">{floats[1]}</span>}
    </figure>
  );
}

export function IconTile({ name, tone, size }: { name: IconName; tone?: string; size?: 'sm' | 'lg' }) {
  return (
    <span className={`site-icon-tile${size ? ` site-icon-tile--${size}` : ''}${tone ? ` tone-${tone}` : ''}`} aria-hidden="true">
      <Icon name={name} />
    </span>
  );
}

export function SolutionIcon({ solution, size }: { solution: Solution; size?: 'sm' | 'lg' }) {
  return <IconTile name={solution.icon} tone={solution.tone} size={size} />;
}

/** The four SaaS solutions, then the separate custom-project path (always visually distinct). */
export function SolutionCards() {
  const { t } = useTranslation();
  return (
    <div className="site-stack">
      <ul className="site-grid site-grid--4" data-reveal>
        {SOLUTIONS.map((solution) => (
          <li key={solution.slug} className={`site-card site-card--link site-card--toned tone-${solution.tone}`} data-testid="solution-card">
            <SolutionIcon solution={solution} size="lg" />
            <h3>
              <Link to={`/solutions/${solution.slug}`}>{t(`site.solutions.${solution.key}.name`)}</Link>
            </h3>
            <p>{t(`site.solutions.${solution.key}.summary`)}</p>
            <span className="site-link-arrow" aria-hidden="true">
              {t('site.solutions.labels.explore')} <Icon name="arrowForward" />
            </span>
          </li>
        ))}
      </ul>
      <CustomCard />
    </div>
  );
}

export function CustomCard() {
  const { t } = useTranslation();
  return (
    <div className="site-card site-card--link site-card--custom site-card--wide tone-custom" data-testid="solution-card-custom">
      <IconTile name="scan" tone="custom" size="lg" />
      <div className="site-stack-sm">
        <span className="site-badge site-badge--custom">{t('site.solutions.customCard.badge')}</span>
        <h3>
          <Link to="/custom-solutions">{t('site.solutions.customCard.title')}</Link>
        </h3>
        <p>{t('site.solutions.customCard.body')}</p>
      </div>
      <span className="site-link-arrow" aria-hidden="true">
        {t('site.solutions.customCard.link')} <Icon name="arrowForward" />
      </span>
    </div>
  );
}

/** Hosted subscription workspace versus a separately scoped custom project. */
export function SaasOwnershipComparison({ interest, start }: { interest?: string; start?: Solution['start'] }) {
  const { t } = useTranslation();
  const saas = useList('site.compare.saas.points');
  const ownership = useList('site.compare.ownership.points');
  return (
    <div className="site-compare" data-reveal>
      <section className="site-card site-card--saas" aria-labelledby="compare-saas">
        <IconTile name="layers" />
        <h3 id="compare-saas">{t('site.compare.saas.title')}</h3>
        <p>{t('site.compare.saas.body')}</p>
        <FeatureList items={saas} />
        <CreateLink className="button button--primary" start={start} />
      </section>
      <section className="site-card site-card--ownership tone-custom" aria-labelledby="compare-ownership">
        <IconTile name="scan" tone="custom" />
        <h3 id="compare-ownership">{t('site.compare.ownership.title')}</h3>
        <p>{t('site.compare.ownership.body')}</p>
        <FeatureList items={ownership} />
        <Link className="button button--secondary" to={inquiryPath(interest)}>
          {t('site.cta.custom')}
        </Link>
      </section>
    </div>
  );
}

/** "Create your clinic workspace": /start carries the pre-selection through sign-up into onboarding. */
export function CreateLink({ className, start, testId }: { className: string; start?: Solution['start']; testId?: string }) {
  const { t } = useTranslation();
  return (
    <Link className={className} to={startPath(start)} data-testid={testId}>
      {t('site.cta.create')}
    </Link>
  );
}

export function Faq({ items, testId }: { items: QuestionItem[]; testId?: string }) {
  return (
    <div className="site-faq" data-testid={testId}>
      {items.map((item) => (
        <details key={item.q}>
          <summary>{item.q}</summary>
          <p>{item.a}</p>
        </details>
      ))}
    </div>
  );
}

/** Numbered steps; `icons` (one per step) sit beside each title, the number stays. */
export function Steps({ items, tone, icons }: { items: TitledItem[]; tone?: string; icons?: readonly IconName[] }) {
  return (
    <ol className={`site-steps${tone ? ` tone-${tone}` : ''}`} data-reveal>
      {items.map((item, index) => (
        <li key={item.title}>
          <h3>
            {icons?.[index] && <Icon name={icons[index]} />}
            <span>{item.title}</span>
          </h3>
          <p>{item.body}</p>
        </li>
      ))}
    </ol>
  );
}

/** Cards with a title and text; `icon` for all cards, or `icons` with one per card. */
export function CardGrid({
  items,
  columns = 3,
  icon,
  icons,
  tone,
}: {
  items: TitledItem[];
  columns?: 2 | 3 | 4;
  icon?: IconName;
  icons?: readonly IconName[];
  tone?: string;
}) {
  return (
    <ul className={`site-grid site-grid--${columns}`} data-reveal>
      {items.map((item, index) => {
        const name = icons?.[index] ?? icon;
        return (
          <li key={item.title} className={`site-card${tone ? ` tone-${tone}` : ''}`}>
            {name && <IconTile name={name} tone={tone} />}
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </li>
        );
      })}
    </ul>
  );
}

export function Breadcrumb({ items }: { items: { to?: string; label: string }[] }) {
  const { t } = useTranslation();
  return (
    <nav className="site-breadcrumb" aria-label={t('site.nav.breadcrumb')}>
      <ol>
        <li>
          <Link to="/">{t('site.nav.home')}</Link>
        </li>
        {items.map((item) => (
          <li key={item.label}>{item.to ? <Link to={item.to}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}</li>
        ))}
      </ol>
    </nav>
  );
}

/** One closing block per page (navy), never two in a row (reference P11 adapted). */
export function CtaBlock({ title, body, children, start }: { title: string; body?: string; children?: ReactNode; start?: Solution['start'] }) {
  const { t } = useTranslation();
  return (
    <section className="site-section site-section--tight" aria-labelledby="closing-title">
      <div className="site-container">
        <div className="site-cta-block">
          <div>
            <h2 id="closing-title">{title}</h2>
            {body && <p>{body}</p>}
          </div>
          <div className="site-cta-row">
            {children ?? (
              <>
                <CreateLink className="button button--accent button--large" start={start} />
                <Link className="button button--on-navy button--large" to="/contact">
                  {t('site.nav.contact')}
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Product facts from the locale ("3", "6"…): numeric ones count up once when scrolled into view. */
export function FactValue({ value }: { value: string }) {
  return /^\d+$/.test(value) ? <CountUp value={Number(value)} when="visible" /> : <>{value}</>;
}

export function DevNotice() {
  const { t } = useTranslation();
  return (
    <p className="site-dev-notice" role="note">
      <Icon name="clock" /> <span>{t('site.notice')}</span>
    </p>
  );
}
