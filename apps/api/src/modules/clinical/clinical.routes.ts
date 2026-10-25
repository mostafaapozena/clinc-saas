import { runTransaction } from '../../db/transaction.js';
import { createHash } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { type ClientSession, type Types } from 'mongoose';
import { z } from 'zod';
import { HttpError, conflict, forbidden, isDuplicateKeyError, notFound, validationError } from '../../http/errors.js';
import { parseInput } from '../../http/validate.js';
import { hasPermission } from '../../tenancy/permissions.js';
import { parseObjectId, tenantOf, type TenantContext } from '../../tenancy/tenant-context.js';
import { clock } from '../../time/clock.js';
import { AppointmentModel } from '../appointments/appointment.model.js';
import { PractitionerModel } from '../practitioners/practitioner.model.js';
import { PatientModel } from '../patients/patient.model.js';
import {
  activeCoverage,
  inactiveCoverageReason,
  recordAccess,
  resolveClinicalActor,
  treats,
  visibleEncountersForPatient,
  type ClinicalActor,
} from './clinical-access.js';
import { recordClinical, recordClinicalOnce } from './clinical-audit.js';
import {
  AddendumModel,
  ENCOUNTER_SECTIONS,
  EncounterModel,
  SECTION_MAX,
  type Addendum,
  type Encounter,
  type EncounterSection,
} from './clinical.model.js';
import { referenceProblems } from './specialty-refs.js';
import { TEMPLATE_IDS, latestTemplate, parseTemplateData, templateVersion, templatesForSpecialty } from './templates.js';

// Clinical visit records (docs/architecture/CLINICAL.md). Every endpoint:
//   1. requires `clinical.encounter.own` (otherwise 403, and a denial is recorded);
//   2. resolves the treating clinician afresh (membership + practitioner profile);
//   3. checks the treating relationship for the appointment / record — anything else answers the
//      generic 404, whether the record exists or not;
//   4. for mutations, repeats 2–3 inside the transaction that also locks the membership.
// Responses are no-store; clinical text never goes into errors, logs or audit events.

type EncounterLean = Encounter & { _id: Types.ObjectId };
type AddendumLean = Addendum & { _id: Types.ObjectId };

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

/** Keeps line breaks and tabs; drops every other control character. */
function stripControl(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code === 9 || code === 10 || (code >= 32 && code !== 127)) out += ch;
  }
  return out;
}

/** Plain text only: line endings normalized, control characters removed, ends trimmed. */
export const clinicalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => stripControl(value.replace(/\r\n?/g, '\n')).trim());

const sectionsSchema = z.object(
  Object.fromEntries(ENCOUNTER_SECTIONS.map((section) => [section, clinicalText(SECTION_MAX).optional()])) as Record<
    EncounterSection,
    z.ZodOptional<ReturnType<typeof clinicalText>>
  >,
);
const createSchema = z.object({
  sections: sectionsSchema.optional(),
  lateEntryReason: clinicalText(300).pipe(z.string().min(5)).optional(),
  /** Specialty template (must fit the practitioner's specialty); default: the first that fits. */
  template: z.enum(TEMPLATE_IDS).optional(),
  specialtyData: z.unknown().optional(),
});
const saveSchema = z.object({
  sections: sectionsSchema,
  /** Full specialty data of the record's own template version (replaces the saved data). */
  specialtyData: z.unknown().optional(),
  version: z.number().int().min(0),
});
const finalizeSchema = z.object({ version: z.number().int().min(0) });
const addendumSchema = z.object({
  reason: clinicalText(300).pipe(z.string().min(3)),
  content: clinicalText(SECTION_MAX).pipe(z.string().min(1)),
});

const emptySections = (): Record<EncounterSection, string> =>
  Object.fromEntries(ENCOUNTER_SECTIONS.map((s) => [s, ''])) as Record<EncounterSection, string>;
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');

export function requireKey(req: Request): string {
  const key = req.get('idempotency-key') ?? '';
  if (!IDEMPOTENCY_KEY.test(key)) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header');
  return key;
}

/**
 * Minimum for finalizing (provisional, pending clinician review): the reason for the visit, plus
 * at least one of examination findings, assessment or plan. History is never required.
 */
