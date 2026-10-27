import type { TFunction } from 'i18next';
import { ApiError } from './api';
import type { AppointmentRef } from './types';

/** Translated, user-facing message for any error (API codes map to errors.<CODE>). */
export function errorMessage(t: TFunction, error: unknown): string {
  const code = error instanceof ApiError ? error.code : 'UNKNOWN';
  return t([`errors.${code}`, 'errors.UNKNOWN']);
}

/**
 * Translated message for a field error code, preferring a field-specific wording. When the field's
 * current value is passed and blank, the message asks for the value: the API reports a blank field
 * as "too_short" or "invalid_choice", which reads wrong ("the value is too short") on an empty field.
 */
export function fieldMessage(t: TFunction, field: string, code: string | undefined, value?: string): string | undefined {
  if (!code) return undefined;
  if (value !== undefined && value.trim() === '') return t([`validation.${field}.empty`, 'validation.required']);
  return t([`validation.${field}.${code}`, `validation.${code}`, 'validation.invalid']);
}

export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiError ? error.fields : {};
}

export function isApiError(error: unknown, code: string): error is ApiError {
  return error instanceof ApiError && error.code === code;
}

/** Appointments named in a conflict error (already limited by the API to what the caller may see). */
export function conflictAppointments(error: unknown): AppointmentRef[] {
  if (!(error instanceof ApiError)) return [];
  const list = error.details.appointments;
  return Array.isArray(list) ? (list as AppointmentRef[]) : [];
}
