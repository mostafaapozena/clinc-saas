# Decision register

_Updated 2026-10-20._ Four lists: what the owner has confirmed, what engineering recommends
(not approved), open product questions, and external setup. A proposal becomes a decision only when
the owner confirms it; record the date when that happens.

Nothing here is legal, medical, tax or regulatory advice. Items marked **needs authoritative
validation** must be checked by a qualified professional for Egypt and Saudi Arabia.

## 1. Confirmed requirements

| # | Requirement | Source |
| - | ----------- | ------ |
| C1 | Markets: Egypt and Saudi Arabia. | Owner briefs |
| C2 | Arabic default, RTL, self-hosted Alexandria; full English, LTR, self-hosted Inter. | Owner briefs |
| C3 | Customers: individual clinics, medical centers, multi-branch organizations. | Owner briefs |
| C4 | Strict tenant and branch isolation. | Owner briefs |
| C5 | Shared operational foundation plus specialty-specific experiences for dentistry, physiotherapy and ENT. | Owner briefs |
| C6 | Radiology and similar complex specialties are custom-project candidates, not SaaS modules. | Owner briefs |
| C7 | Ownership delivery is a separate commercial and delivery track. | Owner briefs |
| C8 | Subscriptions and a free trial are part of the commercial concept. | Owner briefs |
| C9 | Target journey: public home → solution/specialty selection → solution details → trial/subscription or custom ownership request → registration → organization and specialty setup → workspace. | Owner brief (checkpoint) |
| C10 | Existing customers keep a direct login path and are not sent through marketing on every login. | Owner brief (checkpoint) |
| C11 | A medical center can practice several specialties; onboarding must not fix one specialty forever. | Owner brief (checkpoint) |
| C12 | Owners/admins do not automatically get unrestricted clinical-note access. | Owner brief (checkpoint) |
| C13 | Clinic finances are separate from platform subscription billing. | Owner brief (checkpoint) |
| C14 | Platform operator roles are isolated from tenant roles. | Owner brief (checkpoint) |
| C15 | MFA is a deliberate product/security decision, not yet mandatory for everyone. | Owner brief (checkpoint) |
| C16 | No invented prices, trial length, clinical requirements, delivery promises, company claims, testimonials or certifications. | Owner briefs |
| C17 | Synthetic data only until launch readiness; no production deployment without approval; preview ports private. | Owner briefs, AGENTS.md |
| C18 | Phase 3 front-desk policy (receptionist books and checks in; doctor starts/completes own visits; viewer sees aggregates). | Phase 3 brief; matrix in architecture/TENANCY.md |

## 2. Provisional recommendations (engineering proposals, not approved)

| # | Proposal | Why |
| - | -------- | --- |
| P1 | Next phase is **public platform and specialty-aware onboarding** (phase 4). | No external blocker; phases 5–6 need organization specialties. |
| P2 | Organizations hold a **list of enabled specialties** (one or more), editable by owners/admins later; branches may narrow it in a later phase. Practitioner profiles keep their own specialty, limited to the organization's list. | Supports C11 without per-branch complexity now. |
| P3 | Existing organizations get no specialties automatically; owners are prompted (not blocked) to choose. Demo seed sets them explicitly. | Avoid guessing from practitioner labels. |
| P4 | Public pages live in the same React app as a separate lazy-loaded route group; `/` shows the public home; signed-in visitors see a "go to my workspace" action instead of being redirected away. | Reuses i18n, fonts and auth; enables code splitting. SEO prerendering decided later. |
| P5 | Until trial terms exist, the entry point says "create your clinic workspace" (no length, no price) and organizations are created without a plan; no enforcement. | Satisfies C16 while keeping the journey testable. |
| P6 | Ownership requests are stored in the platform database as platform records (not tenant data), with a minimal set of fields and no patient data; reviewed through a developer script until the operator console exists (phase 8). | No email provider yet; avoids building platform roles early. |
| P7 | Specialty pages describe the shared features that work today and label specialty-specific features as "planned" without dates. | Honest presentation; C16. |
| P8 | Clinical access (phase 5) is a separate permission dimension granted per membership; owners/admins need explicit grant. | C12. |
| P9 | Money stored in integer minor units; one currency per organization at first (EGP or SAR). | Avoids rounding errors; simplest model. Needs owner confirmation. |
| P10 | Subscription states never delete tenant data automatically; expired subscriptions become read-only after a grace period to be defined. | Data safety. |

## 3. Unanswered product questions

Ordered by what blocks the next phase. Proposed defaults are proposals.

### Blocking phase 4

| # | Question | Proposed default |
| - | -------- | ---------------- |
| Q1 | How should the trial/subscription entry point be worded while prices and trial length are undecided? | P5: "create your clinic workspace" with no terms shown. |
| Q2 | Where should custom ownership requests go, and which fields may the form collect? | P6: stored in the database; fields: name, organization, country (EG/SA), specialties, number of branches, phone/email, free-text needs. |
| Q3 | Who approves public-page copy (feature descriptions, wording about the custom track)? | The owner reviews the copy in the phase 4 PR before merge. |
| Q4 | Product name to show on public pages. | Keep the temporary "منصة العيادات / Clinics Platform" marked as temporary. Not blocking. |

### Blocking later phases (answer before the phase starts)

| # | Question | Phase |
| - | -------- | ----- |
| Q5 | Clinical access policy: who reads/writes encounters; can owners/admins be granted clinical access; audit expectations. | 5 |
| Q6 | Which clinicians validate encounter content and each specialty workflow? | 5, 6 |
| Q7 | Are prescriptions and attachments in scope, and when? **Needs authoritative validation.** | 5, 6 |
| Q8 | Which specialty slice goes first? | 6 |
| Q9 | Currency per organization or branch; tax treatment; e-invoicing obligations. **Needs authoritative validation.** | 7 |
| Q10 | Plans, prices, trial length, access behavior per subscription state. | 8 |
| Q11 | Support channel and approved support hours; chatbot scope, if any. | 8 |
| Q12 | MFA policy (who, which factor, when enforced). | 9 |
| Q13 | Who may reconcile/merge duplicate patients across branches. | Any |
| Q14 | Messaging channel for reminders (and the consent rules). **Needs authoritative validation.** | Later |

## 4. External setup requirements

Owner-led; not needed for synthetic-data development, required before a pilot.

| # | Item | Needed by |
| - | ---- | --------- |
| E1 | Hosting provider and data-residency approach for Egypt and Saudi Arabia (in-country requirements, per-country deployments). **Needs authoritative validation.** | Phase 9 |
| E2 | Email provider and sending domain (verification, recovery, invitations). | Phase 9 (could be earlier) |
| E3 | Payment provider account(s) for platform subscriptions. | Phase 8 |
| E4 | Legal review: privacy notice, terms, health-data processing rules, retention. | Before public launch and phase 9 |
| E5 | Clinical advisors per specialty. | Phases 5–6 |
| E6 | Domain name and final branding. | Public launch (not phase 4 development) |
| E7 | Budget approval for any paid service (hosting, email, monitoring, security review). | Phase 9 |
