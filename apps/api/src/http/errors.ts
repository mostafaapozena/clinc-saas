/** An error with a stable, client-translatable code. Messages are English fallbacks only. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/** Used for anything the caller may not see, so existence is never disclosed. */
export const notFound = () => new HttpError(404, 'NOT_FOUND', 'Not found');

export const unauthenticated = () =>
  new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');

export const forbidden = (
  code = 'FORBIDDEN',
  message = 'You do not have permission to perform this action',
) => new HttpError(403, code, message);

export const conflict = (code: string, message: string) => new HttpError(409, code, message);

export const validationError = (fields: Record<string, string>) =>
  new HttpError(400, 'VALIDATION_ERROR', 'Invalid input', fields);

export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 11000;
}