function finalizationProblems(sections: Record<EncounterSection, string>): Record<string, string> | null {
  const problems: Record<string, string> = {};
  if (!sections.reason.trim()) problems['sections.reason'] = 'required';
  if (!sections.examination.trim() && !sections.assessment.trim() && !sections.plan.trim()) {
    problems.sections = 'needs_findings_assessment_or_plan';
  }
  return Object.keys(problems).length > 0 ? problems : null;
}

async function toEncounterDto(encounter: EncounterLean, session?: ClientSession) {
  const addenda = await AddendumModel.find({
    organizationId: encounter.organizationId,
    encounterId: encounter._id,
  })
    .sort({ createdAt: 1, _id: 1 })
    .session(session ?? null)
    .lean<AddendumLean[]>();
  // Author names: the record's practitioner, and each addendum's own author (a covering doctor
  // writes addenda under their own name).
  const practitioners = await PractitionerModel.find({
    organizationId: encounter.organizationId,
    _id: { $in: [encounter.practitionerId, ...addenda.map((a) => a.practitionerId)] },
  })
    .select('displayName')
    .session(session ?? null)
    .lean();
  const nameOf = new Map(practitioners.map((p) => [String(p._id), p.displayName]));
  const practitioner = { displayName: nameOf.get(String(encounter.practitionerId)) };
  return {
    id: String(encounter._id),
    appointmentId: String(encounter.appointmentId),
    patientId: String(encounter.patientId),
    branchId: String(encounter.branchId),
    author: {
      practitionerId: String(encounter.practitionerId),
      displayName: practitioner?.displayName ?? '',
    },
    status: encounter.status,
    sections: Object.fromEntries(ENCOUNTER_SECTIONS.map((s) => [s, encounter.sections?.[s] ?? ''])),
    version: encounter.version,
    lateEntry: encounter.lateEntry ? { reason: encounter.lateEntry.reason } : null,
    createdAt: encounter.createdAt.toISOString(),
    lastEditedAt: encounter.lastEditedAt.toISOString(),
    finalizedAt: encounter.finalizedAt ? encounter.finalizedAt.toISOString() : null,
    // The template id and version the record was created with, and its (clinician-entered) data.
    specialty: encounter.specialty
      ? { template: encounter.specialty.template, version: encounter.specialty.version, data: encounter.specialty.data ?? {} }
      : null,
    addenda: addenda.map((a) => ({
      id: String(a._id),
      reason: a.reason,
      content: a.content,
      author: { practitionerId: String(a.practitionerId), displayName: nameOf.get(String(a.practitionerId)) ?? '' },
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

const sectionNames = (sections: Partial<Record<EncounterSection, string>> | undefined) =>
  ENCOUNTER_SECTIONS.filter((s) => (sections?.[s] ?? '') !== '');

/** Records a denial without any payload, then answers like a missing record. */
export async function deny(
  tenant: TenantContext,
  reason: string,
  refs: {
    appointmentId?: Types.ObjectId | null;
    encounterId?: Types.ObjectId | null;
    patientId?: Types.ObjectId | null;
  },
  status: 403 | 404 = 404,
): Promise<never> {
  await recordClinicalOnce(tenant, 'clinical.access_denied', refs, { reason });
  throw status === 403 ? forbidden() : notFound();
}

/** Permission gate that also records the denial (receptionists, viewers, owners, admins). */
export const requireClinicalPermission: RequestHandler = async (req, _res, next) => {
  const tenant = tenantOf(req);
  if (hasPermission(tenant.role, 'clinical.encounter.own')) {
    next();
    return;
  }
  const id = (value: unknown) => parseObjectId(value) ?? null;
  await deny(
    tenant,
    'no_clinical_permission',
    {
      appointmentId: id(req.params.appointmentId),
      encounterId: id(req.params.encounterId),
      patientId: id(req.params.patientId),
    },
    403,
  );
};

export const noStore = (res: Response) => res.set('Cache-Control', 'no-store');

/** Runs a clinical mutation: fresh, locked access check and all writes in one transaction. */
export function inClinicalTransaction<T>(
  tenant: TenantContext,
  work: (actor: ClinicalActor, session: ClientSession) => Promise<T>,
): Promise<T> {
  return runTransaction(async (session) => {
    const actor = await resolveClinicalActor(tenant, { session, lock: true });
    if (!actor) throw notFound();
    return work(actor, session);
  });
}

async function loadOwnEncounter(actor: ClinicalActor, encounterId: Types.ObjectId, session?: ClientSession) {
  const encounter = await EncounterModel.findOne({
    organizationId: actor.organizationId,
    _id: encounterId,
  })
    .session(session ?? null)
    .lean<EncounterLean>();
  return encounter && treats(actor, encounter) ? encounter : null;
}

export function createClinicalRouter() {
  const router = Router({ mergeParams: true });

  // The record of one appointment (or what may be started), for its treating doctor only.
  router.get('/appointments/:appointmentId/encounter', requireClinicalPermission, async (req, res) => {
    noStore(res);
    const tenant = tenantOf(req);
    const appointmentId = parseObjectId(req.params.appointmentId);
    if (!appointmentId) throw notFound();
    const actor = await resolveClinicalActor(tenant);
    const appointment = await AppointmentModel.findOne({
      organizationId: tenant.organizationId,
      _id: appointmentId,
    }).lean();
    if (!actor || !appointment || !treats(actor, appointment)) return deny(tenant, 'not_treating', { appointmentId });

    const encounter = await EncounterModel.findOne({
      organizationId: tenant.organizationId,
      appointmentId,
    }).lean<EncounterLean>();
    if (encounter && !treats(actor, encounter))
      return deny(tenant, 'not_author', {
        appointmentId,
        encounterId: encounter._id,
      });
    if (encounter)
      await recordClinicalOnce(tenant, 'encounter.viewed', {
        encounterId: encounter._id,
        appointmentId,
        patientId: encounter.patientId,
      });
    const canStart = !encounter && (appointment.status === 'in_progress' || appointment.status === 'completed');
    const practitioner = await PractitionerModel.findOne({ organizationId: tenant.organizationId, _id: appointment.practitionerId })
      .select('specialtyCode')
      .lean();
    res.json({
      encounter: encounter ? await toEncounterDto(encounter) : null,
      appointmentStatus: appointment.status,
      canStart,
      lateEntryRequired: canStart && appointment.status === 'completed',
      /** Specialty templates this record may use (the first is the default); [] = general record only. */
      templates: canStart ? templatesForSpecialty(practitioner?.specialtyCode ?? '') : [],
    });
  });

  // Start the record: only for the treating doctor's in-progress appointment, or — as a late
  // entry with a reason — for a completed one. Idempotent per Idempotency-Key.
  router.post('/appointments/:appointmentId/encounter', requireClinicalPermission, async (req, res) => {
    noStore(res);
    const tenant = tenantOf(req);
    const key = requireKey(req);
    const appointmentId = parseObjectId(req.params.appointmentId);
    if (!appointmentId) throw notFound();
    const input = parseInput(createSchema, req.body);
    const creationHash = hash([
      String(appointmentId),
      input.sections ?? {},
      input.lateEntryReason ?? null,
      ...(input.template !== undefined || input.specialtyData !== undefined ? [input.template ?? null, input.specialtyData ?? null] : []),
    ]);

    const replay = async () => {
      const existing = await EncounterModel.findOne({
        organizationId: tenant.organizationId,
        authorUserId: tenant.userId,
        creationKey: key,
      }).lean<EncounterLean>();
      if (!existing) return null;
      if (existing.creationHash !== creationHash || !existing.appointmentId.equals(appointmentId)) {
        throw conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different request');
      }
      const actor = await resolveClinicalActor(tenant);
      return actor && treats(actor, existing) ? existing : null;
    };
    const earlier = await replay();
    if (earlier) {
      res.json({ encounter: await toEncounterDto(earlier), replayed: true });
      return;
    }

    try {
      const created = await inClinicalTransaction(tenant, async (actor, session) => {
        const appointment = await AppointmentModel.findOne({
          organizationId: tenant.organizationId,
          _id: appointmentId,
        })
          .session(session)
          .lean();
        if (!appointment || !treats(actor, appointment)) throw notFound();
        let lateEntry: { reason: string } | null = null;
        if (appointment.status === 'completed') {
          if (!input.lateEntryReason) {
            throw new HttpError(400, 'LATE_ENTRY_REASON_REQUIRED', 'A reason is required to start a record after the visit was completed', {
              lateEntryReason: 'required',
            });
          }
          lateEntry = { reason: input.lateEntryReason };
        } else if (appointment.status !== 'in_progress') {
          throw conflict('ENCOUNTER_NOT_ALLOWED', 'A visit record can be started only for a visit in progress or completed');
        }
        // Specialty template: from the practitioner's specialty, at its newest version.
        const practitioner = await PractitionerModel.findOne({ organizationId: tenant.organizationId, _id: appointment.practitionerId })
          .select('specialtyCode')
          .session(session)
          .lean();
        const allowed = templatesForSpecialty(practitioner?.specialtyCode ?? '');
        if (input.template && !allowed.includes(input.template)) {
          throw new HttpError(400, 'TEMPLATE_NOT_ALLOWED', 'This template does not fit the practitioner’s specialty', {
            template: 'invalid_choice',
          });
        }
        const chosen = input.template ?? allowed[0] ?? null;
        let specialty: { template: string; version: number; data: Record<string, unknown> } | null = null;
        if (chosen) {
          const template = latestTemplate(chosen);
          const parsed = parseTemplateData(template, input.specialtyData ?? {});
          if (!parsed.ok) throw validationError(parsed.fields);
          specialty = { template: template.id, version: template.version, data: parsed.data };
        } else if (input.specialtyData !== undefined) {
          throw new HttpError(400, 'TEMPLATE_NOT_ALLOWED', 'This record has no specialty template', { specialtyData: 'invalid' });
        }
        const now = clock.now();
        const [encounter] = await EncounterModel.create(
          [
            {
              organizationId: tenant.organizationId,
              branchId: appointment.branchId,
              patientId: appointment.patientId,
              appointmentId,
              practitionerId: appointment.practitionerId,
              authorUserId: tenant.userId,
              status: 'draft',
              sections: { ...emptySections(), ...(input.sections ?? {}) },
              specialty,
              version: 0,
              lateEntry,
              creationKey: key,
              creationHash,
              lastEditedAt: now,
            },
          ],
          { session },
        );
        if (!encounter) throw new Error('Expected a created encounter');
        await recordClinical(
          tenant,
          'encounter.created',
          {
            encounterId: encounter._id,
            appointmentId,
            patientId: appointment.patientId,
          },
          {
            lateEntry: Boolean(lateEntry),
            appointmentStatus: appointment.status,
            sections: sectionNames(input.sections),
            template: specialty ? `${specialty.template}@${specialty.version}` : null,
          },
          session,
        );
        return encounter.toObject() as EncounterLean;
      });
      res.status(201).json({ encounter: await toEncounterDto(created), replayed: false });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      // A concurrent request with the same key won, or the appointment already has a record.
      const again = await replay();
      if (again) {
        res.json({ encounter: await toEncounterDto(again), replayed: true });
        return;
      }
      throw conflict('ENCOUNTER_EXISTS', 'This visit already has a record');
    }
  });

  // One record by id: its author, or a covering doctor (read-only unless the grant allows addenda).
  // Includes the minimal patient identity a covering doctor needs to know whose record it is.
  router.get('/encounters/:encounterId', requireClinicalPermission, async (req, res) => {
    noStore(res);
    const tenant = tenantOf(req);
    const encounterId = parseObjectId(req.params.encounterId);
    if (!encounterId) throw notFound();
    const actor = await resolveClinicalActor(tenant);
    if (!actor) return deny(tenant, 'not_treating', { encounterId });
    const encounter = await EncounterModel.findOne({ organizationId: tenant.organizationId, _id: encounterId }).lean<EncounterLean>();
    if (!encounter) return deny(tenant, 'not_found', { encounterId });
    const access = await recordAccess(actor, encounter);
    if (!access) {
      const reason = (await inactiveCoverageReason(actor, encounter)) ?? 'not_treating';
      return deny(tenant, reason, { encounterId, patientId: encounter.patientId });
    }
    await recordClinicalOnce(
      tenant,
      'encounter.viewed',
      { encounterId, appointmentId: encounter.appointmentId, patientId: encounter.patientId },
      access.coverageId ? { via: 'coverage', coverageId: String(access.coverageId) } : {},
    );
    const [patient, appointment] = await Promise.all([
      PatientModel.findOne({ organizationId: tenant.organizationId, _id: encounter.patientId }).select('fullName patientNumber').lean(),
      AppointmentModel.findOne({ organizationId: tenant.organizationId, _id: encounter.appointmentId }).select('startAt status').lean(),
    ]);
    res.json({
      encounter: await toEncounterDto(encounter),
      access: access.access,
      // Drafts of someone else are never editable; addenda need "author" access on a finalized record.
      canAddAddendum: encounter.status === 'finalized' && (access.access === 'own' || access.access === 'author'),
      context: {
        patient: patient ? { id: String(patient._id), fullName: patient.fullName, patientNumber: patient.patientNumber } : null,
        appointment: appointment
          ? { id: String(appointment._id), startAt: appointment.startAt.toISOString(), status: appointment.status }
          : null,
      },
    });
  });

  // Save the draft. Optimistic version: a stale tab gets VERSION_CONFLICT, never an overwrite;
  // a finalized record can never be changed by a draft save.
  router.put('/encounters/:encounterId', requireClinicalPermission, async (req, res) => {
    noStore(res);
    const tenant = tenantOf(req);
    const encounterId = parseObjectId(req.params.encounterId);
    if (!encounterId) throw notFound();
    const input = parseInput(saveSchema, req.body);
    const saved = await inClinicalTransaction(tenant, async (actor, session) => {
      const current = await loadOwnEncounter(actor, encounterId, session);
      if (!current) throw notFound();
      if (current.status !== 'draft') throw conflict('ENCOUNTER_FINALIZED', 'This record is finalized; add an addendum instead');
      const next = {
        ...emptySections(),
        ...current.sections,
        ...input.sections,
      };
      // Specialty data: validated with the record's own template version, references checked.
      let specialtyData: Record<string, unknown> | undefined;
      if (input.specialtyData !== undefined) {
        const template = current.specialty ? templateVersion(current.specialty.template, current.specialty.version) : null;
        if (!template)
          throw new HttpError(400, 'TEMPLATE_NOT_ALLOWED', 'This record has no specialty template', { specialtyData: 'invalid' });
        const parsed = parseTemplateData(template, input.specialtyData);
        if (!parsed.ok) throw validationError(parsed.fields);
        const refs = await referenceProblems(actor, current, template.id, parsed.data, session);
        if (Object.keys(refs).length > 0) throw validationError(refs);
        specialtyData = parsed.data;
      }
      const updated = await EncounterModel.findOneAndUpdate(
        {
          organizationId: tenant.organizationId,
          _id: encounterId,
          status: 'draft',
          version: input.version,
        },
        {
          $set: { sections: next, lastEditedAt: clock.now(), ...(specialtyData ? { 'specialty.data': specialtyData } : {}) },
          $inc: { version: 1 },
        },
        { session, returnDocument: 'after' },
      ).lean<EncounterLean>();
      if (!updated) {
        throw conflict('VERSION_CONFLICT', 'This record was changed in another tab or window', { currentVersion: current.version });
      }
      const changed = ENCOUNTER_SECTIONS.filter((s) => (current.sections?.[s] ?? '') !== next[s]);
      await recordClinical(
        tenant,
        'encounter.draft_saved',
        {
          encounterId,
          appointmentId: current.appointmentId,
          patientId: current.patientId,
        },
        {
          version: updated.version,
          sectionsChanged: changed,
          ...(specialtyData !== undefined
            ? { specialtyChanged: JSON.stringify(specialtyData) !== JSON.stringify(current.specialty?.data ?? null) }
            : {}),
        },
        session,
      );
      return updated;
    });
    res.json({ encounter: await toEncounterDto(saved) });
  });

  // Finalize exactly the version the doctor saw. Retrying with the same key returns the result.
  router.post('/encounters/:encounterId/finalize', requireClinicalPermission, async (req, res) => {
    noStore(res);
    const tenant = tenantOf(req);
    const key = requireKey(req);
    const encounterId = parseObjectId(req.params.encounterId);
    if (!encounterId) throw notFound();
    const input = parseInput(finalizeSchema, req.body);
    const result = await inClinicalTransaction(tenant, async (actor, session) => {
      const current = await loadOwnEncounter(actor, encounterId, session);
      if (!current) throw notFound();
      if (current.status === 'finalized') {
        if (current.finalizationKey === key) return { encounter: current, replayed: true };
        throw conflict('ENCOUNTER_FINALIZED', 'This record is already finalized');
      }
      if (current.version !== input.version) {
        throw conflict('VERSION_CONFLICT', 'This record was changed in another tab or window', { currentVersion: current.version });
      }
      const problems: Record<string, string> = {
        ...(finalizationProblems({ ...emptySections(), ...current.sections }) ?? {}),
      };
      // Specialty requirements (of the record's own template version) and cross-record references.
      const template = current.specialty ? templateVersion(current.specialty.template, current.specialty.version) : null;
      if (template && current.specialty) {
        const data = current.specialty.data ?? {};
        Object.assign(problems, template.finalizeProblems(data));
        const refs = await referenceProblems(actor, current, template.id, data, session);
        if (Object.keys(refs).length > 0) throw validationError(refs);
      }
      if (Object.keys(problems).length > 0)
        throw new HttpError(400, 'ENCOUNTER_INCOMPLETE', 'Some required parts of the record are empty', problems);
      const appointment = await AppointmentModel.findOne({
        organizationId: tenant.organizationId,
        _id: current.appointmentId,
      })
        .session(session)
        .lean();
      if (!appointment || (appointment.status !== 'in_progress' && appointment.status !== 'completed')) {
        throw conflict('ENCOUNTER_NOT_ALLOWED', 'The visit is not in progress or completed');
      }
      const now = clock.now();
      const finalized = await EncounterModel.findOneAndUpdate(
        {
          organizationId: tenant.organizationId,
          _id: encounterId,
          status: 'draft',
          version: input.version,
        },
        {
          $set: {
            status: 'finalized',
            finalizedAt: now,
            finalizedBy: tenant.userId,
            finalizationKey: key,
          },
          $inc: { version: 1 },
        },
        { session, returnDocument: 'after' },
      ).lean<EncounterLean>();
      if (!finalized)
        throw conflict('VERSION_CONFLICT', 'This record was changed in another tab or window', { currentVersion: current.version });
      await recordClinical(
        tenant,
        'encounter.finalized',
        {
          encounterId,
          appointmentId: current.appointmentId,
          patientId: current.patientId,
        },
        {
          version: finalized.version,
          appointmentStatus: appointment.status,
        },
        session,
      );
      return { encounter: finalized, replayed: false };
    });
    res.status(result.replayed ? 200 : 201).json({
      encounter: await toEncounterDto(result.encounter),
      replayed: result.replayed,
    });
  });

  // Corrections: append-only addenda on a finalized record. The original stays as it was.
  router.post('/encounters/:encounterId/addenda', requireClinicalPermission, async (req, res) => {
    noStore(res);
    const tenant = tenantOf(req);
    const key = requireKey(req);
    const encounterId = parseObjectId(req.params.encounterId);
    if (!encounterId) throw notFound();
    const input = parseInput(addendumSchema, req.body);
    const requestHash = hash([String(encounterId), input.reason, input.content]);
    try {
      const result = await inClinicalTransaction(tenant, async (actor, session) => {
        const encounter = await EncounterModel.findOne({ organizationId: tenant.organizationId, _id: encounterId })
          .session(session)
          .lean<EncounterLean>();
        if (!encounter) throw notFound();
        // The author, or a covering doctor with an active "author" grant (locked against revocation).
        const coverage = treats(actor, encounter) ? null : await activeCoverage(actor, encounter, 'author', { session, lock: true });
        if (!treats(actor, encounter) && !coverage) throw notFound();
        const existing = await AddendumModel.findOne({
          organizationId: tenant.organizationId,
          authorUserId: tenant.userId,
          idempotencyKey: key,
        })
          .session(session)
          .lean();
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different request');
          return { encounter, replayed: true };
        }
        if (encounter.status !== 'finalized')
          throw conflict('ENCOUNTER_NOT_FINALIZED', 'Edit the draft directly; addenda are for finalized records');
        const [addendum] = await AddendumModel.create(
          [
            {
              organizationId: tenant.organizationId,
              encounterId,
              authorUserId: tenant.userId,
              practitionerId: actor.practitionerId,
              reason: input.reason,
              content: input.content,
              idempotencyKey: key,
              requestHash,
            },
          ],
          { session },
        );
        if (!addendum) throw new Error('Expected a created addendum');
        await recordClinical(
          tenant,
          'encounter.addendum_added',
          {
            encounterId,
            appointmentId: encounter.appointmentId,
            patientId: encounter.patientId,
          },
          coverage
            ? { addendumId: String(addendum._id), via: 'coverage', coverageId: String(coverage._id) }
            : { addendumId: String(addendum._id) },
          session,
        );
        return { encounter, replayed: false };
      });
      res.status(result.replayed ? 200 : 201).json({
        encounter: await toEncounterDto(result.encounter),
        replayed: result.replayed,
      });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      // A concurrent request with the same key committed first.
      const existing = await AddendumModel.findOne({
        organizationId: tenant.organizationId,
        authorUserId: tenant.userId,
        idempotencyKey: key,
      }).lean();
      if (!existing || existing.requestHash !== requestHash)
        throw conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different request');
      const encounter = await EncounterModel.findOne({
        organizationId: tenant.organizationId,
        _id: encounterId,
      }).lean<EncounterLean>();
      if (!encounter) throw notFound();
      res.json({
        encounter: await toEncounterDto(encounter),
        replayed: true,
      });
    }
  });

  // The caller's records for one patient: their own, plus records covered by an active grant
  // (other doctors' records otherwise never appear), within the current branch scope.
  router.get('/patients/:patientId/clinical-history', requireClinicalPermission, async (req, res) => {
    noStore(res);
    const tenant = tenantOf(req);
    const patientId = parseObjectId(req.params.patientId);
    if (!patientId) throw notFound();
    const actor = await resolveClinicalActor(tenant);
    if (!actor) return deny(tenant, 'not_treating', { patientId });
    const encounters = await visibleEncountersForPatient(actor, patientId, {}, { limit: 100 });
    const appointments = await AppointmentModel.find({
      organizationId: tenant.organizationId,
      _id: { $in: encounters.map((e) => e.appointmentId) },
    })
      .select('startAt')
      .lean();
    const startAt = new Map(appointments.map((a) => [String(a._id), a.startAt.toISOString()]));
    const counts = await AddendumModel.aggregate<{
      _id: Types.ObjectId;
      n: number;
    }>([
      {
        $match: {
          organizationId: tenant.organizationId,
          encounterId: { $in: encounters.map((e) => e._id) },
        },
      },
      { $group: { _id: '$encounterId', n: { $sum: 1 } } },
    ]);
    const addenda = new Map(counts.map((c) => [String(c._id), c.n]));
    if (encounters.length > 0) await recordClinicalOnce(tenant, 'clinical_history.viewed', { patientId }, { records: encounters.length });
    res.json({
      data: encounters.map((e) => ({
        id: String(e._id),
        appointmentId: String(e.appointmentId),
        appointmentStartAt: startAt.get(String(e.appointmentId)) ?? null,
        status: e.status,
        reason: (e.sections?.reason ?? '').slice(0, 160),
        lateEntry: Boolean(e.lateEntry),
        finalizedAt: e.finalizedAt ? e.finalizedAt.toISOString() : null,
        addendaCount: addenda.get(String(e._id)) ?? 0,
        covered: !treats(actor, e),
      })),
    });
  });

  return router;
}
