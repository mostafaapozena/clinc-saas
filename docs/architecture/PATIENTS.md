# Patient registry: data model and visibility

Implemented in `apps/api/src/modules/patients/`. Tested in `apps/api/test/patients.test.ts`,
`apps/api/test/front-desk-isolation.test.ts` and `apps/api/test/local-time.test.ts`
(normalization).

**Administrative data only.** There are no clinical fields, notes, diagnoses, attachments or
national identity numbers. Hard deletion and patient merging do not exist.

## Model (`patients` collection)

| Field | Notes |
| ----- | ----- |
| `organizationId` | Required; the tenant guard rejects any unscoped query. |
| `patientNumber` | Sequential per organization, allocated atomically from `counters` (`$inc` on one document, unique `(organizationId, key)`). A number taken by a request that then fails is not reused, so gaps are possible. Unique index `(organizationId, patientNumber)`. |
| `fullName` | 2–120 characters, stored exactly as typed (Arabic or English, never transliterated). |
| `nameKey` | Search key: Arabic diacritics/tatweel removed, alef/yaa/taa-marbuta/hamza variants unified, Latin lowercased, whitespace collapsed. |
| `phone` | Required. `{ country, e164 }`. |
| `secondaryPhone`, `email`, `dateOfBirth`, `sex`, `address` | Optional. `sex` is administrative: `female`, `male` or `unspecified` (default). `dateOfBirth` is a local calendar date, validated server-side (real date, not in the future, not before 1900). |
| `registrations[]` | `{ branchId, status: active \| archived, registeredAt, registeredBy, archivedAt }`, at least one. |
| `version` | Optimistic concurrency for demographic edits (`409 VERSION_CONFLICT` on a stale version). |
| `scheduleSeq` | Internal counter written by bookings and registration changes so they serialize (see SCHEDULING.md). |
| `createdBy`, `updatedBy`, timestamps | Actor references. |

Reception needs only the full name, a primary phone with country context and an authorized
branch.

### Phone numbers

- Input is a country (`EG`, `SA`, `AE`, `KW`, `QA`, `BH`, `OM`, `JO`) plus a number. Arabic-Indic
  (`٠–٩`) and Eastern Arabic-Indic (`۰–۹`) digits, spaces, dashes and brackets are accepted.
- A number starting with `+` or `00` carries its own country. **A local number without a country
  is rejected** (`phone.country: required`) — the country is never guessed.
- Validation and normalization use `libphonenumber-js` (full metadata); the stored form is E.164
  for exact matching. Numbers from unsupported countries are rejected.
- **Shared numbers are valid** (families). There is no uniqueness on phone numbers.

## Visibility

- **Organization-wide roles** (owner, admin) see every patient of the organization.
- **Branch-limited members** see a patient only if at least one registration (active *or*
  archived) is in one of their branches, and **only those registrations are returned** — hidden
  branch ids, names, counts and their appointments never appear in any response.
- **Doctors** cannot browse the registry (`patient.list` is not granted). They can open a patient
  only when the patient has an appointment with **their own** practitioner profile in one of
  their branches; the appointment history they see is limited to their own appointments.
- **Viewers** cannot see any identifiable patient data.
- Unknown, foreign-organization and out-of-scope ids all produce the same `404 NOT_FOUND`
  (path) or `400 INVALID_REFERENCE` / `INVALID_BRANCH` (request body).

## Search, filters and pagination

`GET /api/v1/orgs/:orgId/patients?q=&branchId=&status=active|archived|all&sort=recent|name|number&page=&pageSize=`

- `q` (≤ 80 characters) matches the exact patient number, the normalized phone (each supported
  country is tried for a local number; matching is exact on E.164, primary or secondary) or a
  substring of `nameKey`. User input is regex-escaped before use.
- `pageSize` ≤ 50, `page` ≤ 1000, sort fields are allowlisted. Unknown query keys are dropped and
  operator objects cannot be expressed (Express `simple` query parser + zod).
- Name search is a substring regex scoped to one organization (and branch scope); it is not
  index-assisted. Adequate for clinic-sized registries; revisit (e.g. a text or prefix index)
  if an organization grows very large.

## Duplicate warnings

On creation, the API looks for patients **within the caller's own visible scope** with the same
`nameKey` and the same phone (primary or secondary). A match returns `409 POSSIBLE_DUPLICATE`
with the matching ids, numbers and names; the user may resubmit with `confirmDuplicate: true`.
It is a warning, not proof of identity. A patient registered only in branches the caller cannot
see is never considered, revealed or linked.

**Deferred:** privileged duplicate reconciliation (finding and merging duplicates across
branches) is not implemented. A branch-limited receptionist may therefore create a second
record for a person already registered at another branch.

## Branch registrations

- `POST /patients/:id/registrations { branchId }` — the caller must see the patient and the
  (active) target branch.
- `PATCH /patients/:id/registrations/:branchId { status }` — archive or reactivate.
- **Archiving is refused while the patient has future active appointments at that branch**
  (`409 FUTURE_APPOINTMENTS_EXIST` with the list); nothing is cancelled silently. Archived
  registrations reject new bookings (`409 PATIENT_NOT_REGISTERED`) and keep all history.

## Updates

`PATCH /patients/:id` writes only an explicit allowlist (name, phones, email, date of birth, sex,
address) with the expected `version`. Identity details are **shared across all registered
branches of the organization**; the UI says so in the edit form.

## Audit

`patient.created`, `patient.updated` (changed **field names only**, never values),
`patient.branch_registered`, `patient.registration_archived`, `patient.registration_reactivated`.
No names, phone numbers or other personal values are copied into audit events or logs; request
logs record only method and path (no query string, headers or bodies).
