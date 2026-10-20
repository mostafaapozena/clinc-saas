# Organizations, authorization and tenant isolation

> **Status: implemented for the resources that exist in phase 2** (organizations, branches,
> memberships, audit events) and tested in `apps/api/test/tenancy.test.ts` and
> `apps/api/test/authorization.test.ts`. Future modules (patients, appointments, …) must follow
> the same rules and add their own isolation tests before anyone relies on them.

## Model

| Collection     | Scope           | Notes                                                                  |
| -------------- | --------------- | ---------------------------------------------------------------------- |
| `users`        | global          | An account; may belong to several organizations.                       |
| `organizations`| the tenant      | Its `_id` is the scope. Reached only after resolving a membership.     |
| `branches`     | organization    | `organizationId` required; name unique per organization (case-insensitive). |
| `memberships`  | organization    | `organizationId` + `userId` unique; `role`; `status` active/suspended; `branchScope` `all` or `selected` + `branchIds`. |
| `audit_events` | organization    | Actor, action, target reference, small change summary, timestamp.     |
| `sessions`     | user            | See AUTH.md.                                                          |
| `specialties`  | platform        | **Deliberate exception**: shared public reference catalog, no tenant data. |

Onboarding (`POST /api/v1/orgs`) creates the organization, its first branch and the creator's
active **owner** membership in **one MongoDB transaction** — tested by forcing the membership
insert to fail and checking nothing remains. Transactions need a replica set: the devcontainer
and CI run MongoDB 8.2.12 as single-node replica set `rs0`.

## Enforcement (every org-scoped request)

1. **Authenticate** — session cookie → user (`loadSession`, `requireAuth`).
2. **Resolve membership** — `requireMembership` reads the active membership for
   `(organizationId from the URL, authenticated user)` **from the database on every request**.
   No membership, a suspended one, an unknown or a malformed id all give the same
   `404 NOT_FOUND`, so other organizations' existence is never disclosed. Suspensions, role and
   branch changes therefore apply to existing sessions immediately.
3. **Check permission** — `requirePermission('<permission>')` against the single
   `PERMISSION_MATRIX`; failures give `403 FORBIDDEN` (the caller is a member, so this discloses
   nothing new).
4. **Scope the query** — handlers build filters only with `orgScope`, `accessibleBranchesFilter`
   (branch documents) or `branchOwnedFilter` (future branch-owned records). The organization id
   always comes from the membership, never from the request body; extra body fields are dropped.
   Out-of-scope resource ids give the same `404`.

**Safety net:** `tenantGuardPlugin` on every tenant-owned schema throws for any query, update,
delete, count or aggregation whose filter (or first `$match`) lacks `organizationId`. The only
opt-out (`skipTenantGuard`) is listing **the caller's own** memberships across organizations,
filtered by the authenticated user id.

Referenced branches (membership branch scopes) must all belong to the caller's organization;
foreign and unknown ids give the same `400 INVALID_BRANCH`.

## Roles and authorization matrix

Branch scope: owners and admins are always organization-wide; other roles may be limited to
selected branches and only ever see those.

| Action (API)                                         | Permission            | Owner | Admin | Doctor | Receptionist | Viewer |
| ---------------------------------------------------- | --------------------- | :---: | :---: | :----: | :----------: | :----: |
| View organization, own role and permissions          | `organization.read`   |  ✓    |  ✓    |   ✓    |      ✓       |   ✓    |
| Rename organization                                  | `organization.update` |  ✓    |       |        |              |        |
| List / search / open branches (within branch scope)  | `branch.read`         |  ✓    |  ✓    |   ✓    |      ✓       |   ✓    |
| Create branch                                        | `branch.create`       |  ✓    |  ✓    |        |              |        |
| Update branch (name, city, active/inactive)          | `branch.update`       |  ✓    |  ✓    |        |              |        |
| View team (members, emails, roles, scopes, count)    | `member.read`         |  ✓    |  ✓    |        |              |        |
| Add an existing account by exact email               | `member.add`          |  ✓    |  ✓    |        |              |        |
| Change role / branch scope / suspend / reactivate    | `member.update`       |  ✓    |  ✓¹   |        |              |        |

¹ Additional membership rules, checked in this order (`membership.routes.ts`):

- The **owner role cannot be granted** by adding or updating members (`403 ROLE_NOT_ASSIGNABLE`);
  ownership transfer is out of scope.
- Only owners may change an **owner** membership (`403 OWNER_PROTECTED`).
- The **last active owner** cannot be suspended or demoted (`409 LAST_OWNER`).
- Nobody can change **their own** membership (`403 SELF_MODIFICATION`).
- Owners and admins are forced to organization-wide branch scope.

Doctor, receptionist and viewer currently differ only in name: no clinical or front-desk actions
exist yet, and none are invented. Their permissions will diverge when those modules are built.

## Web app

- The app learns the role's permissions from `GET /api/v1/orgs/:orgId` and shows only pages and
  controls the role may use — for usability only; the API enforces everything above.
- The organization switcher lists only the caller's active memberships; the branch switcher only
  branches within their scope ("all branches" only for organization-wide scopes).
- All organization data is cached under `['org', orgId, …]`; switching organization removes
  every other organization's cache entries and remounts the shell, so no previous content can
  appear. Signing in or out clears the whole cache.

## Audit events

Generated by the server for: organization created/updated, branch created/updated, member
added, role changed, branch scope changed, suspended, reactivated. Each stores actor user id,
organization, action, target type/id, timestamp and a small change summary (e.g. role from/to,
branch count) — never passwords, cookies, session tokens or email addresses. There is no audit
viewer yet.

## Remaining before production use

- Isolation tests for each new tenant-owned module as it is added.
- Ownership transfer, organization deletion, member removal (not implemented).
- Audit log retention, export and viewer.
- Data residency decision (Egypt / Saudi Arabia): may require region-specific or dedicated
  databases; the scoping layer keeps that possible but nothing is decided.
- Independent security review / penetration test.
