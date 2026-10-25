import { assertEntitlement } from '../platform/subscription.service.js';
import { Router } from 'express';
import mongoose, { Types, type ClientSession } from 'mongoose';
import { z } from 'zod';
import { HttpError, conflict, isDuplicateKeyError, notFound } from '../../http/errors.js';
import { objectIdSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { recordVisibility } from '../../tenancy/permissions.js';
import { canAccessBranch } from '../../tenancy/scope.js';
import { parseObjectId, requirePermission, tenantOf, type TenantContext } from '../../tenancy/tenant-context.js';
import {
  DATE_PATTERN,
  END_TIME_PATTERN,
  TIME_PATTERN,
  isOnGrid,
  isValidDate,
  minutesOfDay,
  todayIn,
} from '../../time/local-time.js';
import { UserModel } from '../../users/user.model.js';
import { recordAudit } from '../audit/audit-event.model.js';
import { BranchModel } from '../branches/branch.model.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { assertPractitionerFits, lockSpecialtyConfig } from '../organizations/specialty-config.js';
import { specialtyCodeSchema } from '../specialties/specialty.service.js';
import {
  dateHasCrossBranchOverlap,
  fitsSchedule,
  futureActiveAppointments,
  loadExceptions,
  toAppointmentRef,
  weeklyHasOverlap,
} from '../scheduling/schedule.service.js';
import { ownPractitionerId, requireTimeZone } from '../scheduling/scheduling-context.js';
import { SpecialtyModel } from '../specialties/specialty.model.js';
import {
  EXCEPTION_KINDS,
  PRACTITIONER_STATUSES,
  PractitionerModel,
  ScheduleExceptionModel,
  type Practitioner,
  type ScheduleException,
  type WeeklyInterval,
} from './practitioner.model.js';

const durationSchema = z.number().int().min(5).max(240).refine(isOnGrid, 'not_on_grid');
const versionSchema = z.number().int().min(0);

const intervalSchema = z
  .object({ start: z.string().regex(TIME_PATTERN), end: z.string().regex(END_TIME_PATTERN) })
  .refine((i) => isOnGrid(minutesOfDay(i.start)) && isOnGrid(minutesOfDay(i.end)), 'not_on_grid')
  .refine((i) => minutesOfDay(i.start) < minutesOfDay(i.end), 'end_before_start');

const createSchema = z.object({
  membershipId: objectIdSchema,
  displayName: z.string().trim().min(2).max(80).optional(),
  specialtyCode: z.string().trim().min(1).max(40),
  branchIds: z.array(objectIdSchema).min(1).max(50),
  defaultDurationMinutes: durationSchema,
});

const updateSchema = z.object({
  displayName: z.string().trim().min(2).max(80).optional(),
  specialtyCode: z.string().trim().min(1).max(40).optional(),
  status: z.enum(PRACTITIONER_STATUSES).optional(),
  branchIds: z.array(objectIdSchema).min(1).max(50).optional(),
  defaultDurationMinutes: durationSchema.optional(),
  version: versionSchema,
});

const scheduleSchema = z.object({
  weeklySchedule: z
    .array(intervalSchema.and(z.object({ branchId: objectIdSchema, weekday: z.number().int().min(0).max(6) })))
    .max(140),
  version: versionSchema,
});

const exceptionSchema = z
  .object({
    date: z.string().regex(DATE_PATTERN).refine(isValidDate, 'invalid_format'),
    branchId: objectIdSchema.nullable().default(null),
    kind: z.enum(EXCEPTION_KINDS),
    intervals: z.array(intervalSchema).max(10).default([]),
  })
  .refine((e) => e.kind === 'closed' || (e.branchId !== null && e.intervals.length > 0), {
    message: 'hours_need_branch_and_intervals',
    path: ['intervals'],
  });

const listQuerySchema = z.object({
  branchId: objectIdSchema.optional(),
  status: z.enum(PRACTITIONER_STATUSES).optional(),
  /** Narrows the visible list; never widens it. */
  specialty: specialtyCodeSchema.optional(),
});

type PractitionerLean = Practitioner & { _id: Types.ObjectId };

/** Only the caller's branches are ever named in a response. */
function toPractitionerDto(p: PractitionerLean, tenant: TenantContext) {
  const visible = (id: Types.ObjectId) => canAccessBranch(tenant, id);
  return {
    id: String(p._id),
    membershipId: String(p.membershipId),
    displayName: p.displayName,
    specialtyCode: p.specialtyCode,
    status: p.status,
    branchIds: p.branchIds.filter(visible).map(String),
    defaultDurationMinutes: p.defaultDurationMinutes,
    weeklySchedule: p.weeklySchedule
      .filter((i) => visible(i.branchId))
      .map((i) => ({ branchId: String(i.branchId), weekday: i.weekday, start: i.start, end: i.end })),
    version: p.version,
  };
}

function toExceptionDto(e: ScheduleException & { _id: Types.ObjectId }) {
  return {
    id: String(e._id),
    date: e.date,
    branchId: e.branchId ? String(e.branchId) : null,
    kind: e.kind,
    intervals: e.intervals.map(({ start, end }) => ({ start, end })),
  };
}

const invalidBranch = () => new HttpError(400, 'INVALID_BRANCH', 'One or more branches are not available');
const versionConflict = () =>
  conflict('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');

/** Branch filter for practitioners a caller may see, or null for "own profile only". */
async function visiblePractitionersFilter(tenant: TenantContext, branchId?: Types.ObjectId) {
  const base: Record<string, unknown> = { organizationId: tenant.organizationId };
  if (recordVisibility(tenant.role) === 'own_practitioner') {
    const own = await ownPractitionerId(tenant);
    base._id = own ?? new Types.ObjectId(); // no profile → matches nothing
  }
  if (branchId) base.branchIds = branchId;
  else if (tenant.branchScope.type === 'selected') base.branchIds = { $in: tenant.branchScope.branchIds };
  return base;
}

async function loadVisible(tenant: TenantContext, rawId: unknown) {
  const id = parseObjectId(rawId);
  if (!id) throw notFound();
  const filter = await visiblePractitionersFilter(tenant);
  // For doctors the filter's _id is their own profile, so any other id is simply not found.
  if (filter._id instanceof Types.ObjectId && !filter._id.equals(id)) throw notFound();
  const practitioner = await PractitionerModel.findOne({ ...filter, _id: id }).lean();
  if (!practitioner) throw notFound();
  return practitioner;
}

/** Branches must exist in this organization and lie inside the doctor's membership scope. */
async function validateBranches(tenant: TenantContext, branchIds: Types.ObjectId[], membershipId: Types.ObjectId) {
  const unique = [...new Set(branchIds.map(String))].map((id) => new Types.ObjectId(id));
  const found = await BranchModel.countDocuments({ organizationId: tenant.organizationId, _id: { $in: unique } });
  if (found !== unique.length) throw invalidBranch();
  const membership = await MembershipModel.findOne({ organizationId: tenant.organizationId, _id: membershipId }).lean();
  if (membership?.branchScope.type === 'selected') {
    const allowed = new Set(membership.branchScope.branchIds.map(String));
    if (!unique.every((id) => allowed.has(String(id)))) {
      throw new HttpError(400, 'BRANCH_OUTSIDE_MEMBERSHIP', "A branch is outside the doctor's membership scope");
    }
  }
  return unique;
}

async function requireEligibleMembership(tenant: TenantContext, membershipId: Types.ObjectId) {
  const membership = await MembershipModel.findOne({
    organizationId: tenant.organizationId,
    _id: membershipId,
    status: 'active',
    role: 'doctor',
  }).lean();
  if (!membership) {
    throw new HttpError(400, 'MEMBERSHIP_NOT_ELIGIBLE', 'A scheduling profile needs an active member with the doctor role');
  }
  return membership;
}

async function requireSpecialty(code: string) {
  if (!(await SpecialtyModel.exists({ code, isActive: true }))) {
    throw new HttpError(400, 'INVALID_SPECIALTY', 'Unknown specialty');
  }
}

/** Runs a schedule change in a transaction that also bumps scheduleSeq (see the model). */
async function inScheduleTransaction<T>(
  tenant: TenantContext,
  practitionerId: Types.ObjectId,
  work: (practitioner: PractitionerLean, session: ClientSession) => Promise<T>,
): Promise<T> {
  return mongoose.connection.transaction(async (session) => {
    const practitioner = await PractitionerModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, _id: practitionerId },
      { $inc: { scheduleSeq: 1 } },
      { session, returnDocument: 'before' },
    ).lean();
    if (!practitioner) throw notFound();
    return work(practitioner, session);
  });
}

