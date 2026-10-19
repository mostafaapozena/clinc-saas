# Progress

_Last updated: 2026-10-19 (phase 1)._

## Phase 1 — project foundation

### Done

- Private repository `mostafaapozena/clinc-saas`; phase work on branch `phase-1/foundation`.
- Codespaces devcontainer: Node 24.21.0 (from `.nvmrc`), MongoDB 8.2.12 service, sshd,
  automatic `npm ci` + Playwright Chromium + seed. Tested on a fresh 2-core Codespace.
- API: Express 5 + Mongoose; `GET /api/health` (real MongoDB ping, 503 when the DB is down),
  `GET /api/v1/specialties` (seeded synthetic reference catalog), validated env config,
  structured logging, security headers.
- Web: React + Vite, Arabic/RTL by default with an English/LTR switch, live API/database
  status panel, specialties loaded from the database through the same-origin `/api` proxy.
- Tests: 23 Vitest tests (web components/i18n, API integration against throwaway MongoDB
  databases) + 2 Playwright smoke tests against production builds.
- `npm run verify` passes inside the Codespace. GitHub Actions CI runs it on PRs and `main`
  and passes (PR #1).
- Repository ruleset "main: require CI" on the default branch: the `verify` check is required
  (branch must be up to date), and force-pushes and deletion are blocked.
- Phase 1 pull request: https://github.com/mostafaapozena/clinc-saas/pull/1 (ready for review,
  not merged).
- Continuity docs: README, AGENTS, CLAUDE, PROJECT_CONTEXT, TENANCY proposal, HANDOFF.

### Known limitations

- Multi-tenancy is designed ([architecture/TENANCY.md](architecture/TENANCY.md)) but **not implemented**.
- No authentication, users or organizations yet.
- MongoDB is pinned to **8.2.12**. MongoDB 8.0.x (8.0.34 checked) refuses to start on Linux
  kernels 6.19 and newer ([SERVER-121912](https://jira.mongodb.org/browse/SERVER-121912)),
  which some GitHub-hosted runners now use. The 8.2.12 binary no longer contains that startup
  check. CI prints the runner kernel and MongoDB version for diagnosis. Re-check this before
  choosing a production MongoDB version.
- No required PR reviews are configured (single maintainer), only the required CI check.
- The owner's browser was signed in to a different GitHub account, so the private preview URL
  was not opened in it. The UI was checked with headless Chromium inside the Codespace instead.
- The preview URL only works while the Codespace runs; there is no hosted environment.

## Next (proposed phase 2 — not started)

1. Authentication (sign-up/sign-in, sessions or tokens) and the user model.
2. Organization, branch and membership models with the tenant-scoping layer from TENANCY.md,
   plus cross-tenant isolation tests.
3. App shell: Arabic-first navigation layout and routing.
4. Decide the product name and confirm data-residency and compliance requirements for Egypt/KSA.

## Blockers

None currently.
