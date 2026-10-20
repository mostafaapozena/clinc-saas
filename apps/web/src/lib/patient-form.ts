import type { Patient, PhoneCountry, Sex } from './types';

export type PatientFormValue = {
  fullName: string;
  phoneCountry: PhoneCountry;
  phoneNumber: string;
  secondaryCountry: PhoneCountry;
  secondaryNumber: string;
  email: string;
  dateOfBirth: string;
  sex: Sex;
  addressLine: string;
  addressCity: string;
};

export const emptyPatientForm = (country: PhoneCountry = 'EG'): PatientFormValue => ({
  fullName: '',
  phoneCountry: country,
  phoneNumber: '',
  secondaryCountry: country,
  secondaryNumber: '',
  email: '',
  dateOfBirth: '',
  sex: 'unspecified',
  addressLine: '',
  addressCity: '',
});

export function patientFormFrom(patient: Patient): PatientFormValue {
  return {
    fullName: patient.fullName,
    phoneCountry: patient.phone.country,
    phoneNumber: patient.phone.e164,
    secondaryCountry: patient.secondaryPhone?.country ?? patient.phone.country,
    secondaryNumber: patient.secondaryPhone?.e164 ?? '',
    email: patient.email ?? '',
    dateOfBirth: patient.dateOfBirth ?? '',
    sex: patient.sex,
    addressLine: patient.address?.line ?? '',
    addressCity: patient.address?.city ?? '',
  };
}

/** Request body for the allowlisted demographic fields. */
export function patientBody(form: PatientFormValue) {
  return {
    fullName: form.fullName,
    phone: { country: form.phoneCountry, number: form.phoneNumber },
    secondaryPhone: form.secondaryNumber.trim() ? { country: form.secondaryCountry, number: form.secondaryNumber } : null,
    email: form.email.trim() || null,
    dateOfBirth: form.dateOfBirth || null,
    sex: form.sex,
    address: form.addressLine.trim() || form.addressCity.trim() ? { line: form.addressLine, city: form.addressCity } : null,
  };
}
