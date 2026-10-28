# Progress

_Last updated: 2026-10-25 (phase 4 and phase 5 in review)._

Product state: [PRODUCT_INVENTORY.md](PRODUCT_INVENTORY.md). Plan: [ROADMAP.md](ROADMAP.md).
Decisions: [DECISIONS.md](DECISIONS.md). Next phase: [NEXT_PHASE_BRIEF.md](NEXT_PHASE_BRIEF.md).

## Pull requests

| Phase | PR | Merge commit on `main` | Status |
| ----- | -- | ---------------------- | ------ |
| 1 — foundation | [#1](https://github.com/mostafaapozena/clinc-saas/pull/1) | `b33d09a` | Merged 2026-10-20 |
| 2 — auth & tenancy | [#2](https://github.com/mostafaapozena/clinc-saas/pull/2) | `12bf659` | Merged 2026-10-20 |
| 3 — front desk | [#3](https://github.com/mostafaapozena/clinc-saas/pull/3) | `ab0551a` | Merged 2026-10-20 |
| Planning docs | [#4](https://github.com/mostafaapozena/clinc-saas/pull/4) | `d8b93b9` | Merged 2026-10-20 (docs only, CI green) |
| 4 — public site & onboarding | [#5](https://github.com/mostafaapozena/clinc-saas/pull/5) | — | Open, `phase-4/public-onboarding` → `main`; awaiting owner review of the public copy and the raclinic identity; not merged |
| 5 — clinical visit records | [#6](https://github.com/mostafaapozena/clinc-saas/pull/6) | — | Open, `phase-5/visit-records` → `phase-4/public-onboarding` (stacked); awaiting owner review and clinician review; not merged |

## Phase 5 — clinical visit records (implemented, in review — clinician review pending)

Branch `phase-5/visit-records`, **stacked on `phase-4/public-onboarding`** (PR #5 still open);
PR [#6](https://github.com/mostafaapozena/clinc-saas/pull/6) targets that branch. Design: [architecture/CLINICAL.md](architecture/CLINICAL.md).
Nothing here is clinically validated or production-ready; synthetic data only.

Delivered:
- General visit record per appointment for the **treating doctor only** (active doctor membership +
  active practitioner profile + own appointment/record + branch scope, re-checked inside every
  mutation): start for a visit in progress, late entry with a reason for a completed visit,
  draft saves with optimistic versions, explicit finalization with a provisional minimum,
  immutable finalized text, append-only addenda with a reason, patient timeline of own records.
- Owners/admins: documentation status only (`none` / `draft` / `finalized`); receptionists and
  viewers: nothing clinical. Other doctors and cross-organization ids: generic `404`.
- Idempotency keys on create / finalize / addendum (reuse with different content → `409`);
  unique index for one record per appointment; `Membership.accessSeq` write-lock so suspensions
  and scope changes cannot race a mutation.
- Separate insert-only clinical audit log (metadata only); no clinical text in logs, URLs, browser
  storage, document titles, errors or the administrative audit log; `no-store` responses.
- Web (ar/en): record page, conflict banner, finalize confirmation, unsaved-changes guard, finalized
  view and timeline, addenda, appointment card, queue badge, patient timeline.
- Synthetic demo records in `demo-nour`; public copy lists general visit records as available
  and specialty tools / prescriptions / attachments as planned ([PUBLIC_COPY.md](PUBLIC_COPY.md)).
- Docs: CLINICAL.md (authorization matrix, lifecycle, concurrency/idempotency, audit/privacy,
  production gates), [CLINICIAN_REVIEW.md](CLINICIAN_REVIEW.md) (not yet reviewed), TENANCY matrix,
  inventory, roadmap, decisions (Q5 answered by the owner's brief; Q6 open).

Evidence (Codespace, 2026-10-25):
- `npm run verify` on the final tree → exit 0: lint, typecheck, Vitest 27 files / 440 tests, build,
  Playwright 30 tests (desktop + mobile).
- `apps/api/test/clinical.test.ts`: 25 tests — lifecycle, validation, idempotency, real parallel
  concurrency (create, save vs finalize, two tabs, parallel finalize, addendum retries, suspension
  race), access per role, cross-organization tampered ids, suspension / branch scope / profile
  deactivation, author mismatch, in-transaction recheck, audit privacy, read dedupe.
- Authorization matrix: 3 clinical actions × 5 roles. Web: `Clinical.test.tsx` 6 tests.
  `e2e/clinical.spec.ts`: full flow with other roles, late entry + patient timeline, two-tab
  conflict in English, mobile layout.
- Mutation checks (11, each breaking one safeguard, all caught by the tests): practitioner, branch,
  author and active-membership checks; clinical permission granted to owners/admins; version check
  on save; finalized-record guard; addendum key reuse; finalization minimum; clinical text in audit;
  documentation status to receptionists.

Remaining / limitations: clinician review (Q6); no delegation, cover or break-glass access; no
audit viewer or retention policy; legal review of clinical record keeping; data residency and
encryption decisions; free text only.

## Phase 4 — public website, solution selection, specialty-aware onboarding (in review)

### Implemented

- Public website separate from the workspace: home, solutions (dentistry, physiotherapy, ENT,
  multi-specialty centers), solution detail pages (what works today vs planned tools), SaaS vs
  custom-project explanation, custom-project request form. Arabic default, English, mobile.
- "Create your clinic workspace" → `/start` → registration or sign-in → resumable onboarding
  (type, explicit time zone, specialties, first branch and its specialties, review) → workspace.
  The pre-selected specialty survives registration and sign-in. Existing members see their
  workspaces first; onboarding never changes an existing organization.
- Specialty model: organization specialties, branch subsets, practitioner consistency, explicit
  setup for organizations created earlier, serialization on `configVersion`, defensive booking
  check ([architecture/SPECIALTIES.md](architecture/SPECIALTIES.md)).
- Workspace specialty context: overview per branch, a view filter that only narrows, setup prompt
  for owners of unconfigured organizations.
- Custom-project inquiries: write-only public endpoint, idempotent, rate limited; operator review
  script with masked contact details ([architecture/INQUIRIES.md](architecture/INQUIRIES.md)).
- Route-level code splitting (public / account / workspace), SEO foundations with
  environment-controlled indexing, hardened post-login redirect validation
  ([architecture/PUBLIC_SITE.md](architecture/PUBLIC_SITE.md)).

### Test evidence

- `npm run verify` in the Codespace on `b5a0fa5`: lint, typecheck, **390 Vitest tests (24 files)**,
  build without the chunk-size warning, **25 Playwright tests** (desktop + Pixel 7).
- GitHub Actions `verify` passed on `b5a0fa5`
  ([run 39472576893](https://github.com/mostafaapozena/clinc-saas/actions/runs/39472576893));
  see the PR checks for the latest commit.
- Mutation checks (each reverted): a specialty filter that ignores the doctor restriction, a
  missing configuration lock, onboarding completion without its replay check, and the old
  `safeNext` each make their tests fail.
- Bundles: shared framework ≈ 219 kB + 280 kB (≈ 157 kB gzip), public 21 kB, account 17 kB,
  workspace 95 kB; previously one 557 kB chunk.
- **Private preview verified 2026-10-24** through `https://<codespace>-5173.app.github.dev` with
  headless Chromium **inside the Codespace** (not the owner's browser), after a non-destructive
  re-seed: public home Arabic/RTL/Alexandria and `noindex`; `robots.txt` `Disallow: /`, no sitemap,
  `X-Robots-Tag: noindex`; physiotherapy solution → registration → onboarding with the
  pre-selection, reload resumed at the review step → medical center with two specialties created
  → workspace with specialty overview and switcher; signed-in `/start` showed the existing
  workspace; custom request stored (`R-FQJQ2XT3`, listed by the review script with the contact
  masked) and no read endpoint; regression in a fresh organization: patient with Arabic digits →
  book → check in → doctor started and completed (registry `403` for the doctor) → book,
  reschedule and cancel; direct sign-in from the public site; viewer `403` on lists; organization
  switch without leftovers; legacy-organization setup prompt; English LTR/Inter; phone width
  without horizontal scroll and a working menu; no console errors.

### Known limitations

- Public copy is provisional until the owner approves it in PR #5.
- Public pages are client-rendered; prerendering and the final domain are decided before
  indexing is enabled. A production web host must send `X-Robots-Tag` for non-public
  environments itself.
- Inquiry retention is a proposal, not automated; no operator console; no messages are sent.
- No plans, prices, trial or subscription states exist; onboarding is the place where they will
  attach (phase 8).

The stack was merged with merge commits in order. #2 and #3 were retargeted to `main` after
their base merged and brought up to date with GitHub's update-branch (a merge, no force-push);
CI passed on each updated head before its merge (`b0464b8`, `09ee4e1`), and both updates
changed no files relative to the reviewed heads. The phase branches still exist.

## Integration checkpoint (2026-10-20)

- `main` at `ab0551a`: push CI passed
  ([run 39455829903](https://github.com/mostafaapozena/clinc-saas/actions/runs/39455829903)).
  Its tree is identical to the reviewed phase 3 head.
- `npm ci` + `npm run verify` on `main` in the Codespace: lint, typecheck, 325 Vitest, build,
  17 Playwright — all passed.
- Private preview on `main` (headless Chromium **inside the Codespace**, not the owner's browser):
  new organization → receptionist creates patient (Arabic digits) → books from server slots →
  checks in → doctor starts and completes → receptionist logs out (protected API then `401`);
  branch-limited receptionist asking for another branch's patients `404`; the same user asking for
  another organization's patients and appointments `404`; viewer `403` on lists, `200` on
  counts; seeded admin booked, rescheduled and cancelled; Arabic RTL/Alexandria, English
  LTR/Inter, language kept after reload; organization switch showed no names from the previous
  organization; phone width without horizontal scroll; no console errors. The run added synthetic
  records to the development database (a new organization, one cancelled booking for a seeded
  patient); nothing was reseeded.
- Warnings assessed (see PRODUCT_INVENTORY.md §5): `MaxListenersExceededWarning` is a supertest
  harness diagnostic with no product impact, kept as documented debt; the 557 kB bundle warning is
  scheduled for phase 4 code splitting.

## Phase 1 — foundation (done)

Monorepo, Codespaces devcontainer, Express + MongoDB API with health check, React web app,
Vitest + Playwright, GitHub Actions CI, ruleset requiring `verify` on `main`.

## Phase 2 — authentication, organizations, tenant isolation, bilingual shell (done, merged)

Email/password auth with server-side sessions and CSRF, organizations/branches/memberships, a
central permission matrix for five roles, tenant isolation on every org-scoped request, team
management, bilingual shell (Arabic/RTL/Alexandria, English/LTR/Inter). Details:
[architecture/AUTH.md](architecture/AUTH.md), [architecture/TENANCY.md](architecture/TENANCY.md).

## Phase 3 — patients, schedules, appointments, check-in, daily queue (done, merged)

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

- `npm run verify` passes in the Codespace (2026-10-20, second session): lint, typecheck,
  **325 Vitest tests** (299 API integration/unit, 26 web) and **17 Playwright tests** (15 desktop,
  2 Pixel 7 mobile).
- GitHub Actions `verify` passes on PR #3; see the PR checks for the latest commit.
- Highlights: Cairo DST gap and repeated hour (unit + API); adjacent vs overlapping bookings;
  practitioner conflicts across branches proven at the reservation layer; patient conflicts
  without leaking details; **real concurrency** (8 simultaneous conflicting bookings → exactly one;
  concurrent reschedules; idempotency burst; concurrent status changes; 12 concurrent patient
  creations → unique numbers); injected mid-transaction failure leaves nothing behind; every valid
  and invalid state transition; queue ordering; dashboard counts per role and branch; role × action
  matrix for all new actions; cross-organization id tampering in paths and bodies; branch-restricted
  lists/search/counts/availability/history/queue; doctor-only visibility; viewer aggregates only;
  immediate effect of suspension and role changes.
- **Schedule change vs booking races** (`schedule-races.test.ts`, added in the review session):
  booking against a working-hours change, a deactivation and a registration archive, each forced
  in both orders by holding the first transaction open after its serializing write. Never both
  succeed.
- **Idempotent replay before validation** (fix in the review session): a retried booking used to
  re-run the booking checks first, so a retry after the booked start (or after archiving) got an
  error instead of its appointment. The key is now checked first; tested in
  `appointments.test.ts`.
- Mutation checks: removing the patient branch-scope filter failed 4 isolation tests; skipping the
  practitioner reservation failed 7 booking/concurrency tests; replacing the booking's
  serializing writes with reads failed all 6 race tests (all reverted).
- A `MaxListenersExceededWarning` from parallel supertest requests appears in the API test output
  (also on the unchanged phase 3 base); it is a test-harness warning, not a failure.
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
- **Preview re-verified** (2026-10-20, review session, commit `783f5b9`) the same way: a new
  organization set up through the preview's API, receptionist UI create (Arabic-digit phone →
  `+20…`) → book from server slots → check in; doctor queue → start → complete; doctor registry
  `403`; seeded admin book → reschedule → cancel with reason; Arabic `rtl`/Alexandria, English
  `ltr`/Inter, language kept after reload; viewer `403` on patients/appointments/queue and `200` on
  dashboard; Pixel 7 queue without horizontal scroll; no console errors. Headless, inside the
  Codespace — not the owner's browser.

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
- Clinical records: clinician review, legal review of record keeping, delegation/break-glass policy,
  clinical audit viewer and retention ([CLINICAL.md](architecture/CLINICAL.md#known-limitations-and-production-gates)).
- No specialty clinical tools, billing, subscriptions, payments, messaging or public booking exist.

## Next

Phase 4 (PR #5) and phase 5 (stacked on it) are in review. After both merge, the next phase in
[ROADMAP.md](ROADMAP.md) is phase 6 (specialty workspaces), which needs clinician input first.
The full remaining order (specialty workspaces, clinic finances, platform subscriptions, launch
readiness) is in
[ROADMAP.md](ROADMAP.md). Hosting, email, legal and clinical-advisor decisions run on a parallel
owner-led decision track ([DECISIONS.md](DECISIONS.md) §4).

## Blockers

PR #5 waits on the owner's review of the public copy. Phase 5 waits on owner review and a
clinician reviewer (Q6, [CLINICIAN_REVIEW.md](CLINICIAN_REVIEW.md)); merge order: #5 first, then
retarget the phase 5 PR to `main`. Later phases depend on the open
questions and external setup in DECISIONS.md.
