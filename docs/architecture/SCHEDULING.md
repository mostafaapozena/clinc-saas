# Scheduling: time zones, practitioner availability, booking concurrency

Implemented in `apps/api/src/time/`, `apps/api/src/modules/practitioners/`,
`apps/api/src/modules/scheduling/` and `apps/api/src/modules/appointments/`. Tested in
`apps/api/test/local-time.test.ts`, `appointments.test.ts`, `front-desk-isolation.test.ts`.

## Organization time zone

- Each organization has an IANA zone (`organizations.timeZone`). Supported: `Africa/Cairo`
  (default shown in onboarding), `Asia/Riyadh`, `Asia/Dubai`, `Asia/Kuwait`, `Asia/Qatar`,
  `Asia/Bahrain`, `Asia/Muscat`, `Asia/Amman`.
- It is chosen **explicitly** in onboarding (`timeZone` is required by `POST /orgs`) or in
  settings; it is never inferred from the interface language. Organizations created before this
  phase have none, and every scheduling endpoint answers `409 TIME_ZONE_REQUIRED` until an owner
  sets it. The demo seed sets Cairo and Riyadh explicitly.
- **Changing the zone is refused while future active appointments exist**
  (`409 TIME_ZONE_LOCKED`); a migration workflow is deferred.
- Instants are stored in UTC. Working hours, dates and booking input are wall-clock values in the
  organization's zone. All offset and daylight-saving arithmetic goes through **Luxon** and the
  runtime tz database (Node 24 / ICU, tzdata 2026c); no fixed offsets are written anywhere.

### Daylight-saving rules

| Situation | Behavior |
| --------- | -------- |
| Booking at a local time that does not exist (spring-forward gap, e.g. Cairo 24 Apr 2026 00:00–00:59) | `400 NONEXISTENT_LOCAL_TIME` |
| Booking at a repeated local time (fall-back, e.g. Cairo 29 Oct 2026 23:00–23:59) without `utcOffsetMinutes` | `409 AMBIGUOUS_LOCAL_TIME` with the candidate offsets; the slot list already carries the offset, so the UI always sends it |
| `utcOffsetMinutes` that is not in force at that time | rejected as nonexistent (never shifted) |
| Working interval starting inside a gap | starts at the first existing time after the gap |
| Working interval start / end on a repeated time | start uses the earlier occurrence, end the later one |
| Days | `[start of local day, start of next local day)` — 23, 24 or 25 hours |

The slot list marks repeated times (`repeatedTime: true`) and the UI shows their UTC offset.

### Server clock

`apps/api/src/time/clock.ts` is the single source of "now" for scheduling decisions. Tests pin it
(`pinClock()` in `apps/api/test/helpers/clinic.ts`) so date-dependent rules are deterministic.

## Practitioner scheduling profiles

- A profile (`practitioners`) references an **active membership with the doctor role** in the same
  organization (`MEMBERSHIP_NOT_ELIGIBLE` otherwise); it is not a login account. One per
  membership.
- Fields: display name, specialty (from the platform catalog), active/inactive, assigned branches
  (must be inside the membership's branch scope), default appointment duration (5–240 minutes,
  multiple of 5), weekly intervals per branch.
- **Weekly intervals** (`weekday` 0 = Sunday, `HH:mm` start, `HH:mm`/`24:00` end, multiples of
  5 minutes) may not overlap on the same weekday — **including across branches**
  (`400 SCHEDULE_OVERLAP`).
