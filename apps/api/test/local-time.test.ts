import { describe, expect, it } from 'vitest';
import { checkTransition, type AppointmentStatus, type StatusAction } from '../src/modules/appointments/appointment.state.js';
import { nameKey, normalizePhone, phoneSearchCandidates, toAsciiDigits } from '../src/modules/patients/normalize.js';
import { effectiveIntervals, hasOverlap } from '../src/modules/scheduling/schedule.service.js';
import {
  addDays,
  dayRange,
  gridCells,
  intervalInstants,
  localDateOf,
  resolveLocalTime,
  weekdayOf,
} from '../src/time/local-time.js';
import { Types } from 'mongoose';

const CAIRO = 'Africa/Cairo';

// Egypt (tzdata 2026): clocks jump 00:00 → 01:00 on Friday 24 April 2026 and fall back
// 24:00 → 23:00 at the end of Thursday 29 October 2026.
describe('Cairo daylight-saving boundaries', () => {
  it('rejects a wall-clock time skipped by the spring-forward jump', () => {
    expect(resolveLocalTime('2026-04-24', '00:30', CAIRO)).toEqual({ kind: 'nonexistent' });
    expect(resolveLocalTime('2026-04-24', '00:00', CAIRO)).toEqual({ kind: 'nonexistent' });
    expect(resolveLocalTime('2026-04-24', '01:00', CAIRO)).toMatchObject({ kind: 'ok', offsetMinutes: 180 });
    expect(resolveLocalTime('2026-04-23', '23:55', CAIRO)).toMatchObject({ kind: 'ok', offsetMinutes: 120 });
  });

  it('reports a repeated wall-clock time as ambiguous unless the offset is named', () => {
    expect(resolveLocalTime('2026-10-29', '23:30', CAIRO)).toEqual({ kind: 'ambiguous', offsets: [180, 120] });
    const first = resolveLocalTime('2026-10-29', '23:30', CAIRO, 180);
    const second = resolveLocalTime('2026-10-29', '23:30', CAIRO, 120);
    expect(first).toMatchObject({ kind: 'ok' });
    expect(second).toMatchObject({ kind: 'ok' });
    if (first.kind === 'ok' && second.kind === 'ok') {
      expect(first.instant.toISOString()).toBe('2026-10-29T20:30:00.000Z');
      expect(second.instant.toISOString()).toBe('2026-10-29T21:30:00.000Z');
    }
    // An offset that is not in force at that time is rejected rather than shifted.
    expect(resolveLocalTime('2026-10-29', '10:00', CAIRO, 120)).toEqual({ kind: 'nonexistent' });
  });

  it('gives the transition days 23 and 25 hours and normal days 24', () => {
    const hours = (date: string) => {
      const { start, end } = dayRange(date, CAIRO);
      return (end.getTime() - start.getTime()) / 3_600_000;
    };
    expect(hours('2026-04-24')).toBe(23);
    expect(hours('2026-10-29')).toBe(25);
    expect(hours('2026-11-10')).toBe(24);
  });

  it('converts working intervals across the boundaries with the documented policy', () => {
    // A start inside the skipped hour begins at the first existing time (01:00 EEST).
    const spring = intervalInstants('2026-04-24', 0, 120, CAIRO);
    expect(spring?.start.toISOString()).toBe('2026-04-23T22:00:00.000Z');
    expect(spring?.end.toISOString()).toBe('2026-04-23T23:00:00.000Z');
    // An interval ending at 24:00 on the fall-back day includes the repeated hour.
    const fall = intervalInstants('2026-10-29', 22 * 60, 24 * 60, CAIRO);
    expect(fall?.start.toISOString()).toBe('2026-10-29T19:00:00.000Z');
    expect(fall?.end.toISOString()).toBe('2026-10-29T22:00:00.000Z');
  });

  it('uses the zone, not a fixed offset, for local dates', () => {
    expect(localDateOf(new Date('2026-07-01T21:30:00Z'), CAIRO)).toBe('2026-07-02'); // UTC+3 in summer
    expect(localDateOf(new Date('2026-12-01T21:30:00Z'), CAIRO)).toBe('2026-12-01'); // UTC+2 in winter
    expect(localDateOf(new Date('2026-12-01T21:30:00Z'), 'Asia/Riyadh')).toBe('2026-12-02');
  });
});

