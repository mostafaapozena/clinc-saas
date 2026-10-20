import { DateTime } from 'luxon';
import { clock } from './clock.js';

/**
 * Wall-clock handling for an organization's IANA time zone. All offset and daylight-saving
 * arithmetic is delegated to Luxon (which reads the runtime's tz database); nothing here
 * assumes a fixed UTC offset. Instants are stored in UTC; dates and times of day are strings
 * in the organization's zone ("YYYY-MM-DD", "HH:mm").
 */

/** Supported organization time zones. Validated on input; Africa/Cairo is the visible default. */
export const SUPPORTED_TIME_ZONES = [
  'Africa/Cairo',
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Kuwait',
  'Asia/Qatar',
  'Asia/Bahrain',
  'Asia/Muscat',
  'Asia/Amman',
] as const;
export type SupportedTimeZone = (typeof SUPPORTED_TIME_ZONES)[number];

/** Appointments start and last in multiples of this many minutes. */
export const GRID_MINUTES = 5;
const GRID_MS = GRID_MINUTES * 60_000;
const DAY_MS = 86_400_000;

export const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Interval ends may be "24:00" (end of the day). */
export const END_TIME_PATTERN = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

export function isValidDate(date: string): boolean {
  return DATE_PATTERN.test(date) && DateTime.fromISO(date, { zone: 'utc' }).isValid;
}

export function minutesOfDay(time: string): number {
  const [h = '0', m = '0'] = time.split(':');
  return Number(h) * 60 + Number(m);
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isOnGrid(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes % GRID_MINUTES === 0;
}

/** Calendar arithmetic on a local date string (independent of any zone). */
export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ days }).toISODate() ?? date;
}

/** 0 = Sunday … 6 = Saturday, for a local date string. */
export function weekdayOf(date: string): number {
  return DateTime.fromISO(date, { zone: 'utc' }).weekday % 7;
}

export function todayIn(zone: string, now: Date = clock.now()): string {
  return localDateOf(now, zone);
}

export function localDateOf(instant: Date, zone: string): string {
  return DateTime.fromJSDate(instant, { zone }).toISODate() ?? '';
}

export function localTimeOf(instant: Date, zone: string): string {
  return DateTime.fromJSDate(instant, { zone }).toFormat('HH:mm');
}

export function offsetMinutesAt(instant: Date, zone: string): number {
  return DateTime.fromJSDate(instant, { zone }).offset;
}

/**
 * The instants [start, end) covering a whole local day (23, 24 or 25 hours long). A day starts
 * at its first existing wall-clock time (midnight may be skipped by a daylight-saving jump).
 */
export function dayRange(date: string, zone: string): { start: Date; end: Date } {
  const firstInstant = (day: string): Date => {
    for (let m = 0; m <= 180; m += GRID_MINUTES) {
      const [first] = localCandidates(day, m, zone);
      if (first) return first.instant;
    }
    throw new Error('No existing time near midnight on ' + day);
  };
  return { start: firstInstant(date), end: firstInstant(addDays(date, 1)) };
}

export type LocalCandidate = { instant: Date; offsetMinutes: number };

/**
 * Every instant at which the zone's clock shows `date` + `minutes` after midnight:
 * none for a time skipped by a daylight-saving jump, two for a repeated hour, otherwise one.
 * Works by testing the offsets in force around that wall-clock time.
 */
export function localCandidates(date: string, minutes: number, zone: string): LocalCandidate[] {
  const wallAsUtc = DateTime.fromISO(date, { zone: 'utc' }).plus({ minutes }).toMillis();
  const offsets = new Set<number>(
    [wallAsUtc - DAY_MS, wallAsUtc, wallAsUtc + DAY_MS].map((ms) => DateTime.fromMillis(ms, { zone }).offset),
  );
  const candidates: LocalCandidate[] = [];
  for (const offset of offsets) {
    const instant = wallAsUtc - offset * 60_000;
    if (DateTime.fromMillis(instant, { zone }).offset === offset) {
      candidates.push({ instant: new Date(instant), offsetMinutes: offset });
    }
  }
  return candidates.sort((a, b) => a.instant.getTime() - b.instant.getTime());
}

export type LocalResolution =
  | { kind: 'ok'; instant: Date; offsetMinutes: number }
  | { kind: 'nonexistent' }
  | { kind: 'ambiguous'; offsets: number[] };

/**
 * Resolves a booking's local date and time. A nonexistent time is rejected; a repeated time
 * needs the caller to name the UTC offset it means (the slot list provides it) — the server
 * never silently picks one.
 */
export function resolveLocalTime(
  date: string,
  time: string,
  zone: string,
  utcOffsetMinutes?: number,
): LocalResolution {
  const candidates = localCandidates(date, minutesOfDay(time), zone);
  if (candidates.length === 0) return { kind: 'nonexistent' };
  if (utcOffsetMinutes !== undefined) {
    const match = candidates.find((c) => c.offsetMinutes === utcOffsetMinutes);
    return match ? { kind: 'ok', ...match } : { kind: 'nonexistent' };
  }
  const [only] = candidates;
  if (candidates.length === 1 && only) return { kind: 'ok', ...only };
  return { kind: 'ambiguous', offsets: candidates.map((c) => c.offsetMinutes) };
}

/**
 * Converts a working interval (local wall times on one date) to instants. Documented policy
 * for daylight-saving edges: a start inside a skipped hour begins at the first existing time
 * after it; a repeated start uses its earlier occurrence and a repeated end its later one.
 */
export function intervalInstants(
  date: string,
  startMinutes: number,
  endMinutes: number,
  zone: string,
): { start: Date; end: Date } | null {
  const first = (minutes: number, pick: 'earliest' | 'latest'): number | null => {
    for (let m = minutes; m <= minutes + 180; m += GRID_MINUTES) {
      const found = localCandidates(date, m, zone);
      if (found.length > 0) {
        const chosen = pick === 'earliest' ? found[0] : found[found.length - 1];
        return chosen ? chosen.instant.getTime() : null;
      }
    }
    return null;
  };
  const start = first(startMinutes, 'earliest');
  const end = first(endMinutes, 'latest');
  if (start === null || end === null || end <= start) return null;
  return { start: new Date(start), end: new Date(end) };
}

/** Five-minute grid cells covered by [start, start + duration). */
export function gridCells(start: Date, durationMinutes: number): Date[] {
  const cells: Date[] = [];
  for (let t = start.getTime(); t < start.getTime() + durationMinutes * 60_000; t += GRID_MS) {
    cells.push(new Date(t));
  }
  return cells;
}

export function isGridInstant(instant: Date): boolean {
  return instant.getTime() % GRID_MS === 0;
}
