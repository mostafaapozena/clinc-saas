# Project context

## Product

A SaaS platform for managing clinics and medical centers, initially for **Egypt** and
**Saudi Arabia**.

## Established decisions

| Topic             | Decision                                                                      |
| ----------------- | ----------------------------------------------------------------------------- |
| Stack             | MERN (MongoDB, Express, React, Node.js) in TypeScript                         |
| Language          | Arabic default (RTL, Alexandria font); full English (LTR, Inter font)         |
| Customers         | Individual clinics, medical centers, and organizations with multiple branches |
| Tenancy           | Shared database; every tenant-owned record carries `organizationId` (and `branchId` when branch-owned); enforced on the server — see [architecture/TENANCY.md](architecture/TENANCY.md) |
| Accounts          | One account per email; a user can belong to several organizations            |
| Authentication    | Email + password, Argon2id, server-side sessions in an HttpOnly cookie, CSRF token — see [architecture/AUTH.md](architecture/AUTH.md) |
| Initial roles     | Owner, admin, doctor, receptionist, viewer (permissions only for implemented actions) |
| Product shape     | Shared management foundation plus specialty-specific functionality            |
| First specialties | Dentistry, physiotherapy, ENT                                                 |
| Out of scope      | Complex systems such as radiology centers are separate custom projects        |
| Commercial        | Subscriptions and a free trial are part of the concept                        |
| Ownership track   | Ownership-based delivery is a separate commercial track, scope to be defined  |

## Not yet decided — do not invent

- Product name (the UI uses "منصة العيادات / Clinics Platform", marked temporary).
- Pricing, plans, trial length, billing provider.
- Clinical workflows and requirements per specialty, and which roles may do what clinically.
- **Hosting and data residency for Egypt and Saudi Arabia** (e.g. whether data must stay in-country,
  per-country deployments, dedicated databases for some customers). Unresolved until hosting is
  approved; nothing in the development setup implies regulatory compliance.
- Email provider (needed for verification, password recovery, invitations), MFA policy.
- Messaging (e.g. WhatsApp) and payment integrations.
- Ownership-delivery track terms.

## Working assumptions (revisit when decided)

- Specialties are a platform-wide reference catalog; organizations will later choose theirs.
- Owners and admins administer the organization; doctor/receptionist/viewer differ only once
  clinical and front-desk modules exist.
- Ownership transfer and organization deletion will be designed explicitly later.
- Development data is synthetic and disposable; the development database is not a backup.
