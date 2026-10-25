import { Router } from 'express';
import type { Types } from 'mongoose';
import { notFound } from '../../http/errors.js';
import { hasPermission } from '../../tenancy/permissions.js';
import { parseObjectId, requirePermission, tenantOf } from '../../tenancy/tenant-context.js';
import { accessibleBranchesFilter } from '../../tenancy/scope.js';
import { clock } from '../../time/clock.js';
import { AppointmentModel } from '../appointments/appointment.model.js';
import { BranchModel } from '../branches/branch.model.js';
import { PractitionerModel } from '../practitioners/practitioner.model.js';
import { resolveClinicalActor, treats, visibleEncountersForPatient } from './clinical-access.js';
import { recordClinicalOnce } from './clinical-audit.js';
import { EncounterModel, type Encounter } from './clinical.model.js';
import { deny, noStore, requireClinicalPermission } from './clinical.routes.js';
import { TEMPLATE_IDS } from './templates.js';

// Specialty views derived from finalized records (docs/architecture/SPECIALTY_WORKSPACES.md).
// Nothing here is stored separately: the chart, the plan and the courses are computed from the
// immutable records, so history can never be overwritten. Same access as the records themselves.

type EncounterLean = Encounter & { _id: Types.ObjectId };
type DentalData = {
  findings?: { id: string; tooth: string; surfaces: string[]; note: string }[];
  procedures?: { id: string; tooth: string | null; description: string }[];
  planItems?: { id: string; tooth: string | null; description: string }[];
  planUpdates?: { itemId: string; sourceEncounterId: string; status: string; note: string }[];
};
type PhysioData = {
  goals?: { id: string; text: string }[];
  plannedSessions?: number | null;
  frequency?: string;
  courseEncounterId?: string | null;
};

const byFinalized = (a: EncounterLean, b: EncounterLean) => (a.finalizedAt?.getTime() ?? 0) - (b.finalizedAt?.getTime() ?? 0);

async function visitDates(organizationId: Types.ObjectId, encounters: EncounterLean[]) {
  const appointments = await AppointmentModel.find({ organizationId, _id: { $in: encounters.map((e) => e.appointmentId) } })
    .select('startAt')
    .lean();
  const startAt = new Map(appointments.map((a) => [String(a._id), a.startAt.toISOString()]));
  return (e: EncounterLean) => startAt.get(String(e.appointmentId)) ?? e.createdAt.toISOString();
}

