# UI polish implementation (phase 15)

Tracker for the owner's UX/UI review of 2026-10-28 (49 findings UX-001…049, icon and motion
recommendations ICN-01…11 / ANIM-01…11) and the implementation brief of the same day (light and
dark themes, layout, icons, navbar, motion, counters, verification, preview). The review package
is kept outside the repository (it contains screenshots of the running app):
`review-inputs/ux-review-2026-10-28/` next to the checkout.

Branch `phase-15/ui-polish`, stacked on `phase-14/public-redesign` (PR #15).

**Status:** `done` implemented and verified · `partial` implemented in part, the rest named ·
`deferred` not done, with the reason · `decision` needs the owner.
**Evidence:** unit tests (`*.test.tsx`), e2e specs (`e2e/*.spec.ts`), and screenshots in
`review-screenshots/raclinic-ui-polish-2026-10-28/` (INDEX.md there).

## 1. Brief requirements

| ID | Requirement | Correction | Status | Evidence |
| --- | --- | --- | --- | --- |
| THEME-1 | Light and dark themes everywhere, one shared system | `<html data-theme>` with semantic tokens: `styles.css` (workspace, account pages, operator), `workspace.css` (shadows, mint), `public.css` (site palette); no per-component dark rules | done | `lib/theme.test.tsx`; screenshots `*-light` / `*-dark` in every folder |
| THEME-2 | Switch in public header, auth/onboarding, workspace, operator | `ThemeSwitcher` next to the language button in all four layouts (icon button, named action) | done | `Site.test.tsx` "theme switch"; screenshots |
| THEME-3 | Light / dark / follow system; persisted; no backend dependency | `ThemeSelect` on the profile page; `localStorage clinc.theme` (absent = system); other tabs follow (`storage` event); system changes followed while on "system" | done | `lib/theme.test.tsx` |
| THEME-4 | No wrong-theme flash, CSP-compatible | `public/theme-init.js`, a blocking script in `<head>` before the stylesheet (Helmet's CSP forbids inline scripts); `html[data-theme=dark]` background in the head style | done | built `dist/index.html` checked: script before the CSS |
| THEME-5 | Contrast; status not by color alone | Dark pairs computed: text 13.2:1, muted 7.1:1, links 9.9:1, statuses 5.7–8.4:1, site tones ≥ 7.4:1; badges keep the dot + text; notices and field errors gained icons | done | contrast table in this file (§5) |
| THEME-6 | Logo intact | Unchanged artwork; on dark surfaces it stays on its white tile (BRAND.md) | done | screenshots |
| THEME-7 | Screenshots framed, not inverted | Light product images in a frame with a lit edge in dark mode | done | `public/*-dark` |
| THEME-8 | Print independent of the theme | `@media print` resets the tokens to the light palette | done | `styles.css` print block |
| LAYOUT-1 | Gutters, content width, rhythm | `--gutter` (16–32px), `--content-max` 1280px centered beside the sidebar; spacing scale; page header and action on one line | done | workspace/operator screenshots |
| LAYOUT-2 | Aligned card rows, coherent metric cards | `Metric` component (icon, label, value, link); 6 → 3 → 2 columns by card width (container query), never an orphan | done | `UiPolish.test.tsx` dashboard; `owner-home-*` |
| LAYOUT-3 | Safe areas | `viewport-fit=cover`; gutters and fixed bars use `env(safe-area-inset-*)` | done | CSS |
| RESP-1 | 360–1920px, no page overflow | Header measured 1024–1920 ar/en; sweep of 20 pages × 8 widths (360, 390, 430, 720, 768, 1024, 1366, 1920) × ar/en with light/dark alternating: 0 overflow, 0 console errors (320 loads) | done | sweep log in the handoff; `e2e/public.spec.ts` overflow list |
| RESP-2 | Zoom up to 200% | 720px CSS width = 1440px screen at 200%: part of the sweep | done | sweep |
| ICON-1 | Icons on features, steps, solutions, metrics, sections, empty states | ICN-01…11 below; operator and clinic metrics; card titles | done | screenshots |
| NAV-1 | Navbar and dropdown corrections | UX-001…005 below | done | `Site.test.tsx`; `menus/` |
| MOTION-1 | Purposeful motion, reduced-motion respected | ANIM-01…11 below; all keyframes/transitions inside `prefers-reduced-motion: no-preference`; content hidden before a reveal only after the observer is ready | done | `public/motion.ts`; CSS |
| COUNT-1 | Count-up for real numbers | `CountUp`: once on first appearance; React always renders the exact final value; the moving digits are hidden from screen readers; no animation with reduced motion or a zero; a new value (scope change, refresh) shows at once | done | `lib/theme.test.tsx` CountUp tests |
| COUNT-2 | Where | Public facts band and about/tour stats (verified product facts only), clinic dashboard metrics, operator overview | done | screenshots |
| ARCH-1 | Security and behavior preserved | No API or permission change. Front-end checks mirror API rules (booking branch, finalize minimum); the API still decides | done | full `npm run verify` and CI |

## 2. Review findings

| ID | Where | Correction | Status | Evidence |
| --- | --- | --- | --- | --- |
| UX-001 | Header menus, drawer | Explicit `.site-menu-item-text/-desc`; self-contained `.site-icon-tile` (centered, tinted, line-height 1); shared `MenuItem` | done | `Site.test.tsx` "menu entries mark their text"; `menus/` |
| UX-002 | Arabic header overflow | Compact header (gaps, paddings, short language label "EN"/"ع"), drawer below 1200px; measured: 9px to spare at 1200px in Arabic | done | measurements; `public/home-*` |
| UX-003 | Sign-in hidden 1061–1240px | Always in the bar on desktop widths, in the drawer below | done | screenshots |
| UX-004 | Escape / Tab out | Escape returns focus to the trigger; leaving a menu with Tab closes it | done | `Site.test.tsx` |
| UX-005 | Menu button at the edge | The hidden `<nav>` itself is hidden, no extra gap | done | `menus/drawer-mobile-*` |
| UX-006 | Navy step text 2.2:1 | On-navy muted tone (6.7:1) | done | `public/home-*` |
| UX-007 | Dark scheme after the public site | Superseded by THEME-1…4: one theme everywhere, chosen by the user | done | |
| UX-008 | Unreadable product shots | Every shot regenerated at 2x (2560×1600) plus 1x, served with `srcset`; hero image eager with high fetch priority. Cropped close-ups not made: the full screens stay (tour, hero) | partial | `Site.test.tsx` checks both densities exist |
| UX-009 | Blank preview on chip switch | All four shots stacked in one frame, cross-fade, idle preload | done | `public/solutions-*` |
| UX-010 | Full size opened raw JPG | In-page `<dialog>` with previous/next, Escape, focus return, link to the original | done | `public/tour-lightbox-*` |
| UX-011 | Duplicate sticky CTA on desktop | Only below 1200px (where the header has no create button), as a bottom bar with safe-area padding | done | mobile screenshots |
| UX-012 | Long home page, duplicate eyebrows | Duplicate eyebrows reworded (solutions, compare). Merging sections is the owner's decision D-2 | partial / decision | `docs/PUBLIC_COPY.md` |
| UX-013 | "Smart assistant" next to "no AI" | Hero eyebrow made descriptive ("إدارة العيادات بالعربية والإنجليزية"); the tagline stays in the logo areas (D-3 recommendation applied, reversible) | done | |
| UX-014 | Lost specialty on later CTAs | Every create link of a solution page (header, drawer, comparison, closing, footer) keeps it | done | `Site.test.tsx` |
| UX-015 | Tools notice heading | Only direct headings of a split get the large size | done | `public/dentistry-*` |
| UX-016 | Contact column order | Form first on every width | done | `public/contact-*` |
| UX-017 | FAQ gap | Tighter section after the hero | done | `public/faq-*` |
| UX-018 | Sign-up note contradicts links | States what exists: verification and recovery available, no real email sent yet | done | |
| UX-019 | "Resuming" on a fresh setup | The wizard keeps the draft found on load; saving no longer remounts it | done | |
| UX-020 | No getting started | Owner/admin checklist from the organization's own data (currency, service, doctor, team, patient) with links and a book action; hidden when done or dismissed | done | |
| UX-021 | Dashboard not role-aware, static counts | Counts link to the filtered appointments (not for viewers); shortcuts and overview first, reference cards after | done | `UiPolish.test.tsx` dashboard |
| UX-022 | Booking branch | Default from the patient's registrations; confirm disabled with a warning for an unregistered branch; register (or reactivate) inline | done | `UiPolish.test.tsx` booking |
| UX-023 | Stale and missing feedback | Booked/rescheduled notice only for that version; every status action confirmed in a polite message region (survives list moves) | done | `UiPolish.test.tsx` queue |
| UX-024 | Queue overlap | Card-width container query: actions under the details when narrow; details wrap | done | `workspace/*queue*` |
| UX-025 | Date formats | Booking and reschedule show the chosen date spelled out under the native field. The native field itself still follows the browser locale | partial | `workspace/owner-booking-*` |
| UX-026 | "10 دقيقة" | i18next plurals (3–10 دقائق, 11+ دقيقة, دقيقتان) | done | `workspace/owner-booking-*` |
| UX-027 | Impossible hint, one-option lists | Hint only when "all branches" is a choice; a single organization or branch shows as text | done | `AppShell.test.tsx`, `e2e/workspace.spec.ts` |
| UX-028 | Mixed-direction text | `<bdi>`/FSI isolation for patient, service and charge names, invoice subtitle; `dir=auto` choosers | done | |
| UX-029 | Heavy / ambiguous cancel | "Cancel appointment" in a destructive outline style | done | `UiPolish.test.tsx` |
| UX-030 | Slot grid | Grouped morning / afternoon; current time marked when rescheduling | done | |
| UX-031 | Doctor's path to the record | Treating doctor: "Open visit record" first (queue and appointment), "Complete" second; the draft starts directly when nothing needs choosing | done | `UiPolish.test.tsx` (2) |
| UX-032 | Dental findings vs finalize rule | Minimum checked before the confirmation, fields marked and focused; rule text and "Tooth findings" label say what counts. Whether specialty findings should count is decision D-4 | done / decision | `UiPolish.test.tsx` visit record |
| UX-033 | No autosave, buttons at the bottom | Sticky action bar with save state; debounced autosave (5s) through the versioned save; the leave warning already existed | done | `e2e/acceptance.spec.ts` save state |
| UX-034 | Confirmation off screen | Invoice issue and record finalize confirmations scrolled into view and focused; cancel returns focus | done | |
| UX-035 | No payment from the invoice | "Record a payment for this invoice" → account with the invoice preselected and the amount focused; credit note behind a button | done | `Finance.test.tsx`, `e2e/finance.spec.ts` |
| UX-036 | Account page steps | Pending charges of one branch preselected; the new draft opens; charge/payment forms behind buttons; messages. Default branch = patient's branch not done (the account response has no registrations) | partial | `Finance.test.tsx`, `e2e/finance.spec.ts` |
| UX-037 | Service code, texts | Code optional (next free `SRV-001`), clearer hint and page text, "currency saved" message | done | |
| UX-038 | Forms before lists | Lists first on Team and Branches. One combined add/invite panel not done | partial | screenshots |
| UX-039 | Terminology | "مطّلع", "موظف استقبال" everywhere; "الحساب المالي" for the finance account (D-5 recommendation applied) | done | e2e role labels updated |
| UX-040 | Full-width save buttons | Natural width at the start of the form; spacing after details lists. The weekly-hours grid redesign not done | partial | `workspace/owner-settings-*` |
| UX-041 | Default details markers | One chevron style in the workspace | done | |
| UX-042 | Branches as status pills | Neutral bordered labels | done | `workspace/owner-patients-*` |
| UX-043 | Focus on the new-patient form | Focus to its heading, back to the button on cancel | done | |
| UX-044 | Heavy phone header and filters | One-row choosers with smaller text, short language label, filters two per row, compact stacked rows. A bottom sheet for the context choosers not done | partial | mobile screenshots |
| UX-045 | Operator overview | "Needs action" (linked) and "platform status"; scope notice once; zeros neutral | done | `operator/overview-*` |
| UX-046 | Audit filters | Action, actor and "hide sign-ins" over the loaded entries (the API pages by date only; no backend change) | done | `OperatorConsole.test.tsx` |
| UX-047 | One empty-state icon | Context icons (41 places) | done | |
| UX-048 | Select direction | `dir=auto` on organization/branch choosers and data selects added here | done | |
| UX-049 | Sign-in language after logout | Kept (D-6 recommendation) | decision | |

## 3. Icons and motion

| ID | Correction | Status |
| --- | --- | --- |
| ICN-01/02 | Kept; tiles now self-contained | done |
| ICN-03 | Calendar/queue/stethoscope/wallet beside the step titles (home), per-specialty workflow icons | done |
| ICN-04 | One icon per problem card and tool card on each specialty page (`solutions.ts`) | done |
| ICN-05 | Security and privacy sections | done |
| ICN-06 | Superseded: the sign-in link stays visible (UX-003) | done |
| ICN-07 | Notice icons by kind (CSS mask, `currentColor`) | done |
| ICN-08 | Operator "needs action" cards | done |
| ICN-09 | `EmptyState icon` | done |
| ICN-10 | Field error mark | done |
| ICN-11 | Getting started checklist | done |
| ANIM-01 | Hero frame floats 6px / labels ±4px on their own phase, ≥1061px, paused off screen or in a hidden tab | done |
| ANIM-02/03 | One-time reveals with stagger; split screenshots slide from their side | done |
| ANIM-04 | Preview cross-fade 200ms | done |
| ANIM-05 | Tour thumbnail lift on hover | done |
| ANIM-06 | Lightbox open | done |
| ANIM-07 | Accordion answers ease in (public FAQ, drawer, workspace disclosures) | done |
| ANIM-08 | Dropdown exit animation | deferred (optional P3; needs delayed unmount) |
| ANIM-09 | Press feedback on public buttons, chips, tabs | done |
| ANIM-10 | Action messages slide in | done |
| ANIM-11 | Confirmations scrolled into view (smooth only without reduced motion) | done |

## 4. Decisions for the owner

- **D-2** Merge "what changes in your day" with "a day at the clinic", shorten "available today".
- **D-4** Should specialty findings (e.g. a tooth finding) count toward the finalize minimum? Clinical
  rule; today the UI explains that they do not.
- **D-6** Sign-in page language after a logout — kept as is.
- Applied as recommended and easy to revert: D-1 (now a user choice), D-3 (hero eyebrow), D-5
  (terminology).

## 5. Dark-theme contrast (computed)

| Pair | Ratio |
| --- | --- |
| text on surface | 13.2 |
| muted on surface / page | 7.1 / 7.9 |
| link on surface | 9.9 |
| primary button (navy on turquoise) | 7.5 |
| ok / warn / bad / info on their tints | 7.9 / 8.4 / 5.7 / 7.4 |
| site muted, emphasis, tones (physio, ENT) | 7.8, 9.8, 7.7, 7.5 |
| on-navy muted (light, dark) | 6.7, 8.8 |

## 6. Verification

- `npm run verify` in the Codespace: lint, typecheck, 722+ unit tests, build, 51 e2e tests.
- Header fit 1024–1920px (ar/en), overflow sweep (§1 RESP-1), theme first paint (built page),
  2x screenshots regenerated on an isolated seeded database (`scripts/brand/product-shots.cjs`).
- Not verified here: real devices with notches (safe areas reasoned, not observed), screen readers
  beyond the automated role/name checks, browsers other than Chromium.