function scheduleConflict(appointments: Parameters<typeof toAppointmentRef>[0][]) {
  return conflict('SCHEDULE_CONFLICT', 'Existing future appointments fall outside the new working hours', {
    appointments: appointments.map(toAppointmentRef),
  });
}

export const practitionersRouter = Router({ mergeParams: true });

practitionersRouter.get('/', requirePermission('practitioner.read'), async (req, res) => {
  const tenant = tenantOf(req);
  const query = parseInput(listQuerySchema, req.query);
  const branchId = query.branchId ? new Types.ObjectId(query.branchId) : undefined;
  if (branchId && !canAccessBranch(tenant, branchId)) throw notFound();
  const filter = await visiblePractitionersFilter(tenant, branchId);
  if (query.status) filter.status = query.status;
  if (query.specialty) filter.specialtyCode = query.specialty;
  const practitioners = await PractitionerModel.find(filter).sort({ displayName: 1 }).limit(500).lean();
  res.json({ data: practitioners.map((p) => toPractitionerDto(p, tenant)) });
});

// Active doctor memberships that do not have a scheduling profile yet.
practitionersRouter.get('/candidates', requirePermission('practitioner.manage'), async (req, res) => {
  const tenant = tenantOf(req);
  const existing = await PractitionerModel.find({ organizationId: tenant.organizationId }).select('membershipId').lean();
  const memberships = await MembershipModel.find({
    organizationId: tenant.organizationId,
    role: 'doctor',
    status: 'active',
    _id: { $nin: existing.map((p) => p.membershipId) },
  }).lean();
  const users = await UserModel.find({ _id: { $in: memberships.map((m) => m.userId) } }).select('displayName').lean();
  const names = new Map(users.map((u) => [String(u._id), u.displayName]));
  res.json({
    data: memberships.map((m) => ({
      membershipId: String(m._id),
      displayName: names.get(String(m.userId)) ?? '',
      branchScope: { type: m.branchScope.type, branchIds: m.branchScope.branchIds.map(String) },
    })),
  });
});

