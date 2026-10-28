import { Schema, model, type ClientSession, type HydratedDocument, type Query, type Types } from 'mongoose';
import { clock } from '../../time/clock.js';

// Platform operators (docs/architecture/PLATFORM.md): the people who run raclinic itself.
// They are NOT tenant users: separate accounts, separate sessions and cookie, separate CSRF token,
// separate audit. No public registration — accounts are provisioned with the operators CLI.
// No operator role grants access to patients or clinical records, and there is no impersonation.

export const OPERATOR_ROLES = ['platform_admin', 'support'] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export interface PlatformOperator {
  email: string;
  displayName: string;
  passwordHash: string;
  role: OperatorRole;
  status: 'active' | 'suspended';
  lastLoginAt: Date | null;
  seedKey?: string;
  createdAt: Date;
  updatedAt: Date;
}
const operatorSchema = new Schema<PlatformOperator>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    displayName: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: OPERATOR_ROLES, required: true },
    status: { type: String, enum: ['active', 'suspended'], required: true, default: 'active' },
    lastLoginAt: { type: Date, default: null },
    seedKey: { type: String },
  },
  { collection: 'platform_operators', timestamps: true },
);
operatorSchema.index({ email: 1 }, { unique: true });
export type OperatorDocument = HydratedDocument<PlatformOperator>;
export const OperatorModel = model<PlatformOperator>('PlatformOperator', operatorSchema);

/** Operator sessions: short absolute lifetime plus an idle timeout (lastSeenAt). */
export interface OperatorSession {
  tokenHash: string;
  operatorId: Types.ObjectId;
  csrfToken: string;
  expiresAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
}
const operatorSessionSchema = new Schema<OperatorSession>(
  {
    tokenHash: { type: String, required: true },
    operatorId: { type: Schema.Types.ObjectId, ref: 'PlatformOperator', required: true },
    csrfToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
  },
  { collection: 'platform_operator_sessions', timestamps: { createdAt: true, updatedAt: false } },
);
operatorSessionSchema.index({ tokenHash: 1 }, { unique: true });
operatorSessionSchema.index({ operatorId: 1 });
operatorSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const OperatorSessionModel = model<OperatorSession>('PlatformOperatorSession', operatorSessionSchema);

/** Platform audit: every operator action and every subscription change. Insert-only. */
export interface PlatformAuditEvent {
  operatorId: Types.ObjectId | null;
  /** 'operator' | 'provider' | 'system' | 'owner' (tenant owner actions such as checkout). */
  actor: 'operator' | 'provider' | 'system' | 'owner';
  action: string;
  target: { type: 'organization' | 'plan' | 'subscription' | 'inquiry' | 'operator' | 'support_request'; id: string };
  changes: Record<string, unknown>;
  createdAt: Date;
}
const platformAuditSchema = new Schema<PlatformAuditEvent>(
  {
    operatorId: { type: Schema.Types.ObjectId, ref: 'PlatformOperator', default: null },
    actor: { type: String, enum: ['operator', 'provider', 'system', 'owner'], required: true },
    action: { type: String, required: true, maxlength: 60 },
    target: {
      type: new Schema({ type: { type: String, required: true }, id: { type: String, required: true } }, { _id: false }),
      required: true,
    },
    changes: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  {
    collection: 'platform_audit_events',
    timestamps: { createdAt: true, updatedAt: false, currentTime: () => clock.now() },
    minimize: false,
  },
);
platformAuditSchema.index({ createdAt: -1 });
platformAuditSchema.index({ 'target.type': 1, 'target.id': 1, createdAt: -1 });
function insertOnly(this: Query<unknown, unknown>) {
  if (this.getOptions().allowSeedCleanup !== true) throw new Error('Platform audit events are insert-only');
}
platformAuditSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne', 'findOneAndReplace'],
  insertOnly,
);
export const PlatformAuditModel = model<PlatformAuditEvent>('PlatformAuditEvent', platformAuditSchema);

export function recordPlatformAudit(event: Omit<PlatformAuditEvent, 'createdAt'>, session?: ClientSession) {
  return PlatformAuditModel.create([event], { session });
}
