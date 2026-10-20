# Next phase brief — Phase 4: public platform and specialty-aware onboarding

_Recommended 2026-10-20. Not started._ Context: [ROADMAP.md](ROADMAP.md),
[PRODUCT_INVENTORY.md](PRODUCT_INVENTORY.md), [DECISIONS.md](DECISIONS.md).

## Why this phase next

The shared front-desk workflow (patients, schedules, booking, check-in, queue) is merged and
verified. The missing piece of the customer journey is everything before the workspace:
there is no public site, no solution selection, no custom-ownership path, and organizations
do not record their specialties. Nothing external blocks this work. Phases 5–6 (clinical and
specialty workspaces) also need organization specialties to decide what to show, so this phase
removes a dependency for them as well. Inspection found no blocker that would justify a different
order.

## Outcome

1. A visitor opens `/`, sees the platform in Arabic (or English), browses solutions for
   dentistry, physiotherapy, ENT and the shared clinic foundation, and opens a solution's detail
   page that says plainly what works today and what is planned.
2. From a detail page they either **create a clinic workspace** (registration → organization,
   time zone, first branch, **one or more specialties**) or **request a custom ownership project**
   (a separate page and form).
3. Existing users use **Sign in** from any public page and go straight to their workspace; signing in
   never passes through solution selection.
4. Owners/admins can review and change the organization's specialties in settings; practitioner
   specialties are limited to the organization's list.

## In scope

- Public route group: home, solutions catalog, solution detail per specialty plus the shared
  foundation, custom ownership page with request form, and a confirmation page. Arabic default,
  English complete, RTL/LTR, Alexandria/Inter, phone width.
- Navigation: public header with language switch, "Sign in" and "Create workspace"; signed-in
  visitors see "Go to my workspace".
- Onboarding: specialty multi-select (from the catalog) with the selection carried in from a
  solution page; existing explicit time-zone choice kept.
- Organization specialties: data model, API (owners/admins update; all members read), settings
  UI, audit event, demo seed values, practitioner specialty validation against the list.
- Ownership request intake: anonymous `POST` with strict validation, size limits, rate limiting,
  stored as platform records, no tenant linkage, no patient data; a developer script lists
  requests (documented in HANDOFF).
- Route-level code splitting so the public pages do not load the workspace bundle (also removes the
  bundle-size warning, if the split achieves it).
- Copy that makes no claims about prices, trial length, certifications, customers or delivery
  dates.

## Out of scope

Plans, prices, payments, trial expiry enforcement, platform operator console, emails/notifications,
clinical or specialty-specific features, SEO prerendering/server rendering, final branding and domain,
analytics/tracking scripts, chatbot.

## Role and data-access implications

- Public endpoints are anonymous, rate limited, CSRF/origin-protected as appropriate for an
  anonymous form, and return no tenant data.
- Ownership requests are platform data: not visible to any tenant role. Only operators can read them,
  through the developer script for now.
- Organization specialties: read by every member; changed by `organization.update` holders
  (owner/admin). Add to the permission matrix and role tests.
- No change to patient, appointment or queue visibility.

## Acceptance criteria

1. `/` renders the public home in Arabic (RTL, Alexandria) by default and in English (LTR, Inter)
   after switching; the choice persists; every new string exists in both locale files.
2. The catalog lists exactly the specialties from the API; each detail page separates
   "available now" (shared foundation features that exist) from "planned"; no dead buttons.
3. "Create workspace" from a solution page pre-selects that specialty in onboarding; the user can
   select several; the organization is created with that list, a time zone and a first branch.
4. Organizations created before this phase keep working; their owners see a prompt to choose
   specialties, but nothing is blocked.
5. Practitioner profiles reject a specialty outside the organization's list; existing
   profiles stay valid (documented migration rule).
6. The ownership form validates every field server-side, rejects unknown fields and oversized
   input, is rate limited, stores the request without any tenant link, and shows a confirmation;
   tenant users cannot read requests through any endpoint.
7. Signing in from a public page goes directly to the last workspace; `/login` and `/app` behave as
   today; signed-in visitors on `/` are offered their workspace.
8. Public pages load without the workspace bundle (verified from the build output).
9. Phone width: no horizontal scrolling on any public page.
10. `npm run verify` passes in the Codespace and CI passes on the PR's latest commit; private
    preview checked through the forwarded URL.

## Verification approach

- API: organization-specialty CRUD with permission matrix and isolation tests; ownership request
  validation, injection attempts, rate limiting, non-disclosure; seed idempotency.
- Web unit tests: locale key parity (existing), catalog rendering from API data, onboarding
  pre-selection.
- Playwright: visitor → solution → create workspace → workspace; visitor → ownership request;
  existing user → sign in from public page → workspace; Arabic/English fonts and direction;
  mobile.
- Build output inspection for chunk separation.
- Owner review of public copy in the PR before merge.

## Unresolved blockers and decisions

None block starting. Decisions to confirm during the phase (proposed defaults in DECISIONS.md):

- **Q1** wording of the trial/subscription entry point (default: "create your clinic workspace",
  no terms shown).
- **Q2** ownership request destination and fields (default: stored in the database, reviewed by
  script).
- **Q3** owner approval of public copy (default: in the PR review).
- Before any public launch (not this phase): privacy notice for the contact form (E4), domain and
  branding (E6), hosting (E1).
