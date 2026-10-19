# Organization context and tenant isolation (proposal)

> **Status: proposed, not implemented.** Nothing in the codebase enforces tenant isolation yet.
> Do not describe the system as multi-tenant or isolation-safe until the items under
> "Definition of done" are built and tested.

## Concepts

- **Organization** (tenant): the paying customer, such as a single clinic or a medical group.
  Owns subscriptions and all clinical/operational data.
- **Branch**: a physical location belonging to one organization. A single clinic has one branch.
- **Membership**: links a user to an organization with a role, optionally limited to branches.
  A user may belong to more than one organization (e.g. a doctor working at two centers).
- **Platform data**: shared reference catalogs (e.g. specialties) with no `organizationId`.

## Proposed approach: shared database, organization-scoped documents

1. Every tenant-owned collection has a required, indexed `organizationId`. Branch-level records
   also carry `branchId`. Compound indexes start with `organizationId`, and unique constraints
   are scoped by it, e.g. `{ organizationId: 1, fileNumber: 1 }`.
2. **Resolve the organization context on the server, once per request**, from the
   authenticated session and the user's membership, never from a client-supplied ID alone.
   The context (`organizationId`, allowed `branchIds`, role) is attached to the request.
3. **Data access goes through tenant-scoped repositories** that require the context and add
   `organizationId` to every query, update, aggregate (`$match` first) and insert. A Mongoose
   plugin should additionally reject queries on tenant models that lack an `organizationId`
   filter, as a safety net. Unscoped access is only possible through an explicit, audited
   platform-admin path.
4. Cross-organization references (e.g. a patient ID from another tenant) are validated to belong
   to the same organization before use.
5. Files and exports are stored under organization-specific prefixes and served only after the
   same authorization check.
6. Audit log entries record organization, user, action and target.

### Why not database-per-tenant (yet)

Database-per-tenant gives stronger physical isolation but multiplies connections, migrations and
operational cost for many small clinics. The shared model with enforced scoping is the usual
starting point. The repository layer above keeps a later move of large or regulated tenants to
dedicated databases possible. Revisit this if data-residency rules (e.g. Saudi hosting
requirements) or enterprise contracts demand physical separation.

## Definition of done (before claiming isolation)

- [ ] Organization, branch and membership models with authentication.
- [ ] Request-level organization context middleware.
- [ ] Tenant-scoped repository/plugin that rejects unscoped queries.
- [ ] Automated tests that create two organizations and prove that reads, updates, deletes,
      aggregates and file access from one cannot reach the other's data, including by guessing IDs.
- [ ] Review of indexes and unique constraints for tenant scoping.
