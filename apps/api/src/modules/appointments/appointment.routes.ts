import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { HttpError, conflict, forbidden, notFound } from '../../http/errors.js';
import { objectIdSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { hasPermission } from '../../tenancy/permissions.js';
import { canAccessBranch } from '../../tenancy/scope.js';
import { parseObjectId, requirePermission, tenantOf } from '../../tenancy/tenant-context.js';
import {
  DATE_PATTERN,
  TIME_PATTERN,
  addDays,
  dayRange,
  isOnGrid,
  isValidDate,
  minutesOfDay,
  todayIn,
} from '../../time/local-time.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { PractitionerModel, ScheduleExceptionModel } from '../practitioners/practitioner.model.js';
import { computeSlots } from '../scheduling/schedule.service.js';
import { requireTimeZone, visibleAppointmentsFilter } from '../scheduling/scheduling-context.js';
import { toAppointmentDto, toAppointmentDtos } from './appointment.dto.js';
import { APPOINTMENT_TYPES, AppointmentModel } from './appointment.model.js';
import { bookAppointment, changeStatus, invalidReference, rescheduleAppointment } from './appointment.service.js';
import { APPOINTMENT_STATUSES, STATUS_ACTIONS, TRANSITIONS } from './appointment.state.js';

const MAX_RANGE_DAYS = 31;
const MAX_RESULTS = 500;

const dateSchema = z.string().regex(DATE_PATTERN).refine(isValidDate, 'invalid_format');
const durationSchema = z.number().int().min(5).max(240).refine(isOnGrid, 'not_on_grid');
const startSchema = {
  date: dateSchema,
  time: z.string().regex(TIME_PATTERN).refine((t) => isOnGrid(minutesOfDay(t)), 'not_on_grid'),
  /** Only needed when the local time occurs twice (end of daylight saving). */
  utcOffsetMinutes: z.number().int().min(-720).max(840).optional(),
};

const bookSchema = z.object({
  patientId: objectIdSchema,
  practitionerId: objectIdSchema,
  branchId: objectIdSchema,
  ...startSchema,
  durationMinutes: durationSchema.optional(),
  type: z.enum(APPOINTMENT_TYPES),
});

const rescheduleSchema = z.object({ ...startSchema, durationMinutes: durationSchema.optional(), version: z.number().int().min(0) });

const statusSchema = z.object({
  action: z.enum(STATUS_ACTIONS),
  reason: z.string().trim().max(200).optional(),
  version: z.number().int().min(0),
});

const listQuerySchema = z
  .object({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    branchId: objectIdSchema.optional(),
    practitionerId: objectIdSchema.optional(),
    status: z
      .string()
      .max(120)
      .transform((value) => value.split(',').filter(Boolean))
      .pipe(z.array(z.enum(APPOINTMENT_STATUSES)).max(APPOINTMENT_STATUSES.length))
      .optional(),
  });

const availabilityQuerySchema = z.object({
  practitionerId: objectIdSchema,
  branchId: objectIdSchema,
  date: dateSchema,
  durationMinutes: z.coerce.number().pipe(durationSchema).optional(),
  step: z.coerce.number().pipe(z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)])).default(15),
  excludeAppointmentId: objectIdSchema.optional(),
});

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

export const appointmentsRouter = Router({ mergeParams: true });

appointmentsRouter.get('/', requirePermission('appointment.read'), async (req, res) => {
  const tenant = tenantOf(req);
  const query = parseInput(listQuerySchema, req.query);
  const zone = await requireTimeZone(tenant);
  const from = query.from ?? todayIn(zone);
  const to = query.to ?? from;
  if (to < from || addDays(from, MAX_RANGE_DAYS - 1) < to) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid input', { to: 'range_too_long' });
  }
  const extra: Record<string, unknown> = {
    startAt: { $gte: dayRange(from, zone).start, $lt: dayRange(to, zone).end },
  };
  if (query.branchId) {
    const branchId = new Types.ObjectId(query.branchId);
    if (!canAccessBranch(tenant, branchId)) throw notFound();
    extra.branchId = branchId;
  }
  if (query.practitionerId) extra.practitionerId = new Types.ObjectId(query.practitionerId);
  if (query.status?.length) extra.status = { $in: query.status };

  const filter = await visibleAppointmentsFilter(tenant, extra);
  // A doctor's own-practitioner restriction overrides any practitionerId filter they send.
  if (filter && query.practitionerId && String(filter.practitionerId) !== query.practitionerId) {
    res.json({ data: [], from, to, timeZone: zone, truncated: false });
    return;
  }
  const items = filter
    ? await AppointmentModel.find(filter).sort({ startAt: 1, _id: 1 }).limit(MAX_RESULTS + 1).lean()
    : [];
  res.json({
    data: await toAppointmentDtos(tenant, items.slice(0, MAX_RESULTS)),
    from,
    to,
    timeZone: zone,
    truncated: items.length > MAX_RESULTS,
  });
});

