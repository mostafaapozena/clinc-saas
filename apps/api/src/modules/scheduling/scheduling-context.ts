import type { Types } from 'mongoose';
import { conflict } from '../../http/errors.js';
import { recordVisibility } from '../../tenancy/permissions.js';
import { branchOwnedFilter } from '../../tenancy/scope.js';
import type { TenantContext } from '../../tenancy/tenant-context.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { PractitionerModel } from '../practitioners/practitioner.model.js';

/** The organization's configured IANA zone; scheduling refuses to guess one. */
export async function requireTimeZone(tenant: TenantContext): Promise<string> {
  const organization = await OrganizationModel.findById(tenant.organizationId).select('timeZone').lean();
  if (!organization?.timeZone) {
    throw conflict('TIME_ZONE_REQUIRED', 'Set the organization time zone in settings before scheduling');
  }
  return organization.timeZone;
}

/** The caller's own practitioner profile (doctors), or null. */
export async function ownPractitionerId(tenant: TenantContext): Promise<Types.ObjectId | null> {
  const own = await PractitionerModel.findOne({ organizationId: tenant.organizationId, membershipId: tenant.membershipId })
    .select('_id')
    .lean();
  return own?._id ?? null;
}

export type Filter = Record<string, unknown>;

/**
 * Filter for appointments the caller may see as individual records: branch scope, plus "own
 * practitioner only" for doctors. Returns null when the role may not see any (viewers, or a
 * doctor without a profile) — callers then answer with an empty result or 404.
 */
export async function visibleAppointmentsFilter(tenant: TenantContext, filter: Filter = {}): Promise<Filter | null> {
  const visibility = recordVisibility(tenant.role);
  if (visibility === 'none') return null;
  if (visibility === 'own_practitioner') {
    const own = await ownPractitionerId(tenant);
    if (!own) return null;
    return branchOwnedFilter(tenant, { ...filter, practitionerId: own });
  }
  return branchOwnedFilter(tenant, filter);
}

/**
 * Filter for counting appointments (dashboard): like visibleAppointmentsFilter, but viewers
 * count everything in their branch scope because they only ever receive totals.
 */
export async function countableAppointmentsFilter(tenant: TenantContext, filter: Filter = {}): Promise<Filter | null> {
  if (recordVisibility(tenant.role) === 'none') return branchOwnedFilter(tenant, filter);
  return visibleAppointmentsFilter(tenant, filter);
}