describe('calendar helpers', () => {
  it('computes weekdays and adds days on local dates', () => {
    expect(weekdayOf('2026-11-10')).toBe(2); // Tuesday
    expect(weekdayOf('2026-11-13')).toBe(5); // Friday
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('splits a booking into five-minute cells', () => {
    const cells = gridCells(new Date('2026-11-10T08:00:00Z'), 20);
    expect(cells.map((c) => c.toISOString())).toEqual([
      '2026-11-10T08:00:00.000Z',
      '2026-11-10T08:05:00.000Z',
      '2026-11-10T08:10:00.000Z',
      '2026-11-10T08:15:00.000Z',
    ]);
  });

  it('detects overlapping intervals and allows touching ones', () => {
    expect(hasOverlap([{ start: '08:00', end: '12:00' }, { start: '12:00', end: '14:00' }])).toBe(false);
    expect(hasOverlap([{ start: '08:00', end: '12:05' }, { start: '12:00', end: '14:00' }])).toBe(true);
  });

  it('applies closures and replacement hours over weekly intervals', () => {
    const a = new Types.ObjectId();
    const b = new Types.ObjectId();
    const schedule = {
      branchIds: [a, b],
      weeklySchedule: [
        { branchId: a, weekday: 2, start: '08:00', end: '12:00' },
        { branchId: b, weekday: 2, start: '13:00', end: '17:00' },
      ],
    };
    expect(effectiveIntervals(schedule, [], a, '2026-11-10')).toEqual([{ start: '08:00', end: '12:00' }]);
    const closedAll = [{ date: '2026-11-10', branchId: null, kind: 'closed' as const, intervals: [] }];
    expect(effectiveIntervals(schedule, closedAll, b, '2026-11-10')).toEqual([]);
    const hours = [{ date: '2026-11-10', branchId: a, kind: 'hours' as const, intervals: [{ start: '10:00', end: '11:00' }] }];
    expect(effectiveIntervals(schedule, hours, a, '2026-11-10')).toEqual([{ start: '10:00', end: '11:00' }]);
    expect(effectiveIntervals(schedule, hours, b, '2026-11-10')).toEqual([{ start: '13:00', end: '17:00' }]);
  });
});

describe('phone and name normalization', () => {
  it('accepts Arabic-Indic digits and normalizes to E.164', () => {
    expect(toAsciiDigits('٠١٠٠١٢٣٤٥٦٧')).toBe('01001234567');
    expect(toAsciiDigits('۰۱۲')).toBe('012');
    expect(normalizePhone('٠١٠٠ ١٢٣ ٤٥٦٧', 'EG')).toEqual({ country: 'EG', e164: '+201001234567' });
    expect(normalizePhone('+20 100 123 4567')).toEqual({ country: 'EG', e164: '+201001234567' });
    expect(normalizePhone('00966501234567')).toEqual({ country: 'SA', e164: '+966501234567' });
    expect(normalizePhone('0501234567', 'SA')).toEqual({ country: 'SA', e164: '+966501234567' });
  });

  it('never guesses the country of a local number and rejects invalid numbers', () => {
    expect(normalizePhone('01001234567')).toBeNull();
    expect(normalizePhone('0100123', 'EG')).toBeNull();
    expect(normalizePhone('not a phone', 'EG')).toBeNull();
    expect(normalizePhone('+12025550123')).toBeNull(); // valid, but not a supported country
  });

  it('expands a local search term into each supported country', () => {
    expect(phoneSearchCandidates('01001234567')).toContain('+201001234567');
    expect(phoneSearchCandidates('12')).toEqual([]);
  });

  it('builds a search key that ignores Arabic spelling variants', () => {
    expect(nameKey('أحمد  محمود')).toBe(nameKey('احمد محمود'));
    expect(nameKey('فاطمةُ')).toBe(nameKey('فاطمه'));
    expect(nameKey('Sara ADEL')).toBe('sara adel');
  });
});

describe('appointment state machine', () => {
  const base = {
    startAt: new Date('2026-11-10T10:00:00Z'),
    appointmentDate: '2026-11-10',
    today: '2026-11-10',
    now: new Date('2026-11-10T09:00:00Z'),
  };
  const STATUSES: AppointmentStatus[] = ['scheduled', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'];
  const ALLOWED: Record<StatusAction, AppointmentStatus[]> = {
    check_in: ['scheduled'],
    start: ['checked_in'],
    complete: ['in_progress'],
    cancel: ['scheduled', 'checked_in'],
    no_show: ['scheduled'],
  };

  for (const [action, from] of Object.entries(ALLOWED) as [StatusAction, AppointmentStatus[]][]) {
    for (const status of STATUSES) {
      const valid = from.includes(status);
      it(`${action} from ${status} is ${valid ? 'allowed' : 'rejected'}`, () => {
        const result = checkTransition({ ...base, action, status, reason: 'x', now: new Date('2026-11-10T11:00:00Z') });
        expect(result.ok).toBe(valid);
        if (!valid) expect(result).toMatchObject({ code: 'INVALID_TRANSITION' });
      });
    }
  }

  it('allows no-show only after the scheduled start', () => {
    expect(checkTransition({ ...base, action: 'no_show', status: 'scheduled' })).toEqual({ ok: false, code: 'TOO_EARLY' });
    expect(checkTransition({ ...base, action: 'no_show', status: 'scheduled', now: new Date('2026-11-10T10:00:00Z') }).ok).toBe(true);
  });

  it('requires a reason to cancel after check-in, but not before', () => {
    expect(checkTransition({ ...base, action: 'cancel', status: 'checked_in' })).toEqual({ ok: false, code: 'REASON_REQUIRED' });
    expect(checkTransition({ ...base, action: 'cancel', status: 'checked_in', reason: '  ' })).toEqual({ ok: false, code: 'REASON_REQUIRED' });
    expect(checkTransition({ ...base, action: 'cancel', status: 'scheduled' }).ok).toBe(true);
  });

  it('checks in only on the appointment day and never completes future-dated visits', () => {
    const tomorrow = { ...base, appointmentDate: '2026-11-11' };
    expect(checkTransition({ ...tomorrow, action: 'check_in', status: 'scheduled' })).toEqual({ ok: false, code: 'NOT_TODAY' });
    expect(checkTransition({ ...tomorrow, action: 'start', status: 'checked_in' })).toEqual({ ok: false, code: 'NOT_TODAY' });
    expect(checkTransition({ ...tomorrow, action: 'complete', status: 'in_progress' })).toEqual({ ok: false, code: 'NOT_TODAY' });
    const yesterday = { ...base, appointmentDate: '2026-11-09' };
    expect(checkTransition({ ...yesterday, action: 'check_in', status: 'scheduled' })).toEqual({ ok: false, code: 'NOT_TODAY' });
  });
});
