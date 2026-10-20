import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';
import { APPOINTMENT_STATUSES, type AppointmentStatus } from './appointment.state.js';

export const APPOINTMENT_TYPES = ['new_visit', 'follow_up'] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

/** Administrative booking record. Deliberately has no free-text clinical notes. */
export interface Appointment {
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  patientId: Types.ObjectId;
  practitionerId: Types.ObjectId;
  startAt: Date;
  endAt: Date;
  durationMinutes: number;
  type: AppointmentType;
  status: AppointmentStatus;
  cancellationReason: string | null;
  checkedInAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  noShowAt: Date | null;
  /** Optimistic concurrency: every change must name the version it was based on. */
  version: number;
  /** Client retry key, unique per organization and creating user. */
  idempotencyKey: string | null;
  requestHash: string | null;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  /** Stable key for development seed data only. */
  seedKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const appointmentSchema = new Schema<Appointment>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    practitionerId: { type: Schema.Types.ObjectId, ref: 'Practitioner', required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    durationMinutes: { type: Number, required: true, min: 5, max: 240 },
    type: { type: String, enum: APPOINTMENT_TYPES, required: true },
    status: { type: String, enum: APPOINTMENT_STATUSES, required: true, default: 'scheduled' },
    cancellationReason: { type: String, default: null, maxlength: 200 },
    checkedInAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    noShowAt: { type: Date, default: null },
    version: { type: Number, required: true, default: 0 },
    idempotencyKey: { type: String, default: null },
    requestHash: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    seedKey: { type: String },
  },
  { collection: 'appointments', timestamps: true },
);
appointmentSchema.index({ organizationId: 1, branchId: 1, startAt: 1 });
appointmentSchema.index({ organizationId: 1, practitionerId: 1, startAt: 1 });
appointmentSchema.index({ organizationId: 1, patientId: 1, startAt: -1 });
appointmentSchema.index({ organizationId: 1, status: 1, startAt: 1 });
appointmentSchema.index(
  { organizationId: 1, createdBy: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
appointmentSchema.index({ organizationId: 1, seedKey: 1 }, { unique: true, partialFilterExpression: { seedKey: { $type: 'string' } } });
appointmentSchema.plugin(tenantGuardPlugin);

export type AppointmentDocument = HydratedDocument<Appointment>;
export const AppointmentModel = model<Appointment>('Appointment', appointmentSchema);

/**
 * Occupancy of one five-minute grid cell by a practitioner or a patient. The unique index
 * (organization, resource, cell) is what makes double-booking impossible: two overlapping
 * bookings would need the same cell, and only one insert can win — even across branches and
 * under concurrent requests. Rows are written and removed in the same transaction as the
 * appointment they belong to.
 */
export interface SlotReservation {
  organizationId: Types.ObjectId;
  resourceType: 'practitioner' | 'patient';
  resourceId: Types.ObjectId;
  slotStart: Date;
  appointmentId: Types.ObjectId;
}

const slotReservationSchema = new Schema<SlotReservation>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    resourceType: { type: String, enum: ['practitioner', 'patient'], required: true },
    resourceId: { type: Schema.Types.ObjectId, required: true },
    slotStart: { type: Date, required: true },
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment', required: true },
  },
  { collection: 'slot_reservations', versionKey: false },
);
slotReservationSchema.index({ organizationId: 1, resourceType: 1, resourceId: 1, slotStart: 1 }, { unique: true });
slotReservationSchema.index({ organizationId: 1, appointmentId: 1 });
slotReservationSchema.plugin(tenantGuardPlugin);

export const SlotReservationModel = model<SlotReservation>('SlotReservation', slotReservationSchema);
