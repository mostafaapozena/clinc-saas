import { Router } from 'express';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { parseInput } from '../../http/validate.js';
import { branchOwnedFilter } from '../../tenancy/scope.js';
import { tenantCan, tenantOf, type TenantContext } from '../../tenancy/tenant-context.js';
import { clock } from '../../time/clock.js';
import { addDays, dayRange } from '../../time/local-time.js';
import { CashSessionModel, JournalEntryModel } from '../accounting/accounting.model.js';
import { ledgerToday, monthEnd, monthOf, organizationZone, settingsOf } from '../accounting/accounting.posting.js';
import { AppointmentModel } from '../appointments/appointment.model.js';
import { resolveClinicalActor } from '../clinical/clinical-access.js';
import { EncounterModel, type Encounter } from '../clinical/clinical.model.js';
import { SettlementModel } from '../compensation/compensation.model.js';
import { ChargeModel, InvoiceModel, PaymentModel } from '../finance/finance.model.js';
import { CommitmentModel } from '../planning/planning.model.js';
import { StockBalanceModel, StockItemModel } from '../inventory/inventory.model.js';
import { PatientModel } from '../patients/patient.model.js';
import { PractitionerModel } from '../practitioners/practitioner.model.js';
import { PurchaseRequestModel, SupplierBillModel } from '../purchasing/purchasing.model.js';
import { AssetModel } from '../assets/assets.model.js';

// "Today's focus" (docs/architecture/SPECIALTY_WORKSPACES.md, "Role and specialty workspaces"):
// each section appears only for the permissions that allow it, and nothing widens access —
// a doctor's worklist comes from their own records only; owners and admins get counts, never
// clinical text. The doctor's worklist differs by the practitioner's specialty.

type EncounterLean = Encounter & { _id: Types.ObjectId };
type DentalData = { planItems?: { id: string }[]; planUpdates?: { itemId: string; sourceEncounterId: string; status: string }[] };
type PhysioData = { plannedSessions?: number | null; courseEncounterId?: string | null };
type EntData = { followUp?: string };

async function patientNames(organizationId: Types.ObjectId, ids: Types.ObjectId[]) {
  const rows = await PatientModel.find({ organizationId, _id: { $in: ids } })
    .select('fullName patientNumber')
    .lean();
  return new Map(rows.map((p) => [String(p._id), { fullName: p.fullName, patientNumber: p.patientNumber }]));
}

