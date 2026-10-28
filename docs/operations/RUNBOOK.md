# Operations runbook (milestone 5)

**There is no production deployment.** Hosting, data residency and budget are open decisions
(E1, E7, B8). This runbook describes how the API is built to be operated, and what is still
missing before real data.

Everything below was exercised only in the development Codespace, with synthetic data.

## Configuration and environment validation

- The API reads configuration from the environment, validated at startup with zod
  (`apps/api/src/config/env.ts`). An invalid value stops the process with a readable message. An
  empty `KEY=` counts as unset.
- **Production refuses:**
  - insecure cookies;
  - the payment simulator (`BILLING_PROVIDER=simulator`);
  - the development mail sink (`MAIL_PROVIDER=dev_sink`);
  - mail without `APP_BASE_URL`.
- Secrets live only in the server environment, never in Git:
  - `MONGODB_URI` credentials;
  - provider keys (once chosen);
  - `BILLING_SIMULATOR_SECRET` (development only).
- `.env.example` lists every variable with safe placeholders.

## Health, readiness and shutdown

| Endpoint | Meaning |
| -------- | ------- |
| `GET /api/health/live` | The process answers. Never depends on the database. |
| `GET /api/health/ready` | `200` only when the database answers, all indexes are built and no shutdown is under way; otherwise `503`. |
| `GET /api/health` | A database round trip and its latency, for humans and the status page. |

On SIGTERM or SIGINT, the API shuts down gracefully:
1. Readiness turns `503` at once.
2. Idle keep-alive connections close.
3. In-flight requests finish.
4. The database disconnects.
5. A **10-second** deadline forces the exit if requests hang.

## Sessions

- Tenant sessions have an absolute lifetime (`SESSION_TTL_HOURS`). They also have an **idle
  timeout** (`SESSION_IDLE_MINUTES`, default 120; 0 turns it off). The default is an engineering
  proposal (P19).
- Operator sessions last 8 hours, with a 30-minute idle timeout.
- Users see their signed-in devices on the profile page. They can sign out one device or all the
  others.
- A password reset ends every session.

## Rate limits

Authentication, password reset, registration and onboarding, inquiries, support requests,
invitations and operator login all have per-IP limits.

The limiter store is **in memory, per instance**. Running several API instances needs a shared
store (production gate).

## Logging, redaction and monitoring

- **Request logs** contain only the method and the path: no query strings (patient searches use
  them), no headers, no bodies.
- **Redacted fields:** cookies, authorization and CSRF headers, and any `password`,
  `passwordHash`, `token` or `csrfToken` field (tested).
- **Monitoring boundary.** Unexpected errors go through an `ErrorReporter`
  (`modules/ops/monitoring.ts`) with only the method, the path and the request id. The default
  writes to the structured log. An external service (decision E7) would implement the same
  interface.
- **Not implemented:** no alerting, no uptime checks, no metrics.

## Database migrations

- The schema is defined by Mongoose models. Indexes are built at startup (`ensureIndexes`), and
  readiness waits for them.
- **Procedure for a change that needs a data migration:**
  1. Ship code that reads both shapes. Each model has an existing example: helpers for documents
     written before the change.
  2. Back up the database (see [BACKUP_RESTORE.md](BACKUP_RESTORE.md)).
  3. Run an idempotent script under `apps/api/src/scripts/`, in dry-run mode first.
  4. Verify the result.
  5. Remove the fallback in a later release.
- **Never drop or rename a field in the same release that stops writing it.**
- Unique-index changes need a duplicate check first. The build fails loudly if one is violated.

## Backups and restore

Use `npm run ops:backup` and `npm run ops:restore-drill`. Details, and the drill performed, are
in [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

## Deployment procedure (to finish once hosting is chosen)

1. CI must be green: `npm run verify`, which runs lint, typecheck, unit and integration tests,
   build, and browser tests.
2. Check dependencies with `npm run audit:deps` (see [DEPENDENCY_AUDIT.md](DEPENDENCY_AUDIT.md)).
3. Back up and confirm the latest restore drill passed.
4. Deploy the API.
5. Wait for `/api/health/ready`.
6. Deploy the web build.
7. Smoke-test: sign-in, the workspace home, and an appointment list.
8. **Rollback:** redeploy the previous build. Data changes follow the migration procedure above,
   so the previous build can still read the data.

## Incident basics

1. Readiness failing: check the database first (`/api/health` latency, connection errors in the
   log).
2. Suspected credential leak:
   - rotate the secret in the environment;
   - end sessions:
     - all sessions of a user: a password reset;
     - one operator: `npm run operators -- suspend <email>`;
     - everyone: delete the `sessions` collection.
3. Data exposure: preserve the logs and audits (they are insert-only), stop the affected path,
   then follow the legal process (E4, still to be defined).

## Production gates still open

- Hosting and residency.
- A real email provider.
- A real payment provider.
- MFA (see [MFA_OPTIONS.md](MFA_OPTIONS.md)).
- A shared rate-limit store.
- External monitoring and alerting.
- Encrypted off-site backups with a schedule.
- Retention decisions.
- A penetration test.
- Legal review.
