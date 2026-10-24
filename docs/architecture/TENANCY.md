# Organizations, authorization and tenant isolation

> **Status: implemented for the resources that exist in phase 3** (organizations, branches,
> memberships, audit events, patients, practitioner profiles and exceptions, appointments, slot
> reservations, counters) and tested in `apps/api/test/tenancy.test.ts`,
> `authorization.test.ts`, `patients.test.ts`, `appointments.test.ts` and
> `front-desk-isolation.test.ts`. Future modules must follow the same rules and add their own
> isolation tests before anyone relies on them.

## Model

| Collection           | Scope           | Notes                                                                  |
| -------------------- | --------------- | ---------------------------------------------------------------------- |
| `users`              | global          | An account; may belong to several organizations.                       |
| `organizations`      | the tenant      | Its `_id` is the scope. Reached only after resolving a membership. Holds the IANA `timeZone`. |
| `branches`           | organization    | `organizationId` required; name unique per organization (case-insensitive). |
| `memberships`        | organization    | `organizationId` + `userId` unique; `role`; `status` active/suspended; `branchScope` `all` or `selected` + `branchIds`. |
| `audit_events`       | organization    | Actor, action, target reference, small change summary, timestamp.     |
| `patients`           | organization    | Organization-owned identity with branch `registrations` — see [PATIENTS.md](PATIENTS.md). |
| `counters`           | organization    | Patient number sequence.                                              |
| `practitioners`      | organization    | Scheduling profile of a doctor membership; branch assignments; weekly hours. |
| `schedule_exceptions`| organization    | Date-specific closures / replacement hours.                           |
| `appointments`       | branch          | `organizationId` + `branchId` required — see [SCHEDULING.md](SCHEDULING.md). |
| `slot_reservations`  | organization    | Five-minute occupancy cells (unique per practitioner/patient and cell). |
| `sessions`           | user            | See AUTH.md.                                                          |
| `specialties`        | platform        | **Deliberate exception**: shared public reference catalog, no tenant data. |

Onboarding (`POST /api/v1/orgs`) creates the organization (with its explicitly chosen time zone),
its first branch and the creator's active **owner** membership in **one MongoDB transaction** —
tested by forcing the membership insert to fail and checking nothing remains. Transactions need a
replica set: the devcontainer and CI run MongoDB 8.2.12 as single-node replica set `rs0`.

## Enforcement (every org-scoped request)

1. **Authenticate** — session cookie → user (`loadSession`, `requireAuth`).
2. **Resolve membership** — `requireMembership` reads the active membership for
   `(organizationId from the URL, authenticated user)` **from the database on every request**.
   No membership, a suspended one, an unknown or a malformed id all give the same
   `404 NOT_FOUND`, so other organizations' existence is never disclosed. Suspensions, role and
   branch changes therefore apply to existing sessions immediately.
3. **Check permission** — `requirePermission('<permission>')` against the single
   `PERMISSION_MATRIX`; failures give `403 FORBIDDEN` (the caller is a member, so this discloses
   nothing new). Appointment status actions check the permission the state machine assigns to
   each action.
