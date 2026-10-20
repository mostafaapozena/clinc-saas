# Specialties: organization, branch and practitioner

Implemented in `apps/api/src/modules/specialties/`, `apps/api/src/modules/organizations/`
(`specialty-config.ts`, `PUT /orgs/:orgId/specialties`), branch and practitioner routes. Tested in
`apps/api/test/specialty-config.test.ts`, `onboarding.test.ts`, `demo-seed.test.ts`.

## Catalog

One platform-wide catalog (`specialties` collection, `specialty.seed.ts`): `dentistry`,
`physiotherapy`, `ent`. Every specialty code anywhere is validated against it
(`400 unsupported_specialty`). The public solution pages use the same codes
(`apps/web/src/public/solutions.ts`; a web test fails if they drift apart). **Radiology and other
complex specialties are not in the catalog**: they are custom-project candidates only, and the
onboarding and inquiry flows reject them as SaaS specialties.

"Medical center" is an organization **type**, not a specialty.

## Model

| Record | Field | Meaning |
| ------ | ----- | ------- |
| Organization | `type` | `clinic` \| `medical_center` \| `multi_branch` — descriptive, limits nothing; `null` before phase 4 |
| Organization | `specialtyCodes` | Specialties the organization practices (one or more). `[]` = not configured yet |
| Organization | `configVersion` | Serialization counter, incremented by every specialty-configuration change |
| Branch | `specialtyCodes` | Specialties offered at the branch — a non-empty subset of the organization's once configured |
| Practitioner profile | `specialtyCode` | The doctor's specialty (unchanged from phase 3) |

A medical center enables several specialties; nothing fixes one specialty per organization.

## Rules (enforced by the API once the organization is configured)

1. Every branch offers at least one specialty, all of them enabled for the organization
   (`400 BRANCH_SPECIALTIES_INVALID` / field `not_in_organization`; new branches need
   `specialtyCodes`, field `required`).
2. A practitioner's specialty is enabled for the organization (`400 SPECIALTY_NOT_ENABLED`) and
   offered at **every** branch they are assigned to (`409 SPECIALTY_NOT_OFFERED_AT_BRANCH`).
3. A specialty cannot be removed from the organization or a branch while a practitioner of that
   specialty works there — inactive profiles included (`409 SPECIALTY_IN_USE`, listing the
   profiles to change). Nothing is dropped or reassigned silently.
4. Booking and availability refuse a practitioner at a branch that does not offer their specialty
   (`409 SPECIALTY_NOT_OFFERED`) — a defensive check; rules 1–3 keep that state from arising.

**Who:** organization specialties and type — owners (`organization.update`); branch specialties —
owners and admins (`branch.create` / `branch.update`); practitioner specialty — owners and admins
(`practitioner.manage`).

**Concurrency:** organization setup, branch create/update and practitioner create/update (when
specialty or branches change) run in transactions that first increment
`organization.configVersion`. Two concurrent changes therefore write-conflict; the retry sees the
other's result. Forced-race tests cover "branch drops a specialty" vs "a practitioner of it is
assigned", in both orders. The owner's setup endpoint also takes `configVersion` as an optimistic
version (`409 VERSION_CONFLICT`).

## Organizations created before phase 4 (migration)

- Their documents have no `type`/`specialtyCodes`; they read as `null`/`[]` and **keep working
  exactly as before**: none of the rules above applies, bookings and front-desk work continue.
- Nothing is inferred (not from the organization name, nor from practitioners' specialty codes),
  and no data is rewritten automatically. Practitioner specialty codes stay as they are.
- The **explicit setup** is `PUT /api/v1/orgs/:orgId/specialties` (Settings → "Type and
  specialties"): the owner chooses the organization's specialties and the specialties of every
  branch in one request. It is refused, with the practitioners or branches to fix, if it would
  leave a practitioner outside the chosen specialties or a branch without one. Owners see a
  prompt on the home page until it is done; other members see nothing different.
- Repeatable: the setup can be repeated or changed later under the same rules. The demo seed
  includes one such organization (`owner.legacy@demo.test`).

## Workspace context (web)

- `GET /orgs/:orgId` returns `type`, `specialtyCodes`, `configVersion`; branches return
  `specialtyCodes`.
- Home shows the enabled specialties and the accessible branches offering each, with a note
  that the workspace is the **shared operational workspace** — there are no specialty clinical
  screens.
- A specialty switcher appears when there is a choice (≥ 2 specialties for the selected branch).
  It narrows practitioners, appointments, the queue and today's counts via a `specialty` query
  parameter. On the server the parameter **only intersects** the already-authorized filter
  (`narrowToSpecialty`): a doctor still sees only their own appointments, a branch-limited user
  only their branches, a viewer only counts. The choice is stored per organization in the browser
  and is part of every affected cache key.
- Booking is not filtered by the switcher (the booking page lists all bookable doctors of the
  chosen branch).

## How future clinical modules will use this (not implemented)

A specialty module (e.g. dental chart) would be enabled for an organization only when the
organization has that specialty, would show its screens for appointments whose practitioner has
that specialty, and would follow the clinical access model to be designed in phase 5 (see
[ROADMAP.md](../ROADMAP.md)). The specialty context gives the "which workspace" signal; it never
grants access by itself.
