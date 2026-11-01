# UI page patterns

Compose new pages from these patterns, built from the primitives in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md). Each pattern names a reference page in the code.

| Pattern | Order on the page | Reference |
| --- | --- | --- |
| **Dashboard** | `PageHeader` with one role action → **needs action** (`FocusPanel`) → **today** (`MetricGrid`) → specialty shortcuts → onboarding steps → **context** (collapsed `<details>`) | `pages/HomePage.tsx` |
| **Reports overview** | `PageHeader` with compact filters → category tabs (URL state) → KPI `MetricGrid` with sources → `ChartCard` row → `ReportLink` cards | `pages/ReportsHubPage.tsx` |
| **Detailed report** | `PageHeader` → `ModuleTabs` → filters card → result card with CSV → `StatementTable` or `DataTable` (`--scroll`); filters in the URL; drill-down links keep them | `pages/AccountingPages.tsx` `ReportsPage` |
| **Search / filter / results** | `PageHeader` with the primary action → filter bar → results (`data-list` or `DataTable`) with a 16px group gap → empty state that names the filter | `pages/PatientsPage.tsx`, `pages/AppointmentsPage.tsx` |
| **Detail page** | `PageHeader` with status badge and actions → `details` list card → related records cards → destructive actions last, in their own card | `pages/AssetPages.tsx` `AssetPage` |
| **Create / edit form** | Card with title and hint → `form-grid` fields → `ActionBar` (primary first in reading order) → inline `Notice` for errors | `components/ModuleSettings.tsx`, compensation forms |
| **Financial document** | Header with number and status → lines table (`.num` amounts) → totals → printable view with letterhead | `pages/FinancePages.tsx` invoice and print |
| **Settings** | One card per concern, each with its own save action; risky actions (reset) last, with preview and confirmation | `pages/SettingsPage.tsx` |
| **Confirmation / error recovery** | `role="alertdialog"` panel with focused heading → consequence in plain words → confirm and cancel; errors use `Notice` with the error-code message and keep the entered values | Invoice issue confirmation, `components/SettingsReset.tsx` |

## Page header and actions (Phase 1, UI-03)

One rule for every page; examples in the dev-only gallery (`/dev/gallery`, "Page patterns").

- **Where you are:** `PageHeader` title, then the subtitle. A detail page passes `back` (the list it belongs to) — a link above the title, never a button among the actions. Static policy text goes in `help`, never a banner.
- **One primary action** per page, at the end of the header, filled (`button--primary`), with a leading icon when it creates (`plus`). It is the page's main task: "Book appointment", "New patient", "Save".
- **Secondary actions** (navigate, print, open a related page) are `button--secondary` and come before the primary one in reading order. A page may have none.
- **Consequential actions** (suspend, archive, cancel, void) are never in the header: they sit with the record they change, through `ConfirmAction` (danger tone, the consequence in words, focus on cancel).
- **Action rows** inside cards are `ActionBar`: primary first in reading order, then secondary; one size per row; buttons never stretch.

| Pattern | Composition |
| --- | --- |
| **List** | `PageHeader` (+ primary create action) → `ModuleTabs` if the module has pages → `FilterBar` → `DataTable` (typed columns, `numeric` amounts) or a `data-list` of cards → `Pagination` → `EmptyState` with the next step |
| **Detail** | `PageHeader` with `back`, status `Badge` and actions → `DescriptionList` card → related records → consequential actions last, through `ConfirmAction` |
| **Create** | A card or page titled with the verb ("New supplier"); `Field` for every input (label, hint, error, required) → `ActionBar` (primary "Save"/"Create", secondary "Cancel") → `Notice` for errors, keeping what was typed. Multi-step or multi-line entities get their own page |
| **Edit** | The same form as create, filled; the primary action says what it saves; leaving with unsaved changes asks first (`useUnsavedSections` on pages of independent sections) |

## Lists, filters and tables

The reference is the Inventory pilot (`pages/InventoryPages.tsx`): stock, items and moves.

- **Filters** sit in a `FilterBar` above the results, with a reset when a filter is set. Their values live in the address through `useUrlState`, so a view survives reload, Back and sharing. Only identifiers, enums, dates and page numbers go in the URL. Names, phones, clinical text and free-text searches stay in component state.
- **Changing a filter resets the page** (`url.set({ item, page: null })`).
- **Tables** are `DataTable` with typed columns. Quantities and amounts are `numeric` and rendered with `Quantity` or `Money`; dates with `DateText`. Code and lot numbers are `<bdi dir="ltr">`.
- **Server-paginated collections** use `Pagination` and sort on the server (`sortable` columns with `onSort`); a page never sorts only the rows it holds.
- **States**: `Loading` (or `Skeleton` inside a drawn frame), `ErrorState` with retry, `EmptyState` with the next step when the viewer can take one.
- **Statuses** use `Badge` with a tone that names the meaning.

## Adding a module

1. Add the destination to `lib/modules.ts` (group, path, module, permissions) and its routes; the sidebar, route gate and reports center follow from it.
2. Add the routes and pages, reusing the patterns above.
3. Put module navigation in `ModuleTabs` (keep it to about six items; reports belong in the reports center). A tab of another module shows only when that module is on.
4. Add the module's reports to `CATEGORIES` in `ReportsHubPage.tsx`, with permission and scope rules matching the API. Reports of a switched-off module are hidden automatically.
5. Use `MetricGrid` for figures, `StatementTable` or `DataTable` for amounts, and `ChartCard` only when a chart answers a question.
6. Add both locales, with plural forms for counts (`_one`, and in Arabic `_two` / `_few` where the sentence needs them). The key test fails on a missing key.
7. Run `npm run verify`. `e2e/layout.spec.ts` covers the shared rules and `e2e/a11y.spec.ts` the automated accessibility checks; add the page to them if it introduces a new layout.
