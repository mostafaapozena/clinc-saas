import type { Types } from 'mongoose';
import {
  gridCells,
  intervalInstants,
  localCandidates,
  localDateOf,
  localTimeOf,
  minutesOfDay,
  offsetMinutesAt,
  weekdayOf,
} from '../../time/local-time.js';
import { clock } from '../../time/clock.js';
import { ACTIVE_STATUSES } from '../appointments/appointment.state.js';
import { AppointmentModel, SlotReservationModel } from '../appointments/appointment.model.js';
import {
  ScheduleExceptionModel,
  type ScheduleException,
  type WeeklyInterval,
} from '../practitioners/practitioner.model.js';

export type LocalInterval = { start: string; end: string };
type ExceptionLike = Pick<ScheduleException, 'date' | 'branchId' | 'kind' | 'intervals'>;
type ScheduleLike = { branchIds: Types.ObjectId[]; weeklySchedule: WeeklyInterval[] };

const sameId = (a: Types.ObjectId | null | undefined, b: Types.ObjectId | null | undefined) =>
  a != null && b != null && String(a) === String(b);

/** Working intervals of one branch on one local date, after date exceptions. */
export function effectiveIntervals(
  schedule: ScheduleLike,
  exceptions: ExceptionLike[],
  branchId: Types.ObjectId,
  date: string,
): LocalInterval[] {
  if (!schedule.branchIds.some((id) => sameId(id, branchId))) return [];
  const onDate = exceptions.filter((e) => e.date === date);
  if (onDate.some((e) => e.kind === 'closed' && (e.branchId == null || sameId(e.branchId, branchId)))) return [];
  const replacement = onDate.find((e) => e.kind === 'hours' && sameId(e.branchId, branchId));
  if (replacement) return replacement.intervals.map(({ start, end }) => ({ start, end }));
  const weekday = weekdayOf(date);
  return schedule.weeklySchedule
    .filter((i) => i.weekday === weekday && sameId(i.branchId, branchId))
    .map(({ start, end }) => ({ start, end }));
}

/** True when any two intervals overlap (touching ends are allowed). */
export function hasOverlap(intervals: LocalInterval[]): boolean {
  const sorted = [...intervals].sort((a, b) => minutesOfDay(a.start) - minutesOfDay(b.start));
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (previous && current && minutesOfDay(current.start) < minutesOfDay(previous.end)) return true;
  }
  return false;
}

/** A practitioner may work at several branches, but never at two at the same time. */
export function dateHasCrossBranchOverlap(schedule: ScheduleLike, exceptions: ExceptionLike[], date: string): boolean {
  const all = schedule.branchIds.flatMap((branchId) => effectiveIntervals(schedule, exceptions, branchId, date));
  return hasOverlap(all);
}

export function weeklyHasOverlap(weekly: WeeklyInterval[]): boolean {
  for (let weekday = 0; weekday < 7; weekday += 1) {
    if (hasOverlap(weekly.filter((i) => i.weekday === weekday))) return true;
  }
  return false;
}

/** Whether [startAt, endAt) lies inside one working interval of that branch on its local date. */
export function fitsSchedule(
  schedule: ScheduleLike,
  exceptions: ExceptionLike[],
  appointment: { branchId: Types.ObjectId; startAt: Date; endAt: Date },
  zone: string,
): boolean {
  const date = localDateOf(appointment.startAt, zone);
  return effectiveIntervals(schedule, exceptions, appointment.branchId, date).some((interval) => {
    const range = intervalInstants(date, minutesOfDay(interval.start), minutesOfDay(interval.end), zone);
    return range != null && range.start <= appointment.startAt && appointment.endAt <= range.end;
  });
}

export async function loadExceptions(organizationId: Types.ObjectId, practitionerId: Types.ObjectId, from?: string) {
  return ScheduleExceptionModel.find({
    organizationId,
    practitionerId,
    ...(from ? { date: { $gte: from } } : {}),
  })
    .sort({ date: 1 })
    .lean();
}

