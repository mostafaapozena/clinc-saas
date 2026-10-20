# Progress

_Last updated: 2026-10-20 (phase 2)._

## Pull requests

| Phase | PR | Branch | Status |
| ----- | -- | ------ | ------ |
| 1 — foundation | [#1](https://github.com/mostafaapozena/clinc-saas/pull/1) | `phase-1/foundation` → `main` | Open, CI green, not merged |
| 2 — auth & tenancy | [#2](https://github.com/mostafaapozena/clinc-saas/pull/2) | `phase-2/auth-tenancy` → `phase-1/foundation` (stacked) | Open, ready for review after #1 |

Merge #1 first, then retarget #2 to `main` and re-check its diff and CI.

## Phase 1 — foundation (done)

Monorepo, Codespaces devcontainer, Express + MongoDB API with health check, React web app,
Vitest + Playwright, GitHub Actions CI, ruleset requiring `verify` on `main`.

**Correction (2026-10-20):** phase 1 verified only that the private preview URL redirects to
GitHub sign-in. Loading the app *through* the preview returned 502 at that time; it was fixed in
phase 2 by changing the devcontainer networking (see below).

## Phase 2 — authentication, organizations, tenant isolation, bilingual shell (done, in review)

### Implemented

- Email/password registration and login (Argon2id), server-side sessions in an HttpOnly cookie
  with rotation, expiry and logout invalidation, CSRF synchronizer token + origin check, auth
  rate limiting, generic login errors. Details: [architecture/AUTH.md](architecture/AUTH.md).
- Organizations, branches, memberships (role, active/suspended, org-wide or selected branches),
  sessions and audit-event models with the required unique indexes.
- Transactional onboarding (organization + first branch + owner membership). MongoDB runs as a
  single-node replica set (devcontainer and CI).
- Central permission matrix, owner/admin/doctor/receptionist/viewer; owner role not assignable,
  admins can't modify owners, last-owner protection, no self-modification.
- Tenant isolation on every org-scoped request (fresh membership lookup, permission check,
  org + branch scoped queries, non-disclosing 404s) plus a tenant guard plugin that rejects
  unscoped queries. Details and matrix: [architecture/TENANCY.md](architecture/TENANCY.md).
- Team management by exact email of an existing account (no directory, no invitations), role and
  branch changes, suspend/reactivate. Server-generated audit events.
- Web: login, registration, onboarding, home, branches, team, organization settings, profile,
  not-found, access-denied; sidebar + mobile drawer; organization and branch switchers limited to
  memberships; persistent language switcher; Arabic/RTL/Alexandria and English/LTR/Inter
  (self-hosted); locale-aware dates and numbers; full translations including errors and states.
- Repeatable development seed with two organizations, five branches, every role, a two-organization
  user, branch-restricted users and a suspended membership (`npm run seed [-- --reset]`).
- Devcontainer networking fix: the app container no longer shares MongoDB's network namespace
  (MongoDB is reached as `mongo:27017`), which made the private preview work end to end.

### Test evidence

- `npm run verify` passes in the Codespace (2026-10-20): lint, typecheck, **128 Vitest tests**
  (109 API integration/unit, 19 web) and **11 Playwright tests** (10 desktop, 1 Pixel 7 mobile).
- API tests run against throwaway replica-set databases: registration validation and
  uniqueness, login success/failure parity, missing/expired/logged-out/rotated sessions, cookie
  flags, CSRF and origin rejection, rate limiting, transactional onboarding with an injected
  failure, a role × action matrix for all five roles, escalation/owner/last-owner/self rules,
  immediate effect of suspension and role/branch changes, cross-organization access with
  tampered ids, cross-organization branch references, scoped lists/search/counts/team views,
  multi-organization scope, and the tenant guard.
- A mutation check (removing org scoping from one query) made the isolation suite fail, then
  was reverted.
- Playwright: register → onboard → workspace, logout/login, generic login error, suspended
  member gets no access, organization switching with no leftover content, restricted doctor
  (hidden pages, access denied, API 403), owner team flow (unknown email, add, role/branch
  change, suspend, reactivate), branch create/search, typography and direction in both
  languages with self-hosted fonts, saved language preference, mobile drawer in both languages.
- **Private preview verified** (2026-10-20) through `https://<codespace>-5173.app.github.dev`
  with headless Chromium running **inside the Codespace**, authenticated with the Codespace's own
  token and GitHub's port-access confirmation: login 200, CSRF-protected `PATCH /me` 200 (origin
  check works behind the forwarder), logout 204, protected endpoint 401 afterwards, RTL +
  Alexandria loaded. This was **not** the owner's desktop browser, which is signed in to a
  different GitHub account and cannot open the owner's private ports.
- CI: GitHub Actions `verify` on PR #2 — see the PR's checks for the latest commit.

### Known limitations and verification gaps

- MongoDB is pinned to 8.2.12 because 8.0.x refuses to start on Linux kernel 6.19+
  ([SERVER-121912](https://jira.mongodb.org/browse/SERVER-121912)). On 2026-10-20 a CI run
  ([39351689080](https://github.com/mostafaapozena/clinc-saas/actions/runs/39351689080)) landed
  on kernel `7.0.0-1017-azure` — inside the affected range — and MongoDB 8.2.12 started and the
  full suite passed. That is one observation, not a guarantee for every 6.19+ kernel; CI keeps
  logging the kernel and MongoDB version.
- Rate limits are per IP; in development all requests come through the Vite proxy and share one
  limit.
- In the Codespace, `SESSION_COOKIE_SECURE=false`; the HTTPS preview would also work with `true`.

## Production gaps (must be resolved before real data or deployment)

- Email verification, password recovery and email invitations (no email infrastructure).
- MFA, idle session timeout, session management UI ("sign out other devices").
- Shared rate-limit store for multiple instances; abuse monitoring.
- Registration reveals whether an email is registered (needs verification-based flow).
- Ownership transfer, organization deletion, member removal; audit viewer, retention, export.
- **Hosting and data residency for Egypt and Saudi Arabia — undecided**; backups, monitoring,
  incident response, secrets management.
- Independent security review / penetration test; legal and regulatory review.
- No clinical modules, subscriptions, billing or payments exist yet.

## Next (recommended phase 3 — not started)

1. Decide hosting/data residency and the email provider; then add email verification, password
   recovery and invitations.
2. First specialty-agnostic clinical foundation, e.g. a patient registry scoped to organization
   and branch, with its own isolation tests and role permissions defined with the owner.
3. Audit log viewer for owners; session management.

## Blockers

None. PR #2 depends on PR #1 being merged first.
