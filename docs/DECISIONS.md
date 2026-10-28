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
| C19 | **Approved working default (phase 4, 2026-10-20):** the registration call to action is "أنشئ مساحة عمل لعيادتك" / "Create your clinic workspace", without prices or trial length. | Owner, phase 4 brief |
| C20 | **Approved working default (phase 4, 2026-10-20):** custom-ownership requests are stored in the database and reviewed with an authorized script until another delivery channel is configured. | Owner, phase 4 brief |
| C21 | **Approved working default (phase 4, 2026-10-20):** public copy is provisional and reviewed by the owner in the phase 4 PR before merge. These defaults do not authorize public deployment or sending messages. | Owner, phase 4 brief |
| C22 | Specialty-specific clinical tools, the operator console, billing, subscriptions and messaging are out of phase 4. | Owner, phase 4 brief |
| C23 | Brand: **raclinic** (lowercase in text); Latin wordmark in both languages (no Arabic transliteration); taglines "مساعدك الذكي في كل تفاصيل العيادة" / "Smart clinic management"; the supplied "raclinic logo .pdf" is the source of truth and its marketing page is a visual reference, not a feature list. Visual application and wording pending owner review. | Owner, 2026-10-24 — see BRAND.md |

## 2. Provisional recommendations (engineering proposals, not approved)

Status after phase 4 in brackets.

| # | Proposal | Why |
| - | -------- | --- |
| P1 | Next phase is **public platform and specialty-aware onboarding** (phase 4). [Done — in review.] | No external blocker; phases 5–6 need organization specialties. |
| P2 | Organizations hold a **list of enabled specialties** (one or more); practitioner profiles keep their own specialty, limited to the organization's list. [Implemented, and branches already narrow the list per branch because the phase 4 brief required per-branch associations — see architecture/SPECIALTIES.md. Changing organization specialties is owner-only, matching `organization.update`.] | Supports C11. |
| P3 | Existing organizations get no specialties automatically; owners are prompted (not blocked) to choose. Demo seed sets them explicitly. [Implemented.] | Avoid guessing from practitioner labels. |
| P4 | Public pages live in the same React app as a separate lazy-loaded route group; `/` shows the public home; signed-in visitors see a "go to my workspace" action. [Implemented; prerendering still to decide — Q16.] | Reuses i18n, fonts and auth; enables code splitting. |
| P5 | Until trial terms exist, organizations are created without a plan; no enforcement. [Implemented; wording approved as C19.] | Satisfies C16 while keeping the journey testable. |
| P6 | Ownership requests as platform records, minimal fields, no patient data, script review. [Implemented; approved as C20.] | No email provider yet; avoids building platform roles early. |
| P7 | Specialty pages describe the shared features that work today and label specialty-specific features as "planned" without dates. [Implemented; copy under review per C21.] | Honest presentation; C16. |
| P11 | Inquiry retention: 12 months after the last status change, earlier deletion on request. [Proposal; not automated.] | Data minimization; needs legal confirmation (E4). |
| P8 | Clinical access (phase 5) is a separate permission dimension granted per membership; owners/admins need explicit grant. | C12. |
| P9 | Money stored in integer minor units; one currency per organization at first (EGP or SAR). [Implemented in milestone 3; still needs owner confirmation.] | Avoids rounding errors; simplest model. |
| P15 | Invoice / receipt numbers: one sequence per organization, document type and year (`INV-2026-000012`). [Implemented; legal numbering rules may require changes.] | Unique and gap-free per committed document. |
| P16 | A new **accountant** role: finance work and patient identity in its branches, no clinical access; doctors charge only their own finalized record items and see no reports. [Implemented.] | Finance staff never need clinical text. |
| P10 | Subscription states never delete tenant data automatically; expired subscriptions become read-only after a grace period to be defined. [Milestone 4 implements the non-destructive part: with enforcement on, only growth (new branches, practitioners, members) is refused; reading and clinical work are never blocked. The rest awaits Q10/B4.] | Data safety. |
| P17 | Platform operators are a **separate identity** from tenant users (own accounts, cookie, CSRF header, 30-minute idle timeout, audit), provisioned only by CLI, with two roles (platform_admin, support); no route reaches patient, clinical or clinic-finance data and there is no impersonation. [Implemented in milestone 4.] | Least privilege; operators run the business, not the clinics. |
| P18 | **Development grants** (free, operator-granted, labelled everywhere) are distinct from **commercial subscriptions**, which only a verified provider event can create; the server always prices from the plan. Plans start with no prices or limits. [Implemented; payment runs through a simulator until B5.] | No invented commercial terms; never trust the client. |
| P12 | Explicit per-membership **capabilities** on top of roles, assigned only by owners and audited: `clinical_audit` (metadata-only clinical audit log) and `clinical_lead` (switched off, see Q17). [Implemented in milestone 1.] | Keeps clinical oversight separate from administration (C12). |
| P14 | Specialty templates are **versioned** and stored with each record; dentistry uses **FDI** notation; derived views (chart, plan, courses) are computed from finalized records, never stored. [Implemented in milestone 2; notation and fields pending clinician review.] | History cannot be reinterpreted or overwritten. |
| P13 | Clinical coverage grants last at most **90 days**, need a reason, and can be scoped to one patient or one encounter. [Implemented; the 90-day bound is an engineering default.] | Bounded, reviewable access. |

