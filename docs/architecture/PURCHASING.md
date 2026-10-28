# Suppliers, purchasing and payables (ERP milestone C)

The clinic's procurement chain, connected to stock ([INVENTORY.md](INVENTORY.md)) and the ledger
([ACCOUNTING.md](ACCOUNTING.md)). Synthetic data only. Supplier documents (quotation requests and
orders) are **prepared for printing or PDF by the clinic and never e-mailed** (decision E-14).

Code:

- API: `apps/api/src/modules/purchasing/` (`purchasing.model.ts`, `purchasing.routes.ts`).
- Web: `pages/PurchasingPages.tsx` and `lib/purchasing.ts`.
- Tests: `apps/api/test/purchasing.test.ts` (the whole chain), the purchasing rows of
  `authorization.test.ts`, and `apps/web/src/pages/Purchasing.test.tsx`.

## The chain

```
purchase request ──(approval if ≥ threshold)──▶ RFQ to suppliers ──▶ quotations + comparison
        │                                                                 │
        └──────────────(or order directly from the approved request)──────┤
                                                                          ▼
                    purchase order (draft → confirmed) ──▶ receipts (partial) ──▶ supplier bill ──▶ payments
                                                           │  returns (unbilled)      │  credit notes (billed)
```

| Document | Number | Rules |
| --- | --- | --- |
| Purchase request | `PR-YYYY-…` | See [Requests](#requests) below. |
| Request for quotation | `RFQ-…` | From an approved request, to one or more active suppliers. Quotations are entered per supplier (price per line unit, quantity, lead time, validity) while open. The comparison shows each line's lowest price and fastest supplier, plus totals per supplier. |
| Purchase order | `PO-…` | See [Orders](#orders) below. |
| Goods receipt | `GRN-…` | See [Receipts and returns](#receipts-and-returns) below. |
| Purchase return | `PRT-…` | Only for **received and not yet billed** quantities. Stock leaves at average cost. |
| Supplier bill | `BILL-…` | See [Bills, credit notes and payments](#bills-credit-notes-and-payments) below. |
| Supplier credit note | `SCN-…` | See [Bills, credit notes and payments](#bills-credit-notes-and-payments) below. |
| Supplier payment | `SPAY-…` | See [Bills, credit notes and payments](#bills-credit-notes-and-payments) below. |

### Requests

- Anyone who works may raise a request, including doctors, who see only their own requests.
- Below the **approval threshold** a request is approved by policy, and this is recorded as
  automatic.
- At or above the threshold, an approver decides. A rejection needs a reason.

### Orders

- An order is created from a quotation (its lines and prices), from an approved request, or
  directly. A direct order is allowed only **below** the threshold, so the simpler path for small
  clinics never bypasses approval of larger amounts.
- Stock lines need a warehouse of the order's branch. Non-stock lines need an expense account.
- An order can be **cancelled** only while nothing has been received. After that it is
  **closed**: received quantities stay billable, and nothing more can be received.

### Receipts and returns

- Receipts can be partial.
- A receipt can never exceed the ordered quantity.
- Stock items enter the order's warehouse **at the order price**, with lot and expiry when the item
  is lot-tracked.
- Receiving is separate from billing and paying.

### Bills, credit notes and payments

- **Supplier bills follow received quantities (3-way match):**
  - A bill line covers at most *received − already billed* of its order line.
  - The supplier's invoice number is unique per supplier.
  - The bill date cannot be in the future, and its due date comes from the supplier's terms.
  - **Direct expense bills** (rent, maintenance… without an order) at or above the threshold wait
    for approval before posting.
- **Supplier credit notes:**
  - They apply to a posted bill: billed goods sent back (stock leaves at average cost) or
    allowances on non-stock lines.
  - They are bounded by each line's billed quantity and the bill's **open balance**.
- **Supplier payments:**
  - A payment is partial or full, and allocated to bills of one supplier. Allocations must equal
    the amount.
  - It is bounded by each bill's open balance through a conditional `$inc`.
  - A cashbox never goes below zero.
  - Money already paid and later refunded by a supplier is recorded as a cash-in voucher.

All documents are idempotent (`Idempotency-Key`), never edited and never deleted. Receipts and
bills lock their order inside the transaction, so concurrent receipts or bills cannot over-receive
or over-bill.

## Segregation of duties (configurable)

The `PUT /purchasing/settings` endpoint (owner only) sets the approval threshold and three
switches:

| Switch | Rule | Default |
| --- | --- | --- |
| `approve` | The requester cannot approve their own request, and whoever recorded a direct bill cannot approve it. | On |
| `receive` | Whoever placed the order cannot receive it. | Off |
| `pay` | Whoever recorded a bill cannot pay it. | Off |

Violations return `403 SEPARATION_OF_DUTIES`. No role bypasses these rules.

## Ledger entries

| Event | Debit | Credit |
| --- | --- | --- |
| Receipt of stock items | Inventory (at order price) | Goods received, not billed |
| Bill line for stock items | Goods received, not billed (at order price) ± purchase price differences | Supplier payables (total) |
| Bill line for non-stock items / direct expense | The line's expense (or asset) account | Supplier payables |
| Purchase return (unbilled) | Goods received, not billed (at order price) | Inventory (average cost), ± purchase price differences |
| Supplier credit note | Supplier payables (credit amount) | Inventory (average cost of goods sent back) ± differences; expense accounts for non-stock allowances |
| Payment | Supplier payables | Cashbox or bank |

A cost is never booked twice:

- A purchase bill records the cost once, to goods received not billed (stock) or to the expense
  account (non-stock).
- Cash vouchers are for spending without a supplier bill.

Tests check three invariants:

- The ledger's supplier payables equal the open bills.
- The ledger's inventory equals the item values.
- The trial balance balances.

## Permissions and scope

| Permission | Roles |
| --- | --- |
| `purchase.request` (raise requests, see suppliers) | owner, admin, receptionist, accountant, doctor |
| `purchase.read` (all requests, RFQs, orders in scope) | owner, admin, accountant, receptionist |
| `purchase.approve` | owner, admin |
| `purchase.order.manage` (RFQs, quotations, orders) | owner, admin, accountant |
| `purchase.receive` (receipts, returns) | owner, admin, receptionist |
| `purchase.bill.manage` (bills, credit notes, payables aging) | owner, admin, accountant |
| `purchase.pay` | owner, accountant |
| `purchase.supplier.manage` | owner, admin, accountant |
| `purchase.settings.manage` | owner |

- Requests, RFQs, orders and receipts are branch-owned, and branch scope applies.
- Bills, credit notes, payments and payables aging are ledger documents and need
  **organization-wide scope**.

## Known limitations

- No supplier advances or unallocated payments; no refunds from suppliers through this module.
- No multi-currency purchasing and no landed costs.
- No blanket orders or contracts, and no automatic reordering. Reorder suggestions come from stock
  alerts.
- No e-mail to suppliers; documents are printed or saved as PDF.
- No VAT or withholding tax (needs Q9).
