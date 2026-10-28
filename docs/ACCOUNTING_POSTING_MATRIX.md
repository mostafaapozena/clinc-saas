# Accounting posting matrix

Every journal entry of the platform comes from **one business document** and goes through the
posting engine (`postEntry`, docs/architecture/ACCOUNTING.md). An entry:

- is balanced;
- uses active, non-group accounts of the organization;
- is in its currency;
- falls on an open date (after the cutover, outside closed months);
- is posted **once per source key**, so retries and reruns never post twice.

This page lists every source in one place. The module documents hold the details.

> The chart is an implementation template (`raclinic.clinic@1`), **not an approved statutory
> chart**. The posting map can be repointed by the accountant (E-3, E-4).

## Patient finance (milestone 3 / A): `accounting/finance-postings.ts`

| Event | Debit | Credit | Source key |
| --- | --- | --- | --- |
| Invoice issued | Patient receivables (total) + Discounts given (discount) | Service revenue (subtotal) | `invoice:<id>:issued` |
| Credit note | Credit notes to patients (sales returns) | Patient receivables | `credit_note:<id>:issued` |
| Write-off (bad debt, owner, H6) | Bad debts (6950) | Patient receivables | `write_off:<id>:issued` |
| Receipt recorded | Cashbox / bank (by method and cashier session) | Patient advances | `payment:<id>:received` |
| Allocation to an invoice | Patient advances | Patient receivables | `payment:<id>:allocation-<n>` |
| Refund | Patient advances | Same cashbox / bank | `refund:<id>:paid` |
| Receipt reversed | Patient receivables (allocated) + Patient advances (unallocated) | Cashbox / bank | `payment:<id>:reversed` |

## Cash and banks (A): `accounting/cash.routes.ts`

| Event | Debit | Credit |
| --- | --- | --- |
| Session count differs (opening or closing) | Cashbox, or cash over/short | The other one |
| Voucher out | Chosen expense, equity or liability account | Cashbox / bank |
| Voucher in | Cashbox / bank | Chosen income, equity or liability account |
| Transfer | Receiving cashbox / bank | Sending cashbox / bank |
| Opening balances | As entered | Opening balances (equity) |

Vouchers never post to control accounts or to document-only accounts:

- **control accounts:** receivables, advances, payables, goods received not billed, inventory,
  practitioner payable;
- **document-only accounts:** staff advances, custody, accumulated depreciation.

## Inventory (B): docs/architecture/INVENTORY.md

| Document | Debit | Credit |
| --- | --- | --- |
| Opening stock | Inventory | Opening balances |
| Count gain / loss | Inventory / Stock adjustments | Stock adjustments / Inventory |
| Write-off (damaged or expired) | Stock adjustments | Inventory |
| Internal issue, consumption in a visit | Medical consumables used | Inventory |
| Consumption return | Inventory | Medical consumables used |

## Purchasing (C): docs/architecture/PURCHASING.md

| Event | Debit | Credit |
| --- | --- | --- |
| Receipt of stock items | Inventory (order price) | Goods received, not billed |
| Bill, stock lines | Goods received, not billed ± price differences | Supplier payables |
| Bill, non-stock or direct expense | Line's expense or asset account | Supplier payables |
| Purchase return (unbilled) | Goods received, not billed | Inventory ± differences |
| Supplier credit note | Supplier payables | Inventory ± differences; expense accounts |
| Supplier payment | Supplier payables | Cashbox or bank |

## Practitioner compensation (D): docs/architecture/COMPENSATION.md

| Event | Debit | Credit | Source key |
| --- | --- | --- | --- |
| Settlement approved | Practitioner fees (branch) | Practitioner fees payable (partner: practitioner) | `settlement:<id>:approved` |
| Settlement paid | Practitioner fees payable | Cashbox or bank | `settlement:<id>:payment-<n>` |

## Equipment (F, H4): docs/architecture/ASSETS.md

| Event | Debit | Credit | Source key |
| --- | --- | --- | --- |
| Purchase (through a supplier bill) | Medical equipment / furniture | Supplier payables | the bill's |
| Monthly depreciation (H4) | Depreciation (6700, branch) | Accumulated depreciation (1590, branch) | `asset:<id>:depreciation-YYYY-MM` |
| Disposal | Accumulated depreciation + Other expenses (book value) | Asset account (cost) | `asset:<id>:disposed` |

## Staff funds (H3): docs/architecture/STAFF_FUNDS.md

| Event | Debit | Credit | Source key |
| --- | --- | --- | --- |
| Advance or custody handed out | Employee advances (1250) / Petty cash custody (1260), partner member | Cashbox / bank | `staff_fund:<id>:issue` |
| Cash returned | Cashbox / bank | Advances / custody | `staff_fund:<id>:return-<n>` |
| Custody receipts | Expense accounts | Custody | `staff_fund:<id>:expense-<n>` |
| Write-off (owner) | Other expenses | Advances / custody | `staff_fund:<id>:write_off-<n>` |

## Modules that never post

| Module | Why |
| --- | --- |
| Budgets, budget against actual, cash flow (H2) | Plans and reports computed from posted entries |
| Recurring commitments (H2) | Each payment is the voucher or bill that already posted it, linked once |
| Installment plans (H6) | Schedules the invoice's open balance; receipts post as usual |
| Settings reset (H7) | Configuration only |

## Accounts added after the template's first version

These are created on first use in ledgers made earlier (`ensureTemplateAccount`, next free code if
taken):

| Code | Key | Type | Milestone |
| --- | --- | --- | --- |
| 1250 | `staffAdvances` | asset (document-only) | H3 |
| 1260 | `staffCustody` | asset (document-only) | H3 |
| 1590 | `accumulatedDepreciation` | asset, contra (document-only) | H4 |
| 6700 | `depreciationExpense` | expense | H4 |
| 6950 | `badDebts` | expense | H6 |

## Invariants checked by tests

- **Trial balance:** it balances (`accounting.test.ts`).
- **Sub-ledgers against the ledger:**
  - receivables = open invoices;
  - payables = open bills;
  - inventory = item values;
  - staff advances and custody = open staff funds;
  - accumulated depreciation = sum of the assets' accumulated depreciation.
  
  Tests: `accounting.test.ts`, `purchasing.test.ts`, `inventory.test.ts`, `staff-funds.test.ts`,
  `depreciation.test.ts`.
- **Cash flow:** opening + net = closing cash (`planning.test.ts`).
- **Reruns post nothing twice:**
  - depreciation (`depreciation.test.ts`);
  - staff-fund settlements, version-checked (`staff-funds.test.ts`);
  - write-offs, idempotency key (`installments.test.ts`).
