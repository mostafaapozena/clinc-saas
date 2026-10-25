import { runTransaction } from '../../db/transaction.js';
import { createHash } from 'node:crypto';
import { type ClientSession, type Types } from 'mongoose';
import { HttpError, conflict, isDuplicateKeyError, notFound } from '../../http/errors.js';
import { canAccessBranch } from '../../tenancy/scope.js';
import type { TenantContext } from '../../tenancy/tenant-context.js';
import { clock } from '../../time/clock.js';
import { gridCells, localDateOf, resolveLocalTime, todayIn } from '../../time/local-time.js';
import { recordAudit } from '../audit/audit-event.model.js';
import { BranchModel } from '../branches/branch.model.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { PatientModel } from '../patients/patient.model.js';
import { patientScopeFilter } from '../patients/patient.service.js';
import { PractitionerModel, ScheduleExceptionModel } from '../practitioners/practitioner.model.js';
import { fitsSchedule } from '../scheduling/schedule.service.js';
import { visibleAppointmentsFilter } from '../scheduling/scheduling-context.js';
import { AppointmentModel, SlotReservationModel, type Appointment, type AppointmentType } from './appointment.model.js';
import { OCCUPYING_STATUSES, checkTransition, type StatusAction } from './appointment.state.js';

type AppointmentLean = Appointment & { _id: Types.ObjectId };

export type LocalStart = { date: string; time: string; utcOffsetMinutes?: number };

export const invalidReference = (field: string) =>
  new HttpError(400, 'INVALID_REFERENCE', 'A referenced record is not available', { [field]: 'not_available' });
const versionConflict = () =>
  conflict('VERSION_CONFLICT', 'This appointment was changed by someone else. Reload and try again.');

/**
 * A branch with configured specialties only books practitioners of those specialties. The
 * configuration rules already prevent such an assignment; this keeps booking safe regardless.
 */
export const offersSpecialty = (branch: { specialtyCodes?: string[] }, specialtyCode: string) =>
  !branch.specialtyCodes?.length || branch.specialtyCodes.includes(specialtyCode);
export const specialtyNotOffered = () =>
  conflict('SPECIALTY_NOT_OFFERED', "This branch does not offer the practitioner's specialty");

/** Local date/time → UTC instant; skipped times are rejected, repeated times must name an offset. */
export function resolveStart(start: LocalStart, zone: string): Date {
  const resolved = resolveLocalTime(start.date, start.time, zone, start.utcOffsetMinutes);
  if (resolved.kind === 'nonexistent') {
    throw new HttpError(400, 'NONEXISTENT_LOCAL_TIME', 'This local time does not exist on that date (clock change)');
  }
  if (resolved.kind === 'ambiguous') {
    throw new HttpError(409, 'AMBIGUOUS_LOCAL_TIME', 'This local time occurs twice on that date; choose one', undefined, {
      utcOffsetMinutes: resolved.offsets,
    });
  }
  return resolved.instant;
}

type BookingTarget = {
  patientId: Types.ObjectId;
  practitionerId: Types.ObjectId;
  branchId: Types.ObjectId;
  startAt: Date;
  durationMinutes: number | undefined;
};

/**
 * Re-validates everything a booking depends on inside the transaction, and writes the
 * practitioner and patient documents (scheduleSeq) so that concurrent schedule changes,
 * registration archiving and deactivation conflict with this transaction instead of racing it.
 */
async function validateTarget(tenant: TenantContext, target: BookingTarget, zone: string, session: ClientSession) {
  if (!canAccessBranch(tenant, target.branchId)) throw invalidReference('branchId');
  const branch = await BranchModel.findOne({ organizationId: tenant.organizationId, _id: target.branchId })
    .session(session)
    .lean();
  if (!branch) throw invalidReference('branchId');
  if (branch.status !== 'active') throw conflict('BRANCH_INACTIVE', 'This branch is inactive');

  const patient = await PatientModel.findOneAndUpdate(
    patientScopeFilter(tenant, { _id: target.patientId }),
    { $inc: { scheduleSeq: 1 } },
    { session, returnDocument: 'after' },
  ).lean();
  if (!patient) throw invalidReference('patientId');
  if (!patient.registrations.some((r) => r.branchId.equals(target.branchId) && r.status === 'active')) {
    throw conflict('PATIENT_NOT_REGISTERED', 'The patient has no active registration in this branch');
  }

  const practitioner = await PractitionerModel.findOneAndUpdate(
    { organizationId: tenant.organizationId, _id: target.practitionerId, branchIds: target.branchId },
    { $inc: { scheduleSeq: 1 } },
    { session, returnDocument: 'after' },
  ).lean();
  if (!practitioner) throw invalidReference('practitionerId');
  if (practitioner.status !== 'active') throw conflict('PRACTITIONER_INACTIVE', 'This practitioner is not taking bookings');
  if (!offersSpecialty(branch, practitioner.specialtyCode)) throw specialtyNotOffered();
  const membership = await MembershipModel.findOne({
    organizationId: tenant.organizationId,
    _id: practitioner.membershipId,
    status: 'active',
    role: 'doctor',
  })
    .session(session)
    .lean();
  const inMembershipScope =
    membership &&
    (membership.branchScope.type === 'all' || membership.branchScope.branchIds.some((b) => b.equals(target.branchId)));
  if (!inMembershipScope) throw conflict('PRACTITIONER_INACTIVE', 'This practitioner is not taking bookings');

  const durationMinutes = target.durationMinutes ?? practitioner.defaultDurationMinutes;
  const startAt = target.startAt;
  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
  if (startAt.getTime() <= clock.now().getTime()) throw new HttpError(400, 'START_IN_PAST', 'Choose a time in the future');
  const date = localDateOf(startAt, zone);
  const exceptions = await ScheduleExceptionModel.find({
    organizationId: tenant.organizationId,
    practitionerId: practitioner._id,
    date,
  })
    .session(session)
    .lean();
  if (!fitsSchedule(practitioner, exceptions, { branchId: target.branchId, startAt, endAt }, zone)) {
    throw conflict('OUTSIDE_WORKING_HOURS', 'The practitioner does not work at this branch at this time');
  }
  return { startAt, endAt, durationMinutes };
}

