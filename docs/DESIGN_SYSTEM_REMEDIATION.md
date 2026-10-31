# Design-system remediation tracker (phase 18)

**Inputs:** the 2026-10-29 UI review (`FINDINGS.csv` F-01…F-25, contract, handoff, screenshots
U01–U12 and C01–C14) and the owner's generated reports-center target image.

**Baseline:** `main@7ff4a65`.

**Work:** PR #31 (foundation), #32 (reports center), #33 (dashboard, layout checks, documentation).

**Evidence:** before and after screenshots in
`review-screenshots/design-system-2026-10-31/` (`before/`, `after/`), taken with the owner demo account (synthetic data) at the listed widths.

| ID | Status | Confirmed cause | Correction | Acceptance / evidence |
| --- | --- | --- | --- | --- |
| F-01 stretched card rows | ✅ Fixed | `.card-grid { align-items: stretch }` | Start-aligned by default; `.card-grid--equal` / `CardGrid equal` opt-in | `e2e/layout.spec.ts` (≤24px trailing space); after: home, operator overview |
| F-02 stretched buttons in forms | ✅ Fixed | Grid form without `align-content`; flex rows stretching buttons | `form { align-content: start }`, `.form-actions { align-items: center }` | layout spec (equal button heights); after: compensation-1150 |
| F-03 icons touching text | ✅ Fixed | `.link-list` reused with Icon + `<br>` | `IconLabel` / `ReportLink` (36px box, 12px gap) | layout spec (gap 12±1); guard test (no `<br>` in links) |
| F-04 one-column metrics | ✅ Fixed | `.metrics` columns only in modifiers; doc comment taught the bare class | Responsive base, `MetricGrid`, comment fixed | Guard test (no bare `metrics`); layout spec (columns > 1) |
| F-05 module nav wrapping | ✅ Fixed | `.module-nav { flex-wrap: wrap }` | `ModuleTabs`: one scrolling row, active in view; reports moved to the reports center | Guard test; layout spec (one row) |
| F-06 misaligned statements | ✅ Fixed | One auto table per group, numbers start-aligned | `StatementTable`, `.num`, width cap | after: balance-sheet-1920-light, profit-loss-1366 |
| F-07 report state not in URL | ✅ Fixed | `useState` | `?report=&from=&to=&branch=&account=`; reports center `?category=&period=&branch=` | Report cards open named reports |
| F-08 two-row top bar hides headings | ✅ Fixed (≥1024) | Wrapping bar; no scroll padding | Measured `--topbar-h` → `scroll-padding-block-start`; one row ≥1024px | after: all 1366 shots (one-row bar) |
| F-09 overflow at 360px | ✅ Fixed | `.date-nav` nowrap | Wraps on phones | layout spec at 360px (appointments, balance sheet, reports) |
| F-10 statements stacked | ✅ Fixed | One responsive behaviour for all tables | `.data-table--scroll` (columns kept, sticky first column) | layout spec at 360px |
| F-11 `common.actions` | ✅ Fixed | Missing key; no key-existence test | Key added; literal-key test | `design-system.test.ts` |
| F-12 uneven row heights | ✅ Fixed | One button size | `sm` controls in tables | after: accounts-1366 |
| F-13 dashboard priorities | ✅ Fixed | Sections appended per phase | Needs action → today → shortcuts → context collapsed; quick links removed; front-desk counts shown once | after: home-1366/1920/390 |
| F-14 two receivable definitions | 🟡 Partly | Documents vs ledger with similar labels | Sources stated on home and reports-center figures ("from documents", "general ledger"); reconciliation unchanged | Which figure the home shows is an owner decision (kept: documents) |
| F-15 text-only report hub | ✅ Fixed | Link index only | Reports center with categories, KPIs, charts and cards | `ReportsHub.test.tsx`; after: reports-1366/1920/390/en-light |
| F-16 no trends | ✅ Fixed (financial trend) | No series endpoint, no chart primitive | `GET /finance/reports/trend`, `ChartCard` (SVG, no dependency) | `reports-trend.test.ts`. Ledger monthly result (R6), cash balance over time (R9) and weekly appointments (R11) remain proposals |
| F-17 aging zeros, no drill-down | ✅ Fixed | Per-table formatting | Same zero format; patient links | after: aging-1366 |
| F-18 mm/dd/yyyy in Arabic | ⏸ Deferred | Native date input follows the browser locale (hypothesis) | Needs a `DateField` with a localized echo or a custom picker | Not reproduced in an Arabic-locale browser; next UI batch |
| F-19 ambiguous sidebar labels | ⏸ Owner decision | Navigation grew per module | Renaming touches e2e and user habit; proposed names in the review | Waiting for the owner's choice of names |
| F-20 small touch targets | ✅ Fixed (primary controls) | Hard-coded heights | 44px minimum for primary buttons, segments and tabs at ≤640px | after: reports-390 |
| F-21 recurrence process | ✅ Fixed | Class recipes, no checks | Primitives, guard tests, layout e2e, docs, AGENTS rule | This document, DESIGN_SYSTEM.md, checklist |
| F-22 operator filters touching | ✅ Already fixed (e13f216) | — | Kept | after: operator-support-1366 |
| F-23 operator cards uneven | ✅ Fixed | Stretch residue | F-01 | after: operator-overview-1366 |
| F-24 English seed names | ⏸ Owner decision | Demo seed names | Demo data only; real clinics name their own accounts | — |
| F-25 untested roles | 🟡 Partly | No sessions in the review | This phase ran the owner and operator sessions (screenshots) and role tests in unit/e2e | Doctor, reception and viewer covered by existing tests, not new screenshots |

## Not done in this phase (stated, not hidden)

1. **Duplicate selectors.** The 68 duplicated top-level selectors in `styles.css` / `workspace.css` are not consolidated. The root-cause rules were fixed in place, and the new contracts live in one section, but a full merge is a separate refactor with its own visual review.
2. **Gallery.** There is no `/dev/gallery` page yet. `e2e/layout.spec.ts` and the reference pages in UI_PAGE_PATTERNS.md serve as the living examples.
3. **Zoom and other browsers.** Browser zoom at 200%, Safari and Firefox were not tested. Narrow widths (360–1920px) were.

## Visual-target checklist (reports center)

| Target element | Implemented |
| --- | --- |
| Title and scope line on the start side, compact filters on the other | ✅ Period and branch selects with icons |
| Icon-labelled category tabs, active one highlighted | ✅ Six categories (four in the image), turquoise outline and tint |
| KPI row of four cards with icon boxes | ✅ Real values with source lines |
| Balanced row of three charts (bars, line, donut) | ✅ Line (trend), donut (methods), horizontal bars (services), all at equal height |
| "Available reports" grid of icon cards | ✅ `ReportLink` cards, three or four per row |
| Navy surfaces, turquoise accents, rounded cards | ✅ Existing tokens |
| "Proposed concept" / "illustrative data" labels | ❌ Intentionally removed |
| Invented metric values and trends | ❌ Intentionally not reproduced |

## Exceptions

None recorded.
