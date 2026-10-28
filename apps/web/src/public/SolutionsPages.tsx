import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Icon } from '../components/Icon';
import { usePageMeta, usePrivatePageMeta } from '../lib/pageMeta';
import {
  Breadcrumb,
  CardGrid,
  CreateLink,
  CtaBlock,
  Faq,
  FeatureList,
  ProductFrame,
  SaasOwnershipComparison,
  SectionHeader,
  SolutionCards,
  SolutionIcon,
  Steps,
} from './shared';
import { useList, useObjects, type QuestionItem, type TitledItem } from './useList';
import { SOLUTIONS, findSolution, inquiryPath } from './solutions';

export function SolutionsPage() {
  const { t } = useTranslation();
  usePageMeta({ title: t('site.solutions.metaTitle'), description: t('site.solutions.metaDescription'), path: '/solutions' });
  const [selected, setSelected] = useState(SOLUTIONS[0]!.slug);
  const current = findSolution(selected) ?? SOLUTIONS[0]!;
  const highlights = useList(`site.solutions.${current.key}.highlights`);
  const rows = useObjects<{ need: string; paper: string; raclinic: string }>('site.solutions.paper.rows', ['need', 'paper', 'raclinic']);

  return (
    <>
      <Breadcrumb items={[{ label: t('site.solutions.title') }]} />
      <section className="site-hero site-hero--page" aria-labelledby="solutions-title">
        <div className="site-container site-hero-grid">
          <div className="site-hero-text">
            <p className="site-eyebrow">{t('site.solutions.eyebrow')}</p>
            <h1 id="solutions-title">{t('site.solutions.title')}</h1>
            <p className="site-lead">{t('site.solutions.lead')}</p>
            {/* Chips choose the preview on the side (reference P22); each solution also has its page. */}
            <div className="site-chips site-chips--start" role="group" aria-label={t('site.solutions.previewLabel')}>
              {SOLUTIONS.map((s) => (
                <button
                  key={s.slug}
                  type="button"
                  className={`site-chip tone-${s.tone}`}
                  aria-pressed={selected === s.slug}
                  onClick={() => setSelected(s.slug)}
                >
                  <SolutionIcon solution={s} size="sm" />
                  {t(`site.solutions.${s.key}.name`)}
                </button>
              ))}
            </div>
            <div className={`site-card site-card--toned tone-${current.tone}`} aria-live="polite">
              <h2 className="site-card-title">{t(`site.solutions.${current.key}.name`)}</h2>
              <FeatureList items={highlights} compact />
              <Link className="site-link-arrow" to={`/solutions/${current.slug}`}>
                {t('site.solutions.labels.explore')} <Icon name="arrowForward" />
              </Link>
            </div>
          </div>
          <ProductFrame key={current.slug} shot={current.shot} alt={t(`site.solutions.${current.key}.shotAlt`)} label={t(`site.solutions.${current.key}.name`)} />
        </div>
      </section>

      <section className="site-section" aria-labelledby="catalog-title">
        <div className="site-container">
          <SectionHeader id="catalog-title" title={t('site.solutions.catalogTitle')} lead={t('site.solutions.catalogLead')} />
          <SolutionCards />
        </div>
      </section>

      <section className="site-section site-section--light" aria-labelledby="paper-title">
        <div className="site-container">
          <SectionHeader id="paper-title" center title={t('site.solutions.paper.title')} lead={t('site.solutions.paper.lead')} />
          <div className="site-table-wrap">
            <table className="site-table">
              <thead>
                <tr>
                  <th scope="col">{t('site.solutions.paper.need')}</th>
                  <th scope="col">{t('site.solutions.paper.paperCol')}</th>
                  <th scope="col" className="site-table-us">
                    raclinic
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.need}>
                    <th scope="row">{row.need}</th>
                    <td className="site-no">{row.paper}</td>
                    <td className="site-table-us">
                      <span className="site-yes">✓</span> {row.raclinic}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="site-section" aria-labelledby="compare-title">
        <div className="site-container">
          <SectionHeader id="compare-title" center eyebrow={t('site.compare.eyebrow')} title={t('site.compare.title')} lead={t('site.compare.lead')} />
          <SaasOwnershipComparison />
        </div>
      </section>

      <CtaBlock title={t('site.solutions.closing.title')} body={t('site.solutions.closing.body')} />
    </>
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
  const solution = findSolution(slug)!;
  const base = `site.solutions.${solution.key}`;
  const needs = useList(`${base}.needs`);
  const planned = useList(`${base}.planned`);
  const shared = useList('site.shared');
  const problems = useObjects<TitledItem>(`${base}.problems`, ['title', 'body']);
  const tools = useObjects<TitledItem>(`${base}.tools`, ['title', 'body']);
  const workflow = useObjects<TitledItem>(`${base}.workflow`, ['title', 'body']);
  const faq = useObjects<QuestionItem>(`${base}.faq`, ['q', 'a']);
  usePageMeta({
    title: t(`${base}.name`),
    description: t(`${base}.metaDescription`),
    path: `/solutions/${slug}`,
    structuredData: faq.length
      ? {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faq.map((item) => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })),
        }
      : undefined,
  });
  const tone = solution.tone;

  return (
    <div className={`tone-${tone}`}>
      <Breadcrumb items={[{ to: '/solutions', label: t('site.solutions.title') }, { label: t(`${base}.name`) }]} />
      <section className="site-hero site-hero--page" aria-labelledby="solution-title">
        <div className="site-container site-hero-grid">
          <div className="site-hero-text">
            <p className="site-pill site-pill--tone">{t(`${base}.badge`)}</p>
            <h1 id="solution-title">{t(`${base}.name`)}</h1>
            <p className="site-lead">{t(`${base}.lead`)}</p>
            <div className="site-cta-row">
              <CreateLink className="button button--primary button--large" start={solution.start} testId="solution-create" />
              <Link className="button button--secondary button--large" to={inquiryPath(solution.inquiryInterest)} data-testid="solution-custom">
                {t('site.cta.custom')}
              </Link>
            </div>
            <p className="site-signin-hint">{t(`${base}.audience`)}</p>
          </div>
          <ProductFrame shot={solution.shot} alt={t(`${base}.shotAlt`)} label={t(`${base}.name`)} floats={useList(`${base}.floats`)} />
        </div>
      </section>

      <section className="site-section" aria-labelledby="problems-title">
        <div className="site-container">
          <SectionHeader id="problems-title" eyebrow={t('site.solutions.labels.problemsEyebrow')} title={t(`${base}.problemsTitle`)} />
          <CardGrid items={problems} columns={3} tone={tone} />
        </div>
      </section>

      <section className="site-section site-section--light" aria-labelledby="tools-title">
        <div className="site-container site-split">
          <div className="site-split-text">
            <p className="site-eyebrow">{t('site.solutions.labels.toolsEyebrow')}</p>
            <h2 id="tools-title">{t(`${base}.toolsTitle`)}</h2>
            <p>{t('site.solutions.labels.plannedNote')}</p>
            <div className="site-card site-card--planned" data-testid="planned-tools">
              <h3>
                <Icon name="clock" /> {t('site.solutions.labels.planned')}
              </h3>
              <ul className="site-checklist site-checklist--compact">
                {planned.map((item) => (
                  <li key={item}>
                    <Icon name="check" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <ul className="site-grid site-grid--2">
            {tools.map((tool) => (
              <li key={tool.title} className="site-card site-card--toned">
                <h3>{tool.title}</h3>
                <p>{tool.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="site-section" aria-labelledby="workflow-title">
        <div className="site-container">
          <SectionHeader id="workflow-title" center eyebrow={t('site.solutions.labels.workflowEyebrow')} title={t(`${base}.workflowTitle`)} />
          <Steps items={workflow} tone={tone} />
        </div>
      </section>

      <section className="site-section site-section--mint" aria-labelledby="audience-title">
        <div className="site-container site-split">
          <div className="site-split-text">
            <p className="site-eyebrow">{t('site.solutions.labels.audience')}</p>
            <h2 id="audience-title">{t('site.solutions.labels.needs')}</h2>
            <FeatureList items={needs} />
          </div>
          <div className="site-card">
            <h3>{t('site.solutions.labels.available')}</h3>
            <FeatureList items={shared} testId="available-now" compact />
          </div>
        </div>
      </section>

      {faq.length > 0 && (
        <section className="site-section" aria-labelledby="solution-faq-title">
          <div className="site-container site-narrow">
            <SectionHeader id="solution-faq-title" center eyebrow={t('site.home.faqEyebrow')} title={t('site.solutions.labels.faqTitle', { name: t(`${base}.name`) })} />
            <Faq items={faq} />
          </div>
        </section>
      )}

      <section className="site-section site-section--light" aria-labelledby="compare-title">
        <div className="site-container">
          <SectionHeader id="compare-title" center eyebrow={t('site.compare.eyebrow')} title={t('site.compare.title')} lead={t('site.compare.lead')} />
          <SaasOwnershipComparison interest={solution.inquiryInterest} />
        </div>
      </section>

      <CtaBlock title={t(`${base}.closingTitle`)} body={t('site.solutions.labels.closingBody')} />
    </div>
  );
}

export function PublicNotFound() {
  const { t } = useTranslation();
  usePrivatePageMeta(t('site.notFound.title'));
  return (
    <section className="site-section">
      <div className="site-container site-narrow site-hero-center">
        <h1>{t('site.notFound.title')}</h1>
        <p className="site-lead">{t('site.notFound.body')}</p>
        <div className="site-cta-row">
          <Link className="button button--primary" to="/solutions">
            {t('site.notFound.solutions')}
          </Link>
          <Link className="button button--secondary" to="/contact">
            {t('site.nav.contact')}
          </Link>
        </div>
      </div>
    </section>
  );
}
