# Product inventory

_State of `main` at `ab0551a` (phases 1–3 merged), checked 2026-10-20._

Status meanings:

- **Implemented and verified**: in `main`, covered by automated tests, and exercised through the
  private preview.
- **Partial**: some of it exists; the gap is named.
- **Planned**: on the [roadmap](ROADMAP.md), nothing built.
- **Blocked**: needs an external dependency or an owner decision first ([DECISIONS.md](DECISIONS.md)).

All data in every environment is synthetic. Nothing has been deployed beyond the private
development Codespace.

## 1. Public website and acquisition journey

| Capability | Status | Notes |
| ---------- | ------ | ----- |
| Public home page | Planned | `/` redirects to `/app`; there is no marketing or landing page. |
| Solution / specialty catalog and detail pages | Planned | `GET /api/v1/specialties` returns a reference list (dentistry, physiotherapy, ENT); no page presents solutions. |
| Choose trial / subscription | Planned | No plans, prices or trial exist. Terms are undecided. |
| Request custom ownership delivery | Planned | No request form or intake storage. |
| Registration | Implemented and verified | Email + password; one account can belong to several organizations. |
| Direct login for existing users | Implemented and verified | `/login` → last workspace; nothing forces the user through marketing. |
| Organization onboarding | Partial | Creates organization, first branch and **explicit time zone**. No specialty selection, no plan/trial state. |
| Honest capability presentation | Planned | Requires the public pages. |

## 2. Subscription SaaS application (authenticated clinic workspace)

### Shared operational foundation

| Capability | Status | Notes |
| ---------- | ------ | ----- |
| Sessions, CSRF, origin checks, auth rate limiting | Implemented and verified | Server-side revocable sessions; rate limit is in-memory per instance. |
| Organizations, branches (create, rename, deactivate) | Implemented and verified | |
| Team: add existing accounts by email, roles, branch scope, suspend | Implemented and verified | No invitations (no email provider). |
| Five roles with a central permission matrix | Implemented and verified | Owner, admin, doctor, receptionist, viewer. Matrix in [architecture/TENANCY.md](architecture/TENANCY.md). |
| Tenant and branch isolation | Implemented and verified | Enforced in the API and tested (cross-org ids, tampered ids, branch-limited staff, counts and searches). |
| Organization and branch switching without stale data | Implemented and verified | |
| Arabic default (RTL, self-hosted Alexandria), English (LTR, self-hosted Inter), persisted choice | Implemented and verified | |
| Mobile layouts for the front desk | Implemented and verified | Queue, appointments and patients tested at phone width. |
| Patient registry (administrative data only) | Implemented and verified | Organization identity, branch registrations, number, name, phones (E.164), optional email, date of birth, administrative sex, address. **No clinical data.** |
| Duplicate warnings within the caller's scope | Implemented and verified | Merging/reconciliation is not built. |
| Practitioner scheduling profiles, weekly hours, date exceptions | Implemented and verified | Profiles carry a specialty code; that is a label, not a specialty workspace. |
| Availability, booking, rescheduling, cancellation, no-show | Implemented and verified | Concurrency-safe reservations, idempotent booking. See [architecture/SCHEDULING.md](architecture/SCHEDULING.md). |
| Check-in, daily queue, start/complete visit | Implemented and verified | **Start/complete changes appointment status only. No visit record or clinical documentation exists.** |
| Today's counts on the home page | Implemented and verified | Scoped per role; viewers get aggregates only. |
| Audit events | Partial | Written for administrative changes; no viewer, export or retention policy. |
| Organization time-zone change with future appointments | Partial | Refused until a migration workflow exists. |
| Patient duplicate merge | Planned | Owner decision needed on who may reconcile. |
| Reminders / notifications to patients | Blocked | No messaging channel chosen. |
| Public (patient-facing) online booking | Planned | Out of scope so far. |

### Clinical foundation and specialty experiences

| Capability | Status | Notes |
| ---------- | ------ | ----- |
| Encounter / visit record | Planned | Nothing stores clinical content. |
| Clinical access rules distinct from administrative access | Planned | Today owners/admins can see administrative patient data; no clinical data exists to protect yet. |
| Dentistry workspace (e.g. charting, treatment plans) | Planned | Requires clinician validation. Not implied by the specialty name in the catalog. |
| Physiotherapy workspace (e.g. treatment plans, session tracking) | Planned | Requires clinician validation. |
| ENT workspace | Planned | Requires clinician validation. |
| Prescriptions | Planned, decision required | Regulatory review required before design. |
| Medical attachments / files | Planned, decision required | Needs storage, retention and hosting decisions. |
| Radiology and other complex specialties | Not in the SaaS | Custom-project candidates only. |

### Clinic financial operations

| Capability | Status | Notes |
| ---------- | ------ | ----- |
| Service catalog and prices | Planned | |
| Charges, invoices, payments, balances | Planned | |
| Financial permissions and reports | Planned | |
| Tax / e-invoicing obligations (Egypt, Saudi Arabia) | Blocked | Needs authoritative tax/legal validation before design. |

### Platform subscriptions and administration

| Capability | Status | Notes |
| ---------- | ------ | ----- |
| Plans, entitlements, trial lifecycle, subscription states | Planned | Prices, plans and trial length are undecided. |
| Payment provider and webhooks | Blocked | Provider not chosen. |
| Platform operator console (isolated from tenant roles) | Planned | No platform-level roles exist; all roles are tenant roles. |
| Support intake | Planned | Support hours and channel undecided. |
| Chatbot | Not planned yet | Scope must be defined before it is considered. |

## 3. Custom ownership delivery

A separate commercial and delivery track. Nothing in the repository implements it, and it is not
part of the subscription SaaS. Terms, scope and whether it reuses this codebase are undecided.
Radiology and similar systems belong here as candidates, not in the SaaS.

## 4. Launch readiness

| Capability | Status | Notes |
| ---------- | ------ | ----- |
| CI on every PR and on `main`; ruleset requires `verify` | Implemented and verified | |
| Email verification, password recovery, invitations | Blocked | No email provider. |
| MFA | Decision required | Policy undecided (who, when, which factor). |
| Idle session timeout, session management UI | Planned | Absolute expiry only. |
| Shared rate-limit store | Planned | Needed once more than one API instance runs. |
| Hosting, data residency, staging/production | Blocked | Undecided for Egypt and Saudi Arabia. |
| Backups and restoration tests, monitoring, runbooks | Blocked | Depends on hosting. |
| Security review / penetration test | Planned | Before any real data. |
| Privacy notice, terms, regulatory review | Blocked | Needs authoritative legal input. No compliance is claimed. |

## 5. Known technical debt

| Item | Impact | Plan |
| ---- | ---- | ---- |
| `MaxListenersExceededWarning` in API tests | None on the product. Supertest 7.3.1 shares one `http.Server` per agent, and each request queued while it starts adds one-shot `listening`/`error`/`close` listeners (removed afterwards). Tests sending more than 10 simultaneous requests through one agent cross Node's default threshold. | Keep. Revisit if the test harness moves to one listening server per suite; do not raise the limit just to hide it. |
| Web bundle above Vite's 500 kB warning (557 kB, 164 kB gzipped, single chunk) | Slower first load on slow mobile networks; no functional effect. | Route-level code splitting in phase 4, where public pages and the workspace become separate route groups. |
| Name search is a scoped substring regex | Slows for very large registries. | Index-assisted search when real volumes are known. |
| Queue refreshes every 30 s | Up to 30 s delay between desks. | Push updates later if needed. |
