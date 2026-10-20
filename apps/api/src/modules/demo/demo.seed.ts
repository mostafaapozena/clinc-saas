import type { Types } from 'mongoose';
import { hashPassword } from '../../auth/password.js';
import { clock } from '../../time/clock.js';
import { addDays, gridCells, resolveLocalTime, todayIn } from '../../time/local-time.js';
import { UserModel } from '../../users/user.model.js';
import { AppointmentModel, SlotReservationModel } from '../appointments/appointment.model.js';
import { OCCUPYING_STATUSES, type AppointmentStatus } from '../appointments/appointment.state.js';
import { BranchModel } from '../branches/branch.model.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { nextPatientNumber } from '../patients/counter.model.js';
import { nameKey, normalizePhone } from '../patients/normalize.js';
import { PatientModel } from '../patients/patient.model.js';
import { PractitionerModel, ScheduleExceptionModel } from '../practitioners/practitioner.model.js';
import { DEMO_ORGANIZATIONS, DEMO_USERS, type DemoAppointment, type DemoOrganization } from './demo.data.js';

const UPSERT = { upsert: true, returnDocument: 'after', runValidators: true } as const;

function required<T>(value: T, what: string): NonNullable<T> {
  if (value == null) throw new Error(`Demo seed: missing ${what}`);
  return value;
}

const STATUS_TIMESTAMP: Partial<Record<AppointmentStatus, string[]>> = {
  checked_in: ['checkedInAt'],
  in_progress: ['checkedInAt', 'startedAt'],
  completed: ['checkedInAt', 'startedAt', 'completedAt'],
  cancelled: ['cancelledAt'],
  no_show: ['noShowAt'],
};

/**
 * Idempotently creates or resets the demo organizations, branches, users and memberships, and
 * the phase 3 front-desk data: practitioner profiles, weekly hours, date exceptions, patients
 * and appointments. Appointment dates are relative to each organization's local "today", so
 * re-running refreshes them. Only records carrying a seed key (or the demo accounts) are
 * touched; data created by hand in the development database is left alone, and a seed
 * appointment that would collide with such data is skipped instead.
 */
export async function seedDemoData(password: string, now = clock.now()) {
  const passwordHash = await hashPassword(password);
  const userIds = new Map<string, Types.ObjectId>();
  for (const user of DEMO_USERS) {
    const doc = await UserModel.findOneAndUpdate(
      { email: user.email },
      {
        $set: { displayName: user.displayName, preferredLanguage: user.language, passwordHash },
        $setOnInsert: { emailVerifiedAt: null },
      },
      UPSERT,
    );
    userIds.set(user.email, required(doc, user.email)._id);
  }

  const summary = new Map<string, string[]>(DEMO_USERS.map((u) => [u.email, []]));
  const skipped: string[] = [];
  for (const org of DEMO_ORGANIZATIONS) {
    const owner = required(org.members.find((m) => m.role === 'owner'), `${org.key} owner`);
    const ownerId = required(userIds.get(owner.email), owner.email);
    const organization = required(
      await OrganizationModel.findOneAndUpdate(
        { seedKey: org.key },
        { $set: { name: org.name, timeZone: org.timeZone }, $setOnInsert: { createdBy: ownerId } },
        UPSERT,
      ),
      org.key,
    );
    const organizationId = organization._id;
    const branchIds = new Map<string, Types.ObjectId>();
    for (const branch of org.branches) {
      const doc = await BranchModel.findOneAndUpdate(
        { organizationId, name: branch.name },
        { $set: { city: branch.city, status: 'active' } },
        UPSERT,
      );
      branchIds.set(branch.name, required(doc, branch.name)._id);
    }
    const branch = (name: string) => required(branchIds.get(name), name);

    const membershipIds = new Map<string, Types.ObjectId>();
    for (const member of org.members) {
      const branchScope = member.branches
        ? { type: 'selected', branchIds: member.branches.map(branch) }
        : { type: 'all', branchIds: [] };
      const doc = await MembershipModel.findOneAndUpdate(
        { organizationId, userId: required(userIds.get(member.email), member.email) },
        { $set: { role: member.role, status: member.status ?? 'active', branchScope } },
        UPSERT,
      );
      membershipIds.set(member.email, required(doc, member.email)._id);
      const scope = member.branches ? member.branches.join('، ') : 'all branches';
      summary.get(member.email)?.push(`${org.name}: ${member.role}${member.status === 'suspended' ? ' (suspended)' : ''} — ${scope}`);
    }

    await seedFrontDesk(org, { organizationId, ownerId, userIds, membershipIds, branch, now, skipped });
  }

  return {
    accounts: DEMO_USERS.map((u) => ({
      email: u.email,
      summary: summary.get(u.email)?.join(' | ') || 'no organization (use for onboarding / team add)',
    })),
    skippedAppointments: skipped,
  };
}