practitionersRouter.get('/:practitionerId', requirePermission('practitioner.read'), async (req, res) => {
  const tenant = tenantOf(req);
  const practitioner = await loadVisible(tenant, req.params.practitionerId);
  res.json({ practitioner: toPractitionerDto(practitioner, tenant) });
});

practitionersRouter.get('/:practitionerId/exceptions', requirePermission('practitioner.read'), async (req, res) => {
  const tenant = tenantOf(req);
  const practitioner = await loadVisible(tenant, req.params.practitionerId);
  const zone = await requireTimeZone(tenant);
  const exceptions = await loadExceptions(tenant.organizationId, practitioner._id, todayIn(zone));
  res.json({
    data: exceptions.filter((e) => e.branchId == null || canAccessBranch(tenant, e.branchId)).map(toExceptionDto),
  });
});

practitionersRouter.post('/', requirePermission('practitioner.manage'), async (req, res) => {
  const tenant = tenantOf(req);
  const input = parseInput(createSchema, req.body);
  await assertEntitlement(req, tenant, 'practitioners');
  const membershipId = new Types.ObjectId(input.membershipId);
  const membership = await requireEligibleMembership(tenant, membershipId);
  await requireSpecialty(input.specialtyCode);
  const branchIds = await validateBranches(tenant, input.branchIds.map((id) => new Types.ObjectId(id)), membershipId);
  const user = await UserModel.findById(membership.userId).select('displayName').lean();
  try {
    const practitioner = await mongoose.connection.transaction(async (session) => {
      // The specialty must be enabled and offered at every chosen branch (once configured).
      const organization = await lockSpecialtyConfig(tenant.organizationId, session);
      await assertPractitionerFits(organization, input.specialtyCode, branchIds, session);
      const [created] = await PractitionerModel.create(
        [
          {
            organizationId: tenant.organizationId,
            membershipId,
            userId: membership.userId,
            displayName: input.displayName ?? user?.displayName ?? 'Doctor',
            specialtyCode: input.specialtyCode,
            status: 'active',
            branchIds,
            defaultDurationMinutes: input.defaultDurationMinutes,
            weeklySchedule: [],
            createdBy: tenant.userId,
            updatedBy: tenant.userId,
          },
        ],
        { session },
      );
      if (!created) throw new Error('Expected a created practitioner');
      await recordAudit(
        {
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          action: 'practitioner.created',
          target: { type: 'practitioner', id: created._id },
          changes: { branchCount: branchIds.length, specialtyCode: input.specialtyCode },
        },
        session,
      );
      return created;
    });
    res.status(201).json({ practitioner: toPractitionerDto(practitioner.toObject(), tenant) });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw conflict('PRACTITIONER_EXISTS', 'This member already has a scheduling profile');
    throw err;
  }
});

