import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import type { AppConfig } from '../../config/app-config.js';
import { HttpError, conflict, forbidden, isDuplicateKeyError, notFound } from '../../http/errors.js';
import { objectIdSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { parseObjectId, requirePermission, tenantOf, type TenantContext } from '../../tenancy/tenant-context.js';
import { clock } from '../../time/clock.js';
import { UserModel } from '../../users/user.model.js';
import { AppointmentModel } from '../appointments/appointment.model.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { PatientModel } from '../patients/patient.model.js';
import { PractitionerModel } from '../practitioners/practitioner.model.js';
import { resolveClinicalActor, treats, type ClinicalActor } from './clinical-access.js';
import { recordClinical, recordClinicalOnce } from './clinical-audit.js';
import { AddendumModel, CLINICAL_AUDIT_ACTIONS, ClinicalAuditModel, EncounterModel, type Encounter } from './clinical.model.js';
import { clinicalText, deny, hash, inClinicalTransaction, noStore, requireClinicalPermission, requireKey } from './clinical.routes.js';
import { COVERAGE_ACCESS, CoverageModel, MAX_COVERAGE_DAYS, type Coverage } from './coverage.model.js';

// Clinical coverage and the clinical audit view (docs/architecture/CLINICAL.md#clinical-coverage).
//
// - A treating doctor shares their OWN records (one encounter, or all of theirs for one patient)
//   with a colleague, read-only or with addenda, for a bounded time and a reason.
// - A clinical lead may do the same for an unavailable doctor's records — only when the platform
//   enables it (config.clinicalLeadGrantsEnabled, blocker B1) AND the membership holds the
//   `clinical_lead` capability. Nobody can grant coverage to themselves.
// - Owners and admins gain nothing from any of this.

type CoverageLean = Coverage & { _id: Types.ObjectId };
type EncounterLean = Encounter & { _id: Types.ObjectId };

const DAY_MS = 86_400_000;

const grantSchema = z.object({
  granteePractitionerId: objectIdSchema,
  /** Only for a clinical lead: whose records are covered. Defaults to the caller's own. */
  sourcePractitionerId: objectIdSchema.optional(),
  scope: z.discriminatedUnion('type', [
    z.object({ type: z.literal('patient'), patientId: objectIdSchema }),
    z.object({ type: z.literal('encounter'), encounterId: objectIdSchema }),
  ]),
  access: z.enum(COVERAGE_ACCESS),
  startsAt: z.iso.datetime().optional(),
  expiresAt: z.iso.datetime(),
  reason: clinicalText(300).pipe(z.string().min(5)),
});
const revokeSchema = z.object({ reason: clinicalText(300).pipe(z.string().min(3)) });
const auditQuerySchema = z.object({
  action: z.enum(CLINICAL_AUDIT_ACTIONS).optional(),
  /** Cursor from the previous page: `<createdAt ISO>|<event id>`. */
  before: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|[a-f\d]{24}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function statusOf(c: CoverageLean, now: Date): 'active' | 'scheduled' | 'expired' | 'revoked' {
  if (c.revokedAt) return 'revoked';
  if (c.expiresAt <= now) return 'expired';
  if (c.startsAt > now) return 'scheduled';
  return 'active';
}

async function toCoverageDtos(tenant: TenantContext, items: CoverageLean[]) {
  const practitionerIds = items.flatMap((c) => [c.sourcePractitionerId, c.granteePractitionerId]);
  const [practitioners, patients] = await Promise.all([
    PractitionerModel.find({ organizationId: tenant.organizationId, _id: { $in: practitionerIds } })
      .select('displayName')
      .lean(),
    PatientModel.find({ organizationId: tenant.organizationId, _id: { $in: items.map((c) => c.scope.patientId) } })
      .select('fullName patientNumber')
      .lean(),
  ]);
  const nameOf = new Map(practitioners.map((p) => [String(p._id), p.displayName]));
  const patientOf = new Map(patients.map((p) => [String(p._id), p]));
  const now = clock.now();
  return items.map((c) => {
    const patient = patientOf.get(String(c.scope.patientId));
    return {
      id: String(c._id),
      source: { practitionerId: String(c.sourcePractitionerId), displayName: nameOf.get(String(c.sourcePractitionerId)) ?? '' },
      grantee: { practitionerId: String(c.granteePractitionerId), displayName: nameOf.get(String(c.granteePractitionerId)) ?? '' },
      scope: {
        type: c.scope.type,
        encounterId: c.scope.encounterId ? String(c.scope.encounterId) : null,
        patient: patient ? { id: String(patient._id), fullName: patient.fullName, patientNumber: patient.patientNumber } : null,
      },
      access: c.access,
      reason: c.reason,
      grantedVia: c.grantedVia,
      grantedByMe: c.grantedBy.equals(tenant.userId),
      status: statusOf(c, now),
      startsAt: c.startsAt.toISOString(),
      expiresAt: c.expiresAt.toISOString(),
      revokedAt: c.revokedAt ? c.revokedAt.toISOString() : null,
      revokeReason: c.revokeReason,
      createdAt: c.createdAt.toISOString(),
    };
  });
}

/** Whether this actor may act as a clinical lead right now (platform switch + fresh capability). */
const isLead = (config: AppConfig, actor: ClinicalActor) =>
  config.clinicalLeadGrantsEnabled && actor.capabilities.includes('clinical_lead');

export function createCoverageRouter(config: AppConfig) {
  const router = Router({ mergeParams: true });

  // Colleagues who could cover: active doctors with an active profile (names and specialty only).
  router.get('/clinical/coverage/candidates', requireClinicalPermission, async (req, res) => {
    noStore(res);
    const tenant = tenantOf(req);
    const actor = await resolveClinicalActor(tenant);
    if (!actor) throw notFound();
    const doctors = await MembershipModel.find({ organizationId: tenant.organizationId, role: 'doctor', status: 'active' })
      .select('_id')
      .lean();
    const practitioners = await PractitionerModel.find({
      organizationId: tenant.organizationId,
      status: 'active',
      membershipId: { $in: doctors.map((m) => m._id) },
      _id: { $ne: actor.practitionerId },
    })
      .select('displayName specialtyCode')
      .sort({ displayName: 1 })
      .limit(200)
      .lean();
    res.json({ data: practitioners.map((p) => ({ id: String(p._id), displayName: p.displayName, specialtyCode: p.specialtyCode })) });
  });

  // Grants I gave (or that cover my records), and grants I received.
  router.get('/clinical/coverage', requireClinicalPermission, async (req, res) => {
    noStore(res);
    const tenant = tenantOf(req);
    const actor = await resolveClinicalActor(tenant);
    if (!actor) throw notFound();
    const [granted, received] = await Promise.all([
      CoverageModel.find({
        organizationId: tenant.organizationId,
        $or: [{ grantedBy: actor.userId }, { sourcePractitionerId: actor.practitionerId }],
      })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean<CoverageLean[]>(),
      CoverageModel.find({
        organizationId: tenant.organizationId,
        granteePractitionerId: actor.practitionerId,
        granteeUserId: actor.userId,
      })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean<CoverageLean[]>(),
    ]);
    res.json({
      granted: await toCoverageDtos(tenant, granted),
      received: await toCoverageDtos(tenant, received),
      canGrantAsLead: isLead(config, actor),
    });
  });

  router.post('/clinical/coverage', requirePermission('clinical.coverage.grant'), async (req, res) => {
    noStore(res);
    const tenant = tenantOf(req);
    const key = requireKey(req);
    const input = parseInput(grantSchema, req.body);
    const requestHash = hash(input);
    try {
      const result = await inClinicalTransaction(tenant, async (actor, session) => {
        const previous = await CoverageModel.findOne({
          organizationId: tenant.organizationId,
          grantedBy: actor.userId,
          idempotencyKey: key,
        })
          .session(session)
          .lean<CoverageLean>();
        if (previous) {
          if (previous.requestHash !== requestHash)
            throw conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different request');
          return { coverage: previous, replayed: true };
        }

        const sourceId = input.sourcePractitionerId ? parseObjectId(input.sourcePractitionerId) : actor.practitionerId;
        if (!sourceId) throw notFound();
        const asLead = !sourceId.equals(actor.practitionerId);
        if (asLead && !isLead(config, actor))
          throw forbidden('COVERAGE_LEAD_NOT_ENABLED', 'Granting coverage for another doctor is not enabled');

        // What is covered — only records of the source practitioner, visible to the grantor.
        let patientId: Types.ObjectId;
        let encounterId: Types.ObjectId | null = null;
        if (input.scope.type === 'encounter') {
          const encounter = await EncounterModel.findOne({ organizationId: tenant.organizationId, _id: input.scope.encounterId })
            .session(session)
            .lean<EncounterLean>();
          const visible =
            encounter &&
            encounter.practitionerId.equals(sourceId) &&
            (asLead ? actor.canAccessBranch(encounter.branchId) : treats(actor, encounter));
          if (!encounter || !visible) throw notFound();
          patientId = encounter.patientId;
          encounterId = encounter._id;
        } else {
          const id = parseObjectId(input.scope.patientId);
          const records = id
            ? await EncounterModel.find({
                organizationId: tenant.organizationId,
                patientId: id,
                practitionerId: sourceId,
                ...(asLead ? {} : { authorUserId: actor.userId }),
              })
                .select('branchId')
                .session(session)
                .lean()
            : [];
          if (!id || !records.some((r) => actor.canAccessBranch(r.branchId))) throw notFound();
          patientId = id;
        }

        // Who covers: another active doctor of this organization — never the caller or the source.
        const grantee = await PractitionerModel.findOne({
          organizationId: tenant.organizationId,
          _id: input.granteePractitionerId,
          status: 'active',
        })
          .session(session)
          .lean();
        const granteeMembership = grantee
          ? await MembershipModel.findOne({
              organizationId: tenant.organizationId,
              _id: grantee.membershipId,
              role: 'doctor',
              status: 'active',
            })
              .session(session)
              .lean()
          : null;
        if (!grantee || !granteeMembership || grantee._id.equals(sourceId) || grantee._id.equals(actor.practitionerId)) {
          throw new HttpError(400, 'COVERAGE_GRANTEE_INVALID', 'Choose another active doctor of this organization', {
            granteePractitionerId: 'invalid_choice',
          });
        }

        const now = clock.now();
        const startsAt = input.startsAt ? new Date(input.startsAt) : now;
        const expiresAt = new Date(input.expiresAt);
        if (startsAt.getTime() < now.getTime() - 60_000)
          throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid input', { startsAt: 'out_of_range' });
        if (expiresAt <= startsAt || expiresAt.getTime() - startsAt.getTime() > MAX_COVERAGE_DAYS * DAY_MS) {
          throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid input', { expiresAt: 'out_of_range' });
        }

        const [coverage] = await CoverageModel.create(
          [
            {
              organizationId: tenant.organizationId,
              sourcePractitionerId: sourceId,
              granteePractitionerId: grantee._id,
              granteeUserId: granteeMembership.userId,
              scope: { type: input.scope.type, patientId, encounterId },
              access: input.access,
              reason: input.reason,
              startsAt,
              expiresAt,
              grantedBy: actor.userId,
              grantedVia: asLead ? 'clinical_lead' : 'author',
              idempotencyKey: key,
              requestHash,
            },
          ],
          { session },
        );
        if (!coverage) throw new Error('Expected a created coverage grant');
        await recordClinical(
          tenant,
          'coverage.granted',
          { encounterId, patientId },
          {
            coverageId: String(coverage._id),
            scope: input.scope.type,
            access: input.access,
            via: asLead ? 'clinical_lead' : 'author',
            granteePractitionerId: String(grantee._id),
            sourcePractitionerId: String(sourceId),
            expiresAt: expiresAt.toISOString(),
          },
          session,
        );
        return { coverage: coverage.toObject() as CoverageLean, replayed: false };
      });
      const [dto] = await toCoverageDtos(tenant, [result.coverage]);
      res.status(result.replayed ? 200 : 201).json({ coverage: dto, replayed: result.replayed });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const existing = await CoverageModel.findOne({
        organizationId: tenant.organizationId,
        grantedBy: tenant.userId,
        idempotencyKey: key,
      }).lean<CoverageLean>();
      if (!existing || existing.requestHash !== requestHash)
        throw conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different request');
      const [dto] = await toCoverageDtos(tenant, [existing]);
      res.json({ coverage: dto, replayed: true });
    }
  });

  // Revoke: the grantor, the doctor whose records are covered, or (when enabled) a clinical lead.
  router.post('/clinical/coverage/:coverageId/revoke', requireClinicalPermission, async (req, res) => {
    noStore(res);
    const tenant = tenantOf(req);
    const coverageId = parseObjectId(req.params.coverageId);
    if (!coverageId) throw notFound();
    const input = parseInput(revokeSchema, req.body);
    const revoked = await inClinicalTransaction(tenant, async (actor, session) => {
      const coverage = await CoverageModel.findOne({ organizationId: tenant.organizationId, _id: coverageId })
        .session(session)
        .lean<CoverageLean>();
      const allowed =
        coverage &&
        (coverage.grantedBy.equals(actor.userId) || coverage.sourcePractitionerId.equals(actor.practitionerId) || isLead(config, actor));
      if (!coverage || !allowed) throw notFound();
      if (coverage.revokedAt) throw conflict('COVERAGE_REVOKED', 'This coverage was already revoked');
      const updated = await CoverageModel.findOneAndUpdate(
        { organizationId: tenant.organizationId, _id: coverageId, revokedAt: null },
        { $set: { revokedAt: clock.now(), revokedBy: actor.userId, revokeReason: input.reason }, $inc: { useSeq: 1 } },
        { session, returnDocument: 'after' },
      ).lean<CoverageLean>();
      if (!updated) throw conflict('COVERAGE_REVOKED', 'This coverage was already revoked');
      await recordClinical(
        tenant,
        'coverage.revoked',
        { encounterId: coverage.scope.encounterId, patientId: coverage.scope.patientId },
        { coverageId: String(coverageId), wasActive: statusOf(coverage, clock.now()) === 'active' },
        session,
      );
      return updated;
    });
    const [dto] = await toCoverageDtos(tenant, [revoked]);
    res.json({ coverage: dto });
  });

  // The records a received, active grant opens (with the minimal patient identity).
  router.get('/clinical/coverage/:coverageId/records', requireClinicalPermission, async (req, res) => {
    noStore(res);
    const tenant = tenantOf(req);
    const coverageId = parseObjectId(req.params.coverageId);
    if (!coverageId) throw notFound();
    const actor = await resolveClinicalActor(tenant);
    if (!actor) return deny(tenant, 'not_treating', {});
    const coverage = await CoverageModel.findOne({
      organizationId: tenant.organizationId,
      _id: coverageId,
      granteePractitionerId: actor.practitionerId,
      granteeUserId: actor.userId,
    }).lean<CoverageLean>();
    if (!coverage) return deny(tenant, 'not_found', {});
    const now = clock.now();
    const status = statusOf(coverage, now);
    if (status !== 'active') {
      const reason = { revoked: 'coverage_revoked', expired: 'coverage_expired', scheduled: 'coverage_not_started' }[status];
      return deny(tenant, reason, { patientId: coverage.scope.patientId });
    }
    const filter =
      coverage.scope.type === 'encounter'
        ? { organizationId: tenant.organizationId, _id: coverage.scope.encounterId, practitionerId: coverage.sourcePractitionerId }
        : { organizationId: tenant.organizationId, patientId: coverage.scope.patientId, practitionerId: coverage.sourcePractitionerId };
    const encounters = (await EncounterModel.find(filter).sort({ createdAt: -1 }).limit(100).lean<EncounterLean[]>()).filter((e) =>
      actor.canAccessBranch(e.branchId),
    );
    const [appointments, counts, patient] = await Promise.all([
      AppointmentModel.find({ organizationId: tenant.organizationId, _id: { $in: encounters.map((e) => e.appointmentId) } })
        .select('startAt')
        .lean(),
      AddendumModel.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { organizationId: tenant.organizationId, encounterId: { $in: encounters.map((e) => e._id) } } },
        { $group: { _id: '$encounterId', n: { $sum: 1 } } },
      ]),
      PatientModel.findOne({ organizationId: tenant.organizationId, _id: coverage.scope.patientId })
        .select('fullName patientNumber')
        .lean(),
    ]);
    const startAt = new Map(appointments.map((a) => [String(a._id), a.startAt.toISOString()]));
    const addenda = new Map(counts.map((c) => [String(c._id), c.n]));
    await recordClinicalOnce(
      tenant,
      'clinical_history.viewed',
      { patientId: coverage.scope.patientId },
      { via: 'coverage', coverageId: String(coverageId), records: encounters.length },
    );
    const [dto] = await toCoverageDtos(tenant, [coverage]);
    res.json({
      coverage: dto,
      patient: patient ? { id: String(patient._id), fullName: patient.fullName, patientNumber: patient.patientNumber } : null,
      data: encounters.map((e) => ({
        id: String(e._id),
        appointmentStartAt: startAt.get(String(e.appointmentId)) ?? null,
        status: e.status,
        reason: (e.sections?.reason ?? '').slice(0, 160),
        lateEntry: Boolean(e.lateEntry),
        finalizedAt: e.finalizedAt ? e.finalizedAt.toISOString() : null,
        addendaCount: addenda.get(String(e._id)) ?? 0,
      })),
    });
  });

  // Clinical audit log — metadata only, for members holding the `clinical_audit` capability.
  router.get('/clinical/audit', requirePermission('clinical.audit.read'), async (req, res) => {
    noStore(res);
    const tenant = tenantOf(req);
    const query = parseInput(auditQuerySchema, req.query);
    const [beforeAt, beforeId] = query.before ? query.before.split('|') : [];
    const cursor =
      beforeAt && beforeId
        ? {
            $or: [
              { createdAt: { $lt: new Date(beforeAt) } },
              { createdAt: new Date(beforeAt), _id: { $lt: new Types.ObjectId(beforeId) } },
            ],
          }
        : {};
    const events = await ClinicalAuditModel.find({
      organizationId: tenant.organizationId,
      ...(query.action ? { action: query.action } : {}),
      ...cursor,
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean();
    const page = events.slice(0, query.limit);
    const [users, patients] = await Promise.all([
      UserModel.find({ _id: { $in: page.map((e) => e.actorUserId) } })
        .select('displayName')
        .lean(),
      PatientModel.find({ organizationId: tenant.organizationId, _id: { $in: page.flatMap((e) => (e.patientId ? [e.patientId] : [])) } })
        .select('patientNumber')
        .lean(),
    ]);
    const userName = new Map(users.map((u) => [String(u._id), u.displayName]));
    const patientNumber = new Map(patients.map((p) => [String(p._id), p.patientNumber]));
    await recordClinicalOnce(tenant, 'clinical_audit.viewed', {}, { filter: query.action ?? null });
    res.json({
      data: page.map((e) => ({
        id: String(e._id),
        action: e.action,
        actor: { displayName: userName.get(String(e.actorUserId)) ?? '', role: e.actorRole },
        createdAt: e.createdAt.toISOString(),
        encounterId: e.encounterId ? String(e.encounterId) : null,
        appointmentId: e.appointmentId ? String(e.appointmentId) : null,
        patientNumber: e.patientId ? (patientNumber.get(String(e.patientId)) ?? null) : null,
        // Mongoose drops empty objects on save, so events without metadata have none stored.
        metadata: e.metadata ?? {},
      })),
      next: events.length > query.limit && page.length > 0 ? `${page.at(-1)!.createdAt.toISOString()}|${String(page.at(-1)!._id)}` : null,
    });
  });

  return router;
}
