import type { Types } from 'mongoose';
import { dayRange, localDateOf } from '../../time/local-time.js';
import type { Lean } from '../accounting/accounting.posting.js';
import { AppointmentModel } from '../appointments/appointment.model.js';
import { EncounterModel } from '../clinical/clinical.model.js';
import { AdjustmentModel, ChargeModel, InvoiceModel, PaymentModel, type Charge, type Invoice } from '../finance/finance.model.js';
import { AgreementModel, SettledItemModel, type Agreement, type SettlementLine } from './compensation.model.js';

// Settlement computation (docs/architecture/COMPENSATION.md). Bases:
// - performed: non-voided charges of the practitioner's appointments / records, dated when charged;
//   a charge voided after being settled gives a negative line.
// - invoiced: lines of issued invoices (discount applied pro rata when the agreement says so), dated
//   at issue; credit notes give negative lines pro rata to the practitioner's share.
// - collected: allocations of receipts to invoices, pro rata to the practitioner's share; a receipt
//   reversed after being settled gives negative lines.
// Items already settled (approved) are skipped; negative counterparts only follow settled items.

/** `requires`: a negative line only applies when the item it undoes was settled. */
const BASIS_OF: Record<SettlementLine['sourceType'], Agreement['basis']> = {
  charge: 'performed',
  charge_void: 'performed',
  invoice_line: 'invoiced',
  credit_note: 'invoiced',
  allocation: 'collected',
  allocation_reversal: 'collected',
};

type Candidate = Omit<SettlementLine, 'amount' | 'agreementId'> & { requires?: string };

/** Which practitioner each charge belongs to (its appointment's, or its clinical record's). */
async function practitionerOfCharges(organizationId: Types.ObjectId, charges: Lean<Charge>[]) {
  const apptIds = charges.map((c) => c.appointmentId).filter((x): x is Types.ObjectId => Boolean(x));
  const encIds = charges.map((c) => c.source.encounterId).filter((x): x is Types.ObjectId => Boolean(x));
  const [appts, encs] = await Promise.all([
    apptIds.length
      ? AppointmentModel.find({ organizationId, _id: { $in: apptIds } })
          .select('practitionerId')
          .lean()
      : [],
    encIds.length
      ? EncounterModel.find({ organizationId, _id: { $in: encIds } })
          .select('practitionerId')
          .lean()
      : [],
  ]);
  const byAppt = new Map(appts.map((a) => [String(a._id), String(a.practitionerId)]));
  const byEnc = new Map(encs.map((e) => [String(e._id), String(e.practitionerId)]));
  return (c: Lean<Charge>) =>
    (c.source.encounterId ? byEnc.get(String(c.source.encounterId)) : undefined) ??
    (c.appointmentId ? byAppt.get(String(c.appointmentId)) : undefined) ??
    null;
}

const shareOf = (inv: Lean<Invoice>, lineAmount: number, discounts: boolean) =>
  discounts && inv.subtotal > 0 ? Math.round((lineAmount * inv.total) / inv.subtotal) : lineAmount;

