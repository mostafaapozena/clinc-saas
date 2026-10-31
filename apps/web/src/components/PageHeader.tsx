import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from './Icon';

/**
 * Title, subtitle and the page's actions (children). A detail page passes `back`: the list it
 * belongs to, shown above the title, so the viewer never loses their place (UX-018).
 */
export function PageHeader({
  title,
  subtitle,
  back,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: { to: string; label: string };
  children?: ReactNode;
}) {
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
      </div>
      {children}
    </div>
  );
}
