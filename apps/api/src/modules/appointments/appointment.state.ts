import type { Permission } from '../../tenancy/permissions.js';

/**
 * The appointment state machine — the only place transitions are defined. Every role,
 * including owners and admins, goes through it; there is no override.
 *
 *   scheduled ──check_in──▶ checked_in ──start──▶ in_progress ──complete──▶ completed
 *       │                      │
 *       ├──cancel──▶ cancelled ◀┘ (from checked_in only with a reason)
 *       └──no_show─▶ no_show      (only once the scheduled start has passed)
 */
export const APPOINTMENT_STATUSES = [
  'scheduled',
  'checked_in',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const STATUS_ACTIONS = ['check_in', 'start', 'complete', 'cancel', 'no_show'] as const;
export type StatusAction = (typeof STATUS_ACTIONS)[number];

type Transition = { from: readonly AppointmentStatus[]; to: AppointmentStatus; permission: Permission };

export const TRANSITIONS: Record<StatusAction, Transition> = {
  check_in: { from: ['scheduled'], to: 'checked_in', permission: 'appointment.front_desk' },
  start: { from: ['checked_in'], to: 'in_progress', permission: 'appointment.visit' },
  complete: { from: ['in_progress'], to: 'completed', permission: 'appointment.visit' },
  cancel: { from: ['scheduled', 'checked_in'], to: 'cancelled', permission: 'appointment.front_desk' },
  no_show: { from: ['scheduled'], to: 'no_show', permission: 'appointment.front_desk' },
};

/** Statuses that occupy the practitioner's and patient's time. */
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = ['scheduled', 'checked_in', 'in_progress'];
/** Statuses that keep their slot reservations (cancelled and no-show release them). */
export const OCCUPYING_STATUSES: readonly AppointmentStatus[] = ['scheduled', 'checked_in', 'in_progress', 'completed'];

export type TransitionCheck =
  | { ok: true; to: AppointmentStatus }
  | { ok: false; code: 'INVALID_TRANSITION' | 'REASON_REQUIRED' | 'TOO_EARLY' | 'NOT_TODAY' };

/**
 * Validates an action against the current state and time. `today` and `appointmentDate` are
 * local dates in the organization's time zone.
 */
export function checkTransition(input: {
  action: StatusAction;
  status: AppointmentStatus;
  startAt: Date;
  appointmentDate: string;
  today: string;
  now: Date;
  reason?: string;
}): TransitionCheck {
  const transition = TRANSITIONS[input.action];
  if (!transition.from.includes(input.status)) return { ok: false, code: 'INVALID_TRANSITION' };
  switch (input.action) {
    case 'check_in':
      // Arrival is recorded on the day of the appointment, never ahead of time.
      if (input.appointmentDate !== input.today) return { ok: false, code: 'NOT_TODAY' };
      break;
    case 'start':
    case 'complete':
      // A visit cannot start or finish on a later date than today (future appointments).
      if (input.appointmentDate > input.today) return { ok: false, code: 'NOT_TODAY' };
      break;
    case 'no_show':
      if (input.now.getTime() < input.startAt.getTime()) return { ok: false, code: 'TOO_EARLY' };
      break;
    case 'cancel':
      if (input.status === 'checked_in' && !input.reason?.trim()) return { ok: false, code: 'REASON_REQUIRED' };
      break;
  }
  return { ok: true, to: transition.to };
}