export async function computeLines(input: {
  organizationId: Types.ObjectId;
  practitionerId: Types.ObjectId;
  from: string;
  to: string;
  zone: string;
}): Promise<SettlementLine[]> {
  const { organizationId, practitionerId, from, to, zone } = input;
  const start = dayRange(from, zone).start;
  const end = dayRange(to, zone).end;
  const pid = String(practitionerId);
  const agreements = await AgreementModel.find({
    organizationId,
    practitionerId,
    effectiveFrom: { $lte: to },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: from } }],
  }).lean<Lean<Agreement>[]>();
  if (agreements.length === 0) return [];
  const agreementOn = (date: string) => agreements.find((a) => a.effectiveFrom <= date && (!a.effectiveTo || a.effectiveTo >= date)) ?? null;
  const date = (d: Date) => localDateOf(d, zone);
  const candidates: Candidate[] = [];
  const bases = new Set(agreements.map((a) => a.basis));

  // Charges of the period (performed basis) and every charge referenced by invoices of the period.
  if (bases.has('performed')) {
    const charges = await ChargeModel.find({ organizationId, createdAt: { $gte: start, $lt: end } }).lean<Lean<Charge>[]>();
    const who = await practitionerOfCharges(organizationId, charges);
    for (const c of charges) {
      if (who(c) !== pid || c.status === 'voided') continue;
      candidates.push({
        sourceKey: `charge:${c._id}`,
        sourceType: 'charge',
        date: date(c.createdAt),
        branchId: c.branchId,
        serviceId: c.serviceId,
        description: c.description,
        qty: c.quantity,
        base: c.amount,
      });
    }
    // Voided after settlement: undo what was paid for it (voids are not dated; use the settlement period end).
    const settled = await SettledItemModel.find({ organizationId, practitionerId, sourceKey: { $regex: '^charge:' } }).lean();
    const settledIds = settled.map((s) => s.sourceKey.slice('charge:'.length));
    if (settledIds.length) {
      const voided = await ChargeModel.find({ organizationId, _id: { $in: settledIds }, status: 'voided' }).lean<Lean<Charge>[]>();
      for (const c of voided)
        candidates.push({
          sourceKey: `charge_void:${c._id}`,
          sourceType: 'charge_void',
          date: to,
          branchId: c.branchId,
          serviceId: c.serviceId,
          description: c.description,
          qty: -c.quantity,
          base: -c.amount,
          requires: `charge:${c._id}`,
        });
    }
  }

  if (bases.has('invoiced') || bases.has('collected')) {
    const [issued, notes, payments] = await Promise.all([
      bases.has('invoiced')
        ? InvoiceModel.find({ organizationId, status: 'issued', issuedAt: { $gte: start, $lt: end } }).lean<Lean<Invoice>[]>()
        : [],
      bases.has('invoiced') ? AdjustmentModel.find({ organizationId, type: 'credit_note', createdAt: { $gte: start, $lt: end } }).lean() : [],
      bases.has('collected')
        ? PaymentModel.find({
            organizationId,
            $or: [{ allocations: { $elemMatch: { at: { $gte: start, $lt: end } } } }, { 'reversal.at': { $gte: start, $lt: end } }],
          }).lean()
        : [],
    ]);
    const invoiceIds = new Set<string>([
      ...issued.map((i) => String(i._id)),
      ...notes.map((n) => String(n.invoiceId)),
      ...payments.flatMap((p) => p.allocations.map((a) => String(a.invoiceId))),
    ]);
    const invoices = await InvoiceModel.find({ organizationId, _id: { $in: [...invoiceIds] } }).lean<Lean<Invoice>[]>();
    const invById = new Map(invoices.map((i) => [String(i._id), i]));
    const charges = await ChargeModel.find({ organizationId, _id: { $in: invoices.flatMap((i) => i.lines.map((l) => l.chargeId)) } }).lean<
      Lean<Charge>[]
    >();
    const who = await practitionerOfCharges(organizationId, charges);
    const chargeById = new Map(charges.map((c) => [String(c._id), c]));
    /** The practitioner's lines of an invoice with their share of its total. */
    const mine = (inv: Lean<Invoice>, discounts: boolean) =>
      inv.lines.flatMap((l, idx) => {
        const c = chargeById.get(String(l.chargeId));
        return c && who(c) === pid ? [{ idx, line: l, charge: c, share: shareOf(inv, l.amount, discounts) }] : [];
      });

    if (bases.has('invoiced')) {
      for (const inv of issued) {
        const a = agreementOn(date(inv.issuedAt!));
        if (!a || a.basis !== 'invoiced') continue;
        for (const m of mine(inv, a.discountsReduceBase))
          candidates.push({
            sourceKey: `invline:${inv._id}:${m.idx}`,
            sourceType: 'invoice_line',
            date: date(inv.issuedAt!),
            branchId: inv.branchId,
            serviceId: m.charge.serviceId,
            description: `${inv.number} ${m.line.description}`,
            qty: m.line.quantity,
            base: m.share,
          });
      }
      for (const n of notes) {
        const inv = n.invoiceId ? invById.get(String(n.invoiceId)) : undefined;
        const a = agreementOn(date(n.createdAt));
        if (!inv || !a || a.basis !== 'invoiced' || !a.creditsReduceBase || inv.total <= 0) continue;
        for (const m of mine(inv, a.discountsReduceBase))
          candidates.push({
            sourceKey: `credit:${n._id}:${m.idx}`,
            sourceType: 'credit_note',
            date: date(n.createdAt),
            branchId: inv.branchId,
            serviceId: m.charge.serviceId,
            description: `${n.number} ${m.line.description}`,
            qty: 0,
            base: -Math.round((n.amount * m.share) / inv.total),
            requires: `invline:${inv._id}:${m.idx}`,
          });
      }
    }
    if (bases.has('collected')) {
      for (const p of payments) {
        p.allocations.forEach((al, i) => {
          const inv = invById.get(String(al.invoiceId));
          if (!inv || inv.total <= 0) return;
          const n = i + 1;
          if (al.at >= start && al.at < end) {
            const a = agreementOn(date(al.at));
            if (a && a.basis === 'collected')
              for (const m of mine(inv, a.discountsReduceBase))
                candidates.push({
                  sourceKey: `alloc:${p._id}:${n}:${m.idx}`,
                  sourceType: 'allocation',
                  date: date(al.at),
                  branchId: inv.branchId,
                  serviceId: m.charge.serviceId,
                  description: `${p.number} ${inv.number}`,
                  qty: 0,
                  base: Math.round((al.amount * m.share) / inv.total),
                });
          }
          if (p.status === 'reversed' && p.reversal && p.reversal.at >= start && p.reversal.at < end) {
            const a = agreementOn(date(p.reversal.at)) ?? agreementOn(date(al.at));
            if (a && a.basis === 'collected')
              for (const m of mine(inv, a.discountsReduceBase))
                candidates.push({
                  sourceKey: `revalloc:${p._id}:${n}:${m.idx}`,
                  sourceType: 'allocation_reversal',
                  date: date(p.reversal.at),
                  branchId: inv.branchId,
                  serviceId: m.charge.serviceId,
                  description: `${p.number} ${inv.number}`,
                  qty: 0,
                  base: -Math.round((al.amount * m.share) / inv.total),
                  requires: `alloc:${p._id}:${n}:${m.idx}`,
                });
          }
        });
      }
    }
  }

  // Negative counterparts only for items that were actually settled; skip anything already settled.
  const lookup = [...new Set(candidates.flatMap((c) => [c.sourceKey, ...(c.requires ? [c.requires] : [])]))];
  const settled = new Set(
    (
      await SettledItemModel.find({ organizationId, sourceKey: { $in: lookup } })
        .select('sourceKey')
        .lean()
    ).map((s) => s.sourceKey),
  );
  const lines: SettlementLine[] = [];
  // A negative line applies when what it undoes was settled earlier or is settled now (same period).
  const pending = new Set(candidates.filter((c) => !c.requires && !settled.has(c.sourceKey)).map((c) => c.sourceKey));
  for (const c of candidates) {
    if (settled.has(c.sourceKey) || (c.requires && !settled.has(c.requires) && !pending.has(c.requires))) continue;
    const a = agreementOn(c.date);
    if (!a || a.basis !== BASIS_OF[c.sourceType]) continue;
    if (a.serviceIds.length && (!c.serviceId || !a.serviceIds.some((s) => s.equals(c.serviceId!)))) continue;
    if (a.branchIds.length && !a.branchIds.some((b) => b.equals(c.branchId))) continue;
    const percent = Math.round((c.base * a.percentBp) / 10_000);
    const fixed = a.basis !== 'collected' ? a.fixedPerUnit * c.qty : 0;
    lines.push({
      sourceKey: c.sourceKey,
      sourceType: c.sourceType,
      date: c.date,
      branchId: c.branchId,
      serviceId: c.serviceId,
      description: c.description.slice(0, 160),
      qty: c.qty,
      base: c.base,
      amount: percent + fixed,
      agreementId: a._id,
    });
  }
  // By date; on one date the items before what reduces them (voids, credit notes, reversals).
  return lines.sort((x, y) => x.date.localeCompare(y.date) || Number(y.base > 0) - Number(x.base > 0) || x.sourceKey.localeCompare(y.sourceKey));
}
