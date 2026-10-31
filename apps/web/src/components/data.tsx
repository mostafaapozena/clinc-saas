import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../lib/finance';
import { useFormatters } from '../lib/format';

// Data display components of the design system (docs/DESIGN_SYSTEM.md §4): tables, pagination,
// filters, key/value lists, money, dates and confirmations. Pages use these instead of assembling
// table markup, number alignment and date formats by hand.

export type Column<T> = {
  key: string;
  /** Header text; also the cell label when the table stacks into cards on phones. */
  label: string;
  cell: (row: T) => ReactNode;
  /** Numbers and amounts: end-aligned, tabular figures. */
  numeric?: boolean;
  /** The server can order by this column (paginated collections sort on the server). */
  sortable?: boolean;
};

export type Sort = { key: string; dir: 'asc' | 'desc' };

/**
 * A data table. Sorting is server-side: the header reports the requested order through `onSort`
 * and the page asks the API again, so the order is right across pages, not only on the current one.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  testId,
  caption,
  sort,
  onSort,
  rowClassName,
  scroll,
}: {
  columns: (Column<T> | false | null | undefined)[];
  rows: T[];
  rowKey: (row: T) => string;
  testId?: string;
  caption?: string;
  sort?: Sort;
  onSort?: (sort: Sort) => void;
  rowClassName?: (row: T) => string | undefined;
  /** Keep the columns and scroll sideways on phones (statements), instead of stacking rows. */
  scroll?: boolean;
}) {
  const { t } = useTranslation();
  const cols = columns.filter(Boolean) as Column<T>[];
  return (
    <div className="table-wrap">
      <table className={scroll ? 'data-table data-table--scroll' : 'data-table'} data-testid={testId}>
        {caption && <caption className="visually-hidden">{caption}</caption>}
        <thead>
          <tr>
            {cols.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={c.numeric ? 'num' : undefined}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.sortable && onSort ? (
                    <button
                      type="button"
                      className="sort-button"
                      onClick={() => onSort({ key: c.key, dir: active && sort.dir === 'asc' ? 'desc' : 'asc' })}
                    >
                      {c.label}
                      <span className="visually-hidden">
                        {active ? t(sort.dir === 'asc' ? 'common.sortedAsc' : 'common.sortedDesc') : t('common.sortable')}
                      </span>
                      <span className="sort-mark" aria-hidden="true">
                        {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={rowClassName?.(row)}>
              {cols.map((c) => (
                <td key={c.key} data-label={c.label} className={c.numeric ? 'num' : undefined}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Previous / next with the position, for server-paginated collections. */
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize && page <= 1) return null;
  return (
    <nav className="pagination" aria-label={t('common.pagination')}>
      <button type="button" className="button button--secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t('common.previous')}
      </button>
      <span className="muted" aria-live="polite">
        {t('common.pageOf', { page: fmt.number(page), pages: fmt.number(pages), total: fmt.number(total) })}
      </span>
      <button type="button" className="button button--secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t('common.next')}
      </button>
    </nav>
  );
}

/** Filters above a list: one responsive row, and a reset when any filter is set. */
export function FilterBar({ children, active, onReset }: { children: ReactNode; active?: boolean; onReset?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="filters" role="group" aria-label={t('common.filters')}>
      {children}
      {active && onReset && (
        <div className="filters-reset">
          <button type="button" className="button button--ghost" onClick={onReset}>
            {t('common.resetFilters')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Label / value pairs (record details), one layout everywhere. */
export function DescriptionList({ items, testId }: { items: ({ label: string; value: ReactNode } | false | null | undefined)[]; testId?: string }) {
  return (
    <dl className="details" data-testid={testId}>
      {(items.filter(Boolean) as { label: string; value: ReactNode }[]).map((i) => (
        <Fragment key={i.label}>
          <dt>{i.label}</dt>
          <dd>{i.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** An amount in minor units. Without a currency (not configured yet) it shows a dash. */
export function Money({ minor, currency }: { minor: number | null | undefined; currency: string | null | undefined }) {
  const { i18n } = useTranslation();
  if (!currency || minor === null || minor === undefined) return <span className="money">—</span>;
  return <span className="money">{formatMoney(minor, currency, i18n.language)}</span>;
}

/**
 * A date in the UI language. `value` is a calendar date ("YYYY-MM-DD", e.g. an expiry) or, with
 * `timeZone`, an instant shown in the organization's zone. Never the raw ISO text.
 */
export function DateText({ value, timeZone, withTime }: { value: string | null | undefined; timeZone?: string; withTime?: boolean }) {
  const fmt = useFormatters();
  if (!value) return <span>—</span>;
  const text = timeZone ? (withTime ? fmt.dateTime(value, timeZone) : fmt.date(value)) : fmt.calendarDate(value);
  return <time dateTime={value}>{text}</time>;
}

/** A quantity with its unit, as a number in the UI language. */
export function Quantity({ value, unit, signed }: { value: number; unit?: string; signed?: boolean }) {
  const fmt = useFormatters();
  const text = `${signed && value > 0 ? '+' : ''}${fmt.number(value)}`;
  return (
    <span className="quantity">
      <bdi dir="ltr">{text}</bdi>
      {unit ? ` ${unit}` : ''}
    </span>
  );
}

/**
 * A consequential action confirmed in place: the first press shows what will happen with a
 * confirm and a cancel button (focus moves to cancel), the second press acts.
 */
export function ConfirmAction({
  label,
  ariaLabel,
  message,
  confirmLabel,
  onConfirm,
  pending,
  danger = true,
}: {
  label: string;
  /** Fuller accessible name for the first button (e.g. with the member's name). */
  ariaLabel?: string;
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  pending?: boolean;
  danger?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);
  const tone = danger ? 'button button--danger' : 'button button--primary';
  if (!open)
    return (
      <button
        type="button"
        className={danger ? 'button button--danger-outline' : 'button button--secondary'}
        onClick={() => setOpen(true)}
        aria-label={ariaLabel}
      >
        {label}
      </button>
    );
  return (
    <div className="confirm-panel" role="group" aria-label={ariaLabel ?? label}>
      <p>{message}</p>
      <div className="form-actions form-actions--start">
        <button
          type="button"
          className={tone}
          disabled={pending}
          onClick={() => {
            onConfirm();
            setOpen(false);
          }}
        >
          {confirmLabel ?? label}
        </button>
        <button ref={cancelRef} type="button" className="button button--secondary" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

/** A placeholder with the shape of the content while it loads (the page frame is already shown). */
export function Skeleton({ lines = 3, label }: { lines?: number; label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="skeleton" role="status">
      <span className="visually-hidden">{label ?? t('common.loading')}</span>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skeleton-line" aria-hidden="true" />
      ))}
    </div>
  );
}