practitionersRouter.patch('/:practitionerId', requirePermission('practitioner.manage'), async (req, res) => {
  const tenant = tenantOf(req);
  const input = parseInput(updateSchema, req.body);
  const id = parseObjectId(req.params.practitionerId);
  if (!id) throw notFound();
  if (input.specialtyCode) await requireSpecialty(input.specialtyCode);

  const updated = await inScheduleTransaction(tenant, id, async (current, session) => {
    if (current.version !== input.version) throw versionConflict();
    const changes: Record<string, unknown> = {};
    const set: Partial<Practitioner> = { updatedBy: tenant.userId };

    if (input.status === 'active' && current.status !== 'active') {
      await requireEligibleMembership(tenant, current.membershipId);
    }
    if (input.status === 'inactive' && current.status !== 'inactive') {
      // Deactivation must not silently orphan bookings: list them for an explicit decision.
      const future = await futureActiveAppointments(tenant.organizationId, { practitionerId: current._id });
      if (future.length > 0) {
        throw conflict('FUTURE_APPOINTMENTS_EXIST', 'Cancel or reschedule the future appointments first', {
          appointments: future.map(toAppointmentRef),
        });
      }
    }
    if (input.branchIds) {
      const next = await validateBranches(tenant, input.branchIds.map((b) => new Types.ObjectId(b)), current.membershipId);
      const removed = current.branchIds.filter((b) => !next.some((n) => n.equals(b)));
      if (removed.length > 0) {
        const future = await futureActiveAppointments(tenant.organizationId, {
          practitionerId: current._id,
          branchId: { $in: removed },
        });
        if (future.length > 0) {
          throw conflict('FUTURE_APPOINTMENTS_EXIST', 'Cancel or reschedule the future appointments at removed branches first', {
            appointments: future.map(toAppointmentRef),
          });
        }
      }
      set.branchIds = next;
      // Working hours of a removed branch no longer apply.
      set.weeklySchedule = current.weeklySchedule.filter((i) => next.some((n) => n.equals(i.branchId)));
      changes.branchCount = { from: current.branchIds.length, to: next.length };
    }
    if (input.branchIds || (input.specialtyCode && input.specialtyCode !== current.specialtyCode)) {
      const organization = await lockSpecialtyConfig(tenant.organizationId, session);
      await assertPractitionerFits(organization, input.specialtyCode ?? current.specialtyCode, set.branchIds ?? current.branchIds, session);
    }
    for (const key of ['displayName', 'specialtyCode', 'status', 'defaultDurationMinutes'] as const) {
      const value = input[key];
      if (value !== undefined && value !== current[key]) {
        (set as Record<string, unknown>)[key] = value;
        changes[key] = { from: current[key], to: value };
      }
    }
    const saved = await PractitionerModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, _id: current._id, version: input.version },
      { $set: set, $inc: { version: 1 } },
      { session, returnDocument: 'after' },
    ).lean();
    if (!saved) throw versionConflict();
    if (Object.keys(changes).length > 0) {
      await recordAudit(
        {
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          action: 'practitioner.updated',
          target: { type: 'practitioner', id: current._id },
          changes,
        },
        session,
      );
    }
    return saved;
  });
  res.json({ practitioner: toPractitionerDto(updated, tenant) });
});

practitionersRouter.put('/:practitionerId/schedule', requirePermission('practitioner.manage'), async (req, res) => {
  const tenant = tenantOf(req);
  const input = parseInput(scheduleSchema, req.body);
  const id = parseObjectId(req.params.practitionerId);
  if (!id) throw notFound();
  const zone = await requireTimeZone(tenant);

  const updated = await inScheduleTransaction(tenant, id, async (current, session) => {
    if (current.version !== input.version) throw versionConflict();
    const weekly: WeeklyInterval[] = input.weeklySchedule.map((i) => ({
      branchId: new Types.ObjectId(i.branchId),
      weekday: i.weekday,
      start: i.start,
      end: i.end,
    }));
    if (!weekly.every((i) => current.branchIds.some((b) => b.equals(i.branchId)))) throw invalidBranch();
    if (weeklyHasOverlap(weekly)) {
      throw new HttpError(400, 'SCHEDULE_OVERLAP', 'Working intervals overlap (also across branches)');
    }
    const next = { branchIds: current.branchIds, weeklySchedule: weekly };
    const exceptions = await loadExceptions(tenant.organizationId, current._id, todayIn(zone));
    if (exceptions.some((e) => dateHasCrossBranchOverlap(next, exceptions, e.date))) {
      throw new HttpError(400, 'SCHEDULE_OVERLAP', 'Working intervals overlap a date-specific change');
    }
    const future = await futureActiveAppointments(tenant.organizationId, { practitionerId: current._id });
    const outside = future.filter((a) => !fitsSchedule(next, exceptions, a, zone));
    if (outside.length > 0) throw scheduleConflict(outside);

    const saved = await PractitionerModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, _id: current._id, version: input.version },
      { $set: { weeklySchedule: weekly, updatedBy: tenant.userId }, $inc: { version: 1 } },
      { session, returnDocument: 'after' },
    ).lean();
    if (!saved) throw versionConflict();
    await recordAudit(
      {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'practitioner.schedule_updated',
        target: { type: 'practitioner', id: current._id },
        changes: { intervals: { from: current.weeklySchedule.length, to: weekly.length } },
      },
      session,
    );
    return saved;
  });
  res.json({ practitioner: toPractitionerDto(updated, tenant) });
});

