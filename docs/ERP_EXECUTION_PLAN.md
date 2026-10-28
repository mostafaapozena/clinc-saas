# ERP execution plan

Milestones are outcome-based and delivered one per branch and pull request (`phase-16/erp-*`).
Each is merged after `npm run verify` passes in the Codespace and in CI. Status is updated here as
each milestone lands. Decisions are in [ERP_DECISIONS.md](ERP_DECISIONS.md); actual state is in
[ERP_MODULE_MATRIX.md](ERP_MODULE_MATRIX.md).

## A. General ledger, cash and banks — ✅ built (branch `phase-16/erp-accounting`)

**Outcome.** An accountant sees balanced books fed automatically by patient finances. Cashiers run
sessions with counted cash. Months can be closed.

**Scope:**

- template chart and posting map;
- automatic postings from invoices, credit notes, receipts, allocations, refunds and reversals;
- manual and opening entries, and linked reversals;
- periods;
- statements: trial balance, ledger, income and expenses, balance sheet, receivables aging;
- sub-ledger reconciliation and the cutover dry run;
- cash accounts, sessions, vouchers, transfers, and CSV bank reconciliation.

**Data and invariants.** See [ACCOUNTING.md](architecture/ACCOUNTING.md):

- balanced, immutable entries;
- unique source keys;
- the same transaction as the document;
- server-side period locks;
- control accounts;
- one currency.

**Permissions.** `accounting.*` and `cash.*` (role matrix updated).

**Tests.** API (postings, idempotency, immutability, periods, sessions with a race, vouchers, bank
matching, cutover rehearsal, cross-organization 404, branch scope 403), role matrix, web pages.

**Migration.** New collections and indexes only. Existing documents are not touched. Accounting
starts when an owner sets it up; the demo organizations are set up by the seed.

**Rollback.** Without settings, nothing posts (the finance code paths are no-ops), so disabling
accounting does not affect patient finances.

## B. Inventory and medical consumables — ✅ built (branch `phase-16/erp-inventory`, stacked on A)

**Outcome.** Clinics track supplies by warehouse, lot and expiry. Procedures consume stock
explicitly, and the ledger carries stock value.

**Scope:**

- items (stock or non-stock, unit and validated conversions, reorder level, lot and expiry
  tracking flags);
- warehouses per branch;
- stock moves: opening, receipt, issue or consumption, transfer, return, count adjustment, damage or
  expiry write-off;
- balances per item, warehouse and lot;
- moving-average valuation;
- FEFO suggestions, expiry alerts and reorder suggestions;
- consumption from a finalized procedure (unique per record item and stock line), with a reversal by
  linked return.

**Invariants:**

- Atomic conditional `$inc` on balances, so stock never goes negative.
- Valuation is updated in the same transaction.
- No backdating.
- Posting rules:

  | Event | Debit | Credit |
  | --- | --- | --- |
  | Consumption | Consumables used | Inventory |
  | Write-off | Stock adjustments | Inventory |
  | Opening stock | Inventory | Opening balances |

**Permissions.** `inventory.read`, `inventory.manage`, `inventory.move`, and `inventory.consume`
(doctor, for their own records).

**Tests.** Valuation examples, a concurrent issue, isolation, FEFO, duplicate consumption, and plan
items not consuming stock.

## C. Suppliers, purchasing and payables — ✅ built (branch `phase-16/erp-purchasing`)

**Outcome.** A traceable purchasing chain from request to payment, with 3-way matching and
payables aging.

**Scope:**

- suppliers and payment terms;
- purchase request, with approval above a threshold and requester ≠ approver when configured;
- RFQ and supplier quotations, with a comparison;
- purchase order;
- partial receipts into a warehouse (stock items) or no receipt (services);
- supplier bills against received quantities, plus direct expense bills;
- partial payments from cash or bank;
- purchase returns and supplier credit notes;
- cancel and close rules;
- printable RFQ and PO;
- payables aging.

**Posting rules:**

| Event | Debit | Credit |
| --- | --- | --- |
| Receipt | Inventory | Goods received, not billed |
| Bill (stock items) | Goods received, not billed (at order price), plus or minus purchase price differences | Supplier payables |
| Bill (services / expenses) | Expense | Supplier payables |
| Payment | Supplier payables | Cashbox or bank |
| Return | Goods received, not billed, or payables | Inventory |

**Tests.** Over-receipt and over-billing refused; partial flows; the approval threshold; separation
of duties; the end-to-end journey.

## D. Practitioner compensation — ✅ built (branch `phase-16/erp-compensation`)

**Outcome.** Practitioner fees are computed from explicit, effective-dated agreements, then
reviewed, approved and paid.

**Scope:**

- agreements: fixed, percentage or both;
- basis: performed charges, invoiced lines or collected allocations;
- service and branch filters;
- treatment of discounts, refunds and credits;
- settlement periods;
- a draft that is computed, then approved (frozen) and paid;
- adjustments.

**Posting rules:**

| Event | Debit | Credit |
| --- | --- | --- |
| Approval | Practitioner fees | Practitioner fees payable |
| Payment | Practitioner fees payable | Cashbox or bank |

## E. Specialty-aware workspaces — ✅ built (with milestone D, branch `phase-16/erp-compensation`)

**Outcome.** Doctors of each specialty see their priorities first:

- dentistry: open plan items and today's chairs;
- physiotherapy: active courses and sessions due;
- ENT: follow-ups.

Reception sees arrivals, finance sees money, and owners see an overview.

Configuration follows the enabled modules, branch, specialty, role and permissions. A specialty
never widens access.

## F. Assets and maintenance — ✅ built (branch `phase-16/erp-assets`)

The equipment register (location, custodian, purchase link), the maintenance schedule and log, the
maintenance expense through a bill or voucher, and retirement. Depreciation only if the accountant
defines it.

## G. Reports and end-to-end proof — ✅ built (branch `phase-16/erp-assets`)

A reports hub over posted data, with scoped filters and CSV export. Browser end-to-end tests cover
journeys A to E from brief §18:

- A — patient to accounting;
- B — supplies;
- C — consumption;
- D — cash;
- E — practitioner.

## Order and dependencies

A → B → C (receipts need stock) → D → E → F → G. Each milestone keeps the full verify suite green.
