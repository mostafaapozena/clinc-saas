import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, matchPath, useLocation } from 'react-router';
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

/** A module page. Pages that share a `group` appear as one primary tab with a second row of their own. */
export type ModuleTab = { to: string; label: string; end?: boolean; group?: string };

type Entry = { key: string; to: string; label: string; end?: boolean; members: ModuleTab[] };

const matches = (tab: ModuleTab, pathname: string) => matchPath({ path: tab.to, end: tab.end ?? false }, pathname) !== null;

/**
 * Module navigation: one row of primary tabs that scrolls sideways when it does not fit (never wraps
 * into several rows), and, for a group of pages, a second row with the group's pages. The active
 * tab is brought into view when the page changes only, never while the viewer scrolls the row.
 */
export function ModuleTabs({ items, label, groups = {} }: { items: ModuleTab[]; label: string; groups?: Record<string, string> }) {
  const ref = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  // Which ends hide more tabs: the row fades there, so a clipped tab reads as "more" (UX-020).
  const [more, setMore] = useState({ start: false, end: false });
  const entries: Entry[] = [];
  for (const item of items) {
    const existing = item.group ? entries.find((e) => e.key === item.group) : undefined;
    if (existing) existing.members.push(item);
    else
      entries.push({
        key: item.group ?? item.to,
        to: item.to,
        label: item.group ? (groups[item.group] ?? item.label) : item.label,
        end: item.end,
        members: [item],
      });
  }
  // A group with one visible page is just that page.
  for (const e of entries) if (e.members.length === 1) Object.assign(e, { label: e.members[0]!.label, end: e.members[0]!.end });
  const activeGroup = entries.find((e) => e.members.length > 1 && e.members.some((m) => matches(m, pathname)));
  useEffect(() => {
    const nav = ref.current;
    const active = nav?.querySelector<HTMLElement>('.module-nav-link.active');
    if (!nav || !active) return;
    // Only the tab row scrolls (never the page). Measured on screen, so it is right in RTL and LTR.
    const row = nav.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    nav.scrollBy?.({ left: tab.left + tab.width / 2 - (row.left + row.width / 2), behavior: 'auto' });
  }, [pathname]);
  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const update = () => {
      // scrollLeft is negative in RTL; its magnitude is the distance from the start.
      const pos = Math.abs(nav.scrollLeft);
      const max = nav.scrollWidth - nav.clientWidth;
      setMore((m) => {
        const next = { start: pos > 2, end: max - pos > 2 };
        return next.start === m.start && next.end === m.end ? m : next;
      });
    };
    update();
    nav.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      nav.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [items.length]);
  if (items.length < 2) return null;
  return (
    <>
      <nav
        ref={ref}
        className={['module-nav', more.start && 'module-nav--more-start', more.end && 'module-nav--more-end'].filter(Boolean).join(' ')}
        aria-label={label}
      >
        {entries.map((e) =>
          e.members.length > 1 ? (
            <Link
              key={e.key}
              to={e.to}
              className={e === activeGroup ? 'module-nav-link active' : 'module-nav-link'}
              aria-current={e === activeGroup ? 'true' : undefined}
            >
              {e.label}
            </Link>
          ) : (
            <NavLink key={e.key} to={e.to} end={e.end} className="module-nav-link">
              {e.label}
            </NavLink>
          ),
        )}
      </nav>
      {activeGroup && (
        <nav className="module-subnav" aria-label={activeGroup.label}>
          {activeGroup.members.map((m) => (
            <NavLink key={m.to} to={m.to} end={m.end} className="module-subnav-link">
              {m.label}
            </NavLink>
          ))}
        </nav>
      )}
    </>
  );
}
