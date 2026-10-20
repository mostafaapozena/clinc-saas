import { useQueryClient } from '@tanstack/react-query';
import { orgKeys, useOrg } from '../org/context';
import { localDateOf, todayIn } from './time';
import type { Appointment, StatusAction } from './types';

/** Refreshes every cached query of the current organization after a change. */
export function useInvalidateOrg() {
  const queryClient = useQueryClient();
  const { orgId } = useOrg();
  return () => queryClient.invalidateQueries({ queryKey: orgKeys.all(orgId) });
}

/** Which state-machine actions to offer (UX only; the API enforces the same rules). */
export function availableActions(appointment: Appointment, ctx: ReturnType<typeof useOrg>): StatusAction[] {
  const zone = ctx.timeZone;
  if (!zone) return [];
  const isToday = localDateOf(appointment.startAt, zone) === todayIn(zone);
  const notFuture = localDateOf(appointment.startAt, zone) <= todayIn(zone);
  const frontDesk = ctx.can('appointment.front_desk');
  const visit = ctx.can('appointment.visit');
  const actions: StatusAction[] = [];
  switch (appointment.status) {
    case 'scheduled':
      if (frontDesk && isToday) actions.push('check_in');
      if (frontDesk && Date.now() >= Date.parse(appointment.startAt)) actions.push('no_show');
      if (frontDesk) actions.push('cancel');
      break;
    case 'checked_in':
      if (visit && notFuture) actions.push('start');
      if (frontDesk) actions.push('cancel');
      break;
    case 'in_progress':
      if (visit && notFuture) actions.push('complete');
      break;
  }
  return actions;
}
