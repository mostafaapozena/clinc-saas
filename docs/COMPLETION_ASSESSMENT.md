# Completion assessment (2026-10-25, after the scalability and subscriptions checkpoint)

Any percentage here is **approximate**, and is weighted over the product scope agreed so far: the
brief's milestones M1–M6 plus this checkpoint. The scope excludes prescriptions, attachments,
insurance and public booking, which are deliberately out of scope.

Each section is assessed separately:
- **missing credentials** are not counted as missing code;
- **simulated code** is not counted as a working integration;
- **a passing test** is not counted as production readiness.

Details per capability are in [COMPLETION_MATRIX.md](COMPLETION_MATRIX.md).

## A. Functional implementation (agreed scope)

| Area | Weight | Status | Score |
| ---- | -----: | ------ | ----: |
| Tenancy, team, roles, onboarding, public site | 10 | Implemented and verified | 10 |
| Patients, scheduling, booking, queue | 15 | Implemented and verified (search changed to word-prefix) | 15 |
| Clinical records, coverage, clinical audit | 15 | Implemented and verified; clinical-lead built and switched off (decision) | 14 |
| Specialty workspaces (dental, physio, ENT) | 10 | First version implemented and verified; clinician validation pending | 9 |
| Clinic finances | 15 | Implemented and verified; no tax or e-invoicing (decision) | 13 |
| Subscriptions and operator console | 15 | Implemented and verified, including trials, grace policy, plan-change and cancellation requests; payments simulated | 14 |
| Support, account email, operations tooling | 10 | Implemented and verified; email delivery via the dev sink | 9 |
| Acceptance journeys 1–10 | 10 | Mapped and passing (automated, headless) | 10 |
| **Total** | **100** | | **≈ 94** |

**How to read the score.** "≈ 94" means the agreed features exist, are connected and are
tested. The missing points are features that wait on decisions:
- tax and e-invoicing;
- the clinical-lead authority;
- validated specialty templates.

It does **not** mean the product is 94% ready to sell.

## B. Verified integrations

| Integration | State |
| ----------- | ----- |
| Payment provider | **Simulated** (signed webhooks, replay and order handling, reconciliation, all against the simulator) |
| Email provider | **Simulated** (development mail sink) |
| Provider sandboxes | **None.** No accounts exist. |
| Live integrations | **None** |

**Verified real or sandbox integrations: 0 of 2 required.** The code boundaries are ready; the
credentials and decisions are missing (B5, B7).

## C. Structural and performance confidence

**Measured (evidence in [SCALABILITY_REVIEW.md](architecture/SCALABILITY_REVIEW.md) and [LOAD_TESTING.md](operations/LOAD_TESTING.md)):**
- **Correctness with two replicas.** It is proven with two real processes: shared rate limits,
  sessions, idempotency, webhook dedupe and concurrent booking.
- **Load test.** Five real defects (S1–S5) were found and fixed. Measured on one 2-vCPU host:
  about **120 requests/s with p95 under 0.5 s and no failures**, with a 50,000-patient tenant and
  19 small ones.
- **Not measured:**
  - separate hosts or horizontal scaling;
  - MongoDB on its own hardware;
  - failover;
  - tenants larger than 50,000 patients.

**Confidence: moderate.** No architectural rework is indicated. Capacity on real hosting is still
unmeasured.

## D. Production readiness

**Not production-ready.** The gates still open:
- hosting and data residency;
- real payment and email providers;
- MFA;
- clinician validation;
- legal review (privacy, retention, record keeping);
- tax and e-invoicing;
- a commercial policy (prices, trial, grace, enforcement);
- monitoring and alerting;
- encrypted off-site backups on a schedule;
- a penetration test;
- capacity testing on real hosting.

## Remaining effort (ranges; actual unfinished work only)

| Kind | Work | Range |
| ---- | ---- | ----- |
| Engineering | Real payment provider adapter and hosted checkout | 1–2 weeks after the provider is chosen |
| | Real email provider adapter | 2–4 days |
| | MFA (TOTP and recovery) | 1–2 weeks after the policy |
| | Tax and e-invoicing | 3–8+ weeks, depending on ETA/ZATCA requirements |
| | Deployment, monitoring and backup automation on the chosen hosting | 1–2 weeks |
| | Fixes from clinician and legal review | unknown until the reviews happen |
| External setup (owner) | Choose providers and open sandbox accounts | depends on the owner |
| | Domain and email authentication | depends on the owner |
| | Hosting and budget | depends on the owner |
| | Support channel | depends on the owner |
| Reviews and acceptance | Clinician review per specialty, legal review, a penetration test, and acceptance by real clinic staff on a pilot | weeks; depends on people outside engineering |