practitionersRouter.post('/:practitionerId/exceptions', requirePermission('practitioner.manage'), async (req, res) => {
  const tenant = tenantOf(req);
  const input = parseInput(exceptionSchema, req.body);
  const id = parseObjectId(req.params.practitionerId);
  if (!id) throw notFound();
  const zone = await requireTimeZone(tenant);
  if (input.date < todayIn(zone)) throw new HttpError(400, 'DATE_IN_PAST', 'Choose today or a later date');

  const created = await inScheduleTransaction(tenant, id, async (current, session) => {
    const branchId = input.branchId ? new Types.ObjectId(input.branchId) : null;
    if (branchId && !current.branchIds.some((b) => b.equals(branchId))) throw invalidBranch();
    const candidate = { date: input.date, branchId, kind: input.kind, intervals: input.kind === 'hours' ? input.intervals : [] };
    const exceptions = [...(await loadExceptions(tenant.organizationId, current._id, input.date)), candidate];
    if (dateHasCrossBranchOverlap(current, exceptions, input.date)) {
      throw new HttpError(400, 'SCHEDULE_OVERLAP', 'Working intervals overlap across branches on this date');
    }
    const future = await futureActiveAppointments(tenant.organizationId, { practitionerId: current._id });
    const outside = future.filter((a) => !fitsSchedule(current, exceptions, a, zone));
    if (outside.length > 0) throw scheduleConflict(outside);
    try {
      const [doc] = await ScheduleExceptionModel.create(
        [{ organizationId: tenant.organizationId, practitionerId: current._id, ...candidate, createdBy: tenant.userId }],
        { session },
      );
      if (!doc) throw new Error('Expected a created exception');
      await recordAudit(
        {
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          action: 'practitioner.exception_added',
          target: { type: 'practitioner', id: current._id },
          changes: { date: input.date, kind: input.kind, branchId },
        },
        session,
      );
      return doc.toObject();
    } catch (err) {
      if (isDuplicateKeyError(err)) throw conflict('EXCEPTION_EXISTS', 'There is already a change for this date and branch');
      throw err;
    }
  });
  res.status(201).json({ exception: toExceptionDto(created) });
});

practitionersRouter.delete(
  '/:practitionerId/exceptions/:exceptionId',
  requirePermission('practitioner.manage'),
  async (req, res) => {
    const tenant = tenantOf(req);
    const id = parseObjectId(req.params.practitionerId);
    const exceptionId = parseObjectId(req.params.exceptionId);
    if (!id || !exceptionId) throw notFound();
    const zone = await requireTimeZone(tenant);

    await inScheduleTransaction(tenant, id, async (current, session) => {
      const all = await loadExceptions(tenant.organizationId, current._id);
      const target = all.find((e) => e._id.equals(exceptionId));
      if (!target) throw notFound();
      const remaining = all.filter((e) => !e._id.equals(exceptionId));
      if (dateHasCrossBranchOverlap(current, remaining, target.date)) {
        throw new HttpError(400, 'SCHEDULE_OVERLAP', 'Removing this change would make working intervals overlap');
      }
      const future = await futureActiveAppointments(tenant.organizationId, { practitionerId: current._id });
      const outside = future.filter((a) => !fitsSchedule(current, remaining, a, zone));
      if (outside.length > 0) throw scheduleConflict(outside);
      await ScheduleExceptionModel.deleteOne({ organizationId: tenant.organizationId, _id: exceptionId }, { session });
      await recordAudit(
        {
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          action: 'practitioner.exception_removed',
          target: { type: 'practitioner', id: current._id },
          changes: { date: target.date, kind: target.kind },
        },
        session,
      );
    });
    res.status(204).end();
  },
);
