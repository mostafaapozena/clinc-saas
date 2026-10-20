# Project context

## Product

A SaaS platform for managing clinics and medical centers, initially for **Egypt** and
**Saudi Arabia**.

## Established decisions

| Topic           | Decision                                                                      |
| --------------- | ----------------------------------------------------------------------------- |
| Stack           | MERN: MongoDB, Express, React, Node.js, written in TypeScript                |
| Language        | Arabic is the default, with RTL layout; English/LTR must be supported         |
| Customers       | Individual clinics, medical centers, and organizations with multiple branches |
| Data separation | Each organization's data is isolated from the others (multi-tenant SaaS)      |
| Product shape   | Shared management foundation plus specialty-specific functionality            |
| First specialties | Dentistry, physiotherapy, ENT                                               |
| Out of scope    | Complex systems such as radiology centers are separate custom projects and do not enter the SaaS scope automatically |
| Commercial      | Subscriptions and a free trial are part of the concept                        |
| Ownership track | Ownership-based delivery is a separate commercial track; scope to be defined later |

## Not yet decided — do not invent

- Product name (the UI uses the temporary name "منصة العيادات / Clinics Platform").
- Pricing, plan contents, trial length, billing provider.
- Clinical workflows and requirements per specialty.
- Hosting/production provider, data-residency requirements (e.g. KSA hosting rules), and
  regulatory compliance scope.
- Messaging integrations (e.g. WhatsApp), payment integrations.
- The ownership-delivery track's terms.

## Working assumptions (revisit when decided)

- Phase 1 only establishes the technical foundation; no medical features and no real data.
- Specialties are a platform-level reference catalog shared by all organizations; each
  organization will later choose which specialties it uses.
- Tenant isolation will be enforced at the application layer with an organization identifier on
  every tenant-owned record (see [architecture/TENANCY.md](architecture/TENANCY.md)). This is a
  proposal and is not built.
- Development data is synthetic and disposable; the dev database is not a backup.
