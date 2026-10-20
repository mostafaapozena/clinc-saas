import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useSearchParams } from 'react-router';
import { useSession } from '../auth/session';
import { Icon } from '../components/Icon';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { setLanguage } from '../i18n';
import { startPath } from './solutions';
import './public.css';

/**
 * Layout of the public platform website (home, solutions, custom projects). Separate from the
 * authenticated workspace: it loads no organization data. The only session information used is
 * whether someone is signed in, to offer "go to my workspace" instead of sign-up.
 */
export function PublicSiteLayout() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const signedIn = Boolean(useSession().data);
  const [menuOpen, setMenuOpen] = useState(false);
  const requested = params.get('lang');

  // `?lang=en|ar` selects the page language (these are the hreflang alternate URLs).
  useEffect(() => {
    if (requested === 'en' || requested === 'ar') void setLanguage(requested);
  }, [requested]);

  const closeMenu = () => setMenuOpen(false);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const keepLanguageInUrl = (language: 'ar' | 'en') => {
    const next = new URLSearchParams(params);
    if (language === 'en') next.set('lang', 'en');
    else next.delete('lang');
    setParams(next, { replace: true });
  };

  const links = [
    { to: '/', label: t('site.nav.home'), end: true },
    { to: '/solutions', label: t('site.nav.solutions') },
    { to: '/custom-solutions', label: t('site.nav.custom') },
  ];

  return (
    <div className="site">
      <a className="skip-link" href="#main-content">
        {t('shell.skipToContent')}
      </a>
      <header className="site-header">
        <div className="site-header-inner">
          <Link to="/" className="public-brand">
            <span className="brand-mark" aria-hidden="true">+</span>
            <span>
              {t('app.name')} <small className="temp-name">({t('app.tempName')})</small>
            </span>
          </Link>
          <button
            type="button"
            className="icon-button site-menu-button"
            aria-expanded={menuOpen}
            aria-controls="site-nav"
            aria-label={menuOpen ? t('site.nav.closeMenu') : t('site.nav.openMenu')}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name={menuOpen ? 'close' : 'menu'} />
          </button>
          <div className={menuOpen ? 'site-nav-area site-nav-area--open' : 'site-nav-area'} id="site-nav">
            <nav aria-label={t('site.nav.main')}>
              <ul className="site-nav">
                {links.map((link) => (
                  <li key={link.to}>
                    <NavLink to={link.to} end={link.end} className="site-nav-link" onClick={closeMenu}>
                      {link.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="site-actions">
              <LanguageSwitcher onSwitched={keepLanguageInUrl} />
              {signedIn ? (
                <Link className="button button--primary" to="/app" onClick={closeMenu}>
                  {t('site.nav.goToWorkspace')}
                </Link>
              ) : (
                <>
                  <Link className="button button--ghost" to="/login" onClick={closeMenu}>
                    {t('site.nav.signIn')}
                  </Link>
                  <Link className="button button--primary" to={startPath()} onClick={closeMenu}>
                    {t('site.nav.createWorkspace')}
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </header>
      <main id="main-content" className="site-main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="site-footer-inner">
          <p>{t('site.footer.about')}</p>
          <p className="site-footer-notice">{t('site.footer.devNotice')}</p>
          <ul className="site-footer-links">
            <li>
              <Link to="/solutions">{t('site.nav.solutions')}</Link>
            </li>
            <li>
              <Link to="/custom-solutions">{t('site.nav.custom')}</Link>
            </li>
            <li>
              {signedIn ? <Link to="/app">{t('site.nav.goToWorkspace')}</Link> : <Link to="/login">{t('site.nav.signIn')}</Link>}
            </li>
            <li>
              <Link to="/status">{t('site.footer.status')}</Link>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
