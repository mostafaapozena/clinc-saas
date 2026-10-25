# Clinician review checklist — general visit record (phase 5)

**Status: not reviewed.** No practising clinician has reviewed the visit record yet (Q6 in
[DECISIONS.md](DECISIONS.md)). Until this checklist is completed and signed off, the visit record
is a development prototype with synthetic data only and must not be described as clinically
validated.

Design reference: [architecture/CLINICAL.md](architecture/CLINICAL.md). Try it in the private
preview with `doctor2.nour@demo.test` (start a record on the visit in progress; late entry on the
completed visit) and `doctor.nour@demo.test` (an existing draft and finalized records).

## Reviewer

| Field | Value |
| ----- | ----- |
| Name, specialty, country of practice | _pending_ |
| Date of review | _pending_ |
| Build / commit reviewed | _pending_ |

Ideally one practising doctor per launch specialty (dentistry, physiotherapy, ENT) reviews it,
since the same general record is used by all of them until the specialty workspaces exist.

## Questions

1. **Sections.** Are "reason for visit", "relevant history", "examination findings", "assessment"
   and "plan and follow-up" the right general sections for your specialty? Anything missing
   (e.g. allergies, vital signs, medications) or unnecessary? Arabic and English wording correct?
2. **Hints.** Are the hint texts under each field accurate and neutral?
3. **Finalization minimum.** Today: reason for visit, plus at least one of examination findings,
   assessment or plan. Is that the right minimum? Should anything else be required?
4. **When to finalize.** Finalizing is allowed while the visit is in progress or after it is
   completed. Should finalizing require the visit to be completed?
5. **Late entries.** A record can be started after the visit was completed, with a reason, and keeps
   its real creation time. Is a time limit or extra wording needed?
6. **Corrections.** A finalized record never changes; corrections are addenda with a reason, shown
   after the original. Is this acceptable practice where you work, or are formal amendments or
   strike-through versions expected?
7. **Who may read.** Only the treating doctor who wrote the record can read it; owners and admins
   see only whether a visit is documented. Do colleagues need read access (cover, referrals,
   follow-up by another doctor)? Under what rule?
8. **Timeline.** The patient page shows the doctor's own records (date, status, a short excerpt of
   the reason, addenda count). Is that useful and appropriate?
9. **Lengths.** 4000 characters per section, 300 for reasons. Sufficient?
10. **Anything misleading** in the screens or public wording about what the record does?

## Sign-off

| Item | Result |
| ---- | ------ |
| Sections and wording | _pending_ |
| Finalization rule | _pending_ |
| Correction model | _pending_ |
| Access rule | _pending_ |
| Changes requested | _pending_ |

Changes requested by reviewers are implemented and tested before any real use; this document is
updated with the outcome.

## Specialty templates (milestone 2) — also not reviewed

Design: [architecture/SPECIALTY_WORKSPACES.md](architecture/SPECIALTY_WORKSPACES.md).

**Dentists**
1. Is FDI two-digit notation right for clinics in Egypt and Saudi Arabia, and are the five surfaces
   (M, O, D, B, L) and their Arabic names correct?
2. Are free-text findings per tooth enough for a first version, or is a fixed list of conditions
   needed (which, and in which terms)?
3. Plan items with statuses planned / in progress / done / cancelled, changed at later visits — is
   that how treatment plans are followed?

**Physiotherapists**
4. Initial assessment (limitations, goals, planned sessions, frequency), sessions (performed,
   progress, notes per goal) and a discharge summary — missing or unnecessary parts?
5. Should finalizing an assessment require the planned number of sessions?

**ENT doctors**
6. Are the regions (history: ear, nose, throat; examination: right ear, left ear, nose, throat,
   neck) right? Anything essential missing (e.g. hearing tests as free text)?

**All**
7. Is anything on the screens misleading, or could it be read as a suggestion or a diagnosis?