- **Date exceptions** (`schedule_exceptions`): `closed` (one branch, or every branch) or `hours`
  (replaces one branch's weekly intervals on that date). Only today or later; one per
  practitioner, date and branch; cross-branch overlap is checked for that date.
- **Changes that would orphan bookings are refused with the list of affected appointments**:
  working-hour changes, exceptions, removing an exception (`409 SCHEDULE_CONFLICT`), deactivation
  and branch removal (`409 FUTURE_APPOINTMENTS_EXIST`). Nothing is cancelled silently.
- Owners and admins manage profiles (`practitioner.manage`). Doctors see only their own profile
  and schedule, read-only. Branch-limited members see only practitioners and intervals of their
  branches.
- Bookings are refused when the profile is inactive, the membership is suspended or no longer a
  doctor, or the branch is outside the membership scope (`409 PRACTITIONER_INACTIVE`).

## Availability

`GET /appointments/availability?practitionerId&branchId&date&durationMinutes&step&excludeAppointmentId`
returns start times that:

1. lie inside the effective working intervals for that branch and local date (weekly intervals
   after exceptions), converted to instants with the rules above;
2. are aligned to `step` (5, 10, 15 or 30 minutes; default 15) from each interval start, and the
   whole duration fits before the interval end;
3. are in the future;
4. do not touch any five-minute cell the practitioner already holds — **in any branch**.

The browser never decides availability: booking re-runs every check inside the transaction and
the reservation index has the final word. Availability may show a practitioner's time as taken
by a booking in another branch (without any details).

## Appointment model and state machine

`appointments`: organization, branch, patient, practitioner, `startAt`/`endAt` (UTC),
`durationMinutes`, `type` (`new_visit` | `follow_up`), `status`, optional short
`cancellationReason` (≤ 200), status timestamps, `version`, idempotency key and request hash,
actor references. No clinical free text. Appointments are never hard-deleted.

Transitions are defined once in `appointment.state.ts` and apply to every role (owners and admins
included):

| Action | From | To | Permission | Extra rule |
| ------ | ---- | -- | ---------- | ---------- |
| `check_in` | scheduled | checked_in | `appointment.front_desk` | only on the appointment's local date (records `checkedInAt`, the actual arrival time) |
| `start` | checked_in | in_progress | `appointment.visit` | not for a later date; doctors only their own |
| `complete` | in_progress | completed | `appointment.visit` | not for a later date; doctors only their own |
| `cancel` | scheduled | cancelled | `appointment.front_desk` | reason optional |
| `cancel` | checked_in | cancelled | `appointment.front_desk` | **reason required** |
| `no_show` | scheduled | no_show | `appointment.front_desk` | only once the scheduled start has passed |

Everything else is `409 INVALID_TRANSITION` (or `REASON_REQUIRED`, `TOO_EARLY`, `NOT_TODAY`).
"Future" for `start`/`complete` means a later local date; a doctor may start a checked-in patient
a little before the booked time on the same day. Rescheduling is allowed only for `scheduled`
appointments, keeps the practitioner, branch and patient, and records the previous and new times
in the audit event. Completed and cancelled appointments stay in the history.

## Concurrency, double-booking and idempotency

**Five-minute occupancy cells.** Every appointment start and duration is on a five-minute grid
(UTC-aligned, which equals local alignment for all supported zones). Booking claims one row per
covered cell in `slot_reservations` for the practitioner **and** for the patient, with a unique
index on `(organizationId, resourceType, resourceId, slotStart)`:

- two overlapping appointments of the same practitioner (any branch) or the same patient need a
  common cell, and only one insert can win — under any concurrency;
- adjacent appointments share no cell and are allowed;
- `cancelled` and `no_show` release their cells; `completed` keeps them.

**Transactions.** Booking, rescheduling and status changes run in one MongoDB transaction
(replica set): appointment document, reservation rows and audit event commit together or not at
all. A duplicate cell aborts the transaction (`409 SLOT_UNAVAILABLE` for the practitioner,
`409 PATIENT_CONFLICT` for the patient — the latter without any details, because the other
appointment may be in a branch the caller cannot see). Tests inject a failure after the
practitioner's cells are written and check that nothing remains.

**Serializing with schedule changes.** Inside its transaction, a booking re-reads and validates the
branch, patient registration, practitioner status, membership and working hours, and increments
`scheduleSeq` on both the practitioner and the patient documents. Schedule changes,
deactivation, branch removal and registration archiving also write those documents inside their
own transactions. MongoDB reports a write conflict for one of two such concurrent transactions,
the driver retries it, and the retry sees the other's committed result — so a booking cannot slip
past a concurrent schedule change, and vice versa. `schedule-races.test.ts` forces each pairing in
both orders (booking vs working-hours change, deactivation and registration archiving): the first
transaction is held open right after its serializing write while the second request starts. With
the booking's two writes replaced by plain reads, all six races fail (the booking lands outside
the new hours, on an inactive practitioner or an archived registration).

**Optimistic versions.** Status changes and reschedules must send the `version` they are based on;
the update filters on it and increments it. Concurrent changes of the same appointment therefore
produce one success and one `409 VERSION_CONFLICT` instead of a silent overwrite. Patients and
practitioner profiles use the same scheme.

**Idempotency.** `POST /appointments` requires an `Idempotency-Key` header (8–100 characters). The
key is stored on the appointment with a unique partial index on
`(organizationId, createdBy, key)` — scoped to the user who sent it. A retry with the same key and
the same request returns the original appointment (`200`, `replayed: true`); the same key with a
different request is `409 IDEMPOTENCY_KEY_REUSED`. The key is looked up **before** the booking
checks run, so a retry still gets its appointment back after the booked start has passed or the
registration was archived. A replay only returns an appointment the caller can still see;
otherwise the key is reported as used. Concurrent duplicates are resolved by the same index inside
the transaction. The web app creates one key per booking attempt and reuses it when
the same attempt is retried.

**Tests with real concurrency** (`appointments.test.ts`): eight simultaneous bookings for the same
practitioner time (exactly one succeeds, no orphan cells); two simultaneous reschedules into the
same time (one succeeds, the other keeps its original time and cells); five simultaneous requests
with one idempotency key (one appointment); simultaneous check-in and cancel (one version
conflict); twelve simultaneous patient creations (unique numbers). `schedule-races.test.ts`: a
booking against a working-hours change, a deactivation and a registration archive, each in both
orders.

## Queue and dashboard

- `GET /queue` — today's (organization-local date) `checked_in` appointments ordered by actual
  arrival time, then appointment time, then id (no manual reordering or priorities), and
  `in_progress` appointments separately. Filters: authorized branch, practitioner. Doctors get
  their own only.
- `GET /dashboard` — counts of appointments **whose start falls on today's local date**, grouped by
  their **current** status: `scheduled` (booked, not arrived), `waiting` (checked in),
  `inProgress`, `completed`, `noShow`, `cancelled`. Scope: the caller's branches (optionally one
  branch); doctors count only their own; viewers receive these totals and nothing identifiable.
