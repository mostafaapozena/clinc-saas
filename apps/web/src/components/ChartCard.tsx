import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from './Icon';

// Charts of the reports center (docs/DESIGN_SYSTEM.md "Charts"): small inline SVG drawings in the
// theme tokens, no chart library. Every chart has a title, a context line (period, currency,
// source), a legend with direct labels, and a "Show as table" alternative with the same numbers.
// Bars compare, lines show change over time, the donut shows the parts of a positive total,
// horizontal bars rank or age. Auditable statements are never charts.

export type ChartSeries = { key: string; label: string; values: number[] };
type Kind = 'bar' | 'line' | 'donut' | 'hbar';

const W = 320;
const H = 180;
const PAD = { top: 12, bottom: 28, side: 8 };

function niceMax(values: number[]) {
  const max = Math.max(0, ...values);
  if (max === 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / p) * p;
}

type Plot = { labels: string[]; series: ChartSeries[]; rtl: boolean; w: number; format: (v: number) => string };

/** The value of the top gridline, so the axis states its unit (currency). */
function Scale({ max, y, w, rtl, format }: { max: number; y: (v: number) => number; w: number; rtl: boolean; format: (v: number) => string }) {
  return (
    <text className="chart-label chart-scale" x={rtl ? w - PAD.side : PAD.side} y={y(max) - 4} textAnchor="start">
      {format(max)}
    </text>
  );
}

function Bars({ labels, series, rtl, w, format }: Plot) {
  const max = niceMax(series.flatMap((s) => s.values));
  const slot = (w - PAD.side * 2) / labels.length;
  const bar = Math.min(28, (slot * 0.7) / series.length);
  const y = (v: number) => H - PAD.bottom - (v / max) * (H - PAD.top - PAD.bottom);
  return (
    <>
      <Scale max={max} y={y} w={w} rtl={rtl} format={format} />
      <line className="chart-axis" x1={PAD.side} x2={w - PAD.side} y1={H - PAD.bottom} y2={H - PAD.bottom} />
      {labels.map((label, i) => {
        const index = rtl ? labels.length - 1 - i : i;
        const x0 = PAD.side + index * slot + (slot - bar * series.length) / 2;
        return (
          <g key={label}>
            {series.map((s, k) => (
              <rect
                key={s.key}
                className={`chart-fill-${k + 1}`}
                x={x0 + k * bar}
                y={y(s.values[i] ?? 0)}
                width={bar - 2}
                height={H - PAD.bottom - y(s.values[i] ?? 0)}
                rx={3}
              />
            ))}
            <text className="chart-label" x={PAD.side + index * slot + slot / 2} y={H - 8} textAnchor="middle">
              {label}
            </text>
          </g>
        );
      })}
    </>
  );
}

function Lines({ labels, series, rtl, w, format }: Plot) {
  const max = niceMax(series.flatMap((s) => s.values));
  const step = labels.length > 1 ? (w - PAD.side * 4) / (labels.length - 1) : 0;
  const x = (i: number) => PAD.side * 2 + (rtl ? labels.length - 1 - i : i) * step;
  const y = (v: number) => H - PAD.bottom - (v / max) * (H - PAD.top - PAD.bottom);
  return (
    <>
      {[0.5, 1].map((f) => (
        <line key={f} className="chart-gridline" x1={PAD.side} x2={w - PAD.side} y1={y(max * f)} y2={y(max * f)} />
      ))}
      <Scale max={max} y={y} w={w} rtl={rtl} format={format} />
      <line className="chart-axis" x1={PAD.side} x2={w - PAD.side} y1={H - PAD.bottom} y2={H - PAD.bottom} />
      {series.map((s, k) => (
        <g key={s.key} className={`chart-stroke-${k + 1}`}>
          <polyline fill="none" strokeWidth={2.5} points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
          {s.values.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r={3.5} />
          ))}
        </g>
      ))}
      {labels.map((label, i) => (
        <text key={label} className="chart-label" x={x(i)} y={H - 8} textAnchor="middle">
          {label}
        </text>
      ))}
    </>
  );
}

function Donut({ values }: { values: number[] }) {
  const total = values.reduce((s, v) => s + v, 0);
  const r = 58;
  const c = 2 * Math.PI * r;
  const lengths = values.map((v) => (total ? (v / total) * c : 0));
  const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((s, l) => s + l, 0));
  return (
    <g transform={`translate(${W / 2} ${H / 2})`}>
      <circle r={r} className="chart-track" fill="none" strokeWidth={22} />
      {lengths.map((len, i) => (
        <circle
          key={i}
          r={r}
          fill="none"
          className={`chart-stroke-${(i % 5) + 1}`}
          strokeWidth={22}
          strokeDasharray={`${len} ${c - len}`}
          strokeDashoffset={-starts[i]!}
          transform="rotate(-90)"
        />
      ))}
    </g>
  );
}

