import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useSearchParams } from 'react-router';
import { useSession } from '../auth/session';
import { BrandLogo } from '../components/BrandLogo';
import { Icon } from '../components/Icon';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { setLanguage } from '../i18n';
import { SolutionIcon, IconTile } from './shared';
import { useSiteMotion } from './motion';
import { SOLUTIONS, findSolution, startPath } from './solutions';
import './public.css';

/** Company pages, shown in the "Company" menu and the footer. */
const COMPANY = [
  { to: '/about', key: 'about', icon: 'building' },
  { to: '/contact', key: 'contact', icon: 'mail' },
  { to: '/security', key: 'security', icon: 'shield' },
  { to: '/privacy', key: 'privacy', icon: 'lock' },
] as const;

/**
 * Layout of the public platform website. Separate from the authenticated workspace: it loads no
 * organization data. The only session information used is whether someone is signed in, to offer
 * "go to my workspace" instead of sign-up.
 */
export function PublicSiteLayout() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const signedIn = Boolean(useSession().data);
  // Menus remember the page they were opened on, so any navigation closes them.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const [menuState, setMenuState] = useState<{ menu: 'solutions' | 'company'; path: string } | null>(null);
  const drawerOpen = drawerPath === location.pathname;
  const openMenu = menuState?.path === location.pathname ? menuState.menu : null;
  const setDrawerOpen = (open: boolean | ((current: boolean) => boolean)) =>
    setDrawerPath((typeof open === 'function' ? open(drawerOpen) : open) ? location.pathname : null);
  const setOpenMenu = (menu: 'solutions' | 'company' | null) => setMenuState(menu ? { menu, path: location.pathname } : null);
  const navRef = useRef<HTMLUListElement>(null);
  const siteRef = useRef<HTMLDivElement>(null);
  useSiteMotion(siteRef);
  // On a solution page every "create" action keeps that solution's pre-selection (UX-014).
  const solution = findSolution(location.pathname.match(/^\/solutions\/([^/]+)/)?.[1]);
  const createPath = startPath(solution?.start);
  const requested = params.get('lang');

  // `?lang=en|ar` selects the page language (these are the hreflang alternate URLs).
  useEffect(() => {
    if (requested === 'en' || requested === 'ar') void setLanguage(requested);
  }, [requested]);

  useEffect(() => {
    if (!drawerOpen && !openMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Focus goes back to the control that opened the menu or drawer (not to the page body).
      const trigger = openMenu
        ? navRef.current?.querySelector<HTMLButtonElement>(`[aria-controls="menu-${openMenu}"]`)
        : document.querySelector<HTMLButtonElement>('[aria-controls="site-drawer"]');
      setDrawerPath(null);
      setMenuState(null);
      trigger?.focus();
    };
    const onPointer = (event: MouseEvent) => {
      if (openMenu && !navRef.current?.contains(event.target as Node)) setMenuState(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [drawerOpen, openMenu]);

  const keepLanguageInUrl = (language: 'ar' | 'en') => {
    const next = new URLSearchParams(params);
    if (language === 'en') next.set('lang', 'en');
    else next.delete('lang');
    setParams(next, { replace: true });
  };

  const inSolutions = location.pathname.startsWith('/solutions') || location.pathname.startsWith('/custom-solutions');
  const inCompany = COMPANY.some((c) => location.pathname === c.to);
  const toggle = (menu: 'solutions' | 'company') => setOpenMenu(openMenu === menu ? null : menu);
  // Tabbing out of an open menu closes it, so it never stays open over the page.
  const closeOnFocusOut = (event: FocusEvent<HTMLLIElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuState(null);
  };

  const solutionLinks = SOLUTIONS.map((s) => (
    <li key={s.slug}>
      <MenuItem to={`/solutions/${s.slug}`} icon={<SolutionIcon solution={s} size="sm" />} title={t(`site.solutions.${s.key}.name`)} description={t(`site.solutions.${s.key}.tagline`)} />
    </li>
  ));
  const companyLinks = COMPANY.map((c) => (
    <li key={c.to}>
      <MenuItem to={c.to} icon={<IconTile name={c.icon} size="sm" />} title={t(`site.nav.${c.key}`)} description={t(`site.nav.descriptions.${c.key}`)} />
    </li>
  ));
  const workspaceActions = signedIn ? (
    <Link className="button button--primary" to="/app">
      {t('site.nav.goToWorkspace')}
    </Link>
  ) : (
    <>
      <Link className="site-signin" to="/login">
        {t('site.nav.signIn')}
      </Link>
      <Link className="button button--primary" to={createPath}>
        {t('site.nav.createWorkspace')}
      </Link>
    </>
  );

  return (
    <div className="site" ref={siteRef}>
      <a className="skip-link" href="#main-content">
        {t('shell.skipToContent')}
      </a>
      <header className="site-header">
        <div className="site-header-inner">
          <Link to="/" className="public-brand" aria-label={t('site.nav.homeLink')}>
            <BrandLogo variant="wordmark" />
          </Link>
          <nav aria-label={t('site.nav.main')}>
            <ul className="site-nav" ref={navRef}>
              <li onBlur={closeOnFocusOut}>
                <button
                  type="button"
                  className={inSolutions ? 'site-nav-trigger site-nav-trigger--active' : 'site-nav-trigger'}
                  aria-expanded={openMenu === 'solutions'}
                  aria-controls="menu-solutions"
                  onClick={() => toggle('solutions')}
                >
                  {t('site.nav.solutions')} <Icon name="chevronDown" />
                </button>
                {openMenu === 'solutions' && (
                  <div className="site-dropdown" id="menu-solutions">
                    <p className="site-dropdown-title">{t('site.nav.solutionsMenu')}</p>
                    <ul className="site-dropdown-grid">{solutionLinks}</ul>
                    <div className="site-dropdown-footer">
                      <Link to="/custom-solutions">
                        <Icon name="scan" /> {t('site.nav.customMenu')}
                      </Link>
                      <Link to="/solutions">
                        {t('site.nav.allSolutions')} <Icon name="arrowForward" />
                      </Link>
                    </div>
                  </div>
                )}
              </li>
              <li>
                <NavLink to="/tour" className="site-nav-link">
                  {t('site.nav.tour')}
                </NavLink>
              </li>
              <li>
                <NavLink to="/custom-solutions" className="site-nav-link">
                  {t('site.nav.custom')}
                </NavLink>
              </li>
              <li onBlur={closeOnFocusOut}>
                <button
                  type="button"
                  className={inCompany ? 'site-nav-trigger site-nav-trigger--active' : 'site-nav-trigger'}
                  aria-expanded={openMenu === 'company'}
                  aria-controls="menu-company"
                  onClick={() => toggle('company')}
                >
                  {t('site.nav.company')} <Icon name="chevronDown" />
                </button>
                {openMenu === 'company' && (
                  <div className="site-dropdown" id="menu-company">
                    <ul className="site-dropdown-grid site-dropdown-grid--single">{companyLinks}</ul>
                  </div>
                )}
              </li>
              <li>
                <NavLink to="/faq" className="site-nav-link">
                  {t('site.nav.faq')}
                </NavLink>
              </li>
            </ul>
          </nav>
          <div className="site-header-actions">
            <ThemeSwitcher />
            <LanguageSwitcher onSwitched={keepLanguageInUrl} />
            {workspaceActions}
          </div>
          <button
            type="button"
            className="icon-button site-menu-button"
            aria-expanded={drawerOpen}
            aria-controls="site-drawer"
            aria-label={drawerOpen ? t('site.nav.closeMenu') : t('site.nav.openMenu')}
            onClick={() => setDrawerOpen((open) => !open)}
          >
            <Icon name={drawerOpen ? 'close' : 'menu'} />
          </button>
        </div>
        <div className={drawerOpen ? 'site-drawer site-drawer--open' : 'site-drawer'} id="site-drawer" hidden={!drawerOpen}>
          <nav aria-label={t('site.nav.mobile')}>
            <ul className="site-drawer-links">
              <li>
                <details>
                  <summary>
                    {t('site.nav.solutions')} <Icon name="chevronDown" />
                  </summary>
                  <ul>
                    {solutionLinks}
                    <li>
                      <MenuItem to="/custom-solutions" icon={<IconTile name="scan" tone="custom" size="sm" />} title={t('site.nav.custom')} description={t('site.nav.descriptions.custom')} />
                    </li>
                    <li>
                      <MenuItem to="/solutions" icon={<IconTile name="layers" size="sm" />} title={t('site.nav.allSolutions')} />
                    </li>
                  </ul>
                </details>
              </li>
              <li>
                <Link to="/tour">{t('site.nav.tour')}</Link>
              </li>
              <li>
                <details>
                  <summary>
                    {t('site.nav.company')} <Icon name="chevronDown" />
                  </summary>
                  <ul>{companyLinks}</ul>
                </details>
              </li>
              <li>
                <Link to="/faq">{t('site.nav.faq')}</Link>
              </li>
            </ul>
          </nav>
          <div className="site-drawer-actions">
            {signedIn ? (
              <Link className="button button--primary button--large" to="/app">
                {t('site.nav.goToWorkspace')}
              </Link>
            ) : (
              <>
                <Link className="button button--primary button--large" to={createPath}>
                  {t('site.nav.createWorkspace')}
                </Link>
                <Link className="button button--secondary button--large" to="/login">
                  {t('site.nav.signIn')}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main id="main-content" className="site-main" tabIndex={-1}>
        <Outlet />
      </main>
      <SiteFooter signedIn={signedIn} createPath={createPath} />
    </div>
  );
}

/** One entry of the header menus and the mobile drawer: icon tile, name, optional description. */
function MenuItem({ to, icon, title, description }: { to: string; icon: ReactNode; title: string; description?: string }) {
  return (
    <Link className="site-menu-item" to={to}>
      {icon}
      <span className="site-menu-item-text">
        <strong>{title}</strong>
        {description && <span className="site-menu-item-desc">{description}</span>}
      </span>
    </Link>
  );
}

function SiteFooter({ signedIn, createPath }: { signedIn: boolean; createPath: string }) {
  const { t } = useTranslation();
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-top">
          <div className="site-footer-brand">
            <Link to="/" className="site-footer-logo" aria-label={t('site.nav.homeLink')}>
              <BrandLogo variant="wordmark" />
            </Link>
            <p>{t('site.footer.about')}</p>
            <p>{t('site.footer.byDevware')}</p>
          </div>
          <div className="site-footer-col">
            <h2>{t('site.footer.groups.solutions')}</h2>
            <ul>
              {SOLUTIONS.map((s) => (
                <li key={s.slug}>
                  <Link to={`/solutions/${s.slug}`}>{t(`site.solutions.${s.key}.name`)}</Link>
                </li>
              ))}
              <li>
                <Link to="/solutions">{t('site.nav.allSolutions')}</Link>
              </li>
            </ul>
          </div>
          <div className="site-footer-col">
            <h2>{t('site.footer.groups.product')}</h2>
            <ul>
              <li>
                <Link to="/tour">{t('site.nav.tour')}</Link>
              </li>
              <li>
                <Link to="/custom-solutions">{t('site.nav.custom')}</Link>
              </li>
              <li>
                <Link to="/faq">{t('site.nav.faq')}</Link>
              </li>
              <li>
                <Link to="/status">{t('site.footer.status')}</Link>
              </li>
            </ul>
          </div>
          <div className="site-footer-col">
            <h2>{t('site.footer.groups.company')}</h2>
            <ul>
              {COMPANY.map((c) => (
                <li key={c.to}>
                  <Link to={c.to}>{t(`site.nav.${c.key}`)}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="site-footer-col">
            <h2>{t('site.footer.groups.account')}</h2>
            <ul>
              {signedIn ? (
                <li>
                  <Link to="/app">{t('site.nav.goToWorkspace')}</Link>
                </li>
              ) : (
                <>
                  <li>
                    <Link to="/login">{t('site.nav.signIn')}</Link>
                  </li>
                  <li>
                    <Link to={createPath}>{t('site.nav.createWorkspace')}</Link>
                  </li>
                </>
              )}
              <li>
                <Link to="/custom-solutions/request">{t('site.footer.customRequest')}</Link>
              </li>
            </ul>
          </div>
        </div>
        <p className="site-footer-notice" role="note">
          <Icon name="clock" /> <span>{t('site.footer.devNotice')}</span>
        </p>
        <div className="site-footer-bottom">
          <span>{t('site.footer.rights', { year })}</span>
          <ul>
            <li>
              <Link to="/privacy">{t('site.nav.privacy')}</Link>
            </li>
            <li>
              <Link to="/security">{t('site.nav.security')}</Link>
            </li>
            <li>
              <Link to="/status">
                <span className="site-status-dot" aria-hidden="true" />
                {t('site.footer.status')}
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
