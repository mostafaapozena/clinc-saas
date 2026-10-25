# Platform completion plan

_Created 2026-10-25 from a gap audit of the repository (main `d8b93b9`, PR #5 `9257190`,
PR #6 `da0187e`, all CI green). Updated at every milestone boundary._ This plan turns the remaining
roadmap (phases 6–9 in [ROADMAP.md](ROADMAP.md)) into six reviewable milestones, each on its own
branch and stacked PR. **The platform is not complete until every acceptance criterion below is met
or explicitly deferred; nothing here is clinically validated or production-ready.**

Status vocabulary used everywhere: **Implemented and verified** · **Sandbox-verified** (a real
provider in test mode) · **Simulated** (a labelled development stand-in) · **Awaiting decision /
credentials** · **Deferred by agreement**.

## Gap audit (2026-10-25)

| Journey | What works today | Missing |
| ------- | ---------------- | ------- |
| A. Visitor | Public home, solution pages, registration, specialty-aware onboarding, custom-project inquiry (PR #5) | Final copy approval; prerendering/indexing (Q16); domain |
| B. Clinic | Branches, specialties, team roles, patients, schedules, booking, arrival, queue, general visit record with addenda (PR #6) | Clinical coverage when a doctor is unavailable; clinical audit view; specialty workspaces; services/prices, charges, invoices, payments, statements |
| C. Platform customer | Organization created without a plan (P5) | Plans/entitlements, trial and subscription state, enforcement, billing status, account/support screens |
| D. Platform operator | Inquiry review by CLI script only | Operator identity and console; organization overview; plan and subscription management; inquiry and support queues |
| E. Operations | Env validation, health check, graceful shutdown, CI, rate limits, redacted logs, session cookies | Readiness probe, idle sessions, password recovery / verification / invitations, MFA (none), backup + restore drill, migrations procedure, monitoring boundary, runbooks, retention configuration, dependency audit |

## Branches and PRs (stacked; never merged by the agent)

```
main ← #5 phase-4/public-onboarding ← #6 phase-5/visit-records
     ← M1 phase-6/clinical-continuity ← M2 phase-7/specialty-workspaces ← M3 phase-8/clinic-finance
     ← M4 phase-9/subscriptions-operator ← M5 phase-10/support-operations ← M6 phase-11/acceptance
```

When a base merges, the next PR is retargeted (`gh pr edit <n> --base <merged base's target>`),
its diff re-checked and CI re-run.

## M1 — Existing-work stabilization and clinical continuity

**Status: implemented and verified in the Codespace; PR [#7](https://github.com/mostafaapozena/clinc-saas/pull/7) in review.**

- **Outcome:** a patient's records stay reachable for care when their doctor is unavailable,
  through explicit, time-bounded, audited coverage — never through owner/admin status.
- **Scope:** coverage grants (grantor, grantee practitioner, scope = one patient or one encounter,
  read vs author, start/expiry, reason); author-initiated grants by the treating doctor; a
  **clinical-lead** capability that may grant on behalf of an unavailable doctor — implemented but
  **unassigned and switched off** until the owner decides (blocker B1); revocation; expiry;
  covering doctors write addenda / drafts under their own identity; a metadata-only clinical audit
  view for an explicitly authorized role; defect fixes found in #5/#6.
- **Dependencies:** PR #6.
- **Data/permissions:** new `clinical_coverage` collection; `clinical.coverage.grant` (doctor,
  own records only), `clinical.audit.read` (explicit capability, unassigned by default); access
  resolution extended in one place (`clinical-access.ts`). Owners/admins gain nothing.
- **Acceptance:** grant/revoke/expiry take effect on the next request; grantee scope limited to
  same organization, active practitioner, permitted branch; no self-grant; author and finalized
  content unchanged; every grant, revoke, expiry-based denial and covered read audited; audit view
  shows no clinical text.
- **Verification:** API tests incl. parallel revoke-vs-write, matrix rows, web tests, e2e
  (delegate → access → revoke), mutation checks.
- **External:** B1 decision (clinical-lead authority).

## M2 — Specialty workspaces (dentistry, physiotherapy, ENT)

**Status: implemented and verified in the Codespace (first version, pending clinician review); PR [#8](https://github.com/mostafaapozena/clinc-saas/pull/8) in review.**

- **Outcome:** each specialty documents its own work inside the shared encounter, with real,
  scoped dashboards.
- **Scope:** versioned specialty templates attached to encounters (`templateId@version`, stored
  with the record so later template changes never reinterpret history). Dentistry: FDI notation
  (ISO 3950) for permanent and primary teeth, interactive tooth selection, per-visit findings and
  procedures (append-only per tooth), treatment-plan items with status. Physiotherapy: initial
  assessment, functional limitations and goals as free text, treatment course with planned
  sessions linked to real appointments, per-session notes and progress text, discharge summary.
  ENT: structured history/examination sections per region (ear/nose/throat), assessment, plan,
  follow-up. Specialty dashboards with counts only.
- **Out of scope:** diagnoses or advice generated by software, named scoring scales, prescriptions,
  imaging/attachments, device integrations.
- **Dependencies:** M1 (access model).
- **Data/permissions:** specialty data is clinical data (same access rules, same draft/finalize/
  addendum lifecycle); dashboards for non-clinical roles show counts only.
- **Acceptance:** bounded schemas per template version; history preserved; sessions are real
  appointments; finalize/addendum rules identical to the general record; all templates labelled
  "pending clinician validation".
- **Verification:** template-version tests, per-specialty API/web tests, e2e per specialty.
- **External:** clinician validation per specialty (Q6, E5) before real use.

## M3 — Clinic financial operations

**Status: implemented and verified in the Codespace; PR [#9](https://github.com/mostafaapozena/clinc-saas/pull/9) in review. Tax / e-invoicing not included.**

- **Outcome:** the clinic prices its services, charges what was performed, issues invoices, takes
  partial or full payments and sees balances and statements.
- **Scope:** service catalog with branch prices; charges from appointments / performed services /
  confirmed treatment-plan items (explicit confirmation, no duplicates); draft → issued invoices
  with per-branch sequential numbers; payments with allocation; discounts (permissioned);
  reversals/credits/refunds as new records with reasons; patient statement; scoped reports;
  printable invoice and receipt (labelled "not a tax invoice").
- **Data/permissions:** integer minor units + explicit currency (proposal P9: one currency per
  organization, EGP or SAR — blocker B3 for confirmation); new `finance.*` permissions and an
  `accountant` role; doctors get no reports by default; finance roles get no clinical text.
- **Acceptance:** no floats; no mixed-currency sums; concurrent numbering and allocation safe
  (parallel tests); idempotent mutations; issued records immutable; over-allocation impossible.
- **External:** tax/VAT/e-invoicing requirements for Egypt and Saudi Arabia (Q9) — not claimed.

## M4 — SaaS subscriptions and platform administration

**Status: implemented and verified in the Codespace; PR _(to be opened)_ in review. Payments simulated only (B5); enforcement off (B4); trial/grace states not built (terms undecided).**

- **Outcome:** platform operators configure offerings; organizations see their plan, trial and
  billing status; entitlements are enforced consistently.
- **Scope:** offerings with versioned entitlements (draft/active/retired); subscription state
  machine (development grant, trialing, active, past_due, grace, restricted, cancelled);
  entitlement checks in API and web; customer subscription screen; payment-provider boundary with
  a **clearly labelled development simulator**, signed webhooks with replay protection and
  out-of-order handling, reconciliation; operator identity separate from tenant roles (no public
  registration; CLI provisioning; own sessions), operator console (organizations metadata,
  offerings, subscriptions, inquiries replacing the script, health), audited operator actions.
- **Data/permissions:** operators never browse patient or clinical data; no impersonation.
- **Acceptance:** no commercial terms invented (prices, trial length, limits stay unset or
  draft); restricted state never deletes data or hides historical clinical records (proposed
  read-only behavior documented — blocker B4 before commercial enforcement).
- **External:** payment provider and sandbox credentials (E3), offer decisions (Q10).

## M5 — Support and operational readiness

- **Outcome:** customers can ask for help in the app and reset their password; operators work a
  support queue; the platform has tested backups and runbooks.
- **Scope:** support requests with statuses and conversation, tenant-isolated, operator queue;
  static FAQ help (labelled as such — no AI); configuration-driven contact details; mail boundary
  with a **development mail sink** (verification, recovery, invitations; single-use expiring
  hashed tokens; non-enumerating responses); readiness endpoint; idle session timeout and
  session list; backup/restore tooling with a restore drill into an isolated database; migration
  procedure; monitoring boundary; retention configuration (no destructive jobs); dependency audit;
  deployment runbook; MFA options document (not enforced — blocker B6).
- **External:** email provider and domain (E2), support channel/hours (Q11), hosting/residency
  (E1), MFA policy (Q12).

## M6 — Integrated acceptance and delivery

- **Outcome:** the connected journeys run end to end in the private preview as the right roles.
- **Scope:** the browser journeys 1–10 of the brief, both languages, desktop and mobile;
  unauthorized attempts; completion matrix; final docs, inventory, decisions and handoff.

## Blocker register

| # | Blocks | Needed from | Status |
| - | ------ | ----------- | ------ |
| B1 | Enabling the clinical-lead authority (who may grant coverage when the treating doctor is unavailable) — Q17 | Owner decision | Open — implemented switched off |
| B2 | Real clinical use of any template | Practising clinicians per specialty (Q6, E5) | Open |
| B3 | Currency model (one per organization?), tax/VAT, e-invoicing | Owner + tax advice (P9, Q9) | Open — development uses one currency per organization |
| B4 | Access behavior in restricted/expired subscription states; trial length; prices | Owner (Q10, P10) | Open — nothing enforced commercially |
| B5 | Payment provider and sandbox credentials | Owner (E3) | Open — simulator only |
| B6 | MFA policy | Owner (Q12) | Open — not enforced |
| B7 | Email provider and sending domain | Owner (E2) | Open — development mail sink |
| B8 | Hosting, data residency, budget | Owner (E1, E7) | Open — no deployment |
| B9 | Support channel, hours, any chatbot scope | Owner (Q11) | Open — static FAQ only |
