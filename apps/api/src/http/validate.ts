import type { z } from 'zod';
import { validationError } from './errors.js';

// Zod issue codes → stable field error codes the web app translates.
const FIELD_CODES: Record<string, string> = {
  too_small: 'too_short',
  too_big: 'too_long',
  invalid_format: 'invalid_format',
  invalid_type: 'required',
  invalid_value: 'invalid_choice',
};

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    fields[key] ??= issue.code === 'custom' ? issue.message : (FIELD_CODES[issue.code] ?? 'invalid');
  }
  throw validationError(fields);
}
