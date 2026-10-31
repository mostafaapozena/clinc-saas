import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Icon } from './Icon';

/**
 * Title, subtitle and the page's actions (children). A detail page passes `back`: the list it
 * belongs to, shown above the title, so the viewer never loses their place (UX-018). `help` is
 * static policy text ("not a tax invoice"), folded under the subtitle instead of a banner (UX-021).
 */
export function PageHeader({
  title,
  subtitle,
  back,
  help,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: { to: string; label: string };
  help?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="page-header">
      <div>
        {back && (
          <Link className="page-back" to={back.to}>
            <Icon name="arrowBack" aria-hidden="true" />
            {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {help && (
          <details className="page-help">
            <summary>
              <Icon name="help" aria-hidden="true" />
              {t('common.aboutPage')}
            </summary>
            <p>{help}</p>
          </details>
        )}
      </div>
      {children}
    </div>
  );
}
