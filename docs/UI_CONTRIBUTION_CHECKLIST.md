# UI contribution checklist

Check every item before opening a PR that adds or changes a screen.

## Structure
- [ ] The page follows a pattern in [UI_PAGE_PATTERNS.md](UI_PAGE_PATTERNS.md) and uses `PageHeader`.
- [ ] Card rows use `CardGrid`. Equal heights only with `equal`, for parallel cards.
- [ ] Figures use `MetricGrid` + `Metric`. Financial figures state their source in `hint`.
- [ ] An icon beside text that can wrap uses `IconLabel` / `ReportLink`, never an icon plus a `<br>`.
- [ ] Module navigation uses `ModuleTabs`. Switching views inside a page uses tabs with URL state.
- [ ] Amount columns use `.num`. Statements and ledgers use `StatementTable` or `.data-table--scroll`.
- [ ] Charts use `ChartCard` with the right kind (see DESIGN_SYSTEM.md §3) and real, scoped data.

## Spacing and sizes
- [ ] No margins between siblings. Gaps come from the container.
- [ ] Buttons use a size (`sm`, default, `lg`). In-table actions are small. No stretched buttons.
- [ ] No literal colors, widths or font sizes outside the tokens.

## States and languages
- [ ] Loading, error, empty and populated states exist. Long Arabic and English labels do not overlap or clip.
- [ ] Every string is in `ar.json` and `en.json` (the key test checks this).
- [ ] RTL and LTR, light and dark checked. No page-level horizontal scroll at 360, 768 or 1366px.

## Access
- [ ] Keyboard: every action is reachable, focus is visible, tabs and menus respond to arrows and Escape where expected.
- [ ] Decorative icons are `aria-hidden`; icon-only buttons have names; charts have a table alternative.
- [ ] Permissions are checked in the API; the UI only hides what the role cannot do.

## Verification
- [ ] `npm run verify` is green. If the page adds a layout not covered by `e2e/layout.spec.ts`, add a check.