function HBars({ labels, values, format }: { labels: string[]; values: number[]; format: (v: number) => string }) {
  const max = niceMax(values);
  return (
    <ul className="hbar-list">
      {labels.map((label, i) => (
        <li key={label}>
          <span className="hbar-label">{label}</span>
          <span className="hbar-track" aria-hidden="true">
            <span className="hbar-fill chart-fill-1" style={{ inlineSize: `${((values[i] ?? 0) / max) * 100}%` }} />
          </span>
          <span className="hbar-value">{format(values[i] ?? 0)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ChartCard({
  title,
  icon,
  context,
  kind,
  labels,
  series,
  format,
  empty,
  loading,
  error,
  testId,
  wide,
}: {
  title: string;
  icon?: IconName;
  /** Period, currency and source, e.g. "Last 6 months · EGP · issued invoices". */
  context: ReactNode;
  kind: Kind;
  labels: string[];
  series: ChartSeries[];
  format: (value: number) => string;
  /** Shown instead of a chart when every value is zero (never an invented series). */
  empty: string;
  loading?: boolean;
  error?: ReactNode;
  testId?: string;
  /** A time series that spans its row: drawn wider so its points do not crowd (UI-08). */
  wide?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [table, setTable] = useState(false);
  const id = useId();
  const rtl = i18n.dir() === 'rtl';
  const w = wide && (kind === 'line' || kind === 'bar') ? W * 2 : W;
  const hasData = series.some((s) => s.values.some((v) => v !== 0));
  const donutTotal = kind === 'donut' ? (series[0]?.values ?? []).reduce((s, v) => s + v, 0) : 0;
  // One non-zero part is not a composition: show the figure, not a 100% ring (UX-022).
  const parts = kind === 'donut' ? (series[0]?.values ?? []).flatMap((v, i) => (v !== 0 ? [i] : [])) : [];
  const single = parts.length === 1 ? parts[0]! : null;
  return (
    <section className={wide ? 'card chart-card chart-card--wide' : 'card chart-card'} aria-labelledby={`${id}-title`} data-testid={testId}>
      <div className="chart-head">
        <h3 id={`${id}-title`} className="card-title">
          {icon && <Icon name={icon} aria-hidden="true" />}
          {title}
        </h3>
        {hasData && !loading && !error && (
          <button type="button" className="button button--ghost button--sm" aria-pressed={table} onClick={() => setTable((v) => !v)}>
            {table ? t('charts.showChart') : t('charts.showTable')}
          </button>
        )}
      </div>
      <p className="chart-context">{context}</p>
      {loading ? (
        <div className="chart-skeleton" aria-busy="true" aria-label={t('common.loading')} />
      ) : error ? (
        error
      ) : !hasData ? (
        <p className="chart-empty">{empty}</p>
      ) : table ? (
        <div className="table-wrap">
          <table className="data-table data-table--scroll">
            <thead>
              <tr>
                <th scope="col">{t('charts.item')}</th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="num">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((label, i) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  {series.map((s) => (
                    <td key={s.key} className="num">
                      {format(s.values[i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : single !== null ? (
        <div className="chart-single" data-testid={testId ? `${testId}-single` : undefined}>
          <p className="chart-single-label">{labels[single]}</p>
          <p className="chart-single-value">{format(series[0]?.values[single] ?? 0)}</p>
          <p className="muted small">{t('charts.wholeTotal')}</p>
        </div>
      ) : kind === 'hbar' ? (
        <HBars labels={labels} values={series[0]?.values ?? []} format={format} />
      ) : (
        <>
          <div className={`chart-body chart-body--${kind}`}>
            <svg viewBox={`0 0 ${w} ${H}`} role="img" aria-label={`${title}: ${t('charts.summary', { count: labels.length })}`} className="chart-svg">
              {kind === 'bar' && <Bars labels={labels} series={series} rtl={rtl} w={w} format={format} />}
              {kind === 'line' && <Lines labels={labels} series={series} rtl={rtl} w={w} format={format} />}
              {kind === 'donut' && <Donut values={series[0]?.values ?? []} />}
            </svg>
            {kind === 'donut' && (
              <ul className="chart-legend chart-legend--side">
                {labels.map((label, i) => (
                  <li key={label}>
                    <span className={`chart-swatch chart-fill-${(i % 5) + 1}`} aria-hidden="true" />
                    <span>{label}</span>
                    <span className="chart-legend-value">
                      {format(series[0]?.values[i] ?? 0)} · {donutTotal ? Math.round(((series[0]?.values[i] ?? 0) / donutTotal) * 100) : 0}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {kind !== 'donut' && (
            <ul className="chart-legend">
              {series.map((s, k) => (
                <li key={s.key}>
                  <span className={`chart-swatch chart-fill-${k + 1}`} aria-hidden="true" />
                  <span>{s.label}</span>
                  <span className="chart-legend-value">{format(s.values.reduce((a, v) => a + v, 0))}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
