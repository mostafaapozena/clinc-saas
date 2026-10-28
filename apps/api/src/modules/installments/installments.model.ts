import { Schema, model, type Query, type Types } from 'mongoose';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';
import { clock } from '../../time/clock.js';
import { MAX_AMOUNT } from '../finance/finance.model.js';

// Installment plans on patient invoices (docs/architecture/INSTALLMENTS.md). A plan only
// schedules the invoice's open balance: receipts are recorded and allocated as usual, and the
// plan's progress is read from the invoice itself, so nothing is counted twice.

const money = {
  type: Number,
  required: true,
  min: 1,
  max: MAX_AMOUNT,
  validate: { validator: Number.isSafeInteger, message: 'not_integer' },
};

export interface ScheduleItem {
  dueDate: string;
  amount: number;
}
export interface PlanRevision {
  at: Date;
  by: Types.ObjectId;
  reason: string;
  /** The schedule that was replaced. */
  schedule: ScheduleItem[];
}
export interface InstallmentPlan {
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  patientId: Types.ObjectId;
  invoiceId: Types.ObjectId;
  number: string;
  /** Invoice paid + credited when the plan started: progress is what was settled since. */
  baseline: number;
  /** Open balance scheduled when the plan started. */
  total: number;
  schedule: ScheduleItem[];
  status: 'active' | 'cancelled';
  revisions: PlanRevision[];
  cancelReason: string | null;
  version: number;
  createdBy: Types.ObjectId;
  createdAt: Date;
}
const itemSchema = new Schema<ScheduleItem>({ dueDate: { type: String, required: true }, amount: money }, { _id: false });
const planSchema = new Schema<InstallmentPlan>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
    number: { type: String, required: true },
    baseline: { type: Number, required: true, min: 0 },
    total: money,
    schedule: { type: [itemSchema], required: true },
    status: { type: String, enum: ['active', 'cancelled'], required: true, default: 'active' },
    revisions: {
      type: [
        new Schema<PlanRevision>(
          {
            at: { type: Date, required: true },
            by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
            reason: { type: String, required: true, maxlength: 300 },
            schedule: [itemSchema],
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    cancelReason: { type: String, default: null, maxlength: 300 },
    version: { type: Number, required: true, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { collection: 'fin_installment_plans', timestamps: { createdAt: true, updatedAt: false, currentTime: () => clock.now() } },
);
planSchema.index({ organizationId: 1, number: 1 }, { unique: true });
// One active plan per invoice.
planSchema.index({ organizationId: 1, invoiceId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
planSchema.index({ organizationId: 1, status: 1, branchId: 1 });
planSchema.index({ organizationId: 1, patientId: 1 });
planSchema.plugin(tenantGuardPlugin);
planSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne', 'findOneAndReplace'], function (this: Query<unknown, unknown>) {
  if (this.getOptions().allowSeedCleanup !== true) throw new Error('Installment plans cannot be deleted');
});

export const InstallmentPlanModel = model<InstallmentPlan>('InstallmentPlan', planSchema);

export type InstallmentState = 'paid' | 'partial' | 'due' | 'overdue';
/**
 * Status of each installment from what was settled on the invoice since the plan started,
 * applied to the installments in date order.
 */
export function scheduleState(schedule: ScheduleItem[], settled: number, today: string) {
  let left = settled;
  return schedule.map((s) => {
    const covered = Math.max(0, Math.min(s.amount, left));
    left -= covered;
    const state: InstallmentState = covered === s.amount ? 'paid' : s.dueDate < today ? 'overdue' : covered > 0 ? 'partial' : 'due';
    return { ...s, covered, state };
  });
}
