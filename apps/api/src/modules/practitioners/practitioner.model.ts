import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';

export const PRACTITIONER_STATUSES = ['active', 'inactive'] as const;
export type PractitionerStatus = (typeof PRACTITIONER_STATUSES)[number];

/** A weekly working interval at one branch, in the organization's local wall-clock time. */
export interface WeeklyInterval {
  branchId: Types.ObjectId;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  /** "HH:mm" */
  start: string;
  /** "HH:mm" or "24:00", exclusive */
  end: string;
}

/**
 * Scheduling profile of a doctor. It is not a login account: it points at an existing active
 * membership with the doctor role, so there is exactly one identity per person.
 */
export interface Practitioner {
  organizationId: Types.ObjectId;
  membershipId: Types.ObjectId;
  userId: Types.ObjectId;
  displayName: string;
  specialtyCode: string;
  status: PractitionerStatus;
  branchIds: Types.ObjectId[];
  defaultDurationMinutes: number;
  weeklySchedule: WeeklyInterval[];
  version: number;
  /**
   * Bumped inside every booking and schedule-change transaction. Two transactions that both
   * write this document conflict, so MongoDB serializes bookings against schedule changes.
   */
  scheduleSeq: number;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const weeklyIntervalSchema = new Schema<WeeklyInterval>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    weekday: { type: Number, required: true, min: 0, max: 6 },
    start: { type: String, required: true },
    end: { type: String, required: true },
  },
  { _id: false },
);

const practitionerSchema = new Schema<Practitioner>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    membershipId: { type: Schema.Types.ObjectId, ref: 'Membership', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    displayName: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    specialtyCode: { type: String, required: true },
    status: { type: String, enum: PRACTITIONER_STATUSES, required: true, default: 'active' },
    branchIds: { type: [Schema.Types.ObjectId], ref: 'Branch', default: [] },
    defaultDurationMinutes: { type: Number, required: true, min: 5, max: 240 },
    weeklySchedule: { type: [weeklyIntervalSchema], default: [] },
    version: { type: Number, required: true, default: 0 },
    scheduleSeq: { type: Number, required: true, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { collection: 'practitioners', timestamps: true },
);
practitionerSchema.index({ organizationId: 1, membershipId: 1 }, { unique: true });
practitionerSchema.index({ organizationId: 1, branchIds: 1, status: 1 });
practitionerSchema.plugin(tenantGuardPlugin);

export type PractitionerDocument = HydratedDocument<Practitioner>;
export const PractitionerModel = model<Practitioner>('Practitioner', practitionerSchema);

export const EXCEPTION_KINDS = ['closed', 'hours'] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

/**
 * A date-specific change: `closed` (one branch, or every branch when branchId is null) or
 * `hours` (replaces that branch's weekly intervals on that date).
 */
export interface ScheduleException {
  organizationId: Types.ObjectId;
  practitionerId: Types.ObjectId;
  date: string;
  branchId: Types.ObjectId | null;
  kind: ExceptionKind;
  intervals: { start: string; end: string }[];
  createdBy: Types.ObjectId;
  /** Stable key for development seed data only. */
  seedKey?: string;
  createdAt: Date;
}

const exceptionSchema = new Schema<ScheduleException>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    practitionerId: { type: Schema.Types.ObjectId, ref: 'Practitioner', required: true },
    date: { type: String, required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    kind: { type: String, enum: EXCEPTION_KINDS, required: true },
    intervals: {
      type: [new Schema({ start: String, end: String }, { _id: false })],
      default: [],
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    seedKey: { type: String },
  },
  { collection: 'schedule_exceptions', timestamps: { createdAt: true, updatedAt: false } },
);
// One exception per practitioner, date and branch (null = all branches).
exceptionSchema.index({ organizationId: 1, practitionerId: 1, date: 1, branchId: 1 }, { unique: true });
exceptionSchema.plugin(tenantGuardPlugin);

export const ScheduleExceptionModel = model<ScheduleException>('ScheduleException', exceptionSchema);
