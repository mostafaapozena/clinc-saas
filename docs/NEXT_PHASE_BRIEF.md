# Next phase brief — Phase 5: clinical visit records and clinical access

_Recommended 2026-10-20. **Implemented** on `phase-5/visit-records` following the owner's phase 5
brief of 2026-10-24, which decided: treating doctor only (no clinical grants for other doctors,
owners or admins), corrections as append-only addenda (instead of amended versions), late entries
with a reason, finalization while in progress or completed. See
[architecture/CLINICAL.md](architecture/CLINICAL.md); clinician review (Q6) still pending._ Context: [ROADMAP.md](ROADMAP.md),
[PRODUCT_INVENTORY.md](PRODUCT_INVENTORY.md), [DECISIONS.md](DECISIONS.md).

Phase 4's own brief (public site and onboarding) is recorded in the phase 4 PR and in
[architecture/PUBLIC_SITE.md](architecture/PUBLIC_SITE.md), [ONBOARDING.md](architecture/ONBOARDING.md),
[SPECIALTIES.md](architecture/SPECIALTIES.md) and [INQUIRIES.md](architecture/INQUIRIES.md).

## Why this phase next

The workspace runs the whole administrative day (registry, schedules, booking, check-in, queue),
and since phase 4 every organization, branch and doctor has a specialty. What is missing for a
clinic to use it during a visit is a **clinical record**: today "start" and "complete" only
change an appointment's status. Every specialty workspace (phase 6) and charges per visit
(phase 7) depend on a visit record and on a clinical access model. Nothing external blocks the
engineering, but two owner decisions must be confirmed at the start (below).

## Outcome

1. A doctor opens the visit of a checked-in or in-progress appointment and writes a structured
   visit record (generic sections, agreed with clinicians), saves drafts, and finalizes it.
2. A finalized record cannot be edited in place; corrections are new versions with author, time
   and reason, and the full history stays readable to those allowed.
3. Clinical content is visible only to roles with clinical access. Being an owner or admin does
   **not** grant it (C12). Receptionists and viewers never see it.
4. Authorized clinicians see a patient's clinical timeline across their accessible branches.

## In scope

- Visit record model linked to the appointment (organization, branch, patient, practitioner,
  specialty of the practitioner), with states draft → finalized → amended (new version).
- A clinical permission dimension separate from administrative permissions, granted per
  membership; audit of every clinical read and write (who, when, which record — never the content).
- API with the same isolation rules as phase 3 (generic not-found, branch scope, own-practitioner
  rules), plus clinical-access checks on every endpoint, search and count.
- Web: visit screen from the queue and the appointment page, draft autosave, finalize,
  amendment with reason, history view; Arabic and English.
- Synthetic demo visit records only.

## Out of scope

Specialty-specific charts and plans (phase 6), prescriptions and attachments (Q7 — not in this
phase), billing, patient portal, external sharing, AI features, importing records.

## Decisions to confirm when the phase starts (proposed defaults in DECISIONS.md)

- **Q5 clinical access:** proposed — the visit's doctor writes; other doctors of the
  organization read only with an explicit clinical grant; owners/admins have no clinical access
  unless granted; break-glass access is not built unless the owner asks for it.
- **Q6 clinician review:** at least one practicing doctor per launch specialty reviews the
  generic sections and wording before merge.
- Whether a doctor may finalize a record for a visit that is not completed yet.

## Acceptance criteria

1. Finalized records are immutable; every amendment creates a version with author, time and
   reason; history is complete and ordered.
2. Without clinical access, every clinical endpoint — including list, search, count and timeline —
   answers like a missing record; owners/admins without a grant are refused.
3. Cross-organization ids, other branches' records and other doctors' drafts are never returned.
4. Every clinical read and write produces an audit event without clinical content.
5. Concurrent edits of a draft cannot silently overwrite each other (optimistic versions).
6. Role × action matrix and isolation tests extended; browser test: check-in → start → write →
   finalize → amend → history, in both languages and on a phone.
7. `npm run verify` and CI pass on the PR's latest commit; private preview checked.

## Blockers

None for starting the design and the model. Implementation of the screens' content waits on the
clinician review (Q6); the access model waits on the owner's confirmation of Q5.
