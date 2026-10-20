# Progress

_Last updated: 2026-10-20 (phase 3)._

## Pull requests

| Phase | PR | Branch | Status |
| ----- | -- | ------ | ------ |
| 1 — foundation | [#1](https://github.com/mostafaapozena/clinc-saas/pull/1) | `phase-1/foundation` → `main` | Open, CI green, not merged |
| 2 — auth & tenancy | [#2](https://github.com/mostafaapozena/clinc-saas/pull/2) | `phase-2/auth-tenancy` → `phase-1/foundation` (stacked) | Open, CI green, not merged |
| 3 — front desk | [#3](https://github.com/mostafaapozena/clinc-saas/pull/3) | `phase-3/patients-appointments` → `phase-2/auth-tenancy` (stacked) | Open, ready for review after #2 |

Merge in order #1 → #2 → #3. After each merge, retarget the next PR to `main` and re-check its
diff and CI.

## Phase 1 — foundation (done)

Monorepo, Codespaces devcontainer, Express + MongoDB API with health check, React web app,
Vitest + Playwright, GitHub Actions CI, ruleset requiring `verify` on `main`.

## Phase 2 — authentication, organizations, tenant isolation, bilingual shell (done, in review)

Email/password auth with server-side sessions and CSRF, organizations/branches/memberships, a
central permission matrix for five roles, tenant isolation on every org-scoped request, team
management, bilingual shell (Arabic/RTL/Alexandria, English/LTR/Inter). Details:
[architecture/AUTH.md](architecture/AUTH.md), [architecture/TENANCY.md](architecture/TENANCY.md).

## Phase 3 — patients, schedules, appointments, check-in, daily queue (done, in review)

### Implemented

- **Patient registry** ([architecture/PATIENTS.md](architecture/PATIENTS.md)): organization-owned
  identity with explicit branch registrations; concurrency-safe patient numbers; E.164 phone
  normalization with explicit country (Arabic digits accepted, family numbers allowed); scoped
  search by number/name/phone, filters, bounded pagination; create/edit allowlisted demographics
  with optimistic versions; scoped duplicate warning with explicit confirmation; add/archive/
  reactivate registrations (archiving refused while future appointments exist); history.
- **Practitioner scheduling** ([architecture/SCHEDULING.md](architecture/SCHEDULING.md)):
  profiles on active doctor memberships, specialty, branches inside the membership scope, default
  duration, weekly hours per branch with no cross-branch overlap, date closures and replacement
  hours; conflicting changes (hours, exceptions, deactivation, branch removal) are refused with the
  affected appointments listed.
- **Time zones**: explicit IANA zone per organization (onboarding and settings), locked while
  future appointments exist; Luxon-based local time with nonexistent/repeated-time handling;
  injectable server clock.
- **Appointments**: booking from server-computed slots, rescheduling, central state machine
  (check-in, start, complete, cancel with reason after arrival, no-show after start), five-minute
  slot reservations in transactions for practitioner and patient, idempotency keys, optimistic
  versions; no hard deletes.
- **Queue and home**: today's arrivals ordered by arrival time, visits in progress, expected
  arrivals; real scoped counts on the home page.
- **Authorization**: 13 new permissions and a central record-visibility rule (doctors: own
  practitioner only; viewers: aggregates only) — matrix in TENANCY.md.
- **Web**: patients, patient detail, appointments (day/week, mobile cards), booking,
  rescheduling, appointment detail, queue, doctors & schedules, time zone in onboarding/settings;
  full Arabic and English translations; organization switch cancels in-flight requests of the
  previous scope.
- **Privacy**: audit events with references and changed field names only; request logs without
  query strings, headers or bodies.
- **Seed**: practitioners, hours, exceptions, 11 patients, 25 appointments in every status
  relative to each organization's local date; re-seeding refreshes only seed-owned records.

### Test evidence

- `npm run verify` passes in the Codespace (2026-10-20): lint, typecheck, **318 Vitest tests**
  (292 API integration/unit, 26 web) and **17 Playwright tests** (15 desktop, 2 Pixel 7 mobile).
- GitHub Actions `verify` passed on PR #3 for commit `721ef53`
  ([run 39366999200](https://github.com/mostafaapozena/clinc-saas/actions/runs/39366999200));
  see the PR checks for the latest commit.
- Highlights: Cairo DST gap and repeated hour (unit + API); adjacent vs overlapping bookings;
  practitioner conflicts across branches proven at the reservation layer; patient conflicts
  without leaking details; **real concurrency** (8 simultaneous conflicting bookings → exactly one;
  concurrent reschedules; idempotency burst; concurrent status changes; 12 concurrent patient
  creations → unique numbers); injected mid-transaction failure leaves nothing behind; every valid
  and invalid state transition; queue ordering; dashboard counts per role and branch; role × action
  matrix for all new actions; cross-organization id tampering in paths and bodies; branch-restricted
  lists/search/counts/availability/history/queue; doctor-only visibility; viewer aggregates only;
  immediate effect of suspension and role changes.
- Mutation check: removing the patient branch-scope filter failed 4 isolation tests; skipping the
  practitioner reservation failed 7 booking/concurrency tests (both reverted).
- Browser (Playwright, headless Chromium in the Codespace/CI): create patient → book → check in →
  doctor starts → completes; reschedule and cancel; viewer/receptionist/doctor restrictions;
  Arabic RTL Alexandria and English LTR Inter; branch and organization switching without leftovers;
  mobile queue check-in without horizontal scroll; no unexplained console errors.
- **Private preview verified** (2026-10-20) through
  `https://<codespace>-5173.app.github.dev` with headless Chromium **inside the Codespace**
  (Codespace token + GitHub's port-access page): receptionist signed in, created a patient with an
  Arabic-digit phone, booked from server slots, checked in; the doctor (separate session) started
  and completed the visit; the doctor's registry request returned 403; RTL/Alexandria and
  LTR/Inter; mobile viewport without horizontal overflow; no console errors. Screenshots were
  reviewed and led to two fixes (reversed time ranges in RTL, empty action labels on mobile).
  This was **not** the owner's own browser.

### Known limitations

- Cross-branch duplicate reconciliation / patient merge is deferred (a branch-limited receptionist
  may create a second record for someone registered only in another branch).
- Organization time-zone migration with future appointments is deferred (changes are refused).
- Name search is a scoped substring regex, not index-assisted.
- Rescheduling keeps practitioner and branch; to change them, cancel and book again.
- The queue refreshes every 30 s (no push updates). No reminders or notifications.
- Demo seed sets today's statuses directly; when seeded early in the day, some of today's demo
  visits appear completed or in progress before their booked time (timestamps never lie in the
  future).
- MongoDB 8.2.12 is pinned for kernel compatibility (see phase 2 notes in git history).
- **Open-file limit (fixed in this phase):** the Codespace's `mongo` container ran with Docker's
  default limit of 1024 open files. With phase 3's extra collections and indexes, back-to-back
  test runs pushed `mongod` past it (695 files open at idle) and it aborted mid-test — the API
  tests failed with `MongoNetworkError` in random suites while CI (higher runner default) passed.
  `docker-compose.yml` and `scripts/ci/start-mongo.sh` now set `nofile` to 64000 (MongoDB's
  recommendation); the Codespace was rebuilt to apply it.
- The web bundle exceeds Vite's 500 kB warning threshold (a warning, not a failure); route-level
  code splitting can be added later.

## Production gaps (must be resolved before real data or deployment)

- **Hosting and data residency for Egypt and Saudi Arabia — undecided**; backups, monitoring,
  incident response, secrets management.
- Legal/regulatory review for processing patient administrative data; retention and deletion
  policy; data-subject requests.
- Email verification, password recovery and invitations (no email provider chosen).
- MFA, idle session timeout, session management UI.
- Shared rate-limit store for multiple instances; abuse monitoring.
- Audit viewer, retention and export; ownership transfer, organization deletion, member removal.
- Patient duplicate reconciliation policy; time-zone migration workflow.
- Independent security review / penetration test, including the concurrency design under load.
- No clinical modules, billing, subscriptions, payments, messaging or public booking exist.

## Next (recommended phase 4 — not started)

Pick one, with the owner:

1. **Hosting decision and a staging environment** (data residency, backups, monitoring, email
   provider for verification/recovery/invitations) — prerequisite for any pilot.
2. **First specialty-agnostic clinical foundation**: a visit record attached to completed
   appointments with role rules for doctors, designed with clinicians before building.
3. **Front-desk refinements**: reminders (after a messaging decision), audit viewer for owners,
   duplicate reconciliation for admins, time-zone migration.

## Blockers

None. PR #3 depends on #2 and #1 being merged first.
