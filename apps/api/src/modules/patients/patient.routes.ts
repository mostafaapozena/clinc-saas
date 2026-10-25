import { runTransaction } from '../../db/transaction.js';
import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { HttpError, conflict, notFound, validationError } from '../../http/errors.js';
import { emailSchema, escapeRegex, objectIdSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { canAccessBranch } from '../../tenancy/scope.js';
import { parseObjectId, requirePermission, tenantOf, type TenantContext } from '../../tenancy/tenant-context.js';
import { clock } from '../../time/clock.js';
import { DATE_PATTERN, isValidDate, todayIn } from '../../time/local-time.js';
import { AppointmentModel } from '../appointments/appointment.model.js';
import { toAppointmentDtos } from '../appointments/appointment.dto.js';
import { recordAudit } from '../audit/audit-event.model.js';
import { BranchModel } from '../branches/branch.model.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { futureActiveAppointments, toAppointmentRef } from '../scheduling/schedule.service.js';
import { visibleAppointmentsFilter } from '../scheduling/scheduling-context.js';
import { nextPatientNumber } from './counter.model.js';
import {
  PHONE_COUNTRIES,
  nameKey,
  nameTokens,
  normalizePhone,
  phoneSearchCandidates,
  toAsciiDigits,
  type NormalizedPhone,
} from './normalize.js';
import { PATIENT_SEXES, PatientModel, REGISTRATION_STATUSES, type Patient } from './patient.model.js';
import { loadAccessiblePatient, patientScopeFilter, toPatientDto, toPatientSummaryDto } from './patient.service.js';

const phoneInputSchema = z.object({
  country: z.enum(PHONE_COUNTRIES).optional(),
  number: z.string().trim().min(1).max(32),
});
const fullNameSchema = z.string().trim().min(2).max(120);
const dateOfBirthSchema = z.string().regex(DATE_PATTERN).refine(isValidDate, 'invalid_format');
const addressSchema = z.object({ line: z.string().trim().max(200).default(''), city: z.string().trim().max(80).default('') });

const demographicsShape = {
  fullName: fullNameSchema,
  phone: phoneInputSchema,
  secondaryPhone: phoneInputSchema.nullable().optional(),
  email: emailSchema.nullable().optional(),
  dateOfBirth: dateOfBirthSchema.nullable().optional(),
  sex: z.enum(PATIENT_SEXES).optional(),
  address: addressSchema.nullable().optional(),
};

const createSchema = z.object({
  ...demographicsShape,
  branchId: objectIdSchema,
  /** Set after the user has seen and dismissed a possible-duplicate warning. */
  confirmDuplicate: z.boolean().optional(),
});

const updateSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    phone: phoneInputSchema.optional(),
    secondaryPhone: demographicsShape.secondaryPhone,
    email: demographicsShape.email,
    dateOfBirth: demographicsShape.dateOfBirth,
    sex: demographicsShape.sex,
    address: demographicsShape.address,
    version: z.number().int().min(0),
  });

/** Largest exact total the patient list reports; beyond it the total is shown as "more than". */
export const COUNT_CAP = 1000;

/**
 * Index per sort, given explicitly: tenants differ in size by orders of magnitude, and MongoDB's
 * plan cache otherwise reused a plan won on a small organization for a 50,000-patient one (S3).
 */
const SORT_HINTS = {
  recent: { organizationId: 1, createdAt: -1, _id: -1 },
  name: { organizationId: 1, nameKey: 1, _id: 1 },
  number: { organizationId: 1, patientNumber: 1 },
} as const;
/** Patient list/search queries stop after this long (503 QUERY_TIMEOUT) instead of running on. */
const LIST_MAX_TIME_MS = 5_000;

const SORTS = {
  recent: { createdAt: -1, _id: -1 },
  name: { nameKey: 1, _id: 1 },
  number: { patientNumber: 1 },
} as const;

const listQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  branchId: objectIdSchema.optional(),
  status: z.enum([...REGISTRATION_STATUSES, 'all']).default('active'),
  sort: z.enum(['recent', 'name', 'number']).default('recent'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

const historyQuerySchema = z.object({
  when: z.enum(['upcoming', 'past']).default('upcoming'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

const registrationSchema = z.object({ branchId: objectIdSchema });
const registrationStatusSchema = z.object({ status: z.enum(REGISTRATION_STATUSES) });

const invalidBranch = () => new HttpError(400, 'INVALID_BRANCH', 'One or more branches are not available');
const versionConflict = () =>
  conflict('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');

/** Validates a phone input; field errors use stable codes the web app translates. */
function parsePhone(input: { country?: (typeof PHONE_COUNTRIES)[number]; number: string }, field: string): NormalizedPhone {
  const digits = toAsciiDigits(input.number).replace(/[\s\-().]/g, '');
  const international = digits.startsWith('+') || digits.startsWith('00');
  if (!international && !input.country) throw validationError({ [`${field}.country`]: 'required' });
  const phone = normalizePhone(input.number, input.country);
  if (!phone) throw validationError({ [`${field}.number`]: 'invalid_phone' });
  return phone;
}

async function checkDateOfBirth(tenant: TenantContext, value: string | null | undefined) {
  if (!value) return;
  const organization = await OrganizationModel.findById(tenant.organizationId).select('timeZone').lean();
  const today = todayIn(organization?.timeZone ?? 'UTC');
  if (value > today || value < '1900-01-01') throw validationError({ dateOfBirth: 'out_of_range' });
}

/** The branch must be active and inside the caller's scope; others look like unknown ids. */
async function requireUsableBranch(tenant: TenantContext, rawId: string) {
  const branchId = new Types.ObjectId(rawId);
  if (!canAccessBranch(tenant, branchId)) throw invalidBranch();
  const branch = await BranchModel.findOne({ organizationId: tenant.organizationId, _id: branchId, status: 'active' }).lean();
  if (!branch) throw invalidBranch();
  return branchId;
}

export const patientsRouter = Router({ mergeParams: true });

patientsRouter.get('/', requirePermission('patient.list'), async (req, res) => {
  const tenant = tenantOf(req);
  const query = parseInput(listQuerySchema, req.query);

  const conditions: Record<string, unknown>[] = [];
  if (query.branchId) {
    const branchId = new Types.ObjectId(query.branchId);
    if (!canAccessBranch(tenant, branchId)) throw notFound();
    conditions.push({
      registrations: { $elemMatch: { branchId, ...(query.status === 'all' ? {} : { status: query.status }) } },
    });
  } else if (query.status !== 'all') {
    // A registration in scope must have the requested status.
    conditions.push({
      registrations: {
        $elemMatch: {
          status: query.status,
          ...(tenant.branchScope.type === 'selected' ? { branchId: { $in: tenant.branchScope.branchIds } } : {}),
        },
      },
    });
  }
  let nameOnly = false;
  if (query.q) {
    const term = toAsciiDigits(query.q);
    const or: Record<string, unknown>[] = [];
    if (/^\d{1,9}$/.test(term)) or.push({ patientNumber: Number(term) });
    const phones = phoneSearchCandidates(term);
    if (phones.length > 0) or.push({ 'phone.e164': { $in: phones } }, { 'secondaryPhone.e164': { $in: phones } });
    // Every word typed must start a word of the name (index range on nameTokens). A substring
    // regex on nameKey read every patient of the organization (scalability review, finding S2).
    const words = nameTokens(nameKey(query.q)).slice(0, 5);
    if (words.length > 0) or.push({ $and: words.map((w) => ({ nameTokens: { $regex: `^${escapeRegex(w)}` } })) });
    conditions.push({ $or: or });
    nameOnly = or.length === 1 && words.length > 0;
  }
  const filter = patientScopeFilter(tenant, conditions.length > 0 ? { $and: conditions } : {});
  // Name-only searches use the token index; plain lists the index of their sort. A search that
  // mixes number/phone/name branches is an $or the planner combines per branch.
  const hint = nameOnly ? { organizationId: 1, nameTokens: 1 } : query.q ? undefined : SORT_HINTS[query.sort];
  const [items, total] = await Promise.all([
    PatientModel.find(filter, null, hint ? { hint } : {})
      .sort(SORTS[query.sort])
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .maxTimeMS(LIST_MAX_TIME_MS)
      .lean(),
    // Counting stops after COUNT_CAP matches: an exact total read every matching patient on every
    // page view (finding S1). Beyond the cap the list says "more than …" and asks to refine.
    PatientModel.countDocuments(filter, { limit: COUNT_CAP + 1, maxTimeMS: LIST_MAX_TIME_MS, ...(hint ? { hint } : {}) }),
  ]);
  res.json({
    data: items.map((p) => toPatientSummaryDto(p, tenant)),
    page: query.page,
    pageSize: query.pageSize,
    total: Math.min(total, COUNT_CAP),
    totalCapped: total > COUNT_CAP,
  });
});

patientsRouter.post('/', requirePermission('patient.create'), async (req, res) => {
  const tenant = tenantOf(req);
  const input = parseInput(createSchema, req.body);
  const phone = parsePhone(input.phone, 'phone');
  const secondaryPhone = input.secondaryPhone ? parsePhone(input.secondaryPhone, 'secondaryPhone') : null;
  await checkDateOfBirth(tenant, input.dateOfBirth);
  const branchId = await requireUsableBranch(tenant, input.branchId);
  const key = nameKey(input.fullName);

  if (!input.confirmDuplicate) {
    // A warning, not proof: same normalized name and phone, searched only where the caller may
    // look. Patients registered only in hidden branches are never considered or revealed.
    const matches = await PatientModel.find(
      patientScopeFilter(tenant, { nameKey: key, $or: [{ 'phone.e164': phone.e164 }, { 'secondaryPhone.e164': phone.e164 }] }),
    )
      .limit(5)
      .lean();
    if (matches.length > 0) {
      throw conflict('POSSIBLE_DUPLICATE', 'A patient with the same name and phone number exists', {
        matches: matches.map((m) => ({ id: String(m._id), patientNumber: m.patientNumber, fullName: m.fullName })),
      });
    }
  }

  const now = new Date();
  const patient = await PatientModel.create({
    organizationId: tenant.organizationId,
    patientNumber: await nextPatientNumber(tenant.organizationId),
    fullName: input.fullName,
    nameKey: key,
    nameTokens: nameTokens(key),
    phone,
    secondaryPhone,
    email: input.email ?? null,
    dateOfBirth: input.dateOfBirth ?? null,
    sex: input.sex ?? 'unspecified',
    address: input.address && (input.address.line || input.address.city) ? input.address : null,
    registrations: [{ branchId, status: 'active', registeredAt: now, registeredBy: tenant.userId, archivedAt: null }],
    createdBy: tenant.userId,
    updatedBy: tenant.userId,
  });
  await recordAudit({
    organizationId: tenant.organizationId,
    actorUserId: tenant.userId,
    action: 'patient.created',
    target: { type: 'patient', id: patient._id },
    changes: { branchId, duplicateWarningConfirmed: Boolean(input.confirmDuplicate) },
  });
  res.status(201).json({ patient: toPatientDto(patient.toObject(), tenant) });
});

patientsRouter.get('/:patientId', requirePermission('patient.read'), async (req, res) => {
  const tenant = tenantOf(req);
  const patient = await loadAccessiblePatient(tenant, req.params.patientId);
  res.json({ patient: toPatientDto(patient, tenant) });
});

patientsRouter.patch('/:patientId', requirePermission('patient.update'), async (req, res) => {
  const tenant = tenantOf(req);
  const input = parseInput(updateSchema, req.body);
  const current = await loadAccessiblePatient(tenant, req.params.patientId);

  // Explicit allowlist: only these fields can ever be written from this request.
  const set: Partial<Patient> = {};
  if (input.fullName !== undefined) {
    set.fullName = input.fullName;
    set.nameKey = nameKey(input.fullName);
    set.nameTokens = nameTokens(set.nameKey);
  }
  if (input.phone !== undefined) set.phone = parsePhone(input.phone, 'phone');
  if (input.secondaryPhone !== undefined) {
    set.secondaryPhone = input.secondaryPhone ? parsePhone(input.secondaryPhone, 'secondaryPhone') : null;
  }
  if (input.email !== undefined) set.email = input.email;
  if (input.dateOfBirth !== undefined) {
    await checkDateOfBirth(tenant, input.dateOfBirth);
    set.dateOfBirth = input.dateOfBirth;
  }
  if (input.sex !== undefined) set.sex = input.sex;
  if (input.address !== undefined) {
    set.address = input.address && (input.address.line || input.address.city) ? input.address : null;
  }
  const changedFields = Object.keys(set).filter((key) => key !== 'nameKey' && key !== 'nameTokens' && JSON.stringify(set[key as keyof Patient]) !== JSON.stringify(current[key as keyof Patient]));

  const saved = await PatientModel.findOneAndUpdate(
    { organizationId: tenant.organizationId, _id: current._id, version: input.version },
    { $set: { ...set, updatedBy: tenant.userId }, $inc: { version: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!saved) throw versionConflict();
  if (changedFields.length > 0) {
    await recordAudit({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      action: 'patient.updated',
      target: { type: 'patient', id: current._id },
      changes: { fields: changedFields },
    });
  }
  res.json({ patient: toPatientDto(saved, tenant) });
});

patientsRouter.post('/:patientId/registrations', requirePermission('patient.registration.manage'), async (req, res) => {
  const tenant = tenantOf(req);
  const input = parseInput(registrationSchema, req.body);
  const patient = await loadAccessiblePatient(tenant, req.params.patientId);
  const branchId = await requireUsableBranch(tenant, input.branchId);
  const saved = await PatientModel.findOneAndUpdate(
    { organizationId: tenant.organizationId, _id: patient._id, 'registrations.branchId': { $ne: branchId } },
    {
      $push: { registrations: { branchId, status: 'active', registeredAt: new Date(), registeredBy: tenant.userId, archivedAt: null } },
      $inc: { version: 1, scheduleSeq: 1 },
      $set: { updatedBy: tenant.userId },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!saved) throw conflict('ALREADY_REGISTERED', 'The patient is already registered in this branch');
  await recordAudit({
    organizationId: tenant.organizationId,
    actorUserId: tenant.userId,
    action: 'patient.branch_registered',
    target: { type: 'patient', id: patient._id },
    changes: { branchId },
  });
  res.status(201).json({ patient: toPatientDto(saved, tenant) });
});

patientsRouter.patch(
  '/:patientId/registrations/:branchId',
  requirePermission('patient.registration.manage'),
  async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(registrationStatusSchema, req.body);
    const patient = await loadAccessiblePatient(tenant, req.params.patientId);
    const branchId = parseObjectId(req.params.branchId);
    if (!branchId || !canAccessBranch(tenant, branchId)) throw notFound();
    const registration = patient.registrations.find((r) => r.branchId.equals(branchId));
    if (!registration) throw notFound();
    if (registration.status === input.status) {
      res.json({ patient: toPatientDto(patient, tenant) });
      return;
    }

    const saved = await runTransaction(async (session) => {
      // Writing the patient first serializes this with bookings for the same patient.
      const touched = await PatientModel.findOneAndUpdate(
        { organizationId: tenant.organizationId, _id: patient._id },
        { $inc: { scheduleSeq: 1 } },
        { session },
      );
      if (!touched) throw notFound();
      if (input.status === 'archived') {
        // Never silently cancel: the caller must resolve these first.
        const future = await futureActiveAppointments(tenant.organizationId, { patientId: patient._id, branchId });
        if (future.length > 0) {
          throw conflict('FUTURE_APPOINTMENTS_EXIST', 'Cancel or reschedule the future appointments in this branch first', {
            appointments: future.map(toAppointmentRef),
          });
        }
      }
      const updated = await PatientModel.findOneAndUpdate(
        { organizationId: tenant.organizationId, _id: patient._id, 'registrations.branchId': branchId },
        {
          $set: {
            'registrations.$.status': input.status,
            'registrations.$.archivedAt': input.status === 'archived' ? new Date() : null,
            updatedBy: tenant.userId,
          },
          $inc: { version: 1 },
        },
        { session, returnDocument: 'after' },
      ).lean();
      if (!updated) throw notFound();
      await recordAudit(
        {
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          action: input.status === 'archived' ? 'patient.registration_archived' : 'patient.registration_reactivated',
          target: { type: 'patient', id: patient._id },
          changes: { branchId },
        },
        session,
      );
      return updated;
    });
    res.json({ patient: toPatientDto(saved, tenant) });
  },
);

patientsRouter.get('/:patientId/appointments', requirePermission('appointment.read'), async (req, res) => {
  const tenant = tenantOf(req);
  const query = parseInput(historyQuerySchema, req.query);
  const patient = await loadAccessiblePatient(tenant, req.params.patientId);
  const now = clock.now();
  const timeFilter = query.when === 'upcoming' ? { startAt: { $gte: now } } : { startAt: { $lt: now } };
  const filter = await visibleAppointmentsFilter(tenant, { patientId: patient._id, ...timeFilter });
  if (!filter) {
    res.json({ data: [], page: query.page, pageSize: query.pageSize, total: 0 });
    return;
  }
  const [items, total] = await Promise.all([
    AppointmentModel.find(filter)
      .sort({ startAt: query.when === 'upcoming' ? 1 : -1, _id: 1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean(),
    AppointmentModel.countDocuments(filter),
  ]);
  res.json({ data: await toAppointmentDtos(tenant, items), page: query.page, pageSize: query.pageSize, total });
});
