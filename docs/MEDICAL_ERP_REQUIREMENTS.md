# Medical ERP requirements (ERP brief 2)

This page lists the requirements of the second ERP brief and the specialty-workspace addition,
with their **actual state** on `main` and where the evidence is. The state was checked against
routes, pages and tests, not reports.

**Legend:**

- ✅ built and tested;
- 🟡 partial;
- ⛔ not built;
- ⚙️ waits for an owner or accountant decision;
- 🔌 needs an external provider.

## Workspace and setup (mandatory addition)

| Requirement | State | Evidence |
| --- | --- | --- |
| Specialty-specific home, navigation and quick actions | ✅ | H1, docs/architecture/MODULES.md; `WorkspaceSetup.test.tsx`; `e2e/specialty-setup.spec.ts` |
| Multi-specialty context chooser, saved context | ✅ | H1; same tests |
| Same resolution on login, refresh and deep links | ✅ | `AppShell` resolver; e2e reload checks |
| Preparation screen tied to the real request, no fake steps | ✅ | `PreparingWorkspace`; e2e with a deliberately delayed request |
| No duplicate submit, idempotent setup, resume after a lost response | ✅ | `workspace-setup.test.ts` (concurrent completes), `WorkspaceSetup.test.tsx` |
| Existing organizations intact | ✅ | No `enabledModules` = everything on (`workspace-setup.test.ts`) |
| Module activation with dependencies | ✅ | `PUT /orgs/:id/modules`; `MODULE_DISABLED` refusals |

## Finance and accounting

| Requirement | State | Evidence / gap |
| --- | --- | --- |
| Expenses | ✅ | Cash-out vouchers (A), direct expense bills with approval (C) |
| Recurring commitments | ✅ | H2, docs/architecture/PLANNING.md |
| Budgets (الموازنة التقديرية) and budget against actual | ✅ | H2 |
| Cash flow statement | ✅ | H2, direct method, reconciled |
| Employee cash advances and petty-cash custody | ✅ | H3, docs/architecture/STAFF_FUNDS.md |
| Installments, rescheduling, write-offs | ✅ | H6, docs/architecture/INSTALLMENTS.md |
| Asset depreciation schedules and postings | ✅ | H4, docs/architecture/ASSETS.md (straight-line; inputs from the accountant) |
| Cheques with lifecycle and print templates | ⛔ | Not built. Needs the bank-cheque layouts and the owner's lifecycle rules (under collection, cleared, bounced) |
| Tax, VAT, e-invoicing | ⚙️ 🔌 | Not built (Q9, E4). Printouts are labelled as not tax invoices |

## Clinic identity and configuration

| Requirement | State | Evidence |
| --- | --- | --- |
| Clinic identity and legal profile (logo, commercial registration, tax card) | ✅ | H5, docs/architecture/ORGANIZATION_PROFILE.md |
| Secure storage adapter for the logo | ✅ | `FileStorage` (MongoDB now, object store later); sniffed raster only |
| Profile applied to documents | ✅ | Letterhead on invoices, receipts, purchase orders, RFQs |
| Safe settings reset: preview, confirmation, audit, snapshot | ✅ | H7, docs/architecture/SETTINGS_RESET.md |

## Operations

| Requirement | State | Evidence / gap |
| --- | --- | --- |
| Consignment in and out (ownership separate from custody) | ⛔ | Not built. Needs a separate ownership flag on stock balances and consignor settlements; design noted in docs/ERP_EXECUTION_PLAN.md |
| Optional product sales and quotations to patients | ⛔ | Not built. Service invoices only; stock items are consumed, not sold |
| Catalogs with effective-dated prices | 🟡 | Branch prices and price snapshots exist; no future-dated price schedule |
| HR and payroll foundations (no statutory guesses) | ⛔ ⚙️ | Not built. Statutory payroll, social insurance and tax are excluded by the brief; employee records and pay components wait for owner rules |
| Unified patient file | 🟡 | The patient page, finance account, statement, records and installments exist separately; there is no single combined timeline |

## Constraints honoured

- No statutory tax or payroll guesses.
- Registration numbers are stored as entered.
- No default useful lives or rates.
- No destructive retention: stored files, snapshots and records are append-only or soft-removed.
- Synthetic data only (`@demo.test`, "(synthetic)" names).
- No live messages, payments or production deploys; preview ports stay private.
