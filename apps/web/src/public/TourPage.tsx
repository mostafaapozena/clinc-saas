import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { usePageMeta } from '../lib/pageMeta';
import { Breadcrumb, CtaBlock } from './shared';
import { productShot } from './solutions';

/**
 * Product tour (reference P36): real screenshots of the workspace, taken with the synthetic demo
 * data, grouped by area. Each links to the page that describes that area. The capture date is the
 * date the images were last regenerated (scripts/brand/product-shots.cjs).
 */
export const TOUR_CAPTURED = '2026-10-27';
const GROUPS = [
  { key: 'frontDesk', shots: [{ shot: 'appointments', to: '/solutions/dentistry' }, { shot: 'week', to: '/solutions/medical-centers' }] },
  { key: 'patients', shots: [{ shot: 'patients', to: '/solutions/medical-centers' }, { shot: 'home', to: '/solutions/medical-centers' }] },
  { key: 'clinical', shots: [{ shot: 'record', to: '/solutions/dentistry' }, { shot: 'dental', to: '/solutions/dentistry' }, { shot: 'physio', to: '/solutions/physiotherapy' }, { shot: 'ent', to: '/solutions/ent' }] },
  { key: 'finance', shots: [{ shot: 'finance', to: '/tour' }, { shot: 'services', to: '/tour' }] },
] as const;

export function TourPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? 'ar';
  usePageMeta({ title: t('site.tour.metaTitle'), description: t('site.tour.metaDescription'), path: '/tour' });
  const total = GROUPS.reduce((n, g) => n + g.shots.length, 0);
  const captured = new Intl.DateTimeFormat(language === 'en' ? 'en' : 'ar-u-nu-latn', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${TOUR_CAPTURED}T00:00:00Z`));

  return (
    <>
      <Breadcrumb items={[{ label: t('site.nav.tour') }]} />
      <section className="site-hero site-hero--page" aria-labelledby="tour-title">
        <div className="site-container site-hero-center">
          <p className="site-eyebrow">{t('site.tour.eyebrow')}</p>
          <h1 id="tour-title">{t('site.tour.title')}</h1>
          <p className="site-lead">{t('site.tour.lead')}</p>
          <ul className="site-stat-row">
            <li>
              <strong>{total}</strong>
              <span>{t('site.tour.statShots')}</span>
            </li>
            <li>
              <strong>{GROUPS.length}</strong>
              <span>{t('site.tour.statGroups')}</span>
            </li>
            <li>
              <strong>2</strong>
              <span>{t('site.tour.statLanguages')}</span>
            </li>
          </ul>
          <p className="muted small">{t('site.tour.captured', { date: captured })}</p>
        </div>
      </section>
      <section className="site-section site-section--light" aria-label={t('site.tour.title')}>
        <div className="site-container">
          {GROUPS.map((group) => (
            <div key={group.key} className="site-gallery-group">
              <div className="site-gallery-head">
                <h2>{t(`site.tour.groups.${group.key}.title`)}</h2>
                <p>{t(`site.tour.groups.${group.key}.body`)}</p>
              </div>
              <ul className="site-grid site-grid--2">
                {group.shots.map(({ shot, to }) => (
                  <li key={shot} className="site-card site-shot">
                    <a href={productShot(shot, language)} target="_blank" rel="noopener" aria-label={t('site.tour.open', { name: t(`site.tour.shots.${shot}.title`) })}>
                      <img src={productShot(shot, language)} alt={t(`site.tour.shots.${shot}.alt`)} width={1280} height={800} loading="lazy" decoding="async" />
                    </a>
                    <div className="site-shot-body">
                      <h3>{t(`site.tour.shots.${shot}.title`)}</h3>
                      <p>{t(`site.tour.shots.${shot}.body`)}</p>
                      {to !== '/tour' && (
                        <Link className="site-link-arrow" to={to}>
                          {t('site.tour.related')} <Icon name="arrowForward" />
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
      <CtaBlock title={t('site.tour.closingTitle')} body={t('site.tour.closingBody')} />
    </>
  );
}
