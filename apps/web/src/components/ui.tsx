import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { useTranslation } from 'react-i18next';

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
  let control = children;
  if (Children.count(children) === 1 && isValidElement<Record<string, unknown>>(children)) {
    const own = typeof children.props['aria-describedby'] === 'string' ? (children.props['aria-describedby'] as string) : '';
    const describedBy = [...new Set([...own.split(' '), hintId, errorId].filter(Boolean))].join(' ');
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

/** Nothing to show yet. `icon` names the context (patients, invoices…); without it a neutral mark. */
export function EmptyState({ children, icon }: { children: ReactNode; icon?: IconName }) {
  if (!icon) return <p className="empty-state">{children}</p>;
  return (
    <p className="empty-state empty-state--icon">
      <span className="empty-state-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      {children}
    </p>
  );
}