4. **Scope the query** — handlers build filters only with `orgScope`, `accessibleBranchesFilter`
   (branch documents), `branchOwnedFilter` (appointments), `patientScopeFilter` (patients via
   registrations) and `visibleAppointmentsFilter` (adds the doctor's own-practitioner limit). The
   organization id always comes from the membership, never from the request body; request bodies
   are parsed with explicit allowlists. Out-of-scope ids in the path give the same `404`; ids in a
   request body that are unknown, foreign or out of scope give the same `400`
   (`INVALID_REFERENCE` / `INVALID_BRANCH`).

**Safety net:** `tenantGuardPlugin` on every tenant-owned schema throws for any query, update,
delete, count or aggregation whose filter (or first `$match`) lacks `organizationId`. The only
opt-out (`skipTenantGuard`) is listing **the caller's own** memberships across organizations,
filtered by the authenticated user id.

Referenced branches (membership branch scopes, practitioner branches) must all belong to the
caller's organization; foreign and unknown ids give the same `400 INVALID_BRANCH`.

## Roles and authorization matrix

Branch scope: owners and admins are always organization-wide; other roles may be limited to
selected branches and only ever see those.

| Action (API)                                         | Permission                    | Owner | Admin | Doctor | Receptionist | Viewer |
| ---------------------------------------------------- | ----------------------------- | :---: | :---: | :----: | :----------: | :----: |
| View organization, own role and permissions          | `organization.read`           |  ✓    |  ✓    |   ✓    |      ✓       |   ✓    |
| Rename organization, set its time zone and type      | `organization.update`         |  ✓    |       |        |              |        |
| Set organization and branch specialties (setup)⁵     | `organization.update`         |  ✓    |       |        |              |        |
| List / search / open branches (within branch scope)  | `branch.read`                 |  ✓    |  ✓    |   ✓    |      ✓       |   ✓    |
| Create branch (with its specialties⁵)                | `branch.create`               |  ✓    |  ✓    |        |              |        |
| Update branch (name, city, active/inactive, specialties⁵) | `branch.update`          |  ✓    |  ✓    |        |              |        |
| View team (members, emails, roles, scopes, count)    | `member.read`                 |  ✓    |  ✓    |        |              |        |
| Add an existing account by exact email               | `member.add`                  |  ✓    |  ✓    |        |              |        |
| Change role / branch scope / suspend / reactivate    | `member.update`               |  ✓    |  ✓¹   |        |              |        |
| Today's aggregate counts                             | `dashboard.read`              |  ✓    |  ✓    |  ✓²    |      ✓       |  ✓³    |
| Browse / search the patient registry                 | `patient.list`                |  ✓    |  ✓    |        |      ✓       |        |
| Open a patient and their appointment history         | `patient.read`                |  ✓    |  ✓    |  ✓²    |      ✓       |        |
| Register a patient                                   | `patient.create`              |  ✓    |  ✓    |        |      ✓       |        |
| Edit administrative details                          | `patient.update`              |  ✓    |  ✓    |        |      ✓       |        |
| Add / archive / reactivate branch registrations      | `patient.registration.manage` |  ✓    |  ✓    |        |      ✓       |        |
| View practitioner profiles and schedules             | `practitioner.read`           |  ✓    |  ✓    |  ✓²    |      ✓       |        |
| Manage profiles, weekly hours, exceptions            | `practitioner.manage`         |  ✓    |  ✓    |        |              |        |
| List / open appointments                             | `appointment.read`            |  ✓    |  ✓    |  ✓²    |      ✓       |        |
| Availability, book, reschedule                       | `appointment.book`            |  ✓    |  ✓    |        |      ✓       |        |
| Check in, cancel, mark no-show                       | `appointment.front_desk`      |  ✓    |  ✓    |        |      ✓       |        |
| Start and complete a visit                           | `appointment.visit`           |  ✓⁴   |  ✓⁴   |  ✓²    |              |        |
| Today's queue                                        | `queue.read`                  |  ✓    |  ✓    |  ✓²    |      ✓       |        |
| Write and read own visit records (clinical text)⁶    | `clinical.encounter.own`      |       |       |  ✓⁶    |              |        |
| See whether a visit is documented (status only)⁶     | `clinical.documentation_status.read` |  ✓    |  ✓    |  ✓²    |              |        |

¹ Additional membership rules, checked in this order (`membership.routes.ts`):

- The **owner role cannot be granted** by adding or updating members (`403 ROLE_NOT_ASSIGNABLE`);
  ownership transfer is out of scope.
- Only owners may change an **owner** membership (`403 OWNER_PROTECTED`).
- The **last active owner** cannot be suspended or demoted (`409 LAST_OWNER`).
- Nobody can change **their own** membership (`403 SELF_MODIFICATION`).
- Owners and admins are forced to organization-wide branch scope.

² **Doctors are limited to their own practitioner profile** (record visibility
`own_practitioner`): their own appointments, the queue and counts for those, their own schedule
(read-only), and the administrative details of patients linked to those appointments. They
cannot browse the registry, edit patients or act on other practitioners' appointments (`404`).

³ **Viewers** get aggregate counts within their branch scope and nothing identifiable: patient,
appointment, queue and practitioner endpoints answer `403`.

⁴ Owners and admins may correct workflow states **only through the same transitions** as everyone
else; there is no override of the state machine.

⁵ Specialty rules and their consistency checks: [SPECIALTIES.md](SPECIALTIES.md). The
`specialty` query parameter on practitioners, appointments, queue and dashboard is a view filter
that **only narrows** the authorized result; it never grants access to anything.

⁶ **Clinical visit records (phase 5)** — only the **treating doctor**: an active doctor membership
with an active practitioner profile, on that profile's own appointments, as the record's author,
within the current branch scope; re-checked on every request and inside every mutation. Owners
and admins get **no** clinical text (status only); other doctors get the generic `404`. Details:
[CLINICAL.md](CLINICAL.md).

Outside organizations (phase 4): creating a new organization — directly (`POST /orgs`) or by
completing one's own onboarding draft — is open to every signed-in user, who becomes its owner;
it never touches existing organizations. Custom-ownership inquiries are platform records with no
tenant access at all ([INQUIRIES.md](INQUIRIES.md)).

Record visibility per role is defined next to the matrix (`RECORD_VISIBILITY` in
`apps/api/src/tenancy/permissions.ts`); routes ask for it through
`visibleAppointmentsFilter` / `loadAccessiblePatient`, never by role name.

## Web app

- The app learns the role's permissions from `GET /api/v1/orgs/:orgId` and shows only pages and
  controls the role may use — for usability only; the API enforces everything above. A doctor's
  own practitioner id is included there as `membership.practitionerId`.
- The organization switcher lists only the caller's active memberships; the branch switcher only
  branches within their scope ("all branches" only for organization-wide scopes).
- All organization data is cached under `['org', orgId, …]`. Switching organization **cancels**
  in-flight requests of every other organization, removes their cache entries and remounts the
  shell, so no previous content can appear or arrive late. Branch-dependent queries carry the
  selected branch in their key, so a branch switch never shows another branch's cached rows.
  The same holds for the selected specialty (phase 4). Signing in or out clears the whole cache.

## Audit events

Generated by the server for: organization created/updated (incl. time zone and type),
organization specialties updated, branch created/updated (incl. specialties), member added, role changed, branch scope changed, suspended, reactivated;
patient created/updated/registered/registration archived/reactivated; practitioner
created/updated/schedule updated/exception added/removed; appointment booked/rescheduled/status
changed. Each stores actor user id, organization, action, target type/id, timestamp and a small
change summary — never passwords, cookies, session tokens, email addresses, patient names, phone
numbers or other demographic values (patient updates list changed field names only; a
cancellation reason stays on the appointment and the event only notes that one was given). There
is no audit viewer yet.

Clinical reads, writes and denials go to a separate, insert-only clinical audit log with ids and
metadata only ([CLINICAL.md](CLINICAL.md#audit-and-privacy)).

## Remaining before production use

- Isolation tests for each new tenant-owned module as it is added.
- Ownership transfer, organization deletion, member removal (not implemented).
- Privileged cross-branch duplicate reconciliation for patients (not implemented).
- Audit log retention, export and viewer.
- Data residency decision (Egypt / Saudi Arabia): may require region-specific or dedicated
  databases; the scoping layer keeps that possible but nothing is decided.
- Independent security review / penetration test.
