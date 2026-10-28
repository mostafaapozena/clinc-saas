# Platform operator console (milestone 4)

The operator console is for the people who run raclinic itself, not for clinic staff. It lives at
`/operator` in the web app and at `/api/v1/platform` in the API.

**Code**
- API: `apps/api/src/modules/platform/`
  - `operator.model.ts`
  - `operator-auth.ts`
  - `platform.routes.ts`
  - `operator.cli.ts`
  - script `src/scripts/operators.ts`
- Web: a separate lazy chunk, `apps/web/src/operator/`, with its own API client in
  `lib/operator.ts`.

## Identity separate from tenant administration

| | Tenant users | Platform operators |
| - | ------------ | ------------------ |
| Accounts | `users` + `memberships` | `platform_operators` |
| Session cookie | `clinc_sid` / `__Host-clinc_sid` | `clinc_op` / `__Host-clinc_op` (`SameSite=Strict`) |
| CSRF header | `X-CSRF-Token` | `X-Operator-CSRF` |
| Lifetime | `SESSION_TTL_HOURS` | 8 h absolute, **30 min idle** |
| Registration | public | **none** — provisioned by CLI only |
| Audit | organization audit log | `platform_audit_events` (insert-only) |

- A tenant session never authenticates `/api/v1/platform`, and an operator session never
  authenticates tenant routes. Both directions are tested. Tenant credentials cannot sign in to
  the console.
- The operator login gives the same answer for an unknown account, a wrong password and a
  suspended account. It is rate limited.
- Suspending an operator deletes their sessions at once. Each request also re-checks that the
  operator is active.
- In the browser, an operator 401 never signs a clinic user out. The operator client throws its
  own error class, and the tenant session handler ignores it.

### Provisioning

There is no HTTP route that creates operators. Whoever can run this command has server and
database access:

```bash
npm run operators -w @clinc/api -- create --email ops@example.com --name "Name" --role platform_admin
npm run operators -w @clinc/api -- list
npm run operators -w @clinc/api -- suspend|reactivate|reset-password <email>
```

- The password comes from `OPERATOR_PASSWORD` (at least 12 characters). Otherwise one is
  generated and **printed once**.
- The last active platform administrator cannot be suspended.
- The development seed creates `operator.admin@demo.test` (platform_admin) and
  `operator.support@demo.test` (support). They use the `DEMO_PASSWORD` and are never created in
  production.

## Roles

| Permission | platform_admin | support |
| ---------- | :------------: | :-----: |
| Overview and health, organizations (metadata), plans (read), inquiries (read, reveal contact, status) | ✓ | ✓ |
| Manage plans, subscriptions (grant, restrict, reinstate, cancel), reconciliation, simulator actions | ✓ | |
| Operators (list, suspend, reactivate), platform audit | ✓ | |

## What operators can and cannot see

**Can see**
- An organization's name, type, specialties, time zone, currency, creation date and branch names.
- Owner display names, with **masked** email.
- Usage counts: branches, practitioners, members.
- The subscription, its history and provider events.

**Cannot see**
- There are **no routes** for patients, appointments, encounters or clinical records, or for
  clinic finances. Requests answer 404 (tested).
- There is **no impersonation**: no operator can act as a tenant user.
- Owner contact details stay masked. Clinics reach raclinic through support requests
  (milestone 5).

## Inquiries

The console replaces the review script for day-to-day work ([INQUIRIES.md](INQUIRIES.md)). The
script remains for server-side use.

- The list and the detail view show **masked** contact details.
- **Reveal contact** is an explicit action per inquiry, and it is audited.
- Status changes (new, reviewed, closed) are audited.

## Platform audit

The audit is insert-only: database hooks refuse updates and deletes. It records:
- operator sign-ins;
- every operator action;
- subscription changes made by providers and the system;
- entitlement "would block" events (`log` mode);
- operator provisioning by the CLI.

It holds metadata only: no patient or clinical data, and no secrets.

## Not included

- **MFA for operators.** It is documented as a production gate (B6) and is not claimed.
- An IP allowlist.
- Operator self-service password change. Reset uses the CLI.
- Support queue (milestone 5).