/** The treating doctor's specialty worklist, from their own finalized records. */
async function worklist(tenant: TenantContext, practitionerId: Types.ObjectId, userId: Types.ObjectId, specialty: string, limit: number) {
  const own = { organizationId: tenant.organizationId, practitionerId, authorUserId: userId, status: 'finalized' as const };
  const now = clock.now();
  const upcoming = async (patientIds: Types.ObjectId[]) => {
    const rows = await AppointmentModel.find({
      organizationId: tenant.organizationId,
      practitionerId,
      patientId: { $in: patientIds },
      status: 'scheduled',
      startAt: { $gte: now },
    })
      .select('patientId startAt')
      .sort({ startAt: 1 })
      .lean();
    const next = new Map<string, { count: number; next: string }>();
    for (const r of rows) {
      const k = String(r.patientId);
      const cur = next.get(k);
      next.set(k, { count: (cur?.count ?? 0) + 1, next: cur?.next ?? r.startAt.toISOString() });
    }
    return next;
  };
  if (specialty === 'dentistry') {
    const records = await EncounterModel.find({ ...own, 'specialty.template': 'dentistry.visit' })
      .select('patientId specialty')
      .limit(2000)
      .lean<EncounterLean[]>();
    const status = new Map<string, { patientId: string; status: string }>();
    for (const r of records)
      for (const i of ((r.specialty?.data ?? {}) as DentalData).planItems ?? [])
        status.set(`${r._id}:${i.id}`, { patientId: String(r.patientId), status: 'planned' });
    for (const r of records)
      for (const u of ((r.specialty?.data ?? {}) as DentalData).planUpdates ?? []) {
        const k = `${u.sourceEncounterId}:${u.itemId}`;
        const cur = status.get(k);
        if (cur) status.set(k, { ...cur, status: u.status });
      }
    const open = new Map<string, number>();
    for (const s of status.values())
      if (s.status === 'planned' || s.status === 'in_progress') open.set(s.patientId, (open.get(s.patientId) ?? 0) + 1);
    const ids = [...open.keys()].slice(0, limit).map((id) => records.find((r) => String(r.patientId) === id)!.patientId);
    const [names, next] = await Promise.all([patientNames(tenant.organizationId, ids), upcoming(ids)]);
    return {
      kind: 'dentistry' as const,
      total: open.size,
      items: ids.map((id) => ({
        patientId: String(id),
        ...names.get(String(id)),
        openPlanItems: open.get(String(id)) ?? 0,
        nextVisit: next.get(String(id))?.next ?? null,
      })),
    };
  }
  if (specialty === 'physiotherapy') {
    const records = await EncounterModel.find({
      ...own,
      'specialty.template': { $in: ['physiotherapy.assessment', 'physiotherapy.session', 'physiotherapy.discharge'] },
    })
      .select('patientId specialty')
      .limit(3000)
      .lean<EncounterLean[]>();
    const discharged = new Set(
      records
        .filter((r) => r.specialty?.template === 'physiotherapy.discharge')
        .map((r) => ((r.specialty?.data ?? {}) as PhysioData).courseEncounterId),
    );
    const courses = records.filter((r) => r.specialty?.template === 'physiotherapy.assessment' && !discharged.has(String(r._id)));
    const sessions = (courseId: string) =>
      records.filter(
        (r) => r.specialty?.template === 'physiotherapy.session' && ((r.specialty?.data ?? {}) as PhysioData).courseEncounterId === courseId,
      ).length;
    const shown = courses.slice(0, limit);
    const [names, next] = await Promise.all([
      patientNames(
        tenant.organizationId,
        shown.map((c) => c.patientId),
      ),
      upcoming(shown.map((c) => c.patientId)),
    ]);
    return {
      kind: 'physiotherapy' as const,
      total: courses.length,
      items: shown.map((c) => ({
        patientId: String(c.patientId),
        ...names.get(String(c.patientId)),
        courseId: String(c._id),
        plannedSessions: ((c.specialty?.data ?? {}) as PhysioData).plannedSessions ?? null,
        completedSessions: sessions(String(c._id)),
        upcomingSessions: next.get(String(c.patientId))?.count ?? 0,
        nextVisit: next.get(String(c.patientId))?.next ?? null,
      })),
    };
  }
  if (specialty === 'ent') {
    const since = new Date(now.getTime() - 60 * 86_400_000);
    const records = await EncounterModel.find({ ...own, 'specialty.template': 'ent.visit', finalizedAt: { $gte: since } })
      .select('patientId specialty finalizedAt')
      .sort({ finalizedAt: -1 })
      .limit(500)
      .lean<EncounterLean[]>();
    const latest = new Map<string, EncounterLean>();
    for (const r of records)
      if (!latest.has(String(r.patientId)) && (((r.specialty?.data ?? {}) as EntData).followUp ?? '').trim()) latest.set(String(r.patientId), r);
    const ids = [...latest.values()].map((r) => r.patientId);
    const next = await upcoming(ids);
    // Follow-up instructions recorded, and no visit booked yet: these patients need a call.
    const due = [...latest.values()].filter((r) => !next.has(String(r.patientId)));
    const shown = due.slice(0, limit);
    const names = await patientNames(
      tenant.organizationId,
      shown.map((r) => r.patientId),
    );
    return {
      kind: 'ent' as const,
      total: due.length,
      items: shown.map((r) => ({
        patientId: String(r.patientId),
        ...names.get(String(r.patientId)),
        lastVisit: r.finalizedAt!.toISOString(),
        recordId: String(r._id),
      })),
    };
  }
  return null;
}

