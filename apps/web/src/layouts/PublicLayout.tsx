import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { BrandLogo } from '../components/BrandLogo';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

/**
 * Layout of sign-in, registration, onboarding and simple standalone pages. With `brand`, the
 * stacked raclinic lockup and tagline introduce the page instead of the header wordmark.
 */
export function PublicLayout({ children, actions, brand = false }: { children: ReactNode; actions?: ReactNode; brand?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="public-layout">
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
  );
}
