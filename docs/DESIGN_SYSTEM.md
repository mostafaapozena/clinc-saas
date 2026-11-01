# raclinic design system

This document is the contract for every workspace and operator screen.

- **Identity (unchanged):** navy, turquoise and coral tokens; Alexandria for Arabic and Inter for English (both self-hosted); the existing logo assets; Arabic RTL by default and English LTR; light, dark and system themes; reduced motion respected.
- **Tokens:** `apps/web/src/tokens.css` is the one place tokens are defined (light, dark, system dark, phones, print, English). Display sizes are language tokens: Arabic (Alexandria renders larger) one step smaller than English. The public site inherits the palette and states only its own values.
- **Implementation:** `components/layout.tsx` (`ActionBar`, `CardGrid`, `MetricGrid`, `ModuleTabs` with groups), `components/data.tsx` (`DataTable`, `Pagination`, `FilterBar`, `Money`, `DateText`, `Quantity`, `ConfirmAction`, `Skeleton`, `DescriptionList`), `lib/money.ts`, `components/PageHeader.tsx` (`back`, `help`), `components/ChartCard.tsx` (`wide`), `components/Metric.tsx`, `components/ui.tsx` (`Field`, `Badge`, `EmptyState` with `action`).
- **Guards:**
  - `apps/web/src/design-system.test.ts` (no raw action rows, grids, metric lists, filters or tone badges; money only through `lib/money.ts`; tokens only in `tokens.css`; duplicate selectors may not grow);
  - `e2e/layout.spec.ts` (geometry) and `e2e/a11y.spec.ts` (axe);
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
| `--touch-min` | 44px | Every button, field, segment and module tab in the page at ≤767px (UX-025) |

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

| Role | Token | Size | Weight |
| --- | --- | --- | --- |
| Page title (`h1`) | `--fs-h1` | 1.625rem | 700 |
| Section / card title (`h2`) | `--fs-h2` | 1.25rem | 600–700 |
| Sub-section (`h3`, `.card h3`) | `--fs-h3` | 1.0625rem | 600 |
| Minor heading (`h4`) | `--fs-h4` | 1rem | 600 |
| Body | `--fs-body` | 1rem / 1.6 | 400 |
| Secondary | `--fs-sm` | 0.875rem | 400, muted |
| Fine print | `--fs-xs` | 0.8125rem | 400 |
| Metric value | – | 1.75rem (1.5 on phones) | 700, tabular figures |

Headings always step down: an `h3` is never larger than its `h2` (UX-005). A heading element always has text; when a section has no visible title, label the section with `aria-label` instead of an empty heading (UX-027).

### Borders and badges

- `--border` is for dividers and card edges. Form controls use `--border-strong`, which keeps 3:1 against the surface in both themes (WCAG 1.4.11, UX-024).
- Badges are named by meaning (`Badge` in `ui.tsx`): `success`, `warning`, `danger`, `info`, `neutral`. Status components map their states to these tones; a page never picks a badge by its colour. Tones other than neutral carry a dot, so the state is not colour alone.

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
| `DataTable` | `components/data.tsx` | Typed columns (`label`, `cell`, `numeric`, `sortable`). Cells carry their label, so record lists stack into labelled cards below 900px; `scroll` keeps the columns for statements and ledgers (horizontal scroll inside the card, sticky first column). Sorting is server-side: the header reports the order through `onSort` and the page asks the API again. |
| `Pagination` | `data.tsx` | Previous / next with "page x of y (n results)"; hidden when everything fits on one page. The page number lives in the URL. |
| `FilterBar` | `data.tsx` | The filters of a list in one responsive row, with a reset when any filter is set. Values are kept with `useUrlState` (`lib/useUrlState.ts`). |
| `DescriptionList` | `data.tsx` | Label / value pairs of a record (the `.details` grid). |
| `Money`, `DateText`, `Quantity` | `data.tsx` | The only way to show an amount, a date or a quantity: UI-language digits, the year on calendar dates, tabular figures, a dash when there is no value. Never print an ISO date or a raw number with a unit. |
| `ConfirmAction` | `data.tsx` | A consequential action confirmed in place: the consequence in plain words, a danger-toned confirm and a cancel that receives focus. |
| `Skeleton` | `data.tsx` | Placeholder lines inside an already drawn page frame. |
| `Badge` | `ui.tsx` | Status by meaning (see §1). |
| `StatementTable` | `AccountingPages.tsx` | One fixed-layout table per statement: section header rows, totals, amounts `.num`, currency in the header, width up to 960px. |
| `ChartCard` | `ChartCard.tsx` | Title, context line (period, currency, source), inline SVG chart, legend, "show as table" alternative, and loading, empty and error states. |
| `EmptyState` / `Loading` / `ErrorState` / `Notice` | `ui.tsx` | Always used instead of hand-written blocks. `EmptyState` takes an `action` (the next step) when the viewer can take one. |
| `Field` | `ui.tsx` | Label, hint and error wiring: the control gets `aria-describedby` for the hint and the error, `aria-invalid` on error and `aria-required` when the field is required. |
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

## 5. Module registry, visibility and scope

- **One registry.** `apps/web/src/lib/modules.ts` lists every workspace destination: group, path, icon, label, the switchable module it belongs to and the permissions that open it. The sidebar, the route `ModuleGate`, the reports center and module tabs read it, so a destination is shown or hidden the same way everywhere. A new destination is added there, with a case in `modules.test.ts`.
- **The API stays the authority.** The registry only decides what is offered. Every endpoint keeps its own permission, tenant and branch checks.
- **Switched-off modules are hidden** from the sidebar, tabs and reports; a typed link to one explains why instead of showing a page whose API refuses.
- **Sidebar groups** (owner decision): daily work; patient billing and collection; operations and resources; accounting and financial reporting; organization and team; my account and help. Patient billing (documents) and the general ledger are separate destinations with distinct labels.
- **One branch scope.** The branch chosen in the top bar applies to every page, including the reports center, which states it. A page that needs another scope shows that override explicitly with a way back to the header scope.
- **Figures name their source.** A document-based figure (invoices, receipts) and a ledger figure are different metrics with different labels; both link to the list that adds up to them. Amounts never count up.

## 6. Recording a justified exception

When a page must break a rule, keep a short code comment at the exception that names the rule and the reason. Add a line to the "Exceptions" table in [docs/DESIGN_SYSTEM_REMEDIATION.md](DESIGN_SYSTEM_REMEDIATION.md). The guard tests have no silent allow-lists.
