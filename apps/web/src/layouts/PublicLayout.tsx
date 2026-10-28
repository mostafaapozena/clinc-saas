import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { BrandLogo } from '../components/BrandLogo';
import { Icon } from '../components/Icon';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

/**
 * Layout of sign-in, registration, onboarding and simple standalone pages. With `brand`, the
 * stacked raclinic lockup and tagline introduce the page instead of the header wordmark. With
 * `panel`, a navy panel beside the form lists what the workspace includes (wide screens only).
 */
export function PublicLayout({ children, actions, brand = false, panel = false }: { children: ReactNode; actions?: ReactNode; brand?: boolean; panel?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={panel ? 'public-layout public-layout--split' : 'public-layout'}>
      <div className="public-layout-form">
        <header className="public-header">
          {brand ? (
            <span />
          ) : (
            <Link to="/" className="public-brand">
              <BrandLogo variant="wordmark" />
            </Link>
          )}
          <div className="public-header-actions">
            {actions}
            <LanguageSwitcher />
          </div>
        </header>
        <main id="main-content" className="public-main">
          {brand && (
            <div className="auth-brand">
              <Link to="/" className="auth-brand-link">
                <BrandLogo variant="lockup" />
              </Link>
              <p className="brand-tagline">{t('app.tagline')}</p>
            </div>
          )}
          {children}
        </main>
        <footer className="app-footer">
          <Link to="/status">{t('auth.systemStatus')}</Link> · {t('footer.devOnly')}
        </footer>
      </div>
      {panel && <AuthPanel />}
    </div>
  );
}

/** What the workspace includes today, with a real screenshot (synthetic data). */
function AuthPanel() {
  const { t, i18n } = useTranslation();
  const points = t('auth.panel.points', { returnObjects: true });
  const language = i18n.language === 'en' ? 'en' : 'ar';
  return (
    <aside className="auth-panel" aria-labelledby="auth-panel-title">
      <div className="auth-panel-inner">
        <h2 id="auth-panel-title">{t('auth.panel.title')}</h2>
        <ul className="auth-panel-points">
          {(Array.isArray(points) ? (points as string[]) : []).map((point) => (
            <li key={point}>
              <Icon name="check" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
        <img className="auth-panel-shot" src={`/product/${language}/appointments.jpg`} alt={t('auth.panel.shotAlt')} loading="lazy" decoding="async" />
        <p className="auth-panel-note">{t('auth.panel.note')}</p>
      </div>
    </aside>
  );
}
