# Roadmap

_Written 2026-10-20, after phases 1–3 were merged into `main` (`ab0551a`)._ What exists today:
[PRODUCT_INVENTORY.md](PRODUCT_INVENTORY.md). Decisions and open questions:
[DECISIONS.md](DECISIONS.md). The next phase in detail: [NEXT_PHASE_BRIEF.md](NEXT_PHASE_BRIEF.md).

This is a sequence of outcome-based phases, not a schedule. Each phase is one reviewable PR
(or a short stack), built on synthetic data, with `npm run verify` and CI green before merge.
No dates, prices or delivery promises are implied.

## Order and why

```
Phase 4  Public platform and specialty-aware onboarding      ← implemented, PR in review
Phase 5  Clinical foundation: encounters and clinical access  ← implemented, PR in review (clinician review pending)
Phase 6  Specialty workspaces: dentistry, physiotherapy, ENT  ← one slice per specialty
Phase 7  Clinic financial operations                          ← needs tax/legal validation
Phase 8  Platform subscriptions and operator administration   ← needs payment provider, terms
Phase 9  Launch readiness and pilot                           ← needs hosting, email, legal

Decision track (runs alongside, owner-led): hosting & residency, email provider,
legal/privacy review, clinical advisors, payment provider, pricing/trial terms.
```

- **Phase 4 first**: the internal operational workflow already works, and nothing external
  blocks a public site and onboarding. It also introduces the organization's **specialty
  selection**, which phases 5–6 need to decide which workspace to show.
- **5 before 6**: every specialty workspace stores clinical content, so the encounter model,
  versioning and clinical access rules must exist first.
- **7 after 5**: charges attach to delivered services (appointments or encounters); a dental
  procedure catalog may come from phase 6, so phase 7 starts with a generic service catalog.
- **8 after 4 and 7**: subscription entitlements gate features that must exist; the trial entry
  point is created in phase 4 without enforcement.
- **9 is a gate, not an afterthought**: much of it depends on decisions that should start now on the
  decision track. Pieces that need no external decision (session idle timeout, shared rate-limit
  store, audit viewer) may be pulled into earlier phases when convenient.

## Phase 4 — Public platform and specialty-aware onboarding

> **Status (2026-10-20):** implemented on `phase-4/public-onboarding`, PR in review with the
> public copy. Delivered as planned below, plus per-branch specialties (the phase 4 brief asked
> for them). Still open from this phase: owner review of the copy; prerendering and the final
> domain before indexing is enabled (DECISIONS.md Q16).

**User outcome.** A visitor understands what the platform offers per specialty, sees clearly what
is available today versus planned, and either starts a trial/registration or requests a custom
ownership project. A new organization records which specialties it practices (one or several) and
lands in its workspace. Existing users go straight to login.

- **In scope:** public home; solution catalog and detail pages for dentistry, physiotherapy, ENT
  and the shared clinic foundation; separate "custom ownership project" page and request form;
  trial/subscription entry point (no billing); specialty-aware onboarding with multi-specialty
  support; organization specialties in settings; existing-user login path; Arabic/English public
  pages; route-level code splitting (public vs workspace bundles).
- **Out of scope:** payments, plans, enforced trial expiry, clinical features, platform operator
  console, email delivery, final branding, SEO prerendering/server rendering.
- **Dependencies:** none external. Uses the existing auth, onboarding and specialty catalog.
- **Decisions needed:** how to label the trial entry point while terms are undecided; where
  ownership requests go; copy approval (see DECISIONS.md, Q1–Q4).
- **Role/data access:** public pages are anonymous and rate limited; ownership requests are
  platform data, not tenant data, and must not ask for patient information; organization
  specialties are managed by owners/admins.
- **Acceptance:** see [NEXT_PHASE_BRIEF.md](NEXT_PHASE_BRIEF.md).
- **Verification:** API tests for public endpoints (validation, rate limits, no tenant data);
  browser tests for each journey in both languages and at phone width; check that signed-in users are
  not forced through marketing.

## Phase 5 — Clinical foundation: encounters and clinical access

**User outcome.** A doctor documents a visit in a structured encounter linked to the
appointment, saves drafts, finalizes it, and corrects it later through a versioned amendment.
Clinical content is visible only to roles granted clinical access.

- **In scope:** encounter record (generic sections agreed with clinicians); draft → finalized →
  amended states with immutable version history and author/time; clinical access model separate from
  administrative roles (an owner/admin who is not a clinician does not automatically read
  clinical notes); "break-glass" or delegated access only if the owner decides it is needed;
  audit of every clinical read and write; patient clinical timeline for authorized clinicians.
- **Out of scope:** specialty-specific charts and plans (phase 6); prescriptions and attachments
  unless explicitly decided; billing; patient portal.
- **Dependencies:** phase 4 (organization specialties); clinician advisors for content and
  terminology; decision on clinical access policy.
- **Decisions needed:** who may read/write clinical content (doctor of the visit, all doctors of
  the organization, branch doctors?); whether admins/owners can be granted clinical access and how
  it is audited; amendment rules; whether prescriptions and attachments enter this phase.
- **Role/data access:** new permission dimension ("clinical") separate from administrative
  permissions; receptionists and viewers never see clinical content; branch scope still applies.