async function seedFrontDesk(
  org: DemoOrganization,
  ctx: {
    organizationId: Types.ObjectId;
    ownerId: Types.ObjectId;
    userIds: Map<string, Types.ObjectId>;
    membershipIds: Map<string, Types.ObjectId>;
    branch: (name: string) => Types.ObjectId;
    now: Date;
    skipped: string[];
  },
) {
  const { organizationId, ownerId, branch } = ctx;
  const today = todayIn(org.timeZone, ctx.now);

  const practitionerIds = new Map<string, Types.ObjectId>();
  for (const p of org.practitioners) {
    const membershipId = required(ctx.membershipIds.get(p.email), p.email);
    const weeklySchedule = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) =>
      p.hours.map((h) => ({ branchId: branch(h.branch), weekday, start: h.start, end: h.end })),
    );
    const doc = await PractitionerModel.findOneAndUpdate(
      { organizationId, membershipId },
      {
        $set: {
          userId: required(ctx.userIds.get(p.email), p.email),
          displayName: p.displayName,
          specialtyCode: p.specialtyCode,
          status: 'active',
          branchIds: [...new Set(p.hours.map((h) => h.branch))].map(branch),
          defaultDurationMinutes: p.durationMinutes,
          weeklySchedule,
          updatedBy: ownerId,
        },
        $setOnInsert: { createdBy: ownerId },
      },
      UPSERT,
    );
    practitionerIds.set(p.email, required(doc, p.email)._id);
  }
  const practitioner = (email: string) => required(practitionerIds.get(email), email);

  await ScheduleExceptionModel.deleteMany({ organizationId, seedKey: { $type: 'string' } });
  for (const e of org.exceptions) {
    await ScheduleExceptionModel.create({
      organizationId,
      practitionerId: practitioner(e.practitioner),
      date: addDays(today, e.day),
      branchId: e.branch ? branch(e.branch) : null,
      kind: e.kind,
      intervals: e.intervals ?? [],
      createdBy: ownerId,
      seedKey: e.key,
    });
  }

  const patientIds = new Map<string, Types.ObjectId>();
  for (const p of org.patients) {
    const phone = required(normalizePhone(p.phone.number, p.phone.country), `${p.key} phone`);
    const registrations = p.registrations.map((r) => ({
      branchId: branch(r.branch),
      status: r.status ?? 'active',
      registeredAt: ctx.now,
      registeredBy: ownerId,
      archivedAt: r.status === 'archived' ? ctx.now : null,
    }));
    const fields = {
      fullName: p.fullName,
      nameKey: nameKey(p.fullName),
      phone,
      secondaryPhone: null,
      email: null,
      dateOfBirth: p.dateOfBirth ?? null,
      sex: p.sex ?? 'unspecified',
      address: null,
      registrations,
      updatedBy: ownerId,
    };
    const existing = await PatientModel.findOne({ organizationId, seedKey: p.key }).select('_id').lean();
    const doc = existing
      ? await PatientModel.findOneAndUpdate({ organizationId, _id: existing._id }, { $set: fields }, { returnDocument: 'after' })
      : await PatientModel.create({
          ...fields,
          organizationId,
          patientNumber: await nextPatientNumber(organizationId),
          createdBy: ownerId,
          seedKey: p.key,
        });
    patientIds.set(p.key, required(doc, p.key)._id);
  }

  // Replace the previous run's seed appointments (and only those) with today's set.
  const previous = await AppointmentModel.find({ organizationId, seedKey: { $type: 'string' } }).select('_id').lean();
  await SlotReservationModel.deleteMany({ organizationId, appointmentId: { $in: previous.map((a) => a._id) } });
  await AppointmentModel.deleteMany({ organizationId, _id: { $in: previous.map((a) => a._id) } });

  for (const a of org.appointments) {
    await seedAppointment(org, a, {
      organizationId,
      ownerId,
      practitionerId: practitioner(a.practitioner),
      patientId: required(patientIds.get(a.patient), a.patient),
      branchId: branch(a.branch),
      date: addDays(today, a.day),
      durationMinutes: required(org.practitioners.find((p) => p.email === a.practitioner), a.practitioner).durationMinutes,
      now: ctx.now,
      skipped: ctx.skipped,
    });
  }
}

