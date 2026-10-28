import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CountUp } from './CountUp';
import { Icon, type IconName } from './Icon';

export type MetricTone = 'neutral' | 'info' | 'warn' | 'ok' | 'bad' | 'muted' | 'brand';

/**
 * One dashboard number: icon, label, the real value (counting up once when first shown) and,
 * optionally, a link to the list it counts. Lives inside a <dl className="metrics">. The value
 * keeps its test id; the label is the term, so screen readers read "label: value".
 */
export function Metric({
  icon,
  label,
  value,
  tone = 'neutral',
  to,
  linkLabel,
  hint,
  testId,
  format,
}: {
  icon: IconName;
  label: string;
  value: number;
  tone?: MetricTone;
  /** Where the number leads (a filtered list); the whole card becomes the link. */
  to?: string;
  /** Accessible name of that link, e.g. "Show waiting appointments". */
  linkLabel?: string;
  hint?: ReactNode;
  testId?: string;
  format?: (value: number) => string;
}) {
  return (
    // A zero is information, not an alarm: it is shown in the neutral tone whatever the metric.
    <div className={`metric metric--${tone}${value === 0 ? ' metric--zero' : ''}${to ? ' metric--link' : ''}`}>
      <dt>
        <span className="metric-icon" aria-hidden="true">
          <Icon name={icon} />
        </span>
        <span className="metric-label">{label}</span>
      </dt>
      <dd>
        <span className="metric-value" data-testid={testId}>
          <CountUp value={value} format={format} />
        </span>
        {hint && <span className="metric-hint">{hint}</span>}
        {to && (
          <Link className="metric-target" to={to}>
            <span className="visually-hidden">{linkLabel ?? label}</span>
          </Link>
        )}
      </dd>
    </div>
  );
}
