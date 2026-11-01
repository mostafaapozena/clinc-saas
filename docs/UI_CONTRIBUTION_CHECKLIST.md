# UI contribution checklist

Check every item before opening a PR that adds or changes a screen.

## Structure
- [ ] The page follows a pattern in [UI_PAGE_PATTERNS.md](UI_PAGE_PATTERNS.md) and uses `PageHeader`: `back` for a detail page, at most one primary action (with an icon when it creates), consequential actions with the record through `ConfirmAction`.
- [ ] Card rows use `CardGrid`. Equal heights only with `equal`, for parallel cards.
- [ ] Figures use `MetricGrid` + `Metric`. Financial figures state their source in `hint`.
- [ ] An icon beside text that can wrap uses `IconLabel` / `ReportLink`, never an icon plus a `<br>`.
- [ ] Module navigation uses `ModuleTabs`. Switching views inside a page uses tabs with URL state.
- [ ] Tables use `DataTable` with typed columns; quantities and amounts are `numeric`. Statements and ledgers use `StatementTable` or `DataTable` with `scroll`.
- [ ] Paginated lists use `Pagination` and sort on the server; filters use `FilterBar` and `useUrlState` (ids, enums, dates and page only: no names, phones, clinical or free text in URLs).
- [ ] Amounts, dates and quantities use `Money`, `DateText` and `Quantity`. No ISO date or raw enum reaches the screen; counts have plural forms.
- [ ] Statuses use `Badge` with a tone that names the meaning.
- [ ] Charts use `ChartCard` with the right kind (see DESIGN_SYSTEM.md §3) and real, scoped data.
- [ ] A new destination is added to `lib/modules.ts` (group, module, permissions), not to the sidebar directly. Pages inherit the header branch.
- [ ] A financial figure names its source (documents or ledger) and links to the list that adds up to it.

## Spacing and sizes
- [ ] No margins between siblings. Gaps come from the container.
- [ ] Buttons use a size (`sm`, default, `lg`). In-table actions are small. No stretched buttons.
- [ ] No literal colors, widths or font sizes outside the tokens.
- [ ] A component's rule is edited where it lives, not restated further down; breakpoints and states are their own rules (DESIGN_SYSTEM.md §1 "Stylesheets").

## States and languages
- [ ] Loading, error, empty and populated states exist; an empty state offers the next step when the viewer can take one. Long Arabic and English labels do not overlap or clip.
- [ ] Form fields use `Field` (label, hint, error, required). A disabled submit says why next to it. A native date input outside `Field` shows `DateEcho` and names it in `aria-describedby`.
- [ ] Every string is in `ar.json` and `en.json` (the key test checks this).
- [ ] RTL and LTR, light and dark checked. No page-level horizontal scroll at 360, 768, 1024 or 1366px.

## Access
- [ ] Keyboard: every action is reachable, focus is visible, tabs and menus respond to arrows and Escape where expected.
- [ ] Decorative icons are `aria-hidden`; icon-only buttons have names; charts have a table alternative.
- [ ] Permissions are checked in the API; the UI only hides what the role cannot do.

## Verification
- [ ] `npm run verify` is green. If the page adds a layout not covered by `e2e/layout.spec.ts`, add a check.
- [ ] The page is in `e2e/a11y.spec.ts` (axe, WCAG 2.1 A/AA rules). Automated checks do not replace a keyboard pass; do not claim screen-reader testing that was not done.
- [ ] The finding it fixes, if any, is updated in [UI_REMEDIATION_TRACKER.md](UI_REMEDIATION_TRACKER.md).
