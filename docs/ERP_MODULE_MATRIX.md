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
| Effective-dated prices | 🟡 | Price changes apply from now on; there is no future-dated schedule |
| Stock items, units and conversions | ✅ | Milestone B; `inventory.test.ts` (validated integer factors, immutable once used) |
| Non-stock purchases | ✅ | Milestone C: order and bill lines to expense accounts |
| Treatment packages | ➖ (E-12) | Rules undefined |

## Accounting, revenue, cash

| Capability | State | Evidence / gap |
| --- | --- | --- |
| Charges, invoices, discounts, receipts, partial payments, credit notes, refunds, reversals, statements | ✅ | Milestone 3; `finance.test.ts` |
| Patient advances / unallocated receipts, allocation | ✅ | `finance.test.ts` (allocation races) |
| Deallocation | ⛔ | Today, a receipt reversal returns its allocations. Partial deallocation is not built. |
| Write-offs | 🟡 | Credit notes with a reason cover write-offs; there is no separate write-off account |
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
| Practitioner compensation | ⛔ | Milestone D |
| Assets and maintenance | ⛔ | Milestone F |
| People / payroll | ➖ (E-13) | Non-statutory employee records could be added later |

## Specialty workspaces

| Capability | State | Evidence / gap |
| --- | --- | --- |
| Dentistry chart, per-tooth history, plan items and status | ✅ | `specialty-records.test.ts` |
| Physiotherapy assessment, course, sessions, discharge | ✅ | `specialty-records.test.ts` |
| ENT visit template | ✅ | `specialty-records.test.ts` |
| Specialty and role-specific home and navigation | 🟡 → milestone E | The home page shows specialty counts; navigation is the same for every specialty |
| Materials linked to procedures | ✅ | "Materials used" on the finalized record (milestone B) |
