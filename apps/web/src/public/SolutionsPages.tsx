import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Icon } from '../components/Icon';
import { usePageMeta, usePrivatePageMeta } from '../lib/pageMeta';
import { FeatureList, SaasOwnershipComparison, SolutionCards } from './shared';
import { useList } from './useList';
import { findSolution, inquiryPath, startPath } from './solutions';

export function SolutionsPage() {
  const { t } = useTranslation();
  usePageMeta({ title: t('site.solutions.metaTitle'), description: t('site.solutions.metaDescription'), path: '/solutions' });
  return (
    <section className="site-section" aria-labelledby="solutions-title">
      <div className="site-container">
        <h1 id="solutions-title">{t('site.solutions.title')}</h1>
        <p className="site-section-lead">{t('site.solutions.lead')}</p>
        <SolutionCards />
      </div>
    </section>
  );
}

export function SolutionDetailPage() {
  const { slug } = useParams();
  const solution = findSolution(slug);
  if (!solution) return <PublicNotFound />;
  return <SolutionDetail key={solution.slug} slug={solution.slug} />;
}

function SolutionDetail({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const solution = findSolution(slug);
  const base = `site.solutions.${solution?.key}`;
  const needs = useList(`${base}.needs`);
  const planned = useList(`${base}.planned`);
  const shared = useList('site.shared');
  usePageMeta({ title: t(`${base}.name`), description: t(`${base}.metaDescription`), path: `/solutions/${slug}` });
  if (!solution) return null;

  return (
    <>
      <section className="site-hero site-hero--compact" aria-labelledby="solution-title">
        <div className="site-container site-hero-inner">
          <p className="site-eyebrow">
            <Link to="/solutions">
              <Icon name="arrowBack" /> {t('site.solutions.labels.back')}
            </Link>
          </p>
          <h1 id="solution-title">{t(`${base}.name`)}</h1>
          <p className="site-lead">{t(`${base}.summary`)}</p>
          <div className="site-cta-row">
            <Link className="button button--primary button--large" to={startPath(solution.start)} data-testid="solution-create">
              {t('site.cta.create')}
            </Link>
            <Link className="button button--secondary button--large" to={inquiryPath(solution.inquiryInterest)} data-testid="solution-custom">
              {t('site.cta.custom')}
            </Link>
          </div>
        </div>
      </section>

      <section className="site-section" aria-labelledby="audience-title">
        <div className="site-container site-split">
          <div>
            <h2 id="audience-title">{t('site.solutions.labels.audience')}</h2>
            <p>{t(`${base}.audience`)}</p>
            <h2>{t('site.solutions.labels.needs')}</h2>
            <FeatureList items={needs} />
          </div>
          <div>
            <h2>{t('site.solutions.labels.available')}</h2>
            <FeatureList items={shared} testId="available-now" />
          </div>
        </div>
      </section>

      <section className="site-section site-section--muted" aria-labelledby="planned-title">
        <div className="site-container site-narrow">
          <div className="site-card site-card--planned" data-testid="planned-tools">
            <h2 id="planned-title">
              <Icon name="clock" /> {t('site.solutions.labels.planned')}
            </h2>
            <p className="site-planned-note">{t('site.solutions.labels.plannedNote')}</p>
            <ul className="site-planned-list">
              {planned.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="site-section" aria-labelledby="compare-title">
        <div className="site-container">
          <h2 id="compare-title">{t('site.compare.title')}</h2>
          <SaasOwnershipComparison interest={solution.inquiryInterest} />
        </div>
      </section>
    </>
  );
}

export function PublicNotFound() {
  const { t } = useTranslation();
  usePrivatePageMeta(t('site.notFound.title'));
  return (
    <section className="site-section">
      <div className="site-container site-narrow">
        <h1>{t('site.notFound.title')}</h1>
        <p>{t('site.notFound.body')}</p>
        <Link className="button button--primary" to="/solutions">
          {t('site.notFound.solutions')}
        </Link>
      </div>
    </section>
  );
}
