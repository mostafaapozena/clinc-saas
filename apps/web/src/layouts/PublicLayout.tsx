import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

export function PublicLayout({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="public-layout">
      <header className="public-header">
        <Link to="/" className="public-brand">
          <span className="brand-mark" aria-hidden="true">+</span>
          <span>
            {t('app.name')} <small className="temp-name">({t('app.tempName')})</small>
          </span>
        </Link>
        <div className="public-header-actions">
          {actions}
          <LanguageSwitcher />
        </div>
      </header>
      <main id="main-content" className="public-main">
        {children}
      </main>
      <footer className="app-footer">
        <Link to="/status">{t('auth.systemStatus')}</Link> · {t('footer.devOnly')}
      </footer>
    </div>
  );
}
