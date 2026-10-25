# Clinical visit records (phase 5)

General, specialty-neutral visit records written by the treating doctor: draft, explicit
finalization, immutable original, append-only addenda. **Development only, synthetic data only.
The sections and the finalization rule are provisional until practising clinicians review them
([CLINICIAN_REVIEW.md](../CLINICIAN_REVIEW.md)); nothing here is clinically validated or ready
for production.**

Specialty templates (dentistry, physiotherapy, ENT) are part of the same record:
[SPECIALTY_WORKSPACES.md](SPECIALTY_WORKSPACES.md). Out of scope: prescriptions, attachments, AI or any
automated suggestion, billing, patient portal, sharing outside the organization, break-glass
access, record import, production use. Milestone 1 added explicit coverage between doctors and a
metadata-only clinical audit view (below).

Code: `apps/api/src/modules/clinical/`, `apps/web/src/pages/EncounterPage.tsx`,
`apps/web/src/components/clinical.tsx`, `apps/web/src/lib/clinical.ts`. Tests:
`apps/api/test/clinical.test.ts`, the clinical rows of `apps/api/test/authorization.test.ts`,
`apps/web/src/pages/Clinical.test.tsx`, `e2e/clinical.spec.ts`.

## Data model

| Collection | Content | Mutability |
| ---------- | ------- | ---------- |
| `clinical_encounters` | One per appointment: organization, branch, patient, appointment, practitioner (fixed at creation), author user, `status` (`draft` / `finalized`), five text sections, `version`, `lateEntry {reason}` or null, creation/finalization idempotency keys, `lastEditedAt`, `finalizedAt`, `finalizedBy` | Updatable only while `draft`; never deleted |
| `clinical_addenda` | Encounter, author, practitioner, `reason` (3–300), `content` (1–4000), idempotency key + request hash, `createdAt` | Insert only |
| `clinical_audit_events` | Actor user and role, action, encounter / appointment / patient ids, metadata | Insert only |

Sections (`ENCOUNTER_SECTIONS`): `reason` (reason for visit), `history` (relevant history),
`examination` (examination findings), `assessment`, `plan` (plan and follow-up); plain text,
≤ 4000 characters each. Input is normalized (line endings, control characters removed, trimmed).

Database-level guards, so no code path can break the rules:

- Unique `(organizationId, appointmentId)` — exactly one record per appointment.
- Unique `(organizationId, authorUserId, creationKey)` and, for addenda,
  `(organizationId, authorUserId, idempotencyKey)`.
- Mongoose hooks reject deletes on all three collections, any update/replace of addenda and audit
  events, replacing an encounter, and any encounter update whose filter is not `status: 'draft'`.
  The only exception is the development seed replacing its own synthetic records
  (`allowSeedCleanup`).
- All three collections use `tenantGuardPlugin` (`organizationId` required in every query).
- Timestamps come from the server clock (`clock.now()`); a late entry keeps its real creation time.

## Authorization

| Who | Clinical text | Documentation status (`none` / `draft` / `finalized`) |
| --- | ------------- | ----------------------------------------------------- |
| Treating doctor (see below) | Read and write own records | Yes |
| Covering doctor (active coverage grant, below) | Read the covered records; add addenda only with "author" coverage | Only on their own appointments |
| Another doctor of the organization | No — generic `404` | Only on their own appointments |
| Owner, admin | No — `403` | Yes, on appointments they can see |
| Member with the `clinical_audit` capability | No (audit metadata only) | As their role allows |
| Receptionist, viewer | No — `403` | No (field absent) |

Permissions in `PERMISSION_MATRIX`: `clinical.encounter.own` (doctor only) and
`clinical.documentation_status.read` (owner, admin, doctor). The owner did **not** get the
clinical permission: being an owner or admin grants no clinical access (C12), and no grant
mechanism exists in this phase.

**Treating doctor** (`resolveClinicalActor` + `treats`, `clinical-access.ts`), checked on every
request and again inside every mutation's transaction:

1. role permission `clinical.encounter.own`;
2. the caller's membership read **fresh from the database**: active, role `doctor`;
3. an **active** practitioner profile on that membership;
4. the appointment's / record's practitioner is that profile, the record's author is the caller;
5. the record's branch is inside the membership's current branch scope.

Consequences, all tested: suspension, role change, branch-scope change and profile deactivation
take effect on the next request, including for an open editor; cross-organization ids, other
doctors' records and records in branches outside the scope answer the same generic `404` as a
missing id; the clinical history lists only the caller's own records within scope (an empty
list, not an error, for anything else — so counts reveal nothing).

Responses: no permission → `403 FORBIDDEN`; permission but no treating relationship (or missing
id) → `404 NOT_FOUND` with an identical body. Both are recorded as `clinical.access_denied`.

## Clinical coverage

