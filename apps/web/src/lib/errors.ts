import type { TFunction } from 'i18next';
import { ApiError } from './api';

/** Translated, user-facing message for any error (API codes map to errors.<CODE>). */
export function errorMessage(t: TFunction, error: unknown): string {
  const code = error instanceof ApiError ? error.code : 'UNKNOWN';
  return t([`errors.${code}`, 'errors.UNKNOWN']);
}

/** Translated message for a field error code, preferring a field-specific wording. */
export function fieldMessage(t: TFunction, field: string, code: string | undefined): string | undefined {
  if (!code) return undefined;
  return t([`validation.${field}.${code}`, `validation.${code}`, 'validation.invalid']);
}

export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiError ? error.fields : {};
}
