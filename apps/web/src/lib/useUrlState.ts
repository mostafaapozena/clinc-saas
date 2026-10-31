import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

type Value = string | number | null | undefined;

/**
 * Filter, tab and page state kept in the address (docs/UI_PAGE_PATTERNS.md "Filters"), so a view can
 * be reloaded, shared and returned to with Back. Only identifiers, enums, dates and page numbers go
 * here: names, phones, clinical text and free-text searches stay in component state, never in a URL.
 */
export function useUrlState() {
  const [params, setParams] = useSearchParams();
  const get = useCallback((key: string, fallback = '') => params.get(key) ?? fallback, [params]);
  /** Applies a patch; empty values remove the key. Changing a filter usually also resets `page`. */
  const set = useCallback(
    (patch: Record<string, Value>) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === undefined || value === '') next.delete(key);
            else next.set(key, String(value));
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  return { get, set };
}

/** A positive page number from the address (1 when missing or invalid). */
export const pageParam = (value: string) => (/^[1-9]\d{0,5}$/.test(value) ? Number(value) : 1);
