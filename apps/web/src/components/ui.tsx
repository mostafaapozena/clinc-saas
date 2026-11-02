import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '../lib/format';

/**
 * A labelled form control. The label is tied to the control by `id`; the hint and the error are
 * tied to it through aria-describedby (merged with any ids the control already names), the error
 * sets aria-invalid, and `required` sets aria-required — so assistive technology announces what a
 * sighted user reads. Wrap exactly one control; groups use <fieldset>.
 */
export function Field({
  id,
  label,
  error,
  hint,
  required,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const date =
    Children.count(children) === 1 && isValidElement<Record<string, unknown>>(children) ? dateValueOf(children.type, children.props) : null;
  const dateId = date ? `${id}-date` : undefined;
  let control = children;
  if (Children.count(children) === 1 && isValidElement<Record<string, unknown>>(children)) {
    const own = typeof children.props['aria-describedby'] === 'string' ? (children.props['aria-describedby'] as string) : '';
    const describedBy = [...new Set([...own.split(' '), dateId, hintId, errorId].filter(Boolean))].join(' ');
    control = cloneElement(children, {
      ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      ...(error ? { 'aria-invalid': true } : {}),
      ...(required && children.props.required === undefined ? { 'aria-required': true } : {}),
    });
  }
  return (
    <div className="field">
      {/* The asterisk is CSS-only: required/aria-required on the control already announces it. */}
      <label htmlFor={id} className={required ? 'label--required' : undefined}>
        {label}
      </label>
      {control}
      {date && <DateEcho id={dateId} value={date} />}
      {hintId && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {errorId && (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The value of a controlled native date input, when it holds a full date. */
function dateValueOf(type: unknown, props: Record<string, unknown>): string | null {
  return type === 'input' && props.type === 'date' && typeof props.value === 'string' && ISO_DATE.test(props.value) ? props.value : null;
}

/**
 * The chosen date with its weekday and month by name, in the UI language ("الأربعاء، 4 مارس 2026").
 * A native date field shows its value in the browser's own format, so 03/04/2026 can be 4 March or
 * 3 April depending on the browser's language, not the app's; this line states the day the app
 * understood. `Field` adds it under every controlled date input and names it in aria-describedby.
 */
export function DateEcho({ id, value, inline }: { id?: string; value: string; inline?: boolean }) {
  const fmt = useFormatters();
  if (!ISO_DATE.test(value)) return null;
  const Tag = inline ? 'span' : 'p';
  return (
    <Tag className="field-hint date-echo" id={id}>
      {fmt.localDate(value)}
    </Tag>
  );
}

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
/** A status label. The tone carries meaning (warning = needs attention, danger = wrong or overdue). */
export function Badge({ tone = 'neutral', children, testId }: { tone?: BadgeTone; children: ReactNode; testId?: string }) {
  return (
    <span className={`badge badge--${tone}`} data-testid={testId}>
      {children}
    </span>
  );
}

export function Notice({ kind, children }: { kind: 'success' | 'error' | 'info' | 'warning'; children: ReactNode }) {
  return (
    <div className={`notice notice--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <p className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label ?? t('common.loading')}
    </p>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="notice notice--error" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="button button--secondary" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

/**
 * Nothing to show yet. `icon` names the context (patients, invoices…); without it a neutral mark.
 * `action` is the next step (a link or button) when the viewer can take one (UX-028).
 */
export function EmptyState({ children, icon, action }: { children: ReactNode; icon?: IconName; action?: ReactNode }) {
  const next = action ? <span className="empty-state-action">{action}</span> : null;
  if (!icon)
    return (
      <p className="empty-state">
        {children}
        {next}
      </p>
    );
  return (
    <p className="empty-state empty-state--icon">
      <span className="empty-state-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      {children}
      {next}
    </p>
  );
}
