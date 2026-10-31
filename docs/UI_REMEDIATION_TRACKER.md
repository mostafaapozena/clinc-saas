# UI remediation tracker (phase 19)

One table for the three review sources, so a fix is recorded once and every finding points to it:

- **UX-nnn**: the frontend UX audit of 2026-10-31 (31 findings, screenshots). Not to be confused with the
  public-site UX-nnn ids of 2026-10-28 in `docs/UI_POLISH_IMPLEMENTATION.md`.
- **FE-nnn**: the frontend architecture audit (`FRONTEND_CODE_AUDIT.md`, 15 findings).
- **F-nn**: the phase 18 design-system review (`docs/DESIGN_SYSTEM_REMEDIATION.md`).

Status: `done` (merged, with the check named), `partial` (what remains is stated), `planned`, `decision` (needs the owner).
A finding is `done` only when the named check exists and passes in `npm run verify`.

## Crosswalk

| UX | Finding | FE | F | Fix (where) | Check | Status |
| --- | --- | --- | --- | --- | --- | --- |
| UX-001 | Cash and bank account cards collapse to a sliver | FE-001, FE-005 | F-01 | `.data-list` is a size container; rows reflow to two columns then one (`workspace.css` "UX foundations") | `e2e/layout.spec.ts` | done |
| UX-002 | Profile page shows the organization title | FE-012 | – | Organization profile keys moved to `orgProfile.*`; `profile.*` is the personal profile again | design-system key guard | done |
| UX-003 | Two branch scopes that disagree | FE-006, FE-007 | F-07 | Reports center inherits the header branch (`useBranchFilter`) and states it (`.report-scope`) | `e2e` reports spec | done |
| UX-004 | The same receivable differs between modules | FE-007 | F-14 | Document-based and ledger figures keep separate labels; the home tile drills down to the aging report; money never counts up (`Metric`) | `modules.test.ts`, unit tests | partial: label audit of remaining tiles |
| UX-005 | H3 larger than H2 | FE-003 | – | Type scale `--fs-h1…h4`, `.card h3` | visual | done |
| UX-006 | Control heights ignore tokens | FE-014 | – | Inputs and selects use `--control-md` | visual | done |
| UX-007 | No rule for the primary page action | FE-001 | F-02 | `PageHeader` actions slot, `ActionBar` | – | planned |
| UX-008 | Four create/edit patterns | FE-001, FE-010 | – | `FormPage` / `FormDrawer` | – | planned |
| UX-009 | Same data listed three ways | FE-005 | F-12 | `DataTable` / data list rules in `UI_PAGE_PATTERNS.md` | – | planned |
| UX-010 | Date formats inconsistent | FE-008 | F-18 | `DateText`, `DateField`, `lib/format.ts` presets | – | planned |
| UX-011 | Numeric columns misaligned | FE-005 | F-06 | `.num` cells in `DataTable`, `Money` | – | planned |
| UX-012 | Untranslated system values and units | FE-008 | F-24 | `accounting.sources.*` incl. `stock`, generic fallback; system default names shown localized (`lib/defaultNames.ts`) without renaming stored data | unit tests | done (user-entered names stay as entered) |
| UX-013 | Plural errors | FE-008 | – | `_one` / `_two` / `_few` forms for counts | locale parity test | done |
| UX-014 | Consequential actions look neutral | FE-010, FE-014 | – | `ConfirmPanel`, danger button tone | – | planned |
| UX-015 | Team rows crowd | FE-005 | F-12 | Container-query rows (as UX-001) | `e2e/layout.spec.ts` | done |
| UX-016 | Settings: one long page, seven Save buttons | FE-001 | – | `SettingsSection` with its own dirty state | – | planned |
| UX-017 | Booking: disabled submit without reason | FE-009 | – | Reason shown next to the button | – | planned |
| UX-018 | Detail pages lose their place | FE-006 | – | Back link and `PatientContextHeader` | – | planned |
| UX-019 | Sidebar grew by addition | FE-007 | F-19 | Module registry (`lib/modules.ts`) with the six task groups | `modules.test.ts` | done |
| UX-020 | Two tab styles; tab bars clip | FE-006 | F-05 | `RouteTabs` with overflow | – | planned |
| UX-021 | Disclaimer banners on top of pages | – | – | Move static notes to help | – | planned |
| UX-022 | Dashboard priorities and link labels | – | F-13 | Verb links, scope labels | – | planned |
| UX-023 | Reports chart grid gaps | FE-001 | F-15 | `CardGrid` | – | planned |
| UX-024 | Low contrast of field borders | FE-003 | – | `--border-strong` (3:1) on controls | axe (planned) | partial |
| UX-025 | Touch targets below 44px | FE-014 | F-20 | 44px minimum for page controls on phones | `e2e/layout.spec.ts` | partial: verify all modules |
| UX-026 | Header choosers truncate | – | F-08 | `field-sizing: content` with bounds | visual | done |
| UX-027 | Empty heading elements | FE-012 | – | Headings render only with text | axe (planned) | planned |
| UX-028 | Empty states without a next step | FE-001 | – | `EmptyState` action | – | planned |
| UX-029 | Blank screen on full load | – | – | Shell-first loading | – | planned |
| UX-030 | Key/value layouts vary | FE-001 | – | `DescriptionList` | – | planned |
| UX-031 | Brand hue changes between themes | FE-003 | – | Owner decision: navy in light, turquoise in dark (kept) | – | decision recorded |

## Architecture findings without a UX row

| FE | Finding | Fix | Status |
| --- | --- | --- | --- |
| FE-002 | CSS organized by phase, duplicate selectors | Reorganize by component | planned |
| FE-004 | Public site is a second design system | Shared tokens | planned |
| FE-007 | Visibility rules duplicated (equipment hidden for `asset.read`) | One registry: sidebar, route `ModuleGate`, reports center, module tabs. The API stays authoritative. | done (`modules.test.ts`) |
| FE-011 | Operator console is a parallel app | Migrate to shared components | planned |
| FE-013 | No catalog, no accessibility tooling | Dev-only gallery, `@axe-core/playwright` | planned |
| FE-015 | Badges consistent | Tone names (`Badge`, `badge--success/warning/danger/info/neutral`) | done |