Continuity of care when a doctor is away or leaves, **without** any blanket access
(`coverage.model.ts`, `coverage.routes.ts`, checks in `clinical-access.ts`).

- **A grant** names a source practitioner (whose records), a grantee practitioner (an active
  doctor of the same organization, never the grantor or the source), a scope — **one encounter**
  or **one patient** (then: all of the source practitioner's records for that patient) — an access
  level (**read**, or **author** = read + addenda), a start, an expiry (at most 90 days —
  engineering default pending confirmation) and a reason (5–300 characters).
- **Who grants:** the treating doctor, for their own records only (`clinical.coverage.grant`,
  doctors). A **clinical lead** may grant on behalf of an unavailable doctor — implemented, but
  **off**: it needs both `CLINICAL_LEAD_GRANTS_ENABLED=true` and the `clinical_lead` membership
  capability, which cannot be assigned while the switch is off (blocker B1: who may hold that
  authority is an owner decision). Nobody can grant to themselves; owners and admins cannot grant.
- **Use:** checked per request, like the treating relationship: active, unrevoked, started and
  unexpired grant; grantee's membership active and doctor; record's branch inside the grantee's
  current branch scope. A covering doctor reads through `GET /encounters/:id` and
  `GET /clinical/coverage/:id/records`; with "author" access they add addenda **under their own
  name** — the record's author, finalized text and drafts never change (someone else's draft is
  read-only).
- **Revoke:** the grantor or the source doctor (or an enabled clinical lead); effective on the
  next request. Covered addenda run in a transaction that write-locks the grant (`useSeq`), so a
  revocation racing an addendum serializes with it (tested with parallel requests: an addendum is
  never written after the revocation time).
- **Audit:** `coverage.granted`, `coverage.revoked`; covered reads and addenda carry
  `via: coverage` and the grant id; refused access records why (`coverage_revoked`,
  `coverage_expired`, `coverage_not_started`, `coverage_out_of_scope`).
- Grants are never edited (only revoked) or deleted; the grantor's later suspension does not end
  a grant (that is the point of continuity) — the grantee's suspension does, immediately.

## Clinical audit view

`GET /clinical/audit` (web: "Clinical audit") lists clinical audit events — actor name and role,
action, time, patient number, record ids and the metadata above — **never clinical text**, with
an action filter and a cursor (`createdAt|id`). It requires the `clinical_audit` membership
capability, which only owners assign (to owners, admins or doctors) in the Team page; no role has
it by default, and holding it gives no access to records. Opening the view is itself recorded
(`clinical_audit.viewed`). Capability changes go to the administrative audit log
(`member.capabilities_changed`).

## Lifecycle

```
(appointment in_progress) ──start──▶ draft ──save (version n → n+1)──▶ draft
(appointment completed)  ──start with lateEntryReason──▶ draft (lateEntry set)
draft ──finalize (version must match; minimum content)──▶ finalized ──addendum──▶ finalized (+addendum)
```

- **Start**: only for the treating doctor's appointment that is `in_progress`; for a `completed`
  appointment only as a **late entry** with a reason (5–300 characters). Scheduled, checked-in,
  cancelled and no-show appointments cannot have a record (`409 ENCOUNTER_NOT_ALLOWED`).
- **Draft save**: full section set + the version the editor loaded. A stale version returns
  `409 VERSION_CONFLICT` with `currentVersion`; nothing is overwritten.
- **Finalize** (provisional minimum): `reason` is not empty **and** at least one of
  `examination`, `assessment`, `plan` is not empty; otherwise `400 ENCOUNTER_INCOMPLETE` with
  field codes. Allowed while the appointment is `in_progress` or `completed`. It sets
  `finalizedAt` / `finalizedBy` atomically with the status change and the audit event.
- **Finalized** records never change. Saving or finalizing again answers
  `409 ENCOUNTER_FINALIZED`.
- **Addenda**: only on finalized records (`409 ENCOUNTER_NOT_FINALIZED` on a draft), each with a
  reason; shown after the original in time order. The original text stays as finalized.

## Endpoints

All under `/api/v1/orgs/:orgId`, after `requireMembership`; all clinical responses send
`Cache-Control: no-store`.

