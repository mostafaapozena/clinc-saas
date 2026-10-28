# Completion matrix (as of the scalability/subscriptions checkpoint, 2026-10-25)

This matrix uses five states. It gives no percentages, and nothing here is "production-ready" or
"clinically validated".

| State | Meaning |
| ----- | ------- |
| **Implemented and verified** | Built and tested (unit, integration and browser) in the Codespace and in CI, on synthetic data. |
| **Sandbox-verified** | Exercised against a real provider's sandbox. **Nothing is in this state**: no provider accounts exist. |
| **Simulated** | Built behind a provider boundary and exercised with a clearly labelled local stand-in. |
| **Awaiting credentials or decision** | Blocked on the owner (B-numbers in [PLATFORM_COMPLETION_PLAN.md](PLATFORM_COMPLETION_PLAN.md)). |
| **Deferred** | Deliberately out of scope for now. |

## Clinic workspace (tenant)

| Capability | State | Notes |
| ---------- | ----- | ----- |
| Registration, organizations, branches, team, roles and branch scope | Implemented and verified | |
| Specialty-aware onboarding (multi-specialty) | Implemented and verified | |
| Patients, schedules, booking, check-in, queue | Implemented and verified | Name search is word-prefix since the scalability review (S2) |
| Visit records (treating doctor), finalize, addenda | Implemented and verified | Clinician review pending (B2) |
| Clinical coverage between doctors, metadata-only clinical audit | Implemented and verified | |
| Clinical-lead authority | Awaiting decision (B1) | Built and switched off |
| Dentistry, physiotherapy and ENT workspaces (first version) | Implemented and verified | Pending clinician review (B2). No generated diagnoses. |
| Clinic finances: catalog, charges, invoices, receipts, credit notes, refunds, statement, reports, printouts | Implemented and verified | Not tax invoices. Tax and e-invoicing await B3. |
| Insurance, online patient payments | Deferred | |
| Subscription page (grant or commercial status, usage, plans) | Implemented and verified | |
| Help and support: static FAQ (not AI), support requests | Implemented and verified | Contact details and hours await B9 |
| Invitations, password recovery, email verification | Implemented and verified (flows) · **Simulated** (delivery: development mail sink) | Real email awaits B7 |
| Session list, idle timeout | Implemented and verified | The 120-minute default needs confirming |
| MFA | Awaiting decision (B6) | Options documented, not built |
| Prescriptions, attachments, reminders, public booking | Deferred | |

## Platform (operators)

| Capability | State | Notes |
| ---------- | ----- | ----- |
| Separate operator identity, CLI provisioning, roles, platform audit | Implemented and verified | No operator MFA (B6) |
| Organization metadata, inquiries (masked, audited reveal), support queue | Implemented and verified | No patient or clinical access, no impersonation |
| Plans (versioned, draft/active/retired) and development grants | Implemented and verified | No prices or limits decided (B4) |
| Commercial subscriptions and payments | **Simulated** | Signed webhooks, replay protection, out-of-order handling and reconciliation all run against the simulator. A real provider awaits B5. |
| Entitlement enforcement | Implemented and verified · **off** by default | Turning it on awaits B4 |
| Trials, grace policy, plan-change and cancellation requests, lifecycle pass | Implemented and verified (configuration unset; provider effects **simulated**) | Terms (trial length, grace, enforcement) still decision B4 |

## Operations

| Capability | State | Notes |
| ---------- | ----- | ----- |
| Env validation, readiness and liveness, graceful shutdown, log redaction | Implemented and verified | |
| Monitoring | Implemented (boundary, log only) | An external service awaits E7 and B8 |
| Backup and restore | Implemented and verified; **drill performed** on synthetic data in an isolated database | Schedule, off-site storage and RPO/RTO await B8 |
| Retention | Implemented (configuration plus a read-only report) | Periods await E4. Nothing is deleted. |
| Dependency audit | Performed: 1 high fixed in range, then 0 | |
| Rate limits | Implemented and verified, **shared across replicas** (MongoDB, fail closed) | Tested with two processes on one host |
| Load and multi-replica behavior | Measured on one 2-vCPU host: about 120 rps, p95 under 0.5 s, 0 failures, after fixing S1–S5 ([LOAD_TESTING.md](operations/LOAD_TESTING.md)) | Horizontal scaling not measured |
| Hosting, production deployment | Awaiting decision (B8) | No deployment was made |

## External integrations

| Integration | State |
| ----------- | ----- |
| Payment provider | **Simulated**. No provider and no credentials (B5). |
| Email provider | **Simulated** (development mail sink). No provider, domain or credentials (B7). |
| SMS / WhatsApp | Deferred. Nothing built. |
| Monitoring / alerting service | Awaiting decision (E7). |
| Hosting / managed database | Awaiting decision (B8). |
