# Front-end redesign — implementation tracker

Phase 14. Adapts the structure and interaction patterns of the reference pack (clinit.app, captured
2026-10-27, `REF-001…REF-057`, patterns `P01…P45`) to raclinic's own identity: navy / turquoise /
coral, the existing logo files, Arabic first (RTL, Alexandria) and English (LTR, Inter).

Nothing is copied from the reference: no branding, copy, customer names, testimonials, prices,
trial terms, statistics or images. Every screenshot on raclinic's site is a real raclinic screen
with synthetic data (`scripts/brand/product-shots.cjs`).

## Classes

| Class | Meaning                                                                             |
| ----- | ----------------------------------------------------------------------------------- |
| A     | Adopt the pattern as is (layout or interaction) in raclinic's identity.             |
| B     | Adapt: the pattern fits, its content must be raclinic's own and true.               |
| C     | Build only behind a real function: the page part exists because the feature exists. |
| D     | Avoid: an anti-pattern seen in the reference; we check that we do not repeat it.    |
| E     | Blocked on a decision or on source material from the owner. Not built, not faked.   |

Status: **done** (in this phase's PRs), **next** (planned in this phase), **E** (waiting).

## Public website

| Ref                                  | Target                  | Change                                                                                                                                                                                                                                                           | Depends on                     | Acceptance                                                                         | Class | Status               |
| ------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------- | ----- | -------------------- |
| REF-002, REF-044 (P01, P04)          | Home hero               | Two-column hero: headline with an emphasised phrase, lead, two calls to action, reassurance list, a real product screenshot in a browser frame with two floating labels. Mirrors in RTL.                                                                         | Product screenshots            | One `h1`; screenshot matches the page language; stacks on mobile without overflow  | A     | done                 |
| REF-003 (P05, P06)                   | Facts band, sticky bar  | Navy band with product facts (specialties, languages, roles, branches) — counts taken from the product, not marketing numbers. Sticky call-to-action bar after the hero, dismissible for the session.                                                            | —                              | No invented figures; bar hidden while the hero is visible; respects reduced motion | B     | done                 |
| REF-004 (P07)                        | Specialty chips         | Chips under the solutions heading, each linking to its solution page.                                                                                                                                                                                            | —                              | Every chip links to an existing route                                              | A     | done                 |
| REF-005, REF-013 (P08, P09)          | Feature splits          | Three alternating splits (appointments, clinical record, finance) with real screenshots and checklists.                                                                                                                                                          | Product screenshots            | Text describes only implemented behaviour                                          | B     | done                 |
| REF-006, REF-014, REF-017 (P10)      | Pricing teaser and page | Not built. No prices, plans or trial terms exist yet.                                                                                                                                                                                                            | Owner decision on pricing      | —                                                                                  | E     | E                    |
| REF-016, REF-007 (P11)               | Closing call to action  | One closing block (create a workspace / talk to us). The trial band is not built (no trial terms).                                                                                                                                                               | —                              | Single closing CTA per page                                                        | B     | done                 |
| REF-008 (P12)                        | Footer                  | Navy footer, four groups (solutions, product, company, account), company line, development notice, bottom bar (rights, privacy, security, status).                                                                                                               | —                              | No dead links (covered by `Site.test.tsx`)                                         | A     | done                 |
| REF-009…REF-012 (P13, P14, P16)      | Header menus            | Solutions and Company dropdowns: icon, name, one-line description; keyboard and Escape close; outside click closes. No resources menu (no blog or help centre yet).                                                                                              | —                              | `aria-expanded` reflects state; links verified                                     | A     | done                 |
| REF-015, REF-018, REF-019 (P20, P21) | Comparison tables       | Hosted workspace vs custom project table, and paper vs raclinic on the solutions page. No competitor comparison (no verified competitor data).                                                                                                                   | —                              | Rows describe raclinic only                                                        | B     | done                 |
| REF-020…REF-022 (P17, P22, P23)      | Solutions catalog       | Hero with chips that switch the preview screenshot; catalog cards with specialty tones and hover border.                                                                                                                                                         | Product screenshots            | Preview changes on chip click; works by keyboard                                   | A     | done                 |
| REF-023…REF-027, REF-056 (P24, P29)  | Solution pages          | Distinct page per specialty: badge, problems, specialty tools, workflow, shared capabilities, needs, FAQ, comparison, CTA. Specialty tone from the brand palette. Medical centres page for multi-specialty.                                                      | Specialty tools                | Planned tools listed separately as not yet available                               | B     | done                 |
| REF-028, REF-029 (P30, P31)          | About                   | Verified facts only: the product, Devware, what is built, how data is handled. No team photos, office counts or founding stories.                                                                                                                                | Owner facts about Devware      | No unverified claim                                                                | B     | done (facts limited) |
| REF-030, REF-031, REF-057 (P32, P33) | Contact                 | Two-step form (intent and contact, then message), persisted as a contact message with a reference, validated on the server, idempotent, rate limited; reviewed in the operator console. Contact channels shown only when configured. Form comes first on mobile. | Contact message API            | Message stored once; success shows the reference; no email promise                 | C     | done                 |
| REF-032…REF-034 (P34, P35)           | FAQ                     | Search (folds Arabic spelling variants), categories with counts, accordion (+ / ×), FAQ structured data.                                                                                                                                                         | —                              | Search and filter tested                                                           | A     | done                 |
| REF-035, REF-036 (P36)               | Product tour            | Gallery of real screenshots grouped by area, with the capture date.                                                                                                                                                                                              | Product screenshots            | All images exist in both languages                                                 | C     | done                 |
| REF-041, REF-042 (P40)               | Public demo             | Not built. A public demo needs an isolated, reset-on-schedule environment.                                                                                                                                                                                       | Owner decision, infrastructure | —                                                                                  | E     | E                    |
| Security / privacy                   | Pages                   | Implemented practices only (sessions, CSRF, isolation, audit, retention). No certification or compliance claims.                                                                                                                                                 | —                              | Copy-doc forbidden-word check passes                                               | B     | done                 |

## Accounts and onboarding

| Ref                    | Target     | Change                                                                                                                                          | Depends on        | Acceptance                              | Class | Status |
| ---------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------- | ----- | ------ |
| REF-037, REF-038 (P37) | Sign-up    | Split screen: form beside a navy value panel; the panel lists what the workspace includes, with a real screenshot. No subdomain or logo upload (not implemented). | —                 | Same fields and validation as today     | B     | done   |
| REF-039 (P38)          | Sign-in    | Split screen matching sign-up; existing single-step email and password.                                                                         | —                 | Auth, CSRF and safe redirects unchanged | B     | done   |
| REF-040 (P39)          | PIN unlock | Not built.                                                                                                                                      | Security decision | —                                       | E     | E      |

## Workspace and operator console

| Target            | Change                                                                      | Depends on          | Acceptance                                             | Class | Status |
| ----------------- | --------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------ | ----- | ------ |
| Workspace sidebar | Group navigation by area (daily work, records and billing, administration, account); same permissions decide what shows.              | —                   | Role separation unchanged; tests pass                  | B     | done   |
| Workspace pages   | Shared tokens and components from the public site (cards, chips, headings). | —                   | No layout overflow at 390px                            | B     | next   |
| Operator console  | Contact messages list and detail (masked, audited reveal, status).          | Contact message API | Tested in `OperatorConsole.test.tsx` and the API tests | C     | done   |

## Anti-patterns checked (class D)

| Ref     | Pattern                                  | How raclinic avoids it                                                                                 |
| ------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| REF-049 | English strings on Arabic pages          | All copy comes from the locale files; the parity test fails on a missing key                           |
| REF-050 | Desktop card heights kept on mobile      | Cards have no fixed minimum height; height follows content                                             |
| REF-051 | Mixed Latin and Arabic without isolation | Latin names and references are wrapped in `bdi`                                                        |
| REF-054 | Footer columns clipping at 390px         | Two flexible columns (`minmax(0, 1fr)`) with short labels that wrap; checked at 390px with no overflow |
| REF-057 | Form pushed below long info on mobile    | The contact form comes before the channel card on mobile                                               |
| REF-001 | Chat pop-up over the first screen        | No chat widget (no live messaging)                                                                     |

## Waiting on the owner (class E)

- Pricing, plans and trial terms.
- Real contact channels (support email, phone, hours) — set through configuration, shown when set.
- Further facts about Devware for the About page.
- Legal privacy policy and terms text.
- A public demo environment.
- Live messaging, payments, AI features, insurance or government integrations, prescriptions, attachments.

## Verification

- Unit: `apps/web/src/public/Site.test.tsx`, `Public.test.tsx`, `OperatorConsole.test.tsx`, `apps/api/test/contact-messages.test.ts`.
- Copy: `docs/PUBLIC_COPY.md` regenerated; forbidden-word check.
- Screenshots: before and after captures at the reference sizes (1150×631 desktop, 390 mobile), Arabic and English, kept outside the repository.