| Method and path | Purpose | Notes |
| --------------- | ------- | ----- |
| `GET /appointments/:appointmentId/encounter` | Record (with addenda) or `null`, plus `canStart`, `lateEntryRequired` | Read audited once per 10 minutes |
| `POST /appointments/:appointmentId/encounter` | Start | `Idempotency-Key` required; body `{ sections?, lateEntryReason? }` |
| `PUT /encounters/:encounterId` | Save draft | `{ sections, version }` |
| `POST /encounters/:encounterId/finalize` | Finalize | `Idempotency-Key`; `{ version }` |
| `POST /encounters/:encounterId/addenda` | Add addendum | `Idempotency-Key`; `{ reason, content }` |
| `GET /patients/:patientId/clinical-history` | Caller's own records for a patient, plus records covered by an active grant (`covered: true`) | Excerpt of the reason only (160 characters), status, late-entry flag, addenda count |
| `GET /encounters/:encounterId` | One record by id: own or covered; `access`, `canAddAddendum`, minimal patient identity | Covered reads audited with the grant id |
| `GET /clinical/coverage` | Grants given (or covering the caller's records) and received | |
| `GET /clinical/coverage/candidates` | Active doctors who could cover (name, specialty) | |
| `POST /clinical/coverage` | Grant | `Idempotency-Key`; `{ granteePractitionerId, scope, access, expiresAt, reason, startsAt?, sourcePractitionerId? (lead only) }` |
| `POST /clinical/coverage/:id/revoke` | Revoke | `{ reason }` |
| `GET /clinical/coverage/:id/records` | Records a received, active grant opens | |
| `GET /clinical/audit` | Clinical audit events (metadata) | `clinical_audit` capability; `?action=&before=&limit=` |

Appointment DTOs (list, detail, queue) carry `documentation` only for roles with
`clinical.documentation_status.read`.

## Concurrency and idempotency

- Every mutation runs in a MongoDB transaction that first increments the caller's
  `Membership.accessSeq`. A concurrent suspension or scope change of that membership therefore
  write-conflicts with the mutation; the driver retries and the retry sees the new state.
- Draft save and finalize are conditional updates on `{ status: 'draft', version }`; two tabs
  saving the same version, or a save racing finalization, produce exactly one winner and a `409`
  for the other (tested with real parallel requests).
- Create: the unique appointment index guarantees one record; parallel requests with different
  keys get one `201` and `409 ENCOUNTER_EXISTS` for the rest.
- `Idempotency-Key` (`/^[A-Za-z0-9_-]{8,100}$/`, per author): a retry with the same key and the
  same content returns the original result (`200`, `replayed: true`); the same key with different
  content returns `409 IDEMPOTENCY_KEY_REUSED`. Applies to create, finalize and addenda; parallel
  retries of one addendum add it once.
- The web client keeps one key per attempt and makes a new one whenever the input changes.

## Audit and privacy

Clinical audit events (`clinical_audit_events`, separate from the administrative audit log):
`encounter.created`, `encounter.viewed`, `encounter.draft_saved`, `encounter.finalized`,
`encounter.addendum_added`, `clinical_history.viewed`, `clinical.access_denied`. Each holds actor,
role, ids and metadata such as versions, names of changed sections, late-entry flag, appointment
status, addendum id or a denial reason code — **never clinical text** (tested by searching all
events for a marker string). Reads and denials are deduplicated per actor/action/target for 10
minutes. Members holding the `clinical_audit` capability read it in the app (above).

Where clinical text must never appear, and how:

| Place | Protection |
| ----- | ---------- |
| API logs | The request logger records method, path and id only; bodies and query strings are never logged |
| Error responses | Validation answers field codes; schema messages are fixed codes (`too_long`) — tested not to echo text |
| URLs | Only ids; content travels in request bodies |
| Browser storage | None. Clinical queries use `gcTime: 0` (dropped from memory when no page shows them); sign-out clears the whole query cache; no `localStorage` / `sessionStorage` use (tested in unit and e2e tests) |
| Document title / history | Generic "Visit record" title |
| HTTP caches | `Cache-Control: no-store` on clinical responses |
| Administrative audit, analytics | Not written to; no analytics exist |

The web editor warns before leaving a page with unsaved changes (in-app navigation and tab
close/reload).

## Demo data

The seed adds five synthetic records and one addendum in `demo-nour` (Arabic and English text
labelled as synthetic), and leaves Dr. Sami's in-progress `b04` and completed `b03` without a
record so the start and late-entry flows can be tried (`doctor2.nour@demo.test`). Re-seeding
replaces only the seed's own records. Records written by hand on seed appointments in a
development database are kept but point to appointments that a re-seed recreates.

## Known limitations and production gates

- Clinician review of sections, wording and the finalization rule (CLINICIAN_REVIEW.md) — required
  before any real use.
- Coverage needs the treating doctor to grant it. If that doctor is already unavailable, only an
  enabled clinical lead could grant it — switched off until the owner decides who holds that
  authority (B1). No break-glass access (deliberately not built).
- No audit retention policy, export or legal hold; no patient access requests.
- No legal/regulatory review of clinical record keeping in Egypt or Saudi Arabia; retention periods
  and amendment rules may need to change.
- Data residency, encryption at rest and backups for clinical data are undecided (same gate as the
  rest of the platform).
- Free-text sections only; no structured data, coding systems, attachments or prescriptions.
- Independent security review of the access model and concurrency design.
