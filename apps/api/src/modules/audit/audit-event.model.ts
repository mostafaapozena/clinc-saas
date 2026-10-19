import { Schema, model, type ClientSession, type Types } from 'mongoose';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';

export const AUDIT_ACTIONS = [
  'organization.created',
  'organization.updated',
  'branch.created',
  'branch.updated',
  'member.added',
  'member.role_changed',
  'member.branch_scope_changed',
  'member.suspended',
  'member.reactivated',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Security-relevant event, always produced by the server. Holds references and small
 * before/after values only — never passwords, cookies, session tokens or contact details.
 */
export interface AuditEvent {
  organizationId: Types.ObjectId;
  actorUserId: Types.ObjectId;
  action: AuditAction;
  target: { type: 'organization' | 'branch' | 'membership'; id: Types.ObjectId };
  changes?: Record<string, unknown>;
  createdAt: Date;
}

const auditEventSchema = new Schema<AuditEvent>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    target: {
      type: { type: String, enum: ['organization', 'branch', 'membership'], required: true },
      id: { type: Schema.Types.ObjectId, required: true },
    },
    changes: { type: Schema.Types.Mixed },
  },
  { collection: 'audit_events', timestamps: { createdAt: true, updatedAt: false } },
);
auditEventSchema.index({ organizationId: 1, createdAt: -1 });
auditEventSchema.plugin(tenantGuardPlugin);

export const AuditEventModel = model<AuditEvent>('AuditEvent', auditEventSchema);

export async function recordAudit(
  event: Omit<AuditEvent, 'createdAt'>,
  session?: ClientSession,
): Promise<void> {
  await AuditEventModel.create([event], { session });
}