export function createFocusRouter() {
  const router = Router({ mergeParams: true });

  router.get('/workspace/focus', async (req, res) => {
    const tenant = tenantOf(req);
    const { full, specialty } = parseInput(z.object({ full: z.enum(['1']).optional(), specialty: z.string().max(40).optional() }), req.query);
    const limit = full ? 100 : 5;
    const zone = await organizationZone(tenant.organizationId).catch(() => null);
    const orgWide = tenant.branchScope.type === 'all';
    const body: Record<string, unknown> = { role: tenant.role };
    const today = zone ? await ledgerToday(tenant.organizationId) : null;
    const range = today && zone ? dayRange(today, zone) : null;

    // Doctor: their day and their specialty worklist (own records only).
    if (tenantCan(tenant, 'clinical.encounter.own')) {
      const actor = await resolveClinicalActor(tenant);
      const practitioner = actor
        ? await PractitionerModel.findOne({ organizationId: tenant.organizationId, _id: actor.practitionerId }).select('specialtyCode').lean()
        : null;
      if (actor && practitioner) {
        const [byStatus, drafts, list] = await Promise.all([
          range
            ? AppointmentModel.aggregate<{ _id: string; n: number }>([
                {
                  $match: {
                    organizationId: tenant.organizationId,
                    practitionerId: actor.practitionerId,
                    startAt: { $gte: range.start, $lt: range.end },
                  },
                },
                { $group: { _id: '$status', n: { $sum: 1 } } },
              ])
            : Promise.resolve([]),
          EncounterModel.countDocuments({
            organizationId: tenant.organizationId,
            practitionerId: actor.practitionerId,
            authorUserId: actor.userId,
            status: 'draft',
          }),
          worklist(tenant, actor.practitionerId, actor.userId, practitioner.specialtyCode, limit),
        ]);
        const n = (s: string) => byStatus.find((b) => b._id === s)?.n ?? 0;
        body.clinical = {
          specialty: practitioner.specialtyCode,
          today: { scheduled: n('scheduled'), waiting: n('checked_in'), inProgress: n('in_progress'), completed: n('completed') },
          draftRecords: drafts,
          worklist: list,
        };
      }
    }

    // A specialty context narrows the front desk to that specialty's practitioners (never widens).
    let practitionerFilter: Record<string, unknown> = {};
    if (specialty && specialty !== 'all') {
      const ids = await PractitionerModel.find({ organizationId: tenant.organizationId, specialtyCode: specialty }).select('_id').lean();
      practitionerFilter = { practitionerId: { $in: ids.map((p) => p._id) } };
      body.specialty = specialty;
    }

    // Front desk: arrivals, queue, charges to invoice, own cashier session.
    if (tenantCan(tenant, 'appointment.front_desk') && range) {
      const scope = branchOwnedFilter(tenant, practitionerFilter);
      const [byStatus, pendingCharges, session] = await Promise.all([
        AppointmentModel.aggregate<{ _id: string; n: number }>([
          { $match: { ...scope, startAt: { $gte: range.start, $lt: range.end } } },
          { $group: { _id: '$status', n: { $sum: 1 } } },
        ]),
        tenantCan(tenant, 'finance.charge.create')
          ? ChargeModel.countDocuments(branchOwnedFilter(tenant, { status: 'pending' as const }))
          : Promise.resolve(null),
        tenantCan(tenant, 'cash.session.operate')
          ? CashSessionModel.findOne({ organizationId: tenant.organizationId, status: 'open', openedBy: tenant.userId }).select('number').lean()
          : Promise.resolve(null),
      ]);
      const n = (s: string) => byStatus.find((b) => b._id === s)?.n ?? 0;
      body.frontDesk = {
        expected: n('scheduled'),
        waiting: n('checked_in'),
        inProgress: n('in_progress'),
        pendingCharges,
        cashSession: session ? { id: String(session._id), number: session.number } : null,
      };
    }

    // Finance: money to collect, money to pay, cash and the books.
    if (tenantCan(tenant, 'accounting.read') && orgWide) {
      const settings = await settingsOf(tenant.organizationId);
      const [receivable, advances, payablesSoon, openSessions] = await Promise.all([
        InvoiceModel.aggregate<{ v: number }>([
          { $match: { organizationId: tenant.organizationId, status: 'issued' } },
          { $group: { _id: null, v: { $sum: { $subtract: ['$total', { $add: ['$paid', '$credited'] }] } } } },
        ]),
        PaymentModel.aggregate<{ v: number }>([
          { $match: { organizationId: tenant.organizationId, status: 'active' } },
          { $group: { _id: null, v: { $sum: { $subtract: ['$amount', { $add: ['$allocated', '$refunded'] }] } } } },
        ]),
        today
          ? SupplierBillModel.aggregate<{ v: number; n: number }>([
              {
                $match: {
                  organizationId: tenant.organizationId,
                  status: 'posted',
                  dueDate: { $lte: addDays(today, 7) },
                  $expr: { $gt: ['$total', { $add: ['$paid', '$credited'] }] },
                },
              },
              { $group: { _id: null, v: { $sum: { $subtract: ['$total', { $add: ['$paid', '$credited'] }] } }, n: { $sum: 1 } } },
            ])
          : Promise.resolve([]),
        CashSessionModel.countDocuments({ organizationId: tenant.organizationId, status: 'open' }),
      ]);
      let monthToClose: string | null = null;
      if (settings && today) {
        const next = settings.lockedThrough ? monthOf(addDays(settings.lockedThrough, 1)) : monthOf(settings.cutoverDate);
        if (monthEnd(next) < today) monthToClose = next;
      }
      const entriesToday = settings && today ? await JournalEntryModel.countDocuments({ organizationId: tenant.organizationId, date: today }) : 0;
      const commitmentsDue = today
        ? await CommitmentModel.countDocuments({ organizationId: tenant.organizationId, status: 'active', nextDue: { $lte: addDays(today, 7) } })
        : 0;
      body.finance = {
        ledger: Boolean(settings),
        openReceivables: receivable[0]?.v ?? 0,
        unallocatedReceipts: advances[0]?.v ?? 0,
        payablesDueSoon: { amount: payablesSoon[0]?.v ?? 0, bills: payablesSoon[0]?.n ?? 0 },
        openCashSessions: openSessions,
        monthToClose,
        entriesToday,
        commitmentsDue,
      };
    }

    // Approvals waiting for this user.
    const approvals: Record<string, number> = {};
    if (tenantCan(tenant, 'purchase.approve')) {
      approvals.purchaseRequests = await PurchaseRequestModel.countDocuments(branchOwnedFilter(tenant, { status: 'submitted' as const }));
      if (orgWide)
        approvals.directBills = await SupplierBillModel.countDocuments({ organizationId: tenant.organizationId, status: 'awaiting_approval' });
    }
    if (tenantCan(tenant, 'compensation.approve') && orgWide)
      approvals.settlements = await SettlementModel.countDocuments({ organizationId: tenant.organizationId, status: 'draft' });
    if (Object.keys(approvals).length) body.approvals = approvals;

    // Stock: what to reorder and what is about to expire (counts; the stock page has the detail).
    if (tenantCan(tenant, 'inventory.manage') && today) {
      const scope = tenant.branchScope.type === 'selected' ? { branchId: { $in: tenant.branchScope.branchIds } } : {};
      const [reorder, expiring] = await Promise.all([
        orgWide
          ? StockItemModel.countDocuments({
              organizationId: tenant.organizationId,
              status: 'active',
              reorderLevel: { $gt: 0 },
              $expr: { $lte: ['$onHand', '$reorderLevel'] },
            })
          : Promise.resolve(0),
        StockBalanceModel.countDocuments({
          organizationId: tenant.organizationId,
          ...scope,
          qty: { $gt: 0 },
          expiry: { $type: 'string', $lte: addDays(today, 30) },
        }),
      ]);
      body.stock = { reorder, expiring };
    }
    // Equipment whose maintenance is due within 14 days (or overdue), and equipment out of service.
    if (tenantCan(tenant, 'asset.manage') && today) {
      const scope = tenant.branchScope.type === 'selected' ? { branchId: { $in: tenant.branchScope.branchIds } } : {};
      const [due, outOfService] = await Promise.all([
        AssetModel.countDocuments({
          organizationId: tenant.organizationId,
          ...scope,
          status: { $in: ['active', 'out_of_service'] },
          nextMaintenanceDue: { $type: 'string', $lte: addDays(today, 14) },
        }),
        AssetModel.countDocuments({ organizationId: tenant.organizationId, ...scope, status: 'out_of_service' }),
      ]);
      body.equipment = { maintenanceDue: due, outOfService };
    }
    res.json(body);
  });

  return router;
}
