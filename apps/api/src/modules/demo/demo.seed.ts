import type { Types } from 'mongoose';
import { hashPassword } from '../../auth/password.js';
import { clock } from '../../time/clock.js';
import { addDays, gridCells, resolveLocalTime, todayIn } from '../../time/local-time.js';
import { UserModel } from '../../users/user.model.js';
import { AppointmentModel, SlotReservationModel } from '../appointments/appointment.model.js';
import { OCCUPYING_STATUSES, type AppointmentStatus } from '../appointments/appointment.state.js';
import { BranchModel } from '../branches/branch.model.js';
import { AddendumModel, EncounterModel } from '../clinical/clinical.model.js';
import { CoverageModel } from '../clinical/coverage.model.js';
import { FinanceServiceModel } from '../finance/finance.model.js';
import { runTransaction } from '../../db/transaction.js';
import { localDateOf } from '../../time/local-time.js';
import { AccountingSettingsModel, CashAccountModel, LedgerAccountModel } from '../accounting/accounting.model.js';
import { createLedger } from '../accounting/accounting.setup.js';
import { StockItemModel, WarehouseModel } from '../inventory/inventory.model.js';
import { lockItem, saveDocument, stockIn, newId } from '../inventory/inventory.stock.js';
import { ensureCounter } from '../finance/finance.model.js';
import { prepareLedger } from '../accounting/accounting.posting.js';
import { latestTemplate, parseTemplateData } from '../clinical/templates.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { nextPatientNumber } from '../patients/counter.model.js';
import { nameKey, nameTokens, normalizePhone, phoneTails } from '../patients/normalize.js';
import { PatientModel } from '../patients/patient.model.js';
import { PractitionerModel, ScheduleExceptionModel } from '../practitioners/practitioner.model.js';
import { DEMO_ORGANIZATIONS, DEMO_USERS, type DemoAppointment, type DemoEncounter, type DemoOrganization } from './demo.data.js';

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
        {
          $set: { name: org.name, timeZone: org.timeZone, type: org.type, specialtyCodes: org.specialtyCodes, currency: org.finance?.currency ?? null },
          $setOnInsert: { createdBy: ownerId },
        },
        UPSERT,
      ),
      org.key,
    );
    const organizationId = organization._id;
    const branchIds = new Map<string, Types.ObjectId>();
    for (const branch of org.branches) {
      const doc = await BranchModel.findOneAndUpdate(
        { organizationId, name: branch.name },
        { $set: { city: branch.city, status: 'active', specialtyCodes: branch.specialtyCodes } },
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
    // Synthetic catalog: upserted by code (prices are examples, not real tariffs).
    for (const s of org.finance?.services ?? []) {
      await FinanceServiceModel.updateOne(
        { organizationId, code: s.code },
        {
          $set: { name: s.name, specialtyCode: s.specialtyCode, price: s.price, status: 'active', currency: org.finance?.currency, updatedBy: ownerId },
          $setOnInsert: { branchPrices: [], version: 0, createdBy: ownerId },
        },
        { upsert: true },
      );
    }
    if (org.finance?.currency) await seedLedger(organizationId, ownerId, org.finance.currency, org.timeZone, [...branchIds.values()], now);
    if (org.finance?.currency) await seedStock(organizationId, ownerId, org.timeZone, [...branchIds.values()], now);
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
      nameTokens: nameTokens(nameKey(p.fullName)),
      phoneTails: phoneTails(phone),
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

  // Seed visit records belong to seed appointments, which are re-created below. Clinical records
  // can never be deleted — except these synthetic ones, by the seed (allowSeedCleanup).
  const seedEncounters = await EncounterModel.find({ organizationId, seedKey: { $type: 'string' } }).select('_id').lean();
  await CoverageModel.deleteMany(
    { organizationId, 'scope.encounterId': { $in: seedEncounters.map((e) => e._id) } },
    { allowSeedCleanup: true },
  );
  await AddendumModel.deleteMany({ organizationId, seedKey: { $type: 'string' } }, { allowSeedCleanup: true });
  await EncounterModel.deleteMany({ organizationId, seedKey: { $type: 'string' } }, { allowSeedCleanup: true });

  // Replace the previous run's seed appointments (and only those) with today's set.
  const previous = await AppointmentModel.find({ organizationId, seedKey: { $type: 'string' } }).select('_id').lean();
  await SlotReservationModel.deleteMany({ organizationId, appointmentId: { $in: previous.map((a) => a._id) } });
  await AppointmentModel.deleteMany({ organizationId, _id: { $in: previous.map((a) => a._id) } });

  const appointments = new Map<string, Awaited<ReturnType<typeof seedAppointment>>>();
  for (const a of org.appointments) {
    const created = await seedAppointment(org, a, {
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
    appointments.set(a.key, created);
  }

  const seededEncounters = new Map<string, string>();
  for (const e of org.encounters ?? []) {
    const appointment = appointments.get(e.appointment);
    if (!appointment) {
      ctx.skipped.push(`${org.key}/${e.key} (its appointment was skipped)`);
      continue;
    }
    const demo = required(org.appointments.find((a) => a.key === e.appointment), e.appointment);
    const authorUserId = required(ctx.userIds.get(demo.practitioner), demo.practitioner);
    const visitTime = appointment.completedAt ?? appointment.startedAt ?? ctx.now;
    // A late entry is written some hours after the visit; otherwise during it.
    const createdAt = e.lateEntryReason
      ? new Date(Math.min(visitTime.getTime() + 3 * 3_600_000, ctx.now.getTime()))
      : (appointment.startedAt ?? visitTime);
    const finalizedAt =
      e.status === 'finalized' ? new Date(Math.min(Math.max(visitTime.getTime(), createdAt.getTime()) + 10 * 60_000, ctx.now.getTime())) : null;
    const encounter = await EncounterModel.create({
      organizationId,
      branchId: appointment.branchId,
      patientId: appointment.patientId,
      appointmentId: appointment._id,
      practitionerId: appointment.practitionerId,
      authorUserId,
      status: e.status,
      sections: { reason: '', history: '', examination: '', assessment: '', plan: '', ...e.sections },
      specialty: e.specialty ? seedSpecialty(e.specialty, seededEncounters) : null,
      version: e.status === 'finalized' ? 2 : 1,
      lateEntry: e.lateEntryReason ? { reason: e.lateEntryReason } : null,
      creationKey: `seed-${e.key}`,
      creationHash: `seed-${e.key}`,
      lastEditedAt: createdAt,
      finalizedAt,
      finalizedBy: finalizedAt ? authorUserId : null,
      finalizationKey: finalizedAt ? `seed-${e.key}-final` : null,
      seedKey: e.key,
      createdAt,
    });
    seededEncounters.set(e.key, String(encounter._id));
    for (const [i, x] of (e.addenda ?? []).entries()) {
      await AddendumModel.create({
        organizationId,
        encounterId: encounter._id,
        authorUserId,
        practitionerId: appointment.practitionerId,
        reason: x.reason,
        content: x.content,
        idempotencyKey: `seed-${x.key}`,
        requestHash: `seed-${x.key}`,
        seedKey: x.key,
        createdAt: new Date(Math.min((finalizedAt ?? createdAt).getTime() + (i + 1) * 3_600_000, ctx.now.getTime())),
      });
    }
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
    return null;
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
  if (!OCCUPYING_STATUSES.includes(a.status)) return appointment;
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
    return null;
  }
  return appointment;
}

/** Specialty data for a seed record, validated like any record (references resolved by seed key). */
function seedSpecialty(specialty: NonNullable<DemoEncounter['specialty']>, seeded: Map<string, string>) {
  const template = latestTemplate(specialty.template);
  const resolved = JSON.parse(
    JSON.stringify(specialty.data, (_key, value: unknown) =>
      typeof value === 'string' && value.startsWith('seed:') ? required(seeded.get(value.slice(5)), value) : value,
    ),
  ) as unknown;
  const parsed = parseTemplateData(template, resolved);
  if (!parsed.ok) throw new Error(`Demo seed: invalid specialty data (${Object.keys(parsed.fields).join(', ')})`);
  return { template: template.id, version: template.version, data: parsed.data };
}

/**
 * The demo ledger (ERP milestone A): template chart from the first day of the seed's month, and one
 * cashbox per branch so cashier sessions can be tried. Created once; reruns leave it as it is.
 */
async function seedLedger(organizationId: Types.ObjectId, ownerId: Types.ObjectId, currency: 'EGP' | 'SAR', timeZone: string, branchIds: Types.ObjectId[], now: Date) {
  if (await AccountingSettingsModel.exists({ organizationId })) return;
  const cutoverDate = `${localDateOf(now, timeZone).slice(0, 7)}-01`;
  await runTransaction(async (session) => {
    await createLedger({ organizationId, userId: ownerId, currency, cutoverDate, requireCashSession: false }, session);
    const group = await LedgerAccountModel.findOne({ organizationId, templateKey: 'cashAndBanks' }).session(session).lean();
    for (const [i, branchId] of branchIds.entries()) {
      const [ledger] = await LedgerAccountModel.create(
        [{ organizationId, code: String(1131 + i), name: `Branch cashbox ${i + 1}`, type: 'asset', parentId: group?._id ?? null, role: 'cash' }],
        { session },
      );
      await CashAccountModel.create([{ organizationId, name: `Branch cashbox ${i + 1}`, kind: 'cash', branchId, accountId: ledger!._id }], { session });
    }
  });
}

/** Synthetic medical supplies (ERP milestone B): a store per branch, a few items, opening stock once. */
const DEMO_STOCK = [
  { code: 'GLV-M', name: 'Examination gloves (M)', category: 'Disposables', baseUnit: 'piece', purchaseUnits: [{ unit: 'box', factor: 100 }], tracking: 'none' as const, reorderLevel: 100, qty: 400, unitCost: 150 },
  { code: 'ANS-2', name: 'Local anesthetic cartridge', category: 'Medicines', baseUnit: 'cartridge', purchaseUnits: [{ unit: 'box', factor: 50 }], tracking: 'lot' as const, reorderLevel: 40, qty: 60, unitCost: 1800 },
  { code: 'CMP-A2', name: 'Composite resin A2', category: 'Dental materials', baseUnit: 'syringe', purchaseUnits: [], tracking: 'lot' as const, reorderLevel: 5, qty: 8, unitCost: 32000 },
  { code: 'TIP-EAR', name: 'Disposable ear speculum tips', category: 'Disposables', baseUnit: 'piece', purchaseUnits: [{ unit: 'pack', factor: 50 }], tracking: 'none' as const, reorderLevel: 50, qty: 30, unitCost: 120 },
];
async function seedStock(organizationId: Types.ObjectId, ownerId: Types.ObjectId, timeZone: string, branchIds: Types.ObjectId[], now: Date) {
  if (await WarehouseModel.exists({ organizationId })) return;
  const today = localDateOf(now, timeZone);
  const ctx = { organizationId, userId: ownerId };
  await ensureCounter(organizationId, `SD:${today.slice(0, 4)}`);
  await prepareLedger(organizationId);
  for (const [i, branchId] of branchIds.entries()) {
    await WarehouseModel.create({ organizationId, branchId, name: `Main store ${i + 1}` });
  }
  for (const s of DEMO_STOCK) {
    await StockItemModel.updateOne(
      { organizationId, code: s.code },
      { $setOnInsert: { name: s.name, category: s.category, baseUnit: s.baseUnit, purchaseUnits: s.purchaseUnits, tracking: s.tracking, reorderLevel: s.reorderLevel, createdBy: ownerId } },
      { upsert: true },
    );
  }
  const store = await WarehouseModel.findOne({ organizationId, branchId: branchIds[0] }).lean();
  if (!store) return;
  await runTransaction(async (session) => {
    const moves = [];
    for (const s of DEMO_STOCK) {
      const doc = await StockItemModel.findOne({ organizationId, code: s.code }).session(session).lean();
      const item = await lockItem(ctx, doc!._id, session);
      moves.push(await stockIn(ctx, item, store, { qty: s.qty, lot: s.tracking === 'lot' ? `DEMO-${s.code}` : '', expiry: s.tracking === 'lot' ? addDays(today, s.code === 'ANS-2' ? 45 : 400) : null, value: s.qty * s.unitCost }, session));
    }
    await saveDocument(
      ctx,
      { _id: newId(), type: 'opening', date: today, warehouseId: store._id, toWarehouseId: null, branchId: store.branchId, reason: 'Synthetic demo stock', source: { encounterId: null, recordItemId: null, documentId: null }, sourceKey: null, reversalOf: null, idempotencyKey: 'demo-opening-stock', requestHash: 'demo' },
      moves,
      { debit: 'inventory', credit: 'openingEquity' },
      session,
    );
  });
}
