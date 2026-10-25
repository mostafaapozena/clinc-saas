# Progress

_Last updated: 2026-10-26 (phases 4–5 in review; platform completion milestone 1 in review)._

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
| Scalability & subscriptions checkpoint | _(to be opened)_ | — | Open, `phase-12/scalability-subscriptions` → `phase-11/acceptance` (stacked); awaiting review; not merged |
| M6 — integrated acceptance | [#12](https://github.com/mostafaapozena/clinc-saas/pull/12) | — | Open, `phase-11/acceptance` → `phase-10/support-operations` (stacked); awaiting review; not merged |
| M5 — support & operations | [#11](https://github.com/mostafaapozena/clinc-saas/pull/11) | — | Open, `phase-10/support-operations` → `phase-9/subscriptions-operator` (stacked); awaiting review; email via development sink only; not merged |
| M4 — subscriptions & operator console | [#10](https://github.com/mostafaapozena/clinc-saas/pull/10) | — | Open, `phase-9/subscriptions-operator` → `phase-8/clinic-finance` (stacked); awaiting review; payments simulated, enforcement off; not merged |
| M3 — clinic finances | [#9](https://github.com/mostafaapozena/clinc-saas/pull/9) | — | Open, `phase-8/clinic-finance` → `phase-7/specialty-workspaces` (stacked); awaiting review; tax/e-invoicing not included; not merged |
| M2 — specialty workspaces | [#8](https://github.com/mostafaapozena/clinc-saas/pull/8) | — | Open, `phase-7/specialty-workspaces` → `phase-6/clinical-continuity` (stacked); awaiting review and clinician review; not merged |
| M1 — clinical coverage & audit view | [#7](https://github.com/mostafaapozena/clinc-saas/pull/7) | — | Open, `phase-6/clinical-continuity` → `phase-5/visit-records` (stacked); awaiting review and decision Q17; not merged |

## Scalability and subscriptions checkpoint (in review)

Branch `phase-12/scalability-subscriptions` (PR _(to be opened)_), stacked on M6.

### What was delivered

- **Shared rate limits.** Counters live in MongoDB and fail closed; sign-in and recovery also have
  per-account limits.
- **Multi-replica checks.** Two app instances in tests, and a two-process script (8/8).
- **Load harness, explain scripts and profiler pass**, which found and fixed five defects:
  - S1: unbounded counts;
  - S2: substring search;
  - S3: cross-tenant plan cache;
  - S4: unbounded transaction retries;
  - S5: unusable partial idempotency index.
- **Measured throughput** on the 2-vCPU Codespace (1 replica):
  - before the fixes, 52.7% failures at 20 rps;
  - after, about 120 rps with p95 448 ms and 0 failures.
  A second replica on the same host adds no capacity.
- **Subscription lifecycle:** trials, grace policy, plan-change and cancellation requests as local
  intent, and an idempotent lifecycle pass, in the UI and the operator console.

### Documents

[SCALABILITY_REVIEW.md](architecture/SCALABILITY_REVIEW.md),
[LOAD_TESTING.md](operations/LOAD_TESTING.md), [COMPLETION_ASSESSMENT.md](COMPLETION_ASSESSMENT.md).

### Behavior changes

- Patient name search is word-prefix.
- Lists show "more than 1,000".
- Run the patient-search backfill on existing data.

## Platform completion — milestone 6: integrated acceptance (in review)

Branch `phase-11/acceptance` (PR [#12](https://github.com/mostafaapozena/clinc-saas/pull/12)), stacked on milestone 5.
[ACCEPTANCE.md](ACCEPTANCE.md) maps the ten browser journeys of the brief to tests (language and
device per journey); [COMPLETION_MATRIX.md](COMPLETION_MATRIX.md) states every capability as
implemented and verified, simulated, awaiting credentials or decision, or deferred — nothing is
sandbox-verified because no provider accounts exist.

New `e2e/acceptance.spec.ts`: J2 (new patient → booking → arrival → dentistry record finalized;
the desk sees status only), J6 (operator inquiry handling with audited reveal, no clinic routes),
J7 (invitation → registration from the mail-sink link → membership with the invited role), J10
(other organization, branch, role and console boundaries, in English), J9 (mobile pages). Bug
found and fixed: the read-only invitation preview sat behind session CSRF, so a signed-in browser
opening a link before its token loaded got 403 (regression API test added).

Private preview (headless check from inside the Codespace, 2026-10-25, branch
`phase-11/acceptance`, ports private): 15/15 read-only checks passed — public home, API readiness,
owner subscription page (development grant, simulator labelled), help page (FAQ labelled as not
AI, no invented contact), finance and profile sessions, no tokens or clinical text in browser
storage, English subscription page (LTR), operator console overview and organization list,
operator session refused by tenant routes, development mail page, mobile help page without
horizontal scroll. The development database was seeded without `--reset` (manually created
records kept) with `BILLING_PROVIDER=simulator` and `MAIL_PROVIDER=dev_sink` in the Codespace
`.env` only. This is not a check in the owner's own browser.

## Platform completion — milestone 5: support and operational readiness (in review)

Branch `phase-10/support-operations` (PR [#11](https://github.com/mostafaapozena/clinc-saas/pull/11)), stacked on milestone 4. Design:
[SUPPORT.md](architecture/SUPPORT.md), [ACCOUNT_EMAIL.md](architecture/ACCOUNT_EMAIL.md),
[operations/RUNBOOK.md](operations/RUNBOOK.md).

Delivered: in-app support requests (tenant-isolated, conversation, statuses) and the operator
queue; static FAQ labelled as not AI; configured-only contact details; mail boundary with a
development sink; password recovery, email verification and invitations with hashed single-use
expiring tokens and non-enumerating responses; idle session timeout and session list; liveness and
readiness, graceful shutdown, log redaction, monitoring boundary; logical backup and a **restore
drill performed** into an isolated database (36 collections verified); non-destructive retention
report; dependency audit (one high advisory fixed in-range: body-parser 2.4.0); runbook and MFA
options. Also fixed: blank values in `.env` (e.g. `BILLING_SIMULATOR_SECRET=`) now count as unset.

Evidence (Codespace): `support-ops.test.ts` 16 tests; web `Support.test.tsx` 8 tests;
`e2e/support.spec.ts` 3 journeys (password reset via the mail sink with single-use link, support
request answered by an operator, mobile help page). Full `npm run verify` and CI: see the PR.

## Platform completion — milestone 4: subscriptions and operator console (in review)

Branch `phase-9/subscriptions-operator` (PR [#10](https://github.com/mostafaapozena/clinc-saas/pull/10)), stacked on milestone 3. Design:
[architecture/SUBSCRIPTIONS.md](architecture/SUBSCRIPTIONS.md),
[architecture/PLATFORM.md](architecture/PLATFORM.md).

Delivered: versioned plans without invented terms; development grants vs commercial
subscriptions; subscription state machine with history and platform audit; customer subscription
page; payment-provider boundary with a clearly labelled simulator (signed webhooks, ±300 s
tolerance, event-id dedupe in the applying transaction, out-of-order handling, reconciliation);
entitlement enforcement off/log/on (default off, B4); separate operator identity (accounts,
cookie, CSRF, idle timeout, CLI provisioning, platform_admin/support) and an operator console
(overview and health, organization metadata, plans, subscriptions, inquiries replacing the
script for daily work, operators, platform audit). No patient/clinical access, no impersonation.

Evidence (Codespace): `platform.test.ts` 21 tests (operator/tenant separation both ways, CSRF,
idle and suspension, role limits, metadata-only, plan versioning, grant state machine, owner-only
checkout priced from the plan, signature/timestamp/malformed rejection, 5 concurrent duplicate
deliveries → one applied, out-of-order ignored, lost webhook found and applied by reconciliation,
enforcement off/log/on, masked inquiries with audited reveal, CLI provisioning, production refuses
the simulator); web `Subscription.test.tsx` 8 tests; `e2e/subscription.spec.ts` 2 journeys
(desktop, Arabic → English; mobile support operator); 12/12 mutation checks caught. Bug found by a
web test and fixed: operator sign-in/out did not refresh the console (session query removed while
observed).

## Platform completion — milestone 3: clinic finances (in review)

Branch `phase-8/clinic-finance` (PR [#9](https://github.com/mostafaapozena/clinc-saas/pull/9)), stacked on milestone 2. Design:
[architecture/FINANCE.md](architecture/FINANCE.md).

Delivered: organization currency (EGP/SAR, once), branch-priced catalog, manual and
doctor-confirmed clinical charges (one per record item, no clinical text), draft → issued invoices
with discounts and atomic numbering, receipts with allocation, credit notes, refunds and
reversals, patient account and running statement, per-currency reports, printable ordinary
invoice and receipt, accountant role, synthetic seed catalog. Public wording updated (clinic
invoicing available; tax e-invoicing, insurance and online payments planned).

Evidence (Codespace): `finance.test.ts` 11 tests incl. parallel invoice claiming, parallel issue
numbering, racing allocations and credit notes, idempotency, immutability hooks, clinical-charge
rules, branch and organization isolation, statement = account balance; authorization matrix +7
finance actions × 6 roles; web `Finance.test.tsx` 6 tests (money parsing without floats, account
flows, issue confirmation, print labelling, doctor's confirmation); `e2e/finance.spec.ts` 3
journeys; 9/9 mutation checks caught. Bug found by e2e and fixed: the payment form kept a stale
"apply to" choice after an invoice was issued. Full `npm run verify` and CI: see the PR.

## Platform completion — milestone 2: specialty workspaces (in review)

Branch `phase-7/specialty-workspaces` (PR [#8](https://github.com/mostafaapozena/clinc-saas/pull/8)), stacked on milestone 1. Design:
[architecture/SPECIALTY_WORKSPACES.md](architecture/SPECIALTY_WORKSPACES.md).

Delivered: versioned templates stored with each record (dentistry, physiotherapy assessment /
session / discharge, ENT), validated by the record's own version; FDI tooth chart with per-visit
findings, procedures, plan items and later status changes; physiotherapy courses linked to real
appointments; ENT region fields; derived chart / plan / course views from finalized records only;
counts-only documentation summary on the home page; synthetic seed data; public wording now
describes the specialty tools as a first version pending clinician review.

Evidence (Codespace): `specialty-records.test.ts` 8 tests (template selection, unknown version
kept read-only, bounded input, chart history without overwrite, drafts excluded, plan references,
course references and goal notes, access incl. coverage, counts-only summary); web
`Specialty.test.tsx` 4 tests; `e2e/specialty.spec.ts` 3 journeys (dentistry, physiotherapy,
ENT); existing clinical e2e adapted (a physiotherapist's record is an assessment); 6/6 mutation
checks caught. Full `npm run verify` and CI: see the PR.

## Platform completion — milestone 1: clinical continuity (in review)

Plan: [PLATFORM_COMPLETION_PLAN.md](PLATFORM_COMPLETION_PLAN.md) (milestones 1–6, blocker register).
Branch `phase-6/clinical-continuity` (PR [#7](https://github.com/mostafaapozena/clinc-saas/pull/7)), stacked on `phase-5/visit-records`.

Delivered: clinical coverage grants (own records → colleague, one encounter or one patient, read or
author, ≤ 90 days, reason; revoke; expiry; branch/suspension enforced per request; covered addenda
under the covering doctor's name; grant write-lock against racing revocation), membership
capabilities (owner-assigned, audited, role-checked), metadata-only clinical audit view, the
clinical-lead path implemented but switched off (Q17/B1); web: share panel on the record,
Clinical coverage page, covered-record page, Clinical audit page, Team toggle; Arabic and English.
Bug found by the new e2e test and fixed: audit events stored without metadata crashed the view.

Evidence (Codespace): API `clinical-coverage.test.ts` 12 tests (incl. parallel revoke vs
addendum, idempotent parallel grants, cross-organization ids, lead switch); authorization matrix
+2 actions × 5 roles; web `Coverage.test.tsx` 8 tests; `e2e/coverage.spec.ts` (share → covered
access + addendum → revoke → refused; owner refused; admin with capability reads the audit without
clinical text); 10/10 mutation checks caught. Full `npm run verify` and CI: see the PR.

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
- A real email provider for verification, recovery and invitations (flows built; development sink only).
- MFA (options documented, not built).
- Shared rate-limit store for multiple instances; abuse monitoring.
- Audit viewer, retention and export; ownership transfer, organization deletion, member removal.
- Patient duplicate reconciliation policy; time-zone migration workflow.
- Independent security review / penetration test, including the concurrency design under load.
- Clinical records: clinician review, legal review of record keeping, delegation/break-glass policy,
  clinical audit viewer and retention ([CLINICAL.md](architecture/CLINICAL.md#known-limitations-and-production-gates)).
- No specialty clinical tools, billing, subscriptions, payments, messaging or public booking exist.

## Next

All six platform-completion milestones are open as stacked PRs (#7 → #12, on top of #5 and #6);
none is merged. Merge order: #5, #6, then #7 … #12, retargeting each to `main` after its base
merges. Owner decisions that unblock the remaining work are listed below and in
[COMPLETION_MATRIX.md](COMPLETION_MATRIX.md).

## Blockers

Owner decisions (see the blocker register in
[PLATFORM_COMPLETION_PLAN.md](PLATFORM_COMPLETION_PLAN.md)): B1 clinical-lead authority (Q17),
B2 clinician reviewers, B3 currency/tax/e-invoicing, B4 plans, prices and enforcement policy, B5
payment provider and sandbox credentials, B6 MFA policy, B7 email provider and sending domain, B8
hosting, residency and budget, B9 support channel and hours. Nothing in this repository is
production-ready or clinically validated.
