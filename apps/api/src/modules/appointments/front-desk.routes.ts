import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { notFound } from '../../http/errors.js';
import { objectIdSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { canAccessBranch } from '../../tenancy/scope.js';
import { requirePermission, tenantOf, type TenantContext } from '../../tenancy/tenant-context.js';
import { dayRange, todayIn } from '../../time/local-time.js';
import {
  countableAppointmentsFilter,
  narrowToSpecialty,
  requireTimeZone,
  visibleAppointmentsFilter,
} from '../scheduling/scheduling-context.js';
import { specialtyCodeSchema } from '../specialties/specialty.service.js';
import { toAppointmentDtos } from './appointment.dto.js';
import { AppointmentModel } from './appointment.model.js';
import type { AppointmentStatus } from './appointment.state.js';

// `specialty` narrows to that specialty's practitioners within the caller's scope; never widens.
const branchQuerySchema = z.object({ branchId: objectIdSchema.optional(), specialty: specialtyCodeSchema.optional() });
const queueQuerySchema = branchQuerySchema.extend({ practitionerId: objectIdSchema.optional() });

function branchFilter(tenant: TenantContext, raw: string | undefined) {
  if (!raw) return {};
  const branchId = new Types.ObjectId(raw);
  if (!canAccessBranch(tenant, branchId)) throw notFound();
  return { branchId };
}

/**
 * Today's arrivals: checked-in patients waiting (ordered by actual arrival time, then by
 * appointment time, then id — deterministic, no manual reordering) and visits in progress.
 */
export const queueRouter = Router({ mergeParams: true });

queueRouter.get('/', requirePermission('queue.read'), async (req, res) => {
  const tenant = tenantOf(req);
  const query = parseInput(queueQuerySchema, req.query);
  const zone = await requireTimeZone(tenant);
  const today = todayIn(zone);
  const { start, end } = dayRange(today, zone);
  const extra: Record<string, unknown> = {
    ...branchFilter(tenant, query.branchId),
    startAt: { $gte: start, $lt: end },
    status: { $in: ['checked_in', 'in_progress'] },
    ...(query.practitionerId ? { practitionerId: new Types.ObjectId(query.practitionerId) } : {}),
  };
  const filter = await visibleAppointmentsFilter(tenant, extra);
  // A doctor's own-practitioner restriction replaces any other practitioner they ask for.
  const overridden = query.practitionerId && String(filter?.practitionerId) !== query.practitionerId;
  const narrowed = overridden ? null : await narrowToSpecialty(tenant, filter, query.specialty);
  const items = narrowed ? await AppointmentModel.find(narrowed).limit(500).lean() : [];
  const waiting = items
    .filter((a) => a.status === 'checked_in')
    .sort(
      (a, b) =>
        (a.checkedInAt?.getTime() ?? 0) - (b.checkedInAt?.getTime() ?? 0) ||
        a.startAt.getTime() - b.startAt.getTime() ||
        String(a._id).localeCompare(String(b._id)),
    );
  const inProgress = items
    .filter((a) => a.status === 'in_progress')
    .sort((a, b) => (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0) || String(a._id).localeCompare(String(b._id)));
  res.json({
    date: today,
    timeZone: zone,
    waiting: await toAppointmentDtos(tenant, waiting),
    inProgress: await toAppointmentDtos(tenant, inProgress),
  });
});

const COUNTED: Record<AppointmentStatus, string> = {
  scheduled: 'scheduled',
  checked_in: 'waiting',
  in_progress: 'inProgress',
  completed: 'completed',
  no_show: 'noShow',
  cancelled: 'cancelled',
};

/**
 * Today's operational counts: appointments whose start falls on today's local date, grouped by
 * current status, within the caller's branch scope (doctors: their own; viewers: totals only).
 */
export const dashboardRouter = Router({ mergeParams: true });

dashboardRouter.get('/', requirePermission('dashboard.read'), async (req, res) => {
  const tenant = tenantOf(req);
  const query = parseInput(branchQuerySchema, req.query);
  const zone = await requireTimeZone(tenant);
  const today = todayIn(zone);
  const { start, end } = dayRange(today, zone);
  const counts = { scheduled: 0, waiting: 0, inProgress: 0, completed: 0, noShow: 0, cancelled: 0 };
  const filter = await narrowToSpecialty(
    tenant,
    await countableAppointmentsFilter(tenant, {
      ...branchFilter(tenant, query.branchId),
      startAt: { $gte: start, $lt: end },
    }),
    query.specialty,
  );
  if (filter) {
    const rows = await AppointmentModel.aggregate<{ _id: AppointmentStatus; n: number }>([
      { $match: filter },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    for (const row of rows) counts[COUNTED[row._id] as keyof typeof counts] = row.n;
  }
  res.json({ date: today, timeZone: zone, counts });
});