export function createSpecialtyRouter() {
  const router = Router({ mergeParams: true });

  // Per-tooth history and the treatment plan, from finalized dental visits only.
  router.get('/patients/:patientId/dental-chart', requireClinicalPermission, async (req, res) => {
    noStore(res);
    const tenant = tenantOf(req);
    const patientId = parseObjectId(req.params.patientId);
    if (!patientId) throw notFound();
    const actor = await resolveClinicalActor(tenant);
    if (!actor) return deny(tenant, 'not_treating', { patientId });
    const all = await visibleEncountersForPatient(actor, patientId, { 'specialty.template': 'dentistry.visit' });
    const finalized = all.filter((e) => e.status === 'finalized').sort(byFinalized);
    const dateOf = await visitDates(tenant.organizationId, finalized);

    const teeth = new Map<
      string,
      { kind: 'finding' | 'procedure'; encounterId: string; date: string; surfaces: string[]; text: string }[]
    >();
    const plan = new Map<
      string,
      {
        id: string;
        sourceEncounterId: string;
        tooth: string | null;
        description: string;
        recordedAt: string;
        status: string;
        history: { status: string; note: string; encounterId: string; at: string }[];
      }
    >();
    for (const e of finalized) {
      const data = (e.specialty?.data ?? {}) as DentalData;
      const at = dateOf(e);
      for (const f of data.findings ?? []) {
        const list = teeth.get(f.tooth) ?? [];
        list.push({ kind: 'finding', encounterId: String(e._id), date: at, surfaces: f.surfaces, text: f.note });
        teeth.set(f.tooth, list);
      }
      for (const p of data.procedures ?? []) {
        if (!p.tooth) continue;
        const list = teeth.get(p.tooth) ?? [];
        list.push({ kind: 'procedure', encounterId: String(e._id), date: at, surfaces: [], text: p.description });
        teeth.set(p.tooth, list);
      }
      for (const item of data.planItems ?? []) {
        plan.set(`${String(e._id)}:${item.id}`, {
          id: item.id,
          sourceEncounterId: String(e._id),
          tooth: item.tooth,
          description: item.description,
          recordedAt: at,
          status: 'planned',
          history: [],
        });
      }
      // Updates apply in finalization order; an item from a record this actor cannot read is skipped.
      for (const u of data.planUpdates ?? []) {
        const item = plan.get(`${u.sourceEncounterId}:${u.itemId}`);
        if (!item) continue;
        item.status = u.status;
        item.history.push({ status: u.status, note: u.note, encounterId: String(e._id), at });
      }
    }
    if (finalized.length > 0)
      await recordClinicalOnce(tenant, 'clinical_history.viewed', { patientId }, { view: 'dental_chart', records: finalized.length });
    res.json({
      teeth: [...teeth.entries()].map(([tooth, entries]) => ({ tooth, entries })).sort((a, b) => a.tooth.localeCompare(b.tooth)),
      planItems: [...plan.values()],
      records: finalized.map((e) => ({ id: String(e._id), date: dateOf(e), own: treats(actor, e) })),
      drafts: all.filter((e) => e.status === 'draft' && treats(actor, e)).length,
    });
  });

  // Treatment courses: a finalized initial assessment, its finalized sessions and discharge.
  router.get('/patients/:patientId/physio-courses', requireClinicalPermission, async (req, res) => {
    noStore(res);
    const tenant = tenantOf(req);
    const patientId = parseObjectId(req.params.patientId);
    if (!patientId) throw notFound();
    const actor = await resolveClinicalActor(tenant);
    if (!actor) return deny(tenant, 'not_treating', { patientId });
    const all = await visibleEncountersForPatient(actor, patientId, {
      'specialty.template': { $in: ['physiotherapy.assessment', 'physiotherapy.session', 'physiotherapy.discharge'] },
    });
    const finalized = all.filter((e) => e.status === 'finalized').sort(byFinalized);
    const dateOf = await visitDates(tenant.organizationId, all);
    const practitioners = await PractitionerModel.find({
      organizationId: tenant.organizationId,
      _id: { $in: all.map((e) => e.practitionerId) },
    })
      .select('displayName')
      .lean();
    const nameOf = new Map(practitioners.map((p) => [String(p._id), p.displayName]));
    const now = clock.now();
    const courses = [];
    for (const a of finalized.filter((e) => e.specialty?.template === 'physiotherapy.assessment')) {
      const data = (a.specialty?.data ?? {}) as PhysioData;
      const refersTo = (e: EncounterLean) => ((e.specialty?.data ?? {}) as PhysioData).courseEncounterId === String(a._id);
      const sessions = finalized.filter((e) => e.specialty?.template === 'physiotherapy.session' && refersTo(e));
      const discharge = finalized.find((e) => e.specialty?.template === 'physiotherapy.discharge' && refersTo(e));
      // Upcoming visits are appointments (the only schedule), counted for the doctor's own courses.
      const upcoming = treats(actor, a)
        ? await AppointmentModel.countDocuments({
            organizationId: tenant.organizationId,
            patientId,
            practitionerId: a.practitionerId,
            status: { $in: ['scheduled', 'checked_in'] },
            startAt: { $gte: now },
          })
        : null;
      courses.push({
        assessmentId: String(a._id),
        practitioner: nameOf.get(String(a.practitionerId)) ?? '',
        own: treats(actor, a),
        startedAt: dateOf(a),
        plannedSessions: data.plannedSessions ?? null,
        frequency: data.frequency ?? '',
        goals: data.goals ?? [],
        sessions: sessions.map((s) => ({ id: String(s._id), date: dateOf(s) })),
        completedSessions: sessions.length,
        discharge: discharge ? { id: String(discharge._id), date: dateOf(discharge) } : null,
        upcomingAppointments: upcoming,
      });
    }
    if (finalized.length > 0)
      await recordClinicalOnce(tenant, 'clinical_history.viewed', { patientId }, { view: 'physio_courses', records: finalized.length });
    res.json({ courses: courses.reverse(), drafts: all.filter((e) => e.status === 'draft' && treats(actor, e)).length });
  });

  // Counts only (no clinical text): own documentation for doctors; organization-wide for owners and
  // admins, within their branch scope. Last 30 days.
  router.get('/clinical/specialty-summary', requirePermission('clinical.documentation_status.read'), async (req, res) => {
    noStore(res);
    const tenant = tenantOf(req);
    const since = new Date(clock.now().getTime() - 30 * 86_400_000);
    const actor = hasPermission(tenant.role, 'clinical.encounter.own') ? await resolveClinicalActor(tenant) : null;
    if (hasPermission(tenant.role, 'clinical.encounter.own') && !actor) throw notFound();
    const branches = actor ? null : await BranchModel.find(accessibleBranchesFilter(tenant)).select('_id').lean();
    const scope = actor
      ? { practitionerId: actor.practitionerId, authorUserId: actor.userId }
      : { branchId: { $in: (branches ?? []).map((b) => b._id) } };
    const grouped = await EncounterModel.aggregate<{ _id: { template: string | null; status: string }; n: number }>([
      { $match: { organizationId: tenant.organizationId, createdAt: { $gte: since }, ...scope } },
      { $group: { _id: { template: { $ifNull: ['$specialty.template', null] }, status: '$status' }, n: { $sum: 1 } } },
    ]);
    const byTemplate = [null, ...TEMPLATE_IDS].map((template) => ({
      template,
      finalized: grouped.find((g) => g._id.template === template && g._id.status === 'finalized')?.n ?? 0,
      draft: grouped.find((g) => g._id.template === template && g._id.status === 'draft')?.n ?? 0,
    }));
    let own: { openPlanItems: number; activeCourses: number } | undefined;
    if (actor) {
      // The doctor's own open plan items and courses (all time, own records only).
      const records = await EncounterModel.find({
        organizationId: tenant.organizationId,
        practitionerId: actor.practitionerId,
        authorUserId: actor.userId,
        status: 'finalized',
        'specialty.template': { $in: ['dentistry.visit', 'physiotherapy.assessment', 'physiotherapy.discharge'] },
      })
        .select('specialty')
        .limit(2000)
        .lean<EncounterLean[]>();
      const items = new Map<string, string>();
      const courses = new Set<string>();
      for (const r of records) {
        const data = (r.specialty?.data ?? {}) as DentalData & PhysioData;
        if (r.specialty?.template === 'dentistry.visit')
          for (const i of data.planItems ?? []) items.set(`${String(r._id)}:${i.id}`, 'planned');
        if (r.specialty?.template === 'physiotherapy.assessment') courses.add(String(r._id));
      }
      for (const r of records) {
        const data = (r.specialty?.data ?? {}) as DentalData & PhysioData;
        for (const u of data.planUpdates ?? [])
          if (items.has(`${u.sourceEncounterId}:${u.itemId}`)) items.set(`${u.sourceEncounterId}:${u.itemId}`, u.status);
        if (r.specialty?.template === 'physiotherapy.discharge' && data.courseEncounterId) courses.delete(data.courseEncounterId);
      }
      own = {
        openPlanItems: [...items.values()].filter((s) => s === 'planned' || s === 'in_progress').length,
        activeCourses: courses.size,
      };
    }
    res.json({ scope: actor ? 'own' : 'organization', since: since.toISOString(), byTemplate, ...(own ? { own } : {}) });
  });

  return router;
}