/**
 * Claims every five-minute cell for the practitioner, then for the patient. A cell already
 * held by another appointment violates the unique index; the transaction then aborts, so no
 * partial reservations or appointment remain. Patient conflicts carry no details because the
 * other appointment may be in a branch the caller cannot see.
 */
async function reserveCells(
  tenant: TenantContext,
  appointment: { _id: Types.ObjectId; practitionerId: Types.ObjectId; patientId: Types.ObjectId },
  startAt: Date,
  durationMinutes: number,
  session: ClientSession,
) {
  const cells = gridCells(startAt, durationMinutes);
  const rows = (resourceType: 'practitioner' | 'patient', resourceId: Types.ObjectId) =>
    cells.map((slotStart) => ({
      organizationId: tenant.organizationId,
      resourceType,
      resourceId,
      slotStart,
      appointmentId: appointment._id,
    }));
  try {
    await SlotReservationModel.insertMany(rows('practitioner', appointment.practitionerId), { session });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw conflict('SLOT_UNAVAILABLE', 'This time is no longer available');
    throw err;
  }
  try {
    await SlotReservationModel.insertMany(rows('patient', appointment.patientId), { session });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw conflict('PATIENT_CONFLICT', 'The patient already has an appointment at this time');
    throw err;
  }
}

class IdempotentReplay extends Error {}

const keyReused = () => conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different booking');

/**
 * The appointment an earlier request with this key created, if the caller can still see it.
 * The same key with a different request is refused.
 */
async function findReplay(tenant: TenantContext, idempotencyKey: string, requestHash: string) {
  const filter = await visibleAppointmentsFilter(tenant, { createdBy: tenant.userId, idempotencyKey: { $eq: idempotencyKey, $type: 'string' } });
  const existing = filter ? await AppointmentModel.findOne(filter).lean() : null;
  if (existing && existing.requestHash !== requestHash) throw keyReused();
  return existing;
}

export type BookInput = {
  patientId: Types.ObjectId;
  practitionerId: Types.ObjectId;
  branchId: Types.ObjectId;
  start: LocalStart;
  durationMinutes?: number;
  type: AppointmentType;
  idempotencyKey: string;
};

/**
 * Books an appointment atomically: appointment, reservations and audit event commit together
 * or not at all. A retried request with the same Idempotency-Key returns the first result.
 */
export async function bookAppointment(tenant: TenantContext, input: BookInput, zone: string) {
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify([
        String(input.patientId),
        String(input.practitionerId),
        String(input.branchId),
        input.start.date,
        input.start.time,
        input.start.utcOffsetMinutes ?? null,
        input.durationMinutes ?? null,
        input.type,
      ]),
    )
    .digest('base64url');
  // A retry of a booking that already went through gets it back, even once its checks would
  // fail (the start has passed, the slot is now its own, the registration was archived).
  const earlier = await findReplay(tenant, input.idempotencyKey, requestHash);
  if (earlier) return { appointment: earlier, replayed: true };
  const startAt = resolveStart(input.start, zone);

  try {
    const appointment = await runTransaction(async (session) => {
      const { endAt, durationMinutes } = await validateTarget(
        tenant,
        { ...input, startAt, durationMinutes: input.durationMinutes },
        zone,
        session,
      );
      let created: AppointmentLean;
      try {
        const [doc] = await AppointmentModel.create(
          [
            {
              organizationId: tenant.organizationId,
              branchId: input.branchId,
              patientId: input.patientId,
              practitionerId: input.practitionerId,
              startAt,
              endAt,
              durationMinutes,
              type: input.type,
              status: 'scheduled',
              idempotencyKey: input.idempotencyKey,
              requestHash,
              createdBy: tenant.userId,
              updatedBy: tenant.userId,
            },
          ],
          { session },
        );
        if (!doc) throw new Error('Expected a created appointment');
        created = doc.toObject();
      } catch (err) {
        if (isDuplicateKeyError(err)) throw new IdempotentReplay();
        throw err;
      }
      await reserveCells(tenant, created, startAt, durationMinutes, session);
      await recordAudit(
        {
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          action: 'appointment.booked',
          target: { type: 'appointment', id: created._id },
          changes: { branchId: input.branchId, practitionerId: input.practitionerId, startAt, durationMinutes },
        },
        session,
      );
      return created;
    });
    return { appointment, replayed: false };
  } catch (err) {
    if (!(err instanceof IdempotentReplay)) throw err;
    // A concurrent request with the same key committed first. If its appointment is no longer
    // visible to the caller, say only that the key is taken.
    const existing = await findReplay(tenant, input.idempotencyKey, requestHash);
    if (!existing) throw keyReused();
    return { appointment: existing, replayed: true };
  }
}

