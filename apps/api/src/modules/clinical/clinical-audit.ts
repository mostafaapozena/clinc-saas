import type { ClientSession, Types } from 'mongoose';
import type { TenantContext } from '../../tenancy/tenant-context.js';
import { clock } from '../../time/clock.js';
import { ClinicalAuditModel, type ClinicalAuditAction } from './clinical.model.js';

type Refs = {
  encounterId?: Types.ObjectId | null;
  appointmentId?: Types.ObjectId | null;
  patientId?: Types.ObjectId | null;
};

/** Reads and denials are recorded at most once per actor, action and target in this window. */
const REPEAT_WINDOW_MS = 10 * 60_000;

/** Clinical audit event: references and metadata only (versions, section names, reason codes). */
export async function recordClinical(
  tenant: TenantContext,
  action: ClinicalAuditAction,
  refs: Refs,
  metadata: Record<string, unknown> = {},
  session?: ClientSession,
): Promise<void> {
  await ClinicalAuditModel.create(
    [
      {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        actorRole: tenant.role,
        action,
        encounterId: refs.encounterId ?? null,
        appointmentId: refs.appointmentId ?? null,
        patientId: refs.patientId ?? null,
        metadata,
      },
    ],
    { session },
  );
}

/** Like recordClinical, but skips a repeat of the same event within the window (refreshes, retries). */
export async function recordClinicalOnce(
  tenant: TenantContext,
  action: ClinicalAuditAction,
  refs: Refs,
  metadata: Record<string, unknown> = {},
) {
  const recent = await ClinicalAuditModel.exists({
    organizationId: tenant.organizationId,
    actorUserId: tenant.userId,
    action,
    encounterId: refs.encounterId ?? null,
    appointmentId: refs.appointmentId ?? null,
    patientId: refs.patientId ?? null,
    createdAt: { $gte: new Date(clock.now().getTime() - REPEAT_WINDOW_MS) },
  });
  if (!recent) await recordClinical(tenant, action, refs, metadata);
}
