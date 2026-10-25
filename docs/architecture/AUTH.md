# Authentication, sessions and CSRF

Implemented in `apps/api/src/auth/`. Covered by `apps/api/test/auth.test.ts` and
`apps/api/test/session-security.test.ts`.

## Accounts

- Email + password registration. Emails are trimmed and lowercased; a unique index on
  `users.email` enforces one account per address.
- Passwords: 10–128 characters, hashed with **Argon2id** via `@node-rs/argon2`
  (19 MiB memory, 2 iterations, 1 lane — the OWASP baseline). Hashes are `select: false` and the
  only user shape returned by the API is `toUserDto` (no password fields).
- `emailVerifiedAt` is set when the user opens an email-verification link (milestone 5, [ACCOUNT_EMAIL.md](ACCOUNT_EMAIL.md)). Nothing requires verification yet.
  Password recovery does not exist. Both are production gaps (see PROGRESS.md).
- Registration reveals that an email is taken (`409 EMAIL_UNAVAILABLE`) — unavoidable without
  email verification; registration is rate limited. Login never reveals it: wrong password and
  unknown email return the same `401 INVALID_CREDENTIALS`, and a dummy hash verification keeps
  timing similar.

## Sessions

- Opaque, server-side, revocable. On sign-in the server creates 32 random bytes (base64url) as
  the token and stores only its **SHA-256 hash** in `sessions`, with the user id, a CSRF token
  and `expiresAt`.
- Cookie: `clinc_sid` (or `__Host-clinc_sid` when `SESSION_COOKIE_SECURE=true`), `HttpOnly`,
  `SameSite=Lax`, `Path=/`, `Expires` = session expiry. `SESSION_COOKIE_SECURE` **must** be `true`
  in production (startup fails otherwise); it is `false` for local `http://127.0.0.1` tests. The
  Codespaces preview is HTTPS, so cookies there also work with `Secure` enabled.
- Lifetime: absolute expiry `SESSION_TTL_HOURS` (default 168 h), checked on every request; a TTL
  index removes expired documents. Since milestone 5 sessions also end after `SESSION_IDLE_MINUTES` without a request (default 120;
  `lastSeenAt` updated at most once a minute); idle or expired sessions are deleted when next presented.
  Users list their sessions (device hint from a truncated User-Agent) and sign out one or all others
  (`/api/v1/me/sessions`); a password reset ends all of them.
- **Rotation**: login and registration always create a new session and delete the one the
  request arrived with. **Logout** deletes the session server-side; a copied cookie stops
  working immediately.
- Tokens are never stored in `localStorage` or readable by JavaScript. The CSRF token is held in
  memory by the web app and re-read from `GET /api/v1/auth/session` after a reload.
- `GET /api/v1/auth/session` answers `200 {user: null}` when signed out (it is the "am I signed
  in?" probe). Every other protected endpoint answers `401 UNAUTHENTICATED`.

## CSRF and origins

1. **Synchronizer token**: every state-changing request (`POST/PUT/PATCH/DELETE`) made with a
   session must send `X-CSRF-Token` equal to the session's token (constant-time comparison),
   otherwise `403 CSRF_INVALID`. Logout is included. Login and registration have no session yet
   and rely on (2).
2. **Origin check** on all state-changing API requests: if the browser sent `Origin`, its host
   must equal the request's `Host` (same-origin, which also holds through the Vite proxy and the
   Codespaces preview) or be listed in `APP_ORIGINS`; `Sec-Fetch-Site: cross-site` without
   `Origin` is rejected too (`403 ORIGIN_NOT_ALLOWED`).
3. `SameSite=Lax` cookies and **no CORS middleware**: other origins cannot read API responses or
   send credentialed writes.

## Rate limiting

`express-rate-limit`, per IP, in memory: login and registration each allow
`AUTH_RATE_LIMIT_MAX` attempts per `AUTH_RATE_LIMIT_WINDOW_MINUTES` (default 10 per 15 min);
adding members by email allows three times that. Responses: `429 RATE_LIMITED` with standard
`RateLimit` headers. Behind a reverse proxy set `TRUST_PROXY=true` so the client IP is used.
Multiple API instances will need a shared store (production gap). In development everything
arrives through the Vite proxy, so all users share one limit.

## Logging

pino redacts `Authorization`, `Cookie`, `X-CSRF-Token` and `Set-Cookie` headers. Audit events
(see TENANCY.md) never contain passwords, tokens or contact details.