## 3. Unanswered product questions

Ordered by what blocks the next phase. Proposed defaults are proposals.

### Answered for phase 4

Q1 (entry-point wording), Q2 (where ownership requests go) and Q3 (who approves public copy) were
answered by the owner on 2026-10-20 — see C19–C21. Q4 (product name) was answered on 2026-10-24: **raclinic**, with the supplied logo PDF as
the brand source of truth (C23).

### Blocking phase 5 (clinical visit records)

| # | Question | Proposed default |
| - | -------- | ---------------- |
| Q5 | Clinical access policy. | **Answered by the owner (phase 5 brief, 2026-10-24):** the treating doctor only (active doctor membership + active practitioner relationship, authorized branch); other doctors denied; owners/admins see documentation status only, no clinical text; receptionists/viewers nothing clinical; membership changes apply immediately; no sharing or break-glass in this phase. Corrections are append-only addenda with a reason. Implemented: [CLINICAL.md](architecture/CLINICAL.md). |
| Q6 | Which clinicians validate the visit-record content? **Still open.** | At least one practicing doctor per launch specialty completes [CLINICIAN_REVIEW.md](CLINICIAN_REVIEW.md) before any real use. |
| Q7 | Are prescriptions and attachments in scope, and when? **Needs authoritative validation.** | Not in phase 5. |
| Q17 | **Who may authorize clinical coverage when the treating doctor is unavailable** (left, on leave without having shared)? (Blocker B1.) | Proposal: a designated **clinical lead** — a doctor membership given the `clinical_lead` capability by an owner — may grant time-bounded coverage of that doctor's records to another doctor, never to themselves; every grant audited. Implemented but **switched off** (`CLINICAL_LEAD_GRANTS_ENABLED=false`, capability unassignable) until the owner decides. |

### Blocking public launch (not development)

| # | Question |
| - | -------- |
| Q15 | Privacy notice and retention rules for the inquiry form and registration (P11). **Needs authoritative validation.** |
| Q16 | Prerendering or server rendering for the public pages before enabling indexing; final domain (E6). |
| Q16b | Official brand color values from the designer (the current tokens are read from the PDF fills). |

### Blocking later phases (answer before the phase starts)

| # | Question | Phase |
| - | -------- | ----- |
| Q8 | Which specialty slice goes first? — **All three built as a first version (owner brief 2026-10-25); clinician review still required (Q6).** | 6 |
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
