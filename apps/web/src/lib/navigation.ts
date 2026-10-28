// Post-login destinations (no open redirects). Only internal paths of the authenticated app are
// accepted: the workspace, onboarding and invitation acceptance. Anything else — other origins, protocol-relative
// "//host", backslash tricks ("/\host", which browsers treat like "//host"), control characters
// or unrelated paths — falls back to the default.
const ALLOWED_PREFIXES = ['/app', '/onboarding', '/invitations/accept'] as const;
const INTERNAL = 'https://internal.invalid';

export function safeNext(value: string | null | undefined, fallback = '/app'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, INTERNAL);
  } catch {
    return fallback;
  }
  if (url.origin !== INTERNAL) return fallback;
  const allowed = ALLOWED_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
  return allowed ? `${url.pathname}${url.search}` : fallback;
}

/** `path?next=<destination>` when a destination is given (it is validated again where used). */
export function withNext(path: string, next: string | null | undefined): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}
