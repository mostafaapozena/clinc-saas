import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { SOLUTIONS, inquiryPath, startPath } from './solutions';
import { useList } from './useList';

export function FeatureList({ items, testId }: { items: string[]; testId?: string }) {
  return (
    <ul className="site-checklist" data-testid={testId}>
      {items.map((item) => (
        <li key={item}>
          <Icon name="check" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** The four SaaS solutions plus the separate custom-project path. */
export function SolutionCards() {
  const { t } = useTranslation();
  return (
    <ul className="site-grid site-grid--solutions">
      {SOLUTIONS.map((solution) => (
        <li key={solution.slug} className="site-card site-card--solution" data-testid="solution-card">
          <h3>
            <Link to={`/solutions/${solution.slug}`}>{t(`site.solutions.${solution.key}.name`)}</Link>
          </h3>
          <p>{t(`site.solutions.${solution.key}.summary`)}</p>
          <span className="site-badge">{t('site.solutions.labels.sharedBadge')}</span>
        </li>
      ))}
      <li className="site-card site-card--custom" data-testid="solution-card-custom">
        <h3>
          <Link to="/custom-solutions">{t('site.solutions.customCard.title')}</Link>
        </h3>
        <p>{t('site.solutions.customCard.body')}</p>
        <span className="site-badge site-badge--custom">{t('site.solutions.customCard.badge')}</span>
      </li>
    </ul>
  );
}

/** Hosted subscription workspace versus a separately scoped custom project. */
export function SaasOwnershipComparison({ interest }: { interest?: string }) {
  const { t } = useTranslation();
  const saas = useList('site.compare.saas.points');
  const ownership = useList('site.compare.ownership.points');
  return (
    <div className="site-compare">
      <section className="site-card site-card--saas" aria-labelledby="compare-saas">
        <h3 id="compare-saas">{t('site.compare.saas.title')}</h3>
        <p>{t('site.compare.saas.body')}</p>
        <FeatureList items={saas} />
        <Link className="button button--primary" to={startPath()}>
          {t('site.cta.create')}
        </Link>
      </section>
      <section className="site-card site-card--ownership" aria-labelledby="compare-ownership">
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