async function seedAppointment(
  org: DemoOrganization,
  a: DemoAppointment,
  ctx: {
    organizationId: Types.ObjectId;
    ownerId: Types.ObjectId;
    practitionerId: Types.ObjectId;
    patientId: Types.ObjectId;
    branchId: Types.ObjectId;
    date: string;
    durationMinutes: number;
    now: Date;
    skipped: string[];
  },
) {
  const resolved = resolveLocalTime(ctx.date, a.time, org.timeZone);
  if (resolved.kind !== 'ok') {
    ctx.skipped.push(`${org.key}/${a.key} (${a.time} does not map to one instant on ${ctx.date})`);
    return;
  }
  const startAt = resolved.instant;
  const endAt = new Date(startAt.getTime() + ctx.durationMinutes * 60_000);
  // Arrival a few minutes before the booked time, start at it, completion at its end — but never
  // later than the seed time, so a morning seed has no arrivals "in the future".
  const offsets: Record<string, number> = { checkedInAt: -5, startedAt: 0, completedAt: ctx.durationMinutes, cancelledAt: -60, noShowAt: ctx.durationMinutes };
  const stamps: Record<string, Date> = {};
  for (const field of STATUS_TIMESTAMP[a.status] ?? []) {
    const at = startAt.getTime() + (offsets[field] ?? 0) * 60_000;
    stamps[field] = new Date(Math.min(at, ctx.now.getTime()));
  }

  const appointment = await AppointmentModel.create({
    organizationId: ctx.organizationId,
    branchId: ctx.branchId,
    patientId: ctx.patientId,
    practitionerId: ctx.practitionerId,
    startAt,
    endAt,
    durationMinutes: ctx.durationMinutes,
    type: a.type ?? 'new_visit',
    status: a.status,
    cancellationReason: a.reason ?? null,
    ...stamps,
    createdBy: ctx.ownerId,
    updatedBy: ctx.ownerId,
    seedKey: a.key,
  });
  if (!OCCUPYING_STATUSES.includes(a.status)) return;
  const cells = gridCells(startAt, ctx.durationMinutes);
  const rows = (['practitioner', 'patient'] as const).flatMap((resourceType) =>
    cells.map((slotStart) => ({
      organizationId: ctx.organizationId,
      resourceType,
      resourceId: resourceType === 'practitioner' ? ctx.practitionerId : ctx.patientId,
      slotStart,
      appointmentId: appointment._id,
    })),
  );
  try {
    await SlotReservationModel.insertMany(rows);
  } catch {
    // Collides with something created by hand: leave that alone and drop this seed booking.
    await SlotReservationModel.deleteMany({ organizationId: ctx.organizationId, appointmentId: appointment._id });
    await AppointmentModel.deleteOne({ organizationId: ctx.organizationId, _id: appointment._id });
    ctx.skipped.push(`${org.key}/${a.key} (time already taken)`);
  }
}
