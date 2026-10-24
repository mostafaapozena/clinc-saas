import type { Types } from 'mongoose';
import type { TenantContext } from '../../tenancy/tenant-context.js';
import { documentationStatuses } from '../clinical/clinical-status.js';
import { PatientModel } from '../patients/patient.model.js';
import { PractitionerModel } from '../practitioners/practitioner.model.js';
import type { Appointment } from './appointment.model.js';

type AppointmentLean = Appointment & { _id: Types.ObjectId };

const iso = (value: Date | null) => (value ? value.toISOString() : null);

/**
 * Response shape for appointments the caller is already allowed to see. Patient details are
 * limited to what the front desk needs to identify the person (number, name, phone).
 */
export async function toAppointmentDtos(tenant: TenantContext, appointments: AppointmentLean[]) {
  const patientIds = [...new Set(appointments.map((a) => String(a.patientId)))];
  const practitionerIds = [...new Set(appointments.map((a) => String(a.practitionerId)))];
  const [patients, practitioners, documentation] = await Promise.all([
    PatientModel.find({ organizationId: tenant.organizationId, _id: { $in: patientIds } })
      .select('patientNumber fullName phone')
      .lean(),
    PractitionerModel.find({ organizationId: tenant.organizationId, _id: { $in: practitionerIds } })
      .select('displayName')
      .lean(),
    documentationStatuses(tenant, appointments.map((a) => a._id)),
  ]);
  const patientById = new Map(patients.map((p) => [String(p._id), p]));
  const practitionerById = new Map(practitioners.map((p) => [String(p._id), p]));

  return appointments.map((a) => {
    const patient = patientById.get(String(a.patientId));
    const practitioner = practitionerById.get(String(a.practitionerId));
    return {
      id: String(a._id),
      branchId: String(a.branchId),
      patient: patient
        ? { id: String(patient._id), patientNumber: patient.patientNumber, fullName: patient.fullName, phone: patient.phone.e164 }
        : null,
      practitioner: practitioner ? { id: String(practitioner._id), displayName: practitioner.displayName } : null,
      startAt: a.startAt.toISOString(),
      endAt: a.endAt.toISOString(),
      durationMinutes: a.durationMinutes,
      type: a.type,
      status: a.status,
      cancellationReason: a.cancellationReason,
      checkedInAt: iso(a.checkedInAt),
      startedAt: iso(a.startedAt),
      completedAt: iso(a.completedAt),
      cancelledAt: iso(a.cancelledAt),
      noShowAt: iso(a.noShowAt),
      version: a.version,
      createdAt: a.createdAt.toISOString(),
      // Only for roles with clinical.documentation_status.read; a status, never clinical text.
      ...(documentation ? { documentation: documentation.get(String(a._id)) ?? ('none' as const) } : {}),
    };
  });
}

export async function toAppointmentDto(tenant: TenantContext, appointment: AppointmentLean) {
  const [dto] = await toAppointmentDtos(tenant, [appointment]);
  if (!dto) throw new Error('Expected an appointment DTO');
  return dto;
}
