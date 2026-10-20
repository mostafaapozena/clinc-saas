# Working rules for this repository

These rules apply to every contributor, human or AI agent. Commands live in
[README.md](README.md); product scope in [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md);
security design in [docs/architecture/](docs/architecture/).

## 1. Execute in the cloud, not on the owner's computer

- The owner's local disk (Windows C:) is nearly full. **Do not clone this repository, install its
  dependencies, download browsers or pull Docker images on the owner's machine.**
- All installs, builds, tests and dev servers run inside the GitHub Codespace (or CI).
- An agent running locally operates the Codespace remotely (`gh codespace ssh -c <name> -- '…'`)
  and first confirms it is inside it (`echo $CODESPACES` → `true`, `/workspaces/clinc-saas`).
  Opening a Codespace URL in a browser does not move an agent's session.
- Use one Codespace on the smallest machine unless there is a stated reason. Never change billing,
  spending limits or paid features without the owner's explicit approval.

## 2. Testing requirements

- `npm run verify` must pass in the Codespace before pushing, and in GitHub Actions before a PR
  is ready. Passing in the Codespace does **not** mean CI passed — check the actual run.
- Every behavior change comes with a test that would fail without it. Never skip, disable or
  loosen a check to get past a failure; fix the cause.
- API integration tests use real MongoDB (replica set) with throwaway `clinc_test_*` databases
  (`apps/api/test/helpers/test-database.ts`). Never point tests at the dev database.
- **Every new tenant-owned endpoint needs isolation tests**: another organization's ids, tampered
  ids in the path or body, branch-restricted callers, and list/count/search scope. Follow
  `apps/api/test/tenancy.test.ts` and `apps/api/test/front-desk-isolation.test.ts`. Add new
  actions to the role matrix in `apps/api/test/authorization.test.ts`.
- Time-dependent rules read `clock.now()` (`apps/api/src/time/clock.ts`); tests pin it with
  `pinClock()` from `apps/api/test/helpers/clinic.ts` instead of depending on when they run.
  Browser tests that need "today" create their own data in a time zone with time left today.
- Report results honestly: what was verified, what was not, and the failure output.

## 3. Data, secrets and environments

- No real patient data anywhere: code, seeds, fixtures, screenshots, logs. Demo data is synthetic
  and uses `@demo.test` emails.
- No secrets in Git. `.env` is ignored; `.env.example` holds placeholders. `DEMO_PASSWORD` lives
  only in the Codespace's `.env` (or is generated per test run) — never commit or report it.
  Review `git diff --cached` before every commit.
- Ports stay **private**. No public deployment without explicit approval.
- Never log passwords, cookies, session tokens or CSRF tokens (the logger redacts the headers).

## 4. Git workflow

- Change `main` only through pull requests; a repository ruleset requires the `verify` check and
  blocks force-pushes and deletion.
- Branches: `phase-<n>/<topic>`, `feat/…`, `fix/…`, `docs/…`. Conventional commit prefixes.
- When the previous phase's PR is still open, **stack**: branch from its head, target its branch,
  and say so in the PR. Retarget to `main` only after the base merges, then re-check diff and CI.
- Never commit `node_modules`, build output, `.env` files, test reports or database files.
- Do not merge your own PR unless the owner asks. Never force-push shared branches.

## 5. Architecture conventions

- API modules live in `apps/api/src/modules/<module>/` and mount under `/api/v1`.
  Configuration comes only from env vars validated in `apps/api/src/config/env.ts`.
- **Authorization**: add permissions to `PERMISSION_MATRIX` in
  `apps/api/src/tenancy/permissions.ts` and guard routes with `requirePermission(...)`. Never
  check role names in routes. The web app hides controls for UX only.
- **Tenant data**: every tenant-owned model has a required `organizationId` (branch-owned also
  `branchId`) and applies `tenantGuardPlugin`. Org-scoped routes sit under
  `/api/v1/orgs/:orgId/...` after `requireMembership`, read the scope from `tenantOf(req)` and
  build filters with `orgScope` / `accessibleBranchesFilter` / `branchOwnedFilter`. Never take an
  organization id from a request body. Inaccessible ids return the generic `404`.
- State-changing requests need the CSRF token (the web client sends it automatically).
- Web: Arabic first. Every user-facing string goes in **both** `ar.json` and `en.json` (a test
  enforces matching keys); API error codes map to `errors.<CODE>`. Use CSS logical properties,
  never left/right. Organization-scoped query keys start with `['org', orgId]`.
- Do not claim multi-tenant isolation beyond what the tests in `apps/api/test/` prove.

## 6. Keep continuity documents current

Before ending a session, update [docs/PROGRESS.md](docs/PROGRESS.md) and, if resuming changed,
[docs/HANDOFF.md](docs/HANDOFF.md). Push everything — a Codespace is not a backup.
