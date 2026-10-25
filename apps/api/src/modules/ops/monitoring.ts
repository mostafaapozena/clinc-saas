import type { Logger } from 'pino';

// The monitoring boundary (docs/operations/RUNBOOK.md#monitoring). Unexpected errors are reported
// with a minimal context — method, path without query string, request id — never bodies, query
// strings, cookies or user data. The default reporter writes to the structured log; an external
// service (decision pending, E7) would implement the same interface.

export type ErrorContext = { method: string; path: string; requestId?: string };
export interface ErrorReporter {
  readonly name: string;
  report(error: unknown, context: ErrorContext): void;
}

export function logErrorReporter(logger?: Logger): ErrorReporter {
  return {
    name: 'log',
    report(error, context) {
      const err = error instanceof Error ? { type: error.name, message: error.message, stack: error.stack } : { type: typeof error };
      logger?.error({ err, ...context }, 'Unhandled request error');
    },
  };
}