- **Acceptance:** finalized encounters cannot be edited in place; every change produces a new
  version with author and time; unauthorized roles get the generic not-found response for clinical
  endpoints, including through search and counts; full isolation tests like phase 3.
- **Verification:** role × action matrix extended; version-history tests; isolation tests;
  browser tests of draft → finalize → amend; clinician review of the screens before merge.

## Phase 6 — Specialty workspaces: dentistry, physiotherapy, ENT

**User outcome.** Each specialty gets a workspace and dashboard suited to its daily work, on top
of the shared front desk and the phase 5 encounter. A multi-specialty center sees the right
workspace per practitioner/specialty.

- **In scope (one slice per specialty, each its own PR):**
  - Dentistry: candidate features such as tooth charting and treatment plans with stages. **To be
    validated by dentists.**
  - Physiotherapy: candidate features such as treatment plans with session counts and progress
    measures. **To be validated by physiotherapists.**
  - ENT: candidate features such as structured examination findings. **To be validated by ENT
    clinicians.**
  - Specialty dashboards built from real records only.
- **Out of scope:** radiology and other complex specialties (custom track); imaging viewers;
  device integrations; billing (phase 7).
- **Dependencies:** phase 5; clinician validation per specialty; decision on attachments if a
  slice needs images.
- **Decisions needed:** the minimum viable workflow per specialty and its terminology in Arabic and
  English; which specialty slice goes first.
- **Role/data access:** inherits the phase 5 clinical model; specialty data is clinical data.
- **Acceptance:** per slice, defined with clinicians before implementation; no feature shown
  that does not work.
- **Verification:** domain tests per slice; browser tests; clinician walkthrough on synthetic
  data.

## Phase 7 — Clinic financial operations

**User outcome.** The clinic records what it charges for, issues invoices, records payments and
sees outstanding balances, with financial permissions and branch reports.

- **In scope:** service catalog with prices per organization (and branch overrides if decided);
  charges linked to appointments/encounters; invoices with immutable numbering; payments (cash,
  card recorded manually), refunds/voids as reversing entries; patient balances; financial
  permissions (e.g. a cashier or accountant role); daily/branch reports; audit.
- **Out of scope:** platform subscription billing (phase 8); online card processing for patients;
  insurance claims unless decided; e-invoicing integration until requirements are confirmed.
- **Dependencies:** phase 5 (charges per encounter) or phase 3 (per appointment) for a first cut;
  tax/legal validation for Egypt and Saudi Arabia.
- **Decisions needed:** currency per organization or per branch (EGP, SAR); tax treatment;
  invoice numbering scope; whether e-invoicing integration is required at launch; new financial
  roles.
- **Role/data access:** financial data visible only to financial permissions; doctors see what the
  owner decides; viewers aggregate only.
- **Acceptance:** money amounts stored as integers in minor units; no hard deletes; every
  correction is a reversing entry; totals reconcile in tests; concurrency-safe numbering.
- **Verification:** ledger/reconciliation tests, numbering concurrency tests, permission matrix,
  isolation tests, browser tests.

## Phase 8 — Platform subscriptions and operator administration

**User outcome.** Organizations start a trial, choose a plan and pay the platform; platform
operators manage tenants and support requests from a console isolated from tenant roles.

- **In scope:** plans and entitlements (feature flags per plan); trial lifecycle; subscription
  states (trialing, active, past due, cancelled, expired) and the access behavior for each
  (e.g. read-only grace; never data deletion without a defined policy); payment-provider checkout
  and verified, idempotent webhooks; platform operator roles and console (separate authentication
  scope and audit); support intake with the approved support hours; review of phase 4 ownership
  requests.
- **Out of scope:** chatbot (until scoped); clinic financial operations (phase 7).
- **Dependencies:** payment provider account; prices, plans and trial terms; phase 4 entry points.
- **Decisions needed:** provider; currencies; trial length; what each plan includes; access behavior
  per state; support hours and channel; whether a chatbot is wanted and its limits.
- **Role/data access:** platform operators do not get tenant data by default; any support access
  to a tenant is explicit, time-bound and audited.
- **Acceptance:** webhook replay and signature tests; state-machine tests; entitlement checks
  enforced in the API; operator actions audited.
- **Verification:** provider sandbox only; no real charges.

## Phase 9 — Launch readiness and pilot

**User outcome.** A first clinic can use the product with real data under approved hosting,
security and operational procedures.

- **In scope:** email verification, password recovery, invitations; MFA according to the decided
  policy; idle timeout and session management; shared rate-limit store; staging and production
  environments; backups with tested restores; monitoring, alerting, runbooks, incident response;
  security review and fixes; privacy notice and terms as approved; data export for the clinic;
  pilot acceptance criteria and feedback loop.
- **Out of scope:** features not needed by the pilot.
- **Dependencies:** hosting and residency decision; email provider; legal review; budget approval.
- **Decisions needed:** all items in DECISIONS.md "External setup".
- **Acceptance (pilot gate, proposed):** restore drill passed; security review findings of high
  severity closed; monitoring alerts tested; signed-off privacy documents; pilot clinic's workflow
  run end to end on staging.
- **Verification:** restore drill, security review report, staging smoke tests, pilot checklist.

## Separate track — custom ownership delivery

Handled commercially and per project. Phase 4 only collects requests. Whether a custom project
reuses this codebase, and how, is decided per project; nothing here commits the SaaS to radiology
or to any existing ownership solution.
