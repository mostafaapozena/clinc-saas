import type { Types } from 'mongoose';
import { notFound } from '../../http/errors.js';
import { recordVisibility } from '../../tenancy/permissions.js';
import { canAccessBranch } from '../../tenancy/scope.js';
import { parseObjectId, type TenantContext } from '../../tenancy/tenant-context.js';
import { AppointmentModel } from '../appointments/appointment.model.js';
import { visibleAppointmentsFilter } from '../scheduling/scheduling-context.js';
import { PatientModel, type Patient, type StoredPhone } from './patient.model.js';

type PatientLean = Patient & { _id: Types.ObjectId };

/**
 * Filter for patients visible through the caller's branch scope: at least one registration
 * (active or archived) in an authorized branch. Organization-wide roles see every patient.
 */
export function patientScopeFilter(tenant: TenantContext, extra: Record<string, unknown> = {}) {
  return tenant.branchScope.type === 'all'
    ? { ...extra, organizationId: tenant.organizationId }
    : { ...extra, organizationId: tenant.organizationId, 'registrations.branchId': { $in: tenant.branchScope.branchIds } };
}

/**
 * Loads a patient the caller may open, or throws the generic 404. Doctors only reach patients
 * linked to one of their own appointments in their authorized branches.
 */
export async function loadAccessiblePatient(tenant: TenantContext, rawId: unknown): Promise<PatientLean> {
  const id = parseObjectId(rawId);
  if (!id) throw notFound();
  const visibility = recordVisibility(tenant.role);
  if (visibility === 'none') throw notFound();
  if (visibility === 'own_practitioner') {
    const filter = await visibleAppointmentsFilter(tenant, { patientId: id });
    if (!filter || !(await AppointmentModel.exists(filter))) throw notFound();
    const patient = await PatientModel.findOne({ organizationId: tenant.organizationId, _id: id }).lean();
    if (!patient) throw notFound();
    return patient;
  }
  const patient = await PatientModel.findOne(patientScopeFilter(tenant, { _id: id })).lean();
  if (!patient) throw notFound();
  return patient;
}

const phoneDto = (phone: StoredPhone | null) => (phone ? { country: phone.country, e164: phone.e164 } : null);

/** Only registrations in the caller's branches are returned; hidden branches are never named. */
export function visibleRegistrations(patient: PatientLean, tenant: TenantContext) {
  return patient.registrations
    .filter((r) => canAccessBranch(tenant, r.branchId))
    .map((r) => ({
      branchId: String(r.branchId),
      status: r.status,
      registeredAt: r.registeredAt.toISOString(),
      archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
    }));
}

export function toPatientSummaryDto(patient: PatientLean, tenant: TenantContext) {
  return {
    id: String(patient._id),
    patientNumber: patient.patientNumber,
    fullName: patient.fullName,
    phone: phoneDto(patient.phone),
    registrations: visibleRegistrations(patient, tenant),
  };
}

export function toPatientDto(patient: PatientLean, tenant: TenantContext) {
  return {
    ...toPatientSummaryDto(patient, tenant),
    secondaryPhone: phoneDto(patient.secondaryPhone),
    email: patient.email,
    dateOfBirth: patient.dateOfBirth,
    sex: patient.sex,
    address: patient.address ? { line: patient.address.line ?? '', city: patient.address.city ?? '' } : null,
    version: patient.version,
    createdAt: patient.createdAt.toISOString(),
    updatedAt: patient.updatedAt.toISOString(),
  };
}
