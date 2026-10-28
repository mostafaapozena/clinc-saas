import { useEffect, useRef, type RefObject } from 'react';

/**
 * After a failed submit, moves focus (and the view) to the first invalid field inside `container`,
 * or else to its error notice. Without it the errors render out of view and nothing seems to happen.
 * Runs again for every new error object, i.e. on every failed attempt.
 */
export function useFocusOnError(container: RefObject<HTMLElement | null>, error: unknown) {
  useEffect(() => {
    if (!error) return;
    const root = container.current;
    const target = root?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? root?.querySelector<HTMLElement>('[role="alert"]');
    if (!target) return;
    if (!target.matches('input, select, textarea, button') && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: 'center' });
  }, [container, error]);
}

/**
 * Moves focus to the new page's heading (or the main region) after client-side navigation, so the
 * change is announced and keyboard users start at the content. Not on the first render.
 */
export function useRouteFocus(main: RefObject<HTMLElement | null>, routeKey: string) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const root = main.current;
    if (!root) return;
    // The new page already put focus in a field on purpose (e.g. the payment amount): keep it.
    const active = document.activeElement;
    if (active && root.contains(active) && active.matches('input, select, textarea')) return;
    const heading = root.querySelector<HTMLElement>('h1');
    if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    (heading ?? root).focus({ preventScroll: true });
  }, [main, routeKey]);
}

/** aria props tying an input to the hint/error paragraphs rendered by <Field>. */
export function describedBy(id: string, error?: string, hint?: string) {
  return {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const;
}

/**
 * Brings an element that just appeared (a confirmation, the first field to fix) into view and
 * focuses it, so keyboard and screen-reader users land on it. Smooth only without reduced motion.
 */
export function revealAndFocus(element: HTMLElement | null) {
  if (!element) return;
  if (!element.matches('input, select, textarea, button, a[href]') && !element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  element.focus({ preventScroll: true });
}
