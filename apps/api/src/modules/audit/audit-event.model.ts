import { Schema, model, type ClientSession, type Types } from 'mongoose';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';

export const AUDIT_ACTIONS = [
  'organization.created',
  'organization.updated',
  'organization.specialties_updated',
  'branch.created',
  'branch.updated',
  'member.added',
  'member.role_changed',
  'member.branch_scope_changed',
  'member.suspended',
  'member.reactivated',
  'member.capabilities_changed',
  'patient.created',
  'patient.updated',
  'patient.branch_registered',
  'patient.registration_archived',
  'patient.registration_reactivated',
  'practitioner.created',
  'practitioner.updated',
  'practitioner.schedule_updated',
  'practitioner.exception_added',
  'practitioner.exception_removed',
  'appointment.booked',
  'appointment.rescheduled',
  'appointment.status_changed',
  'finance.settings_updated',
  'subscription.checkout_started',
  'member.invited',
  'member.invitation_revoked',
  'support.request_created',
  'support.request_closed',
  'service.created',
  'service.updated',
  'charge.created',
  'charge.voided',
  'invoice.created',
  'invoice.discount_applied',
  'invoice.issued',
  'invoice.discarded',
  'credit_note.issued',
  'payment.recorded',
  'payment.allocated',
  'payment.reversed',
  'refund.recorded',
  'accounting.set_up',
  'accounting.settings_updated',
  'ledger_account.created',
  'ledger_account.updated',
  'journal.posted',
  'journal.reversed',
  'period.closed',
  'period.reopened',
  'cash_account.created',
  'cash_account.updated',
  'cash_session.opened',
  'cash_session.closed',
  'cash_voucher.created',
  'bank_statement.imported',
  'bank_line.matched',
  'bank_line.unmatched',
  'stock_item.created',
  'stock_item.updated',
  'warehouse.created',
  'warehouse.updated',
  'stock_document.created',
  'purchase.settings_updated',
  'supplier.created',
  'supplier.updated',
  'purchase.request_created',
  'purchase.request_approved',
  'purchase.request_rejected',
  'purchase.request_cancelled',
  'purchase.rfq_created',
  'purchase.quotation_recorded',
  'purchase.order_created',
  'purchase.order_confirmed',
  'purchase.order_cancelled',
  'purchase.order_closed',
  'purchase.goods_received',
  'purchase.goods_returned',
  'purchase.bill_recorded',
  'purchase.bill_approved',
  'purchase.bill_rejected',
  'purchase.payment_recorded',
  'purchase.credit_recorded',
  'compensation.agreement_created',
  'compensation.settlement_drafted',
  'compensation.settlement_adjusted',
  'compensation.settlement_approved',
  'compensation.settlement_paid',
  'asset.created',
  'asset.updated',
  'asset.maintained',
  'asset.retired',
  'asset.disposed',
  'budget.saved',
  'budget.approved',
  'budget.reopened',
  'commitment.created',
  'commitment.updated',
  'commitment.recorded',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_TARGET_TYPES = ['organization', 'branch', 'membership', 'patient', 'practitioner', 'appointment', 'service', 'charge', 'invoice', 'payment', 'adjustment', 'ledger_account', 'journal_entry', 'cash_account', 'cash_session', 'cash_voucher', 'stock_item', 'warehouse', 'stock_document', 'purchase_document', 'settlement', 'asset', 'budget', 'commitment'] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

/**
 * Security-relevant event, always produced by the server. Holds references and small
 * before/after values only — never passwords, cookies, session tokens, contact details or
 * copies of patient records (patient changes list the changed field names, not their values).
 */
export interface AuditEvent {
  organizationId: Types.ObjectId;
  actorUserId: Types.ObjectId;
  action: AuditAction;
  target: { type: AuditTargetType; id: Types.ObjectId };
  changes?: Record<string, unknown>;
  createdAt: Date;
}

const auditEventSchema = new Schema<AuditEvent>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    target: {
      type: { type: String, enum: AUDIT_TARGET_TYPES, required: true },
      id: { type: Schema.Types.ObjectId, required: true },
    },
    changes: { type: Schema.Types.Mixed },
  },
  { collection: 'audit_events', timestamps: { createdAt: true, updatedAt: false } },
);
auditEventSchema.index({ organizationId: 1, createdAt: -1 });
auditEventSchema.index({ organizationId: 1, 'target.id': 1, createdAt: 1 });
auditEventSchema.plugin(tenantGuardPlugin);

export const AuditEventModel = model<AuditEvent>('AuditEvent', auditEventSchema);

export async function recordAudit(
  event: Omit<AuditEvent, 'createdAt'>,
  session?: ClientSession,
): Promise<void> {
  await AuditEventModel.create([event], { session });
}
