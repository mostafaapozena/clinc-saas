/**
 * Calendar helpers for local dates ("YYYY-MM-DD") in the organization's time zone. The browser
 * only uses these to choose what to ask for; every rule (availability, today, past/future) is
 * decided again by the API.
 */

/** Today's date in a time zone, via Intl (no fixed offsets). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function datesFrom(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

/** Local date of an instant in a time zone. */
export function localDateOf(iso: string, timeZone: string): string {
  return todayIn(timeZone, new Date(iso));
}

export const isValidDateInput = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** A fresh key per booking attempt; reused when the same attempt is retried. */
export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
