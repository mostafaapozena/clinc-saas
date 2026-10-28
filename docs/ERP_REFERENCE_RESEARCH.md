# ERP reference research

The research was bounded and done on 2026-10-28. It drew on official documentation only:

- Odoo 17 documentation;
- ERPNext and Frappe documentation, including the v13 Healthcare pages, which are the current
  public ones for clinical procedures.

There were no logins, private endpoints or source code. Nothing was copied: no code, no copy, no
assets and no branding. Each pattern below is reimplemented in raclinic's architecture.
**Observed** means it is stated in the cited documentation. **Inferred** means it is our reading,
not verified behaviour.

| # | Reference | Observed behaviour | Problem solved | raclinic adaptation | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| R1 | Odoo, *Year-end closing* | A lock date blocks entries up to a date. The balance sheet shows current-year earnings computed automatically, and a closing entry is optional. | Closed periods cannot drift; reports stay live. | `lockedThrough`: months close in order, an owner can reopen the latest with a reason, and the balance sheet shows the accumulated result. | Posting into a closed month returns `409 PERIOD_CLOSED` (tested); reopening is owner-only (tested). |
| R2 | Odoo, *Bill control* / 3-way matching | Bills follow *ordered* or *received* quantities. With received quantities, only received products can be billed, and a fully billed order cannot be billed again. | Paying for goods that never arrived. | Planned milestone C: bill quantity ≤ received − already billed, per order line (the received-quantities policy), with partial receipts and bills. | Over-billing refused; partial flows tested. |
| R3 | ERPNext, *Procurement cycle overview*, *Supplier Quotation*, *Purchase Order* | Material request → RFQ → supplier quotations (drafts per supplier from the RFQ) → comparison report → PO from the chosen quotation → receipt → invoice → payment. | A traceable purchasing chain with competition between suppliers. | Milestone C: purchase request → approval (threshold) → RFQ → quotations → comparison (price, quantity, lead time) → PO → receipt → bill → payment. A short path (PR → PO) is allowed for small clinics under the same controls. | Each document links to its source; the comparison shows each line's best offer; the journey is tested end to end. |
| R4 | ERPNext, *Moving average valuation* | The average is recomputed on each receipt as (old value + new cost) ÷ new quantity, and issues are valued at the current average. | Simple, defensible stock valuation. | Milestone B: perpetual moving weighted average per item at organization level, atomic per-item updates, negative stock blocked, no backdated stock moves. | Valuation examples tested; concurrent issues cannot oversell. |
| R5 | ERPNext v13 Healthcare, *Clinical Procedure* | Consumables must be in the service unit's warehouse. After the procedure, actual quantities are entered and "Complete and Consume" books a stock entry. Consumables can be invoiced separately. | Stock follows what was actually used, not what was planned. | Milestone B: consumption is recorded against a performed procedure, never from a plan item. It is explicit, once per record item and stock line (unique key), and reversible by a linked return. Billing stays a separate choice. | Duplicate consumption refused; plan items never reduce stock. |
| R6 | ERPNext, *POS opening and closing* (workflow pages) | An opening entry starts a session, with optional opening cash; the closing entry gathers the session's transactions and posts. Exactly how the difference is computed is not documented on the page we read (**not verified**). | Cash accountability per shift. | Cashier sessions: the counted opening is checked against the ledger, expected = opening + session movements, and the counted closing posts any difference with a note. | Expected and difference tested; one open session per cashbox (race tested). |
| R7 | Odoo and ERPNext journals (**inferred** from general documentation) | Documents post to journals; entries are reversed rather than deleted. | Auditability. | Immutable entries, linked reversals, unique source keys. | Database hooks refuse edits and deletes (tested). |

## What we deliberately did not adopt

- Multi-company or intercompany accounting, and multi-currency revaluation. These are out of
  scope (decisions E-1 and E-2).
- Tax engines, statutory payroll and insurance claims. These need validated local rules.
- Point-of-sale invoice consolidation. raclinic keeps one invoice per patient visit, as before.

## Sources

- https://www.odoo.com/documentation/17.0/applications/finance/accounting/reporting/year_end.html
- https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/purchase/manage_deals/control_bills.html
- https://docs.frappe.io/erpnext/user/manual/en/procurement-cycle-overview
- https://docs.frappe.io/erpnext/user/manual/en/supplier-quotation
- https://docs.frappe.io/erpnext/user/manual/en/purchase-order
- https://docs.frappe.io/erpnext/user/manual/en/calculation-of-valuation-rate-in-fifo-and-moving-average
- https://docs.frappe.io/erpnext/v13/user/manual/en/healthcare/clinical_procedure
- https://docs.frappe.io/erpnext/pos-workflows
