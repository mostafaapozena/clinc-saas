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

## Adding a module

1. Add the routes and pages, reusing the patterns above.
2. Put module navigation in `ModuleTabs` (keep it to about six items; reports belong in the reports center).
3. Add the module's reports to `CATEGORIES` in `ReportsHubPage.tsx`, with permission and scope rules matching the API.
4. Use `MetricGrid` for figures, `StatementTable` or `DataTable` for amounts, and `ChartCard` only when a chart answers a question.
5. Add both locales. The key test fails on a missing key.
6. Run `npm run verify`. `e2e/layout.spec.ts` covers the shared rules; add a page there if it introduces a new layout.