appointmentsRouter.get('/availability', requirePermission('appointment.book'), async (req, res) => {
  const tenant = tenantOf(req);
  const query = parseInput(availabilityQuerySchema, req.query);
  const zone = await requireTimeZone(tenant);
  const branchId = new Types.ObjectId(query.branchId);
  if (!canAccessBranch(tenant, branchId)) throw invalidReference('branchId');
  const practitioner = await PractitionerModel.findOne({
    organizationId: tenant.organizationId,
    _id: new Types.ObjectId(query.practitionerId),
    branchIds: branchId,
  }).lean();
  if (!practitioner) throw invalidReference('practitionerId');
  const membership = await MembershipModel.findOne({
    organizationId: tenant.organizationId,
    _id: practitioner.membershipId,
    status: 'active',
    role: 'doctor',
  }).lean();
  const bookable =
    practitioner.status === 'active' &&
    membership &&
    (membership.branchScope.type === 'all' || membership.branchScope.branchIds.some((b) => b.equals(branchId)));
  if (!bookable) throw conflict('PRACTITIONER_INACTIVE', 'This practitioner is not taking bookings');

  const exceptions = await ScheduleExceptionModel.find({
    organizationId: tenant.organizationId,
    practitionerId: practitioner._id,
    date: query.date,
  }).lean();
  const durationMinutes = query.durationMinutes ?? practitioner.defaultDurationMinutes;
  const slots = await computeSlots({
    organizationId: tenant.organizationId,
    practitionerId: practitioner._id,
    schedule: practitioner,
    exceptions,
    branchId,
    date: query.date,
    durationMinutes,
    step: query.step,
    zone,
    excludeAppointmentId: query.excludeAppointmentId ? new Types.ObjectId(query.excludeAppointmentId) : undefined,
  });
  res.json({ date: query.date, timeZone: zone, durationMinutes, slots });
});

appointmentsRouter.get('/:appointmentId', requirePermission('appointment.read'), async (req, res) => {
  const tenant = tenantOf(req);
  const id = parseObjectId(req.params.appointmentId);
  if (!id) throw notFound();
  const filter = await visibleAppointmentsFilter(tenant, { _id: id });
  const appointment = filter ? await AppointmentModel.findOne(filter).lean() : null;
  if (!appointment) throw notFound();
  res.json({ appointment: await toAppointmentDto(tenant, appointment) });
});

appointmentsRouter.post('/', requirePermission('appointment.book'), async (req, res) => {
  const tenant = tenantOf(req);
  const key = req.get('idempotency-key') ?? '';
  if (!IDEMPOTENCY_KEY.test(key)) {
    throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header with each booking');
  }
  const input = parseInput(bookSchema, req.body);
  const zone = await requireTimeZone(tenant);
  const { appointment, replayed } = await bookAppointment(
    tenant,
    {
      patientId: new Types.ObjectId(input.patientId),
      practitionerId: new Types.ObjectId(input.practitionerId),
      branchId: new Types.ObjectId(input.branchId),
      start: { date: input.date, time: input.time, utcOffsetMinutes: input.utcOffsetMinutes },
      durationMinutes: input.durationMinutes,
      type: input.type,
      idempotencyKey: key,
    },
    zone,
  );
  res.status(replayed ? 200 : 201).json({ appointment: await toAppointmentDto(tenant, appointment), replayed });
});

appointmentsRouter.post('/:appointmentId/reschedule', requirePermission('appointment.book'), async (req, res) => {
  const tenant = tenantOf(req);
  const id = parseObjectId(req.params.appointmentId);
  if (!id) throw notFound();
  const input = parseInput(rescheduleSchema, req.body);
  const zone = await requireTimeZone(tenant);
  const saved = await rescheduleAppointment(
    tenant,
    id,
    {
      start: { date: input.date, time: input.time, utcOffsetMinutes: input.utcOffsetMinutes },
      durationMinutes: input.durationMinutes,
      version: input.version,
    },
    zone,
  );
  res.json({ appointment: await toAppointmentDto(tenant, saved) });
});

appointmentsRouter.post('/:appointmentId/status', requirePermission('appointment.read'), async (req, res) => {
  const tenant = tenantOf(req);
  const id = parseObjectId(req.params.appointmentId);
  if (!id) throw notFound();
  const input = parseInput(statusSchema, req.body);
  // Each action has its own permission in the central state machine.
  if (!hasPermission(tenant.role, TRANSITIONS[input.action].permission)) throw forbidden();
  const zone = await requireTimeZone(tenant);
  const saved = await changeStatus(tenant, id, input, zone);
  res.json({ appointment: await toAppointmentDto(tenant, saved) });
});
