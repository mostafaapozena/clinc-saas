# Signup and onboarding

Implemented in `apps/api/src/modules/onboarding/` and `apps/web/src/pages/OnboardingPage.tsx`.
Tested in `apps/api/test/onboarding.test.ts`, `apps/web/src/public/Public.test.tsx`,
`e2e/auth.spec.ts`, `e2e/public.spec.ts`.

## Journey

1. Public "Create your clinic workspace" (any solution page) links to `/start`, carrying an
   optional pre-selection (`?specialty=<catalog code>` or `?type=medical_center`). Unknown values
   are dropped.
2. `/start`: signed out → `/register?next=/onboarding?…`; signed in → `/onboarding?…`.
   Registration reuses the existing account system (no second identity system); afterwards, and
   after signing in through "Already have an account?", the validated `next` brings the user to
   onboarding with the pre-selection intact.
3. Onboarding: **organization** (type, name, explicit time zone — Africa/Cairo, Asia/Riyadh and
   the other supported zones; never inferred from language or browser) → **specialties** (one or
   more from the catalog) → **first branch** (name, optional city, its specialties — a subset of
   the organization's) → **review** → create. Multi-branch organizations add further branches
   afterwards on the Branches page (owners/admins), as the form explains.
4. Completion lands in `/app/<organizationId>`.

Only setup information is collected: no national IDs, patient data, clinical data or payment
details.

## Persistence and safe completion

- One open **draft** per user (`onboarding_drafts`, unique partial index on `userId` for
  `status: 'draft'`). It belongs to the user, not to a tenant.
- `GET /api/v1/onboarding` returns the open draft; `PUT` saves a step (all fields optional and
  allowlisted; specialty codes checked against the catalog; `version` optimistic — another tab's
  save gives `409 VERSION_CONFLICT` and the web app reloads the stored draft).
- A reload or a later visit resumes at the saved step with the saved values.
- `POST /api/v1/onboarding/:draftId/complete` validates the whole draft and, **in one MongoDB
  transaction**, creates the organization, its first branch, the owner membership and the audit
  event, and marks the draft completed with the new organization's id. Any failure leaves nothing
  behind and the draft still open (tested with an injected failure). Missing data answers
  `400 ONBOARDING_INCOMPLETE` with the field errors and the step to return to.
- **Duplicate and concurrent requests:** every completion transaction writes the draft first, so
  concurrent completions conflict and retry; the retry sees the draft completed and returns the
  organization already created (`200`, `replayed: true`). Six simultaneous completions create
  exactly one organization (tested). Completion is rate limited per IP (`SETUP_RATE_LIMIT_MAX`
  per hour), like `POST /api/v1/orgs`.
- Another user's draft id answers `404`.

## Existing users

- A signed-in member who opens onboarding (e.g. from a public page) first sees their existing
  workspaces with direct links, and a separate "Set up a new organization" action. Nothing is
  created automatically.
- Onboarding only ever creates a **new** organization owned by the caller. It never reads or
  changes an existing organization, so public parameters cannot alter the specialties of an
  organization the user merely belongs to (tested with a receptionist).
- Existing customers keep the direct `/login` route; after sign-in they go straight to their
  last workspace (`/app`), never through the public site or solution selection.

## Redirects

`safeNext` (`apps/web/src/lib/navigation.ts`) accepts only internal paths under `/app` and
`/onboarding`; anything else — other origins, `//host`, `/\host`, control characters, other
paths — falls back to the default. Unauthenticated workspace visits go to
`/login?next=<path>` and return there after sign-in.

## Later: trials and subscriptions (not implemented)

No plan, trial, price, payment or expiry exists. Phase 8 will attach a subscription record to the
organization at completion time (the single place organizations are created through the web
app) and decide the access behavior per subscription state. Until then the call to action says
"Create your clinic workspace" and the review step states that commercial plans have not been
announced.
