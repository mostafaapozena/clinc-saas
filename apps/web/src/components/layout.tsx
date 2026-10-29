import { useEffect, useRef, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { Icon, type IconName } from './Icon';

// Layout primitives of the design system (docs/DESIGN_SYSTEM.md). Pages compose these instead of
// assembling the CSS classes by hand, so the layout contract (alignment, gaps, columns, overflow)
// is the same in every module. The classes they render are documented in workspace.css.

/** A row of cards. Cards keep their own height (start-aligned); `equal` only for parallel cards. */
export function CardGrid({ children, wide, equal, className = '' }: { children: ReactNode; wide?: boolean; equal?: boolean; className?: string }) {
  return <div className={['card-grid', wide && 'card-grid--wide', equal && 'card-grid--equal', className].filter(Boolean).join(' ')}>{children}</div>;
}

/** A list of Metric cards with responsive columns (auto by default; never one full-width column). */
export function MetricGrid({
  children,
  columns = 'auto',
  testId,
  label,
}: {
  children: ReactNode;
  columns?: 'auto' | 'compact' | 'four' | 'six';
  testId?: string;
  label?: string;
}) {
  return (
    <dl className={`metrics metrics--${columns}`} data-testid={testId} aria-label={label}>
      {children}
    </dl>
  );
}

/** Icon in its own box beside a title and an optional description; the icon never touches wrapped text. */
export function IconLabel({ icon, title, description }: { icon: IconName; title: ReactNode; description?: ReactNode }) {
  return (
    <span className="icon-label">
      <span className="icon-box" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <span className="icon-label-text">
        <span className="icon-label-title">{title}</span>
        {description && <span className="icon-label-description">{description}</span>}
      </span>
    </span>
  );
}

/** A link to a report or a destination: icon box, title and description, and a direction arrow. */
export function ReportLink({ to, icon, title, description }: { to: string; icon: IconName; title: ReactNode; description?: ReactNode }) {
  return (
    <Link to={to} className="report-link">
      <IconLabel icon={icon} title={title} description={description} />
      <span className="report-link-arrow" aria-hidden="true">
        <Icon name="arrowForward" />
      </span>
    </Link>
  );
}

/** Buttons that act on the content above: one row, related spacing, never stretched vertically. */
export function ActionBar({ children, align = 'start' }: { children: ReactNode; align?: 'start' | 'end' | 'between' }) {
  return <div className={`form-actions form-actions--${align}`}>{children}</div>;
}

export type ModuleTab = { to: string; label: string; end?: boolean };

/**
 * Module navigation: one row of tabs that scrolls sideways when it does not fit (never wraps into
 * several rows); the active tab is scrolled into view.
 */
export function ModuleTabs({ items, label }: { items: ModuleTab[]; label: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const active = ref.current?.querySelector<HTMLElement>('.module-nav-link.active');
    // Only the tab row scrolls; the page itself does not move.
    if (active && ref.current) {
      const nav = ref.current;
      const offset = active.offsetLeft - (nav.clientWidth - active.clientWidth) / 2;
      nav.scrollTo?.({ left: offset, behavior: 'auto' });
    }
  });
  if (items.length < 2) return null;
  return (
    <nav ref={ref} className="module-nav" aria-label={label}>
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} className="module-nav-link">
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}
