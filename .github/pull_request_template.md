## What and why

<!-- The change, the problem it solves, and the findings it closes (UX-…, FE-…, F-…). -->

## How it was verified

- [ ] `npm run verify` green in the Codespace, and the `verify` check green on this PR
- [ ] New behaviour has a test that fails without it

## Screens (skip if no UI change)

- [ ] Follows a pattern in `docs/UI_PAGE_PATTERNS.md`; went through `docs/UI_CONTRIBUTION_CHECKLIST.md`
- [ ] Arabic and English, light and dark; no page-level horizontal scroll at 360, 768 and 1366px
- [ ] Loading, empty, error and populated states
- [ ] Page covered by `e2e/a11y.spec.ts` and, for a new layout, `e2e/layout.spec.ts`
- [ ] Before / after screenshots attached (synthetic `@demo.test` data only)
- [ ] `docs/UI_REMEDIATION_TRACKER.md` updated for the findings this closes

## Safety

- [ ] Permissions are enforced in the API; the UI only hides what the role cannot do
- [ ] No secrets, real patient data, names, phones or clinical text in code, URLs, logs or screenshots
- [ ] Financial postings unchanged, or the change is documented in `docs/ACCOUNTING_POSTING_MATRIX.md`
