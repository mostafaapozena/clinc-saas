# ERP module matrix (actual state)

Each row was classified after checking the actual API routes, the web pages and the tests in this
repository, not earlier reports. The matrix is updated at the end of each milestone.

Legend:

- ✅ **Implemented and verified** — API, UI and tests exist.
- 🟡 **Partial**.
- ⛔ **Missing**.
- ⚙️ **Configuration-dependent** — owner or accountant choices.
- 🔌 **External-provider-dependent**.
- ➖ **Optional or out of scope**.

## Shared foundation

| Capability | State | Evidence / gap |
| --- | --- | --- |
| Organizations, branches, time zone, single currency | ✅ | `organizations`, `branches`, finance settings; `tenancy.test.ts` |
| Legal entity distinct from branches | ✅ (by design, E-1) | One organization is one entity; branches are cost centers in the ledger |
| Departments / locations inside a branch | ⛔ | Specialties per branch exist; no departments or rooms. Not needed by current workflows. |
| Document numbering | ✅ | Per organization, type and year, gap-free (`finance.model.ts` counters; JE, CS and CV numbers) |
| Approval thresholds | ✅ | Milestone C: purchase requests and direct bills (`purchasing.test.ts`) |
| Team: roles, branch scope, immediate suspension, audit | ✅ | `membership.routes.ts`; `authorization.test.ts`, `session-security.test.ts` |
| Separation of duties (request / approve / receive / pay) | ✅ | Milestone C: configurable approve / receive / pay switches (`purchasing.test.ts`) |
| Patients: identity, branch registrations, scoped search, shared phone | ✅ | `patients.test.ts`, `front-desk-isolation.test.ts`, `patient-search-scale.test.ts` |
| Scheduling, booking, reschedule, cancel, queue | ✅ | `appointments.test.ts`, `schedule-races.test.ts` |
| Clinical records, finalize, addenda, coverage | ✅ | `clinical.test.ts`, `clinical-coverage.test.ts` |
| In-app tasks / reminders | ⛔ | Not in this programme's first milestones |

## Catalog and pricing

| Capability | State | Evidence / gap |
| --- | --- | --- |
| Clinical services with branch prices and price snapshots on charges | ✅ | `finance.test.ts` |
| Effective-dated prices | 🟡 | Price changes apply from now on; there is no future-dated schedule (brief 2, not built) |
| Stock items, units and conversions | ✅ | Milestone B; `inventory.test.ts` (validated integer factors, immutable once used) |
| Non-stock purchases | ✅ | Milestone C: order and bill lines to expense accounts |
| Treatment packages | ➖ (E-12) | Rules undefined |

## Accounting, revenue, cash

| Capability | State | Evidence / gap |
| --- | --- | --- |
| Charges, invoices, discounts, receipts, partial payments, credit notes, refunds, reversals, statements | ✅ | Milestone 3; `finance.test.ts` |
| Patient advances / unallocated receipts, allocation | ✅ | `finance.test.ts` (allocation races) |
| Deallocation | ⛔ | Today, a receipt reversal returns its allocations. Partial deallocation is not built. |
| Write-offs | ✅ | H6: owner-only bad-debt write-off (`WO-`, bad debts 6950); `installments.test.ts` |
| Chart, journals, entries, reversals, opening balances | ✅ | Milestone A; `accounting.test.ts` |
| Periods, close, reopen, server-side locks | ✅ | `accounting.test.ts` |
| Trial balance, ledger, income and expenses, balance sheet, receivables aging | ✅ | `accounting.test.ts`, `Accounting.test.tsx` |
| Cost centers (branches) | ✅ | Line `branchId`; income and expenses by branch |
| Cutover dry run, sub-ledger reconciliation | ✅ | `accounting.test.ts` (cutover rehearsal) |
| Cashboxes, bank accounts, sessions, vouchers, transfers | ✅ | `accounting.test.ts` (session race, insufficient cash) |
| Bank reconciliation (manual / CSV) | ✅ | `accounting.test.ts` |
| Bank or payment-provider feeds | 🔌 ➖ | Not built |
| Tax, VAT, e-invoicing | ⚙️ ➖ | Q9 / E4 |
| Payables aging | ✅ | Milestone C (`purchasing.test.ts`: aging = payables ledger) |

## Operations ERP

| Capability | State | Plan |
| --- | --- | --- |
| Warehouses, stock ledger, lots and expiry, FEFO, counts, adjustments, valuation | ✅ | Milestone B; `inventory.test.ts` (moving average, concurrency, FEFO, expired lots) |
| Consumption from performed procedures | ✅ | Milestone B; treating doctor, finalized records, once per item, linked returns |
| Suppliers, PR, approval, RFQ, quotations, PO, receipts, bills, payments, returns, credit notes | ✅ | Milestone C (`purchasing.test.ts`, full chain) |
| Expenses with approval | ✅ | Direct expense bills with threshold approval (milestone C); cash-out vouchers (milestone A) |
| Practitioner compensation | ✅ | Milestone D (`compensation.test.ts`: performed and invoiced bases, approval once, payments) |
| Assets and maintenance | ✅ | Milestone F (`assets.test.ts`); straight-line depreciation and disposal at book value (H4, `depreciation.test.ts`) |
| People / payroll | ⛔ ⚙️ | Brief 2 asks for configurable foundations; not built. Statutory rules excluded; waits for owner rules |

## Specialty workspaces

| Capability | State | Evidence / gap |
| --- | --- | --- |
| Dentistry chart, per-tooth history, plan items and status | ✅ | `specialty-records.test.ts` |
| Physiotherapy assessment, course, sessions, discharge | ✅ | `specialty-records.test.ts` |
| ENT visit template | ✅ | `specialty-records.test.ts` |
| Specialty and role-specific home and navigation | ✅ | Milestone E: "Today's focus" per role and the doctor's specialty worklist (`workspace-focus.test.ts`) |
| Materials linked to procedures | ✅ | "Materials used" on the finalized record (milestone B) |

## Brief 2 modules (milestones H1–H7)

| Capability | State | Evidence / gap |
| --- | --- | --- |
| Specialty workspaces, context chooser, preparation screen, module activation | ✅ | H1: docs/architecture/MODULES.md; `workspace-setup.test.ts`, `e2e/specialty-setup.spec.ts` |
| Budgets, budget against actual, cash flow, recurring commitments | ✅ | H2: docs/architecture/PLANNING.md; `planning.test.ts` |
| Employee advances and petty-cash custody | ✅ | H3: docs/architecture/STAFF_FUNDS.md; `staff-funds.test.ts` |
| Depreciation schedules and postings | ✅ | H4: docs/architecture/ASSETS.md; `depreciation.test.ts` |
| Clinic identity and legal profile, secure logo storage, letterhead | ✅ | H5: docs/architecture/ORGANIZATION_PROFILE.md; `organization-profile.test.ts` |
| Installment plans, rescheduling, write-offs | ✅ | H6: docs/architecture/INSTALLMENTS.md; `installments.test.ts` |
| Safe settings reset with snapshot and restore | ✅ | H7: docs/architecture/SETTINGS_RESET.md; `settings-reset.test.ts` |
| Consignment in and out | ⛔ | Not built (see docs/ERP_EXECUTION_PLAN.md, "Not built yet") |
| Cheques and print templates | ⛔ | Not built |
| Product sales and quotations to patients | ⛔ | Not built |
| HR and payroll foundations | ⛔ ⚙️ | Not built |
| Unified patient file (one timeline) | 🟡 | The parts exist separately |
