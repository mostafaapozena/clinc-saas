import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CountUp } from '../components/CountUp';
import { Icon } from '../components/Icon';
import { usePageMeta } from '../lib/pageMeta';
import { Breadcrumb, CtaBlock } from './shared';
import { productShot, productShotSet } from './solutions';

/**
 * Product tour (reference P36): real screenshots of the workspace, taken with the synthetic demo
 * data, grouped by area. Each links to the page that describes that area. The capture date is the
 * date the images were last regenerated (scripts/brand/product-shots.cjs).
 */
export const TOUR_CAPTURED = '2026-10-28';
const GROUPS = [
  { key: 'frontDesk', shots: [{ shot: 'appointments', to: '/solutions/dentistry' }, { shot: 'week', to: '/solutions/medical-centers' }] },
  { key: 'patients', shots: [{ shot: 'patients', to: '/solutions/medical-centers' }, { shot: 'home', to: '/solutions/medical-centers' }] },
  { key: 'clinical', shots: [{ shot: 'record', to: '/solutions/dentistry' }, { shot: 'dental', to: '/solutions/dentistry' }, { shot: 'physio', to: '/solutions/physiotherapy' }, { shot: 'ent', to: '/solutions/ent' }] },
  { key: 'finance', shots: [{ shot: 'finance', to: '/tour' }, { shot: 'services', to: '/tour' }] },
] as const;
const ALL_SHOTS = GROUPS.flatMap((g) => g.shots.map((s) => s.shot));

export function TourPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? 'ar';
  usePageMeta({ title: t('site.tour.metaTitle'), description: t('site.tour.metaDescription'), path: '/tour' });
  const total = ALL_SHOTS.length;
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
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
              <strong>
                <CountUp value={total} when="visible" />
              </strong>
              <span>{t('site.tour.statShots')}</span>
            </li>
            <li>
              <strong>
                <CountUp value={GROUPS.length} when="visible" />
              </strong>
              <span>{t('site.tour.statGroups')}</span>
            </li>
            <li>
              <strong>
                <CountUp value={2} when="visible" />
              </strong>
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
                    <button
                      type="button"
                      className="site-shot-open"
                      aria-label={t('site.tour.open', { name: t(`site.tour.shots.${shot}.title`) })}
                      onClick={(event) => {
                        opener.current = event.currentTarget;
                        setOpen(ALL_SHOTS.indexOf(shot));
                      }}
                    >
                      <img src={productShot(shot, language)} srcSet={productShotSet(shot, language)} alt={t(`site.tour.shots.${shot}.alt`)} width={1280} height={800} loading="lazy" decoding="async" />
                    </button>
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
      {open !== null && (
        <ShotDialog
          index={open}
          language={language}
          onMove={setOpen}
          onClose={() => {
            setOpen(null);
            opener.current?.focus();
          }}
        />
      )}
      <CtaBlock title={t('site.tour.closingTitle')} body={t('site.tour.closingBody')} />
    </>
  );
}

/**
 * Full-size view of one screenshot inside the page (UX-010): a native modal <dialog> (focus stays
 * inside, Escape closes), previous/next, and a link to the original file. Focus returns to the
 * thumbnail that opened it.
 */
function ShotDialog({ index, language, onMove, onClose }: { index: number; language: string; onMove: (index: number) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const shot = ALL_SHOTS[index]!;
  const show = (dialog: HTMLDialogElement | null) => {
    if (dialog && !dialog.open) dialog.showModal?.();
  };
  return (
    <dialog
      ref={show}
      className="site-lightbox"
      aria-labelledby="shot-dialog-title"
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop (the dialog box itself, outside its content) closes it.
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <div className="site-lightbox-body">
        <header className="site-lightbox-head">
          <div>
            <h2 id="shot-dialog-title">{t(`site.tour.shots.${shot}.title`)}</h2>
            <p>{t('site.tour.dialog.position', { current: index + 1, total: ALL_SHOTS.length })}</p>
          </div>
          <form method="dialog">
            <button type="submit" className="icon-button" aria-label={t('site.tour.dialog.close')} autoFocus>
              <Icon name="close" />
            </button>
          </form>
        </header>
        <img src={productShot(shot, language)} srcSet={productShotSet(shot, language)} alt={t(`site.tour.shots.${shot}.alt`)} width={1280} height={800} />
        <footer className="site-lightbox-foot">
          <button type="button" className="button button--secondary" disabled={index === 0} onClick={() => onMove(index - 1)}>
            <Icon name="arrowBack" /> {t('site.tour.dialog.previous')}
          </button>
          <a className="site-link-arrow" href={productShot(shot, language)} target="_blank" rel="noopener">
            {t('site.tour.dialog.original')} <Icon name="external" />
          </a>
          <button type="button" className="button button--secondary" disabled={index === ALL_SHOTS.length - 1} onClick={() => onMove(index + 1)}>
            {t('site.tour.dialog.next')} <Icon name="arrowForward" />
          </button>
        </footer>
      </div>
    </dialog>
  );
}
