import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { intlLocale } from '../lib/format';

/**
 * A real number that counts up once, when it first appears: on mount for dashboards (`when="mount"`;
 * mount it only once the data has loaded) or when scrolled into view on the public site
 * (`when="visible"`). Later value changes — a background refresh, another branch — show the new
 * value at once, never animating from a previous scope's number.
 *
 * React always renders the exact final value. The moving digits live in a separate node that React
 * never fills, hidden from screen readers; it only runs with requestAnimationFrame and no
 * reduced-motion preference, so without scripts or with reduced motion the final value just shows.
 */
export function CountUp({
  value,
  when = 'mount',
  duration = 700,
  format,
}: {
  value: number;
  when?: 'mount' | 'visible';
  duration?: number;
  format?: (value: number) => string;
}) {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage === 'en' ? 'en' : 'ar';
  const decimals = Number.isInteger(value) ? 0 : (String(value).split('.')[1]?.length ?? 0);
  const show = format ?? ((n: number) => new Intl.NumberFormat(intlLocale(language), { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n));
  const finalRef = useRef<HTMLSpanElement>(null);
  const movingRef = useRef<HTMLSpanElement>(null);
  const showRef = useRef(show);
  const firstValue = useRef(value);
  const done = useRef(false);

  useLayoutEffect(() => {
    showRef.current = show;
  });

  // Decided once, for the first value only.
  useLayoutEffect(() => {
    const target = firstValue.current;
    const final = finalRef.current;
    const moving = movingRef.current;
    done.current = false; // StrictMode runs this effect twice; the first cleanup finished it.
    if (!final || !moving || !canAnimate(target)) {
      done.current = true;
      return;
    }
    const step = (n: number) => {
      moving.textContent = showRef.current(decimals ? n : Math.round(n));
    };
    const finish = () => {
      done.current = true;
      moving.hidden = true;
      moving.textContent = '';
      final.classList.remove('visually-hidden');
    };
    final.classList.add('visually-hidden');
    moving.hidden = false;
    step(0);

    let frame = 0;
    const run = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / duration);
        if (progress >= 1 || done.current) return finish();
        step(target * (1 - (1 - progress) ** 3));
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    let observer: IntersectionObserver | undefined;
    if (when === 'visible') {
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer?.disconnect();
          run();
        },
        { threshold: 0.4 },
      );
      observer.observe(final.parentElement ?? final);
    } else run();
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      finish();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one animation, for the first value
  }, []);

  // Any later value (refresh, scope change) ends a running animation right away.
  useEffect(() => {
    if (value !== firstValue.current) done.current = true;
  }, [value]);

  return (
    <span className="count-up">
      <span ref={movingRef} aria-hidden="true" hidden />
      <span ref={finalRef}>{show(value)}</span>
    </span>
  );
}

function canAnimate(value: number) {
  if (!Number.isFinite(value) || value === 0) return false;
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return false;
  if (typeof IntersectionObserver === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