export type AppointmentRef = { id: string; branchId: string; startAt: string; endAt: string; status: string };

export async function futureActiveAppointments(
  organizationId: Types.ObjectId,
  filter: Record<string, unknown>,
  now = clock.now(),
) {
  return AppointmentModel.find({
    ...filter,
    organizationId,
    status: { $in: ACTIVE_STATUSES },
    endAt: { $gt: now },
  })
    .sort({ startAt: 1 })
    .limit(200)
    .lean();
}

export function toAppointmentRef(a: { _id: Types.ObjectId; branchId: Types.ObjectId; startAt: Date; endAt: Date; status: string }): AppointmentRef {
  return {
    id: String(a._id),
    branchId: String(a.branchId),
    startAt: a.startAt.toISOString(),
    endAt: a.endAt.toISOString(),
    status: a.status,
  };
}

export type Slot = {
  startAt: string;
  endAt: string;
  localDate: string;
  localTime: string;
  utcOffsetMinutes: number;
  /** The wall-clock time occurs twice that day (daylight-saving fall-back). */
  repeatedTime: boolean;
};

/**
 * Bookable start times for one practitioner, branch and local date: inside the effective
 * working intervals, aligned to `step` minutes from each interval start, in the future, and
 * not overlapping the practitioner's existing reservations (in any branch). The client never
 * decides availability — booking re-runs the same checks and the reservation index decides.
 */
export async function computeSlots(input: {
  organizationId: Types.ObjectId;
  practitionerId: Types.ObjectId;
  schedule: ScheduleLike;
  exceptions: ExceptionLike[];
  branchId: Types.ObjectId;
  date: string;
  durationMinutes: number;
  step: number;
  zone: string;
  now?: Date;
  excludeAppointmentId?: Types.ObjectId;
}): Promise<Slot[]> {
  const now = input.now ?? clock.now();
  const ranges = effectiveIntervals(input.schedule, input.exceptions, input.branchId, input.date)
    .map((i) => intervalInstants(input.date, minutesOfDay(i.start), minutesOfDay(i.end), input.zone))
    .filter((r): r is { start: Date; end: Date } => r != null);
  if (ranges.length === 0) return [];

  const minStart = Math.min(...ranges.map((r) => r.start.getTime()));
  const maxEnd = Math.max(...ranges.map((r) => r.end.getTime()));
  const taken = await SlotReservationModel.find({
    organizationId: input.organizationId,
    resourceType: 'practitioner',
    resourceId: input.practitionerId,
    slotStart: { $gte: new Date(minStart), $lt: new Date(maxEnd) },
    ...(input.excludeAppointmentId ? { appointmentId: { $ne: input.excludeAppointmentId } } : {}),
  })
    .select('slotStart')
    .lean();
  const occupied = new Set(taken.map((r) => r.slotStart.getTime()));

  const repeated = (instant: Date) =>
    localCandidates(localDateOf(instant, input.zone), minutesOfDay(localTimeOf(instant, input.zone)), input.zone).length > 1;

  const slots: Slot[] = [];
  const durationMs = input.durationMinutes * 60_000;
  for (const range of ranges.sort((a, b) => a.start.getTime() - b.start.getTime())) {
    for (let t = range.start.getTime(); t + durationMs <= range.end.getTime(); t += input.step * 60_000) {
      if (t <= now.getTime()) continue;
      const start = new Date(t);
      if (gridCells(start, input.durationMinutes).some((cell) => occupied.has(cell.getTime()))) continue;
      slots.push({
        startAt: start.toISOString(),
        endAt: new Date(t + durationMs).toISOString(),
        localDate: localDateOf(start, input.zone),
        localTime: localTimeOf(start, input.zone),
        utcOffsetMinutes: offsetMinutesAt(start, input.zone),
        repeatedTime: repeated(start),
      });
    }
  }
  return slots;
}
