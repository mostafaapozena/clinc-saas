import type { Types } from 'mongoose';
import { hasPermission } from '../../tenancy/permissions.js';
import type { TenantContext } from '../../tenancy/tenant-context.js';
import { EncounterModel, type EncounterStatus } from './clinical.model.js';

export type DocumentationStatus = 'none' | EncounterStatus;

/**
 * Documentation status of appointments ("none" / "draft" / "finalized") for roles allowed to see
 * it (owners, admins, doctors — doctors only ever list their own appointments). Never clinical
 * text. Null for roles without `clinical.documentation_status.read`.
 */
export async function documentationStatuses(
  tenant: TenantContext,
  appointmentIds: Types.ObjectId[],
): Promise<Map<string, EncounterStatus> | null> {
  if (!hasPermission(tenant.role, 'clinical.documentation_status.read')) return null;
  if (appointmentIds.length === 0) return new Map();
  const rows = await EncounterModel.find({
    organizationId: tenant.organizationId,
    appointmentId: { $in: appointmentIds },
  })
    .select('appointmentId status')
    .lean();
  return new Map(rows.map((r) => [String(r.appointmentId), r.status]));
}
