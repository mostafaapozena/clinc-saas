# raclinic design system

This document is the contract for every workspace and operator screen.

- **Identity (unchanged):** navy, turquoise and coral tokens in `styles.css :root`; Alexandria for Arabic and Inter for English (both self-hosted); the existing logo assets; Arabic RTL by default and English LTR; light, dark and system themes; reduced motion respected.
- **Implementation:** `apps/web/src/components/layout.tsx` (layout primitives), `components/ChartCard.tsx`, `components/Metric.tsx`, `components/ui.tsx`, and the "Design-system contracts" section at the end of `workspace.css`.
- **Guards:**
  - `apps/web/src/design-system.test.ts` (static rules);
  - `e2e/layout.spec.ts` (geometry);
  - [docs/UI_CONTRIBUTION_CHECKLIST.md](UI_CONTRIBUTION_CHECKLIST.md).

## 1. Tokens

### Spacing

The scale is `--space-1…6` and `--space-8` (4, 8, 12, 16, 20, 24 and 32px). Use the semantic names below.

| Token | Value | Use |
| --- | --- | --- |
| `--stack-related` | 8px | Related items: two buttons, a label and its field |
| `--stack-group` | 16px | A heading and its content; filters and their results |
| `--stack-page` | 20px (16px on phones) | Sections of a page |
| `--gap-inline-icon` | 8px | Icon beside a one-line label (buttons, legends) |
| `--gap-icon-text` | 12px | Icon box beside wrapping text (`IconLabel`) |

Sibling spacing comes from the container's `gap`, never from margins on the children. The two
existing rhythm rules (page and card) are the only margin systems.

### Control sizes

| Size | Height | Use |
| --- | --- | --- |
| `.button--sm` / `--control-sm` | 32px | Inside tables and dense toolbars (automatic for buttons in `.data-table` cells) |
| default / `--control-md` | 40px | Buttons and fields |
| `.button--lg` / `--control-lg` | 48px | A primary action on phones or sign-in screens |
| `--touch-min` | 44px | Primary buttons, segments and module tabs at ≤640px |

Buttons take their height from their size, never from a stretched row (`.form-actions` uses
`align-items: center`). Width follows the label; buttons of one size in one context share height,
font, padding and icon spacing.

### Icons

| Context | Icon size | Container |
| --- | --- | --- |
| In a button or link | 18px | none |
| Card or section title | 20px | none |
| `IconLabel` / `ReportLink` | 20px | `.icon-box` 36×36, radius 10 |
| `Metric` | 18px | 34×34 (existing) |
| Empty state | 22px | 44px circle |

- **Decorative icons** carry `aria-hidden`.
- **An icon used alone** needs an accessible name on its button.
- **Direction:** arrows that mean forward or back use the existing directional icons (mirrored in RTL).

### Color and charts

- **Semantic tokens only.** No literal colors in pages.
- **Chart colors:** `--chart-1…5`, `--chart-grid` and `--chart-axis` are defined for light and dark.
  - Turquoise is a fill or stroke, never text on white.
  - Do not rely on color alone: every series has a direct label or legend.

### Typography

| Role | Size | Weight |
| --- | --- | --- |
| Page title | existing clamp | 700 |
| Section / card title | 1.1rem | 600–700 |
| Sub-title | 1rem | 600 |
| Body | 1rem / 1.6 | 400 |
| Secondary | 0.875rem | 400, muted |
| Metric value | 1.75rem (1.5 on phones) | 700, tabular figures |

Numbers and amounts use `<bdi dir="ltr">` where mixed with Arabic text. Table amounts use `.num`, which gives end alignment, tabular figures and no wrapping, in both directions.

## 2. Primitives

| Primitive | Where | Contract |
| --- | --- | --- |
| `PageHeader` | `components/PageHeader.tsx` | Title, subtitle and one primary action (children). Filters of report pages live here. |
| `CardGrid` | `layout.tsx` | Cards start at the top and keep their own height. `equal` only for parallel cards (plans, charts). |
| `MetricGrid` + `Metric` | `layout.tsx`, `Metric.tsx` | Auto-fit columns, never one full-width column above about 400px. A financial metric states its source in `hint` ("from documents", "general ledger"). |
| `IconLabel` | `layout.tsx` | `[icon box][title + description]`, 12px gap, top-aligned. Wrapped text never slides under the icon. |
| `ReportLink` | `layout.tsx` | `IconLabel` plus a direction arrow in its own column. Used for report cards and destination lists. |
| `ActionBar` | `layout.tsx` | One row of actions, related gap, never stretched. `align` is start, end or between. |
| `ModuleTabs` | `layout.tsx` | Module navigation: one row with horizontal scroll and the active tab scrolled into view. Navigation links only. |
| Category tabs | `ReportsHubPage.tsx` | `role="tablist"` buttons for switching content inside one page; the state lives in the URL. |
| `DataTable` conventions | `.data-table` | Record lists stack into labelled cards below 900px. Statements, ledgers and anything compared by row use `.data-table--scroll`: columns kept, horizontal scroll inside the card, sticky first column. |
| `StatementTable` | `AccountingPages.tsx` | One fixed-layout table per statement: section header rows, totals, amounts `.num`, currency in the header, width up to 960px. |
| `ChartCard` | `ChartCard.tsx` | Title, context line (period, currency, source), inline SVG chart, legend, "show as table" alternative, and loading, empty and error states. |
| `EmptyState` / `Loading` / `ErrorState` / `Notice` | `ui.tsx` | Unchanged; always used instead of hand-written blocks. |
| `Field` | `ui.tsx` | Label, hint and error wiring. |
| Forms | `form` / `.form-grid` | Grid forms keep their natural row height (`align-content: start`). |

## 3. Charts and report data rules

- **Choose by meaning:**
  - Bars compare.
  - Lines show change over time.
  - A donut shows the parts of a **positive** total.
  - Horizontal bars rank or age.
  - Statements, the ledger and the trial balance stay tables.
- **Every number** comes from a permission-checked, tenant- and branch-scoped endpoint. Empty periods show an empty state, never an invented series.
- **Definitions:**
  - Never mix currencies.
  - Never present collections as revenue.
  - Never call the ledger result "net profit".
  - Show reconciliation differences; do not hide them.
- **Context:** each chart states its period, currency and source.

## 4. Responsive behaviour

| Width | Sidebar | Top bar | Card rows | Tables |
| --- | --- | --- | --- | --- |
| ≤640 | Drawer | At most two rows | One column; metrics one or two | Records stack; statements scroll |
| 641–900 | Drawer | One row | Two columns | Statements keep columns |
| 901–1023 | Fixed | May wrap | Two to three | Full |
| ≥1024 | Fixed | One row (chooser captions become hidden labels) | Up to three cards, six metrics | Full, statement width capped |

`--topbar-h` is measured at run time and feeds `scroll-padding-block-start`, so anchors and focus never land under the sticky bar. The page never scrolls sideways; wide content scrolls inside its own container.

## 5. Recording a justified exception

When a page must break a rule, keep a short code comment at the exception that names the rule and the reason. Add a line to the "Exceptions" table in [docs/DESIGN_SYSTEM_REMEDIATION.md](DESIGN_SYSTEM_REMEDIATION.md). The guard tests have no silent allow-lists.