async function loadForChange(tenant: TenantContext, id: Types.ObjectId, session: ClientSession) {
  const filter = await visibleAppointmentsFilter(tenant, { _id: id });
  if (!filter) throw notFound();
  const appointment = await AppointmentModel.findOne(filter).session(session).lean();
  if (!appointment) throw notFound();
  return appointment;
}

/** Moves a scheduled appointment, swapping its reservations in the same transaction. */
export async function rescheduleAppointment(
  tenant: TenantContext,
  id: Types.ObjectId,
  input: { start: LocalStart; durationMinutes?: number; version: number },
  zone: string,
) {
  const startAt = resolveStart(input.start, zone);
  return runTransaction(async (session) => {
    const current = await loadForChange(tenant, id, session);
    if (current.version !== input.version) throw versionConflict();
    if (current.status !== 'scheduled') {
      throw conflict('INVALID_TRANSITION', 'Only scheduled appointments can be rescheduled');
    }
    const { endAt, durationMinutes } = await validateTarget(
      tenant,
      {
        patientId: current.patientId,
        practitionerId: current.practitionerId,
        branchId: current.branchId,
        startAt,
        durationMinutes: input.durationMinutes ?? current.durationMinutes,
      },
      zone,
      session,
    );
    await SlotReservationModel.deleteMany({ organizationId: tenant.organizationId, appointmentId: current._id }, { session });
    await reserveCells(tenant, current, startAt, durationMinutes, session);
    const saved = await AppointmentModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, _id: current._id, version: input.version },
      { $set: { startAt, endAt, durationMinutes, updatedBy: tenant.userId }, $inc: { version: 1 } },
      { session, returnDocument: 'after' },
    ).lean();
    if (!saved) throw versionConflict();
    await recordAudit(
      {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'appointment.rescheduled',
        target: { type: 'appointment', id: current._id },
        changes: {
          from: { startAt: current.startAt, durationMinutes: current.durationMinutes },
          to: { startAt, durationMinutes },
        },
      },
      session,
    );
    return saved;
  });
}

const TIMESTAMP_FIELD: Record<StatusAction, keyof Appointment> = {
  check_in: 'checkedInAt',
  start: 'startedAt',
  complete: 'completedAt',
  cancel: 'cancelledAt',
  no_show: 'noShowAt',
};

/** Applies one state-machine action; cancelled and no-show appointments release their time. */
export async function changeStatus(
  tenant: TenantContext,
  id: Types.ObjectId,
  input: { action: StatusAction; reason?: string; version: number },
  zone: string,
) {
  return runTransaction(async (session) => {
    const current = await loadForChange(tenant, id, session);
    if (current.version !== input.version) throw versionConflict();
    const now = clock.now();
    const check = checkTransition({
      action: input.action,
      status: current.status,
      startAt: current.startAt,
      appointmentDate: localDateOf(current.startAt, zone),
      today: todayIn(zone, now),
      now,
      reason: input.reason,
    });
    if (!check.ok) throw conflict(check.code, 'This status change is not allowed now');

    const set: Partial<Appointment> = { status: check.to, updatedBy: tenant.userId, [TIMESTAMP_FIELD[input.action]]: now };
    if (input.action === 'cancel') set.cancellationReason = input.reason?.trim() || null;
    const saved = await AppointmentModel.findOneAndUpdate(
      { organizationId: tenant.organizationId, _id: current._id, version: input.version, status: current.status },
      { $set: set, $inc: { version: 1 } },
      { session, returnDocument: 'after' },
    ).lean();
    if (!saved) throw versionConflict();
    if (!OCCUPYING_STATUSES.includes(check.to)) {
      await SlotReservationModel.deleteMany({ organizationId: tenant.organizationId, appointmentId: current._id }, { session });
    }
    await recordAudit(
      {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'appointment.status_changed',
        target: { type: 'appointment', id: current._id },
        // The reason text stays on the appointment; the audit trail only notes that one was given.
        changes: { from: current.status, to: check.to, withReason: Boolean(set.cancellationReason) },
      },
      session,
    );
    return saved;
  });
}
