# Clinic finances (milestone 3)

Prices, charges, invoices, receipts, corrections and balances of a clinic — **separate from the
platform's own subscription billing** (milestone 4). Development with synthetic data only.

**Not a tax system.** Invoices and receipts are ordinary documents labelled "not a tax invoice and
not an electronic invoice". VAT / tax handling and e-invoicing for Egypt (ETA) or Saudi Arabia
(ZATCA) are not implemented and need approved requirements and validation first (Q9). No insurance
claims, no online card payments: receipts record money the clinic actually received.

Code: `apps/api/src/modules/finance/` (`finance.model.ts`, `finance.routes.ts`), web
`pages/FinancePages.tsx`, `components/finance.tsx`, `lib/finance.ts`. Tests:
`apps/api/test/finance.test.ts`, finance rows in `authorization.test.ts`,
`apps/web/src/pages/Finance.test.tsx`, `e2e/finance.spec.ts`.

## Money

- Every amount is an **integer number of minor units** (piastres, halalas) with an explicit
  currency; inputs are parsed as text (Arabic digits accepted), never through floating point.
  Bounds: 0 ≤ amount ≤ 10⁹ minor units; sums are checked to stay exact.
- **One currency per organization** (EGP or SAR), chosen once by the owner. It cannot change once
  prices or charges exist (`409 CURRENCY_LOCKED`). Amounts in different currencies are never added:
  invoices refuse mixed charges and reports group by currency. _(Proposal P9, to be confirmed.)_

## Documents and lifecycle

| Record | States | Changes allowed |
| ------ | ------ | --------------- |
| Service (catalog) | active / inactive | name, price, branch prices, status — with version; never affects charges already made |
| Charge | pending → invoiced, or voided (reason) | voiding only while pending |
| Invoice | draft → issued, or draft → discarded | draft: discount (permission, reason, ≤ subtotal), issue, discard (charges return to pending). Issued: **immutable**; only `paid` / `credited` change, through bounded counters |
| Receipt (payment) | active → reversed | allocation of its unallocated part; refunds; reversal (not after a refund) |
| Credit note, refund | — | insert only |

- **Charges** come from the catalog price at the branch (branch override or base price). Doctors
  can charge a **procedure or treatment-plan item of their own finalized record** with explicit
  confirmation; the charge carries the catalog service name only — never the clinical text — and a
  unique index allows **one charge per record item**, ever (concurrent attempts tested).
- **Numbers**: `INV-2026-000012`, `RCPT-…`, `CN-…`, `REF-…` — one sequence per organization,
  document type and year, assigned inside the issuing transaction (unique, gap-free for committed
  documents; tested with parallel issues). Per-branch numbering or legal formats are a tax decision.
- **No hard deletes, no silent edits**: database hooks refuse deleting or replacing charges,
  invoices, receipts and adjustments, and any update of an issued invoice other than its counters.

## Integrity under concurrency

- Creating an invoice claims its charges with a conditional update inside a transaction; a charge
  can be on one invoice only (parallel test: one invoice wins).
- Allocating money to an invoice is a single conditional `$inc` requiring
  `paid + credited + amount ≤ total`, and on the receipt `allocated + refunded + amount ≤ amount`;
  credit notes and refunds use the same pattern. Two cashiers racing for the same balance: one
  succeeds, the other gets `409 OVER_ALLOCATION` and its receipt is rolled back (tested).
- Mutations that create documents take an `Idempotency-Key`; a reused key with a different request
  is refused (`409 IDEMPOTENCY_KEY_REUSED`).

## Balances, statement and reports

- Invoice balance = total − paid − credited. Patient account: outstanding on issued invoices,
  unallocated credit on active receipts, net.
- Statement: invoices (debit), receipts (credit), reversals (debit), credit notes (credit), refunds
  (debit), with a running balance per currency; it equals the account's net balance (tested).
- Reports (`/finance/reports/summary`): invoiced, discounts, collected by method, credit notes and
  refunds in a period, outstanding now, top services — per currency, within the caller's branches.

## Permissions (separate from clinical permissions)

| Permission | Roles |
| ---------- | ----- |
| `finance.settings.manage` (currency) | owner |
| `finance.catalog.read` | owner, admin, receptionist, accountant, doctor |
| `finance.catalog.manage` | owner, admin |
| `finance.charge.create`, `finance.invoice.manage`, `finance.payment.record`, `finance.account.read` | owner, admin, receptionist, accountant |
| `finance.charge.clinical` (own finalized records) | doctor |
| `finance.discount.apply`, `finance.adjustment.manage` (credit notes, refunds, reversals) | owner, admin, accountant |
| `finance.report.read` | owner, admin, accountant |

The new **accountant** role reads patient identity and appointments (to bill) within its branches
and has no clinical access at all. Doctors get no financial reports. Everything is branch-scoped:
documents of other branches or organizations answer `404`. Every financial change is in the
administrative audit log with amounts and numbers — no patient or clinical text.

## Printouts

Issued invoices and receipts have a print view with the raclinic logo, organization and branch,
patient name and number, lines and totals, and the "not a tax invoice / not an electronic invoice"
label; the browser's print dialog saves a PDF. No PDF is generated server-side.

## Known limitations / decisions needed

- Tax, VAT, e-invoicing, legal invoice numbering and retention periods (Q9, E4).
- Insurance, installments, online payments for patients, multi-currency organizations.
- Cashier sessions, the general ledger and period closing are built in ERP milestone A ([ACCOUNTING.md](ACCOUNTING.md)): from the ledger cutover, every invoice, credit note, receipt, allocation, refund and reversal posts a balanced entry in the same transaction. Export to external accounting software is not built.
- Prices in the demo seed are synthetic examples, not tariffs.
