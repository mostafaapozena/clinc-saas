# ERP acceptance (brief 2)

Each cross-module journey of the brief is listed here with what proves it on `main`. A journey is
accepted when its tests pass in `npm run verify`:

- API tests with a real MongoDB replica set and transactions;
- web tests;
- Playwright browser tests against production builds and a reset, synthetic database.

## Journeys

| Journey | Steps proven | Evidence | State |
| --- | --- | --- | --- |
| **Patient** | Register → book → check in → visit record → charge → invoice → receipt → allocation → statement; installments and write-off on the invoice | `e2e/erp.spec.ts` (A), `e2e/finance.spec.ts`, `finance.test.ts`, `installments.test.ts`, `Installments.test.tsx` | ✅ |
| **Procurement** | Request → approval → RFQ → order → receipt → bill (3-way match) → payment; payables equal open bills | `purchasing.test.ts`, `e2e/erp.spec.ts` (B + C) | ✅ |
| **Consumption** | Finalized visit → materials used → stock out at moving average (FEFO) → consumables expense; returns | `inventory.test.ts` | ✅ |
| **Consignment** | — | Not built (docs/MEDICAL_ERP_REQUIREMENTS.md) | ⛔ |
| **Payroll** | — | Not built; statutory rules excluded, foundation waits for owner rules | ⛔ ⚙️ |
| **Cash advance / custody** | Issue (idempotent) → partial return → receipts → owner write-off → settled; ledger equals the open documents; vouchers and manual entries refused on these accounts | `staff-funds.test.ts`, `StaffFunds.test.tsx` | ✅ |
| **Asset** | Bill capitalizes → register → method from the accountant → monthly run once → disposal at book value | `assets.test.ts`, `depreciation.test.ts`, `Depreciation.test.tsx` | ✅ |
| **Installments** | Plan equal to the open balance → receipts move progress → reschedule with history → owner write-off completes it | `installments.test.ts` | ✅ |
| **Budget** | Draft → owner approval (frozen) → reopen → budget against actual; cash flow reconciled; commitments linked once | `planning.test.ts`, `Planning.test.tsx` | ✅ |
| **Specialty setup** | Dentistry, physiotherapy and ENT setup with a delayed real request → the specialty home → reload; multi-specialty chooser and saved context | `e2e/specialty-setup.spec.ts` (with screenshots), `workspace-setup.test.ts` | ✅ |
| **Identity on documents** | Owner profile and logo (raster only, members only) → letterhead on printouts | `organization-profile.test.ts`, `OrganizationProfile.test.tsx` | ✅ |
| **Settings reset** | Preview → name and token → snapshot → defaults → restore once | `settings-reset.test.ts`, `SettingsReset.test.tsx` | ✅ |

## Cross-cutting checks

- **Tenancy:** another organization's data returns 404 in every new module. Tests: the profile logo
  (`organization-profile.test.ts`), branch-scoped plans (`installments.test.ts`) and
  `tenancy.test.ts`.
- **Permissions:**
  - Owner-only actions are refused for others: budget approval, staff-fund write-off, invoice
    write-off, settings reset.
  - Accountant actions are refused for front-desk roles.
- **Idempotency and concurrency:**
  - request keys on issues and write-offs;
  - versions on every update;
  - source keys on every posting;
  - unique indexes on one active plan per invoice and on one link per voucher or bill.
- **Ledger integrity:** see docs/ACCOUNTING_POSTING_MATRIX.md ("Invariants checked by tests").
- **Arabic and English:** every new string exists in both locales.

## Latest run

`npm run verify` at the end of milestone H7 (branch `phase-17/settings-reset`):

- 74 test files, 929 unit and integration tests passed;
- 58 Playwright tests passed.

CI runs the same command on every PR before merge.
