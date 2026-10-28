# ERP decisions

Technical and product decisions for the medical ERP milestones, made on the evidence in
[ERP_REFERENCE_RESEARCH.md](ERP_REFERENCE_RESEARCH.md). Legal, tax, medical and commercial
decisions are **not** made here. They are listed as open items for the owner, the clinic's
accountant or clinicians.

| Id | Decision | Status | Why / consequence |
| --- | --- | --- | --- |
| E-1 | One legal entity per organization; branches are cost centers. | Decided (technical) | Branches are not separate companies. No intercompany entries can arise. A group of companies would mean separate organizations. |
| E-2 | One currency per organization (EGP or SAR), with no exchange accounting. | Decided (technical) | Incomplete foreign exchange is worse than none. The boundary is enforced: one currency in settings, documents and the ledger. |
| E-3 | The chart template `raclinic.clinic@1` and its posting map are implementation templates. | Decided — **accountant review required before real use** | Codes, names and mappings can be changed per organization (mappings by the owner, accounts by the accountant). |
| E-4 | Accrual basis: revenue at invoice issue; receipts are patient advances until allocated. | Decided (technical) — accountant to confirm | Receipts never count as revenue. Performed but uninvoiced services are not accrued, a simplification flagged for review. |
| E-5 | Cutover with opening entries; no reposting of history. | Decided | Avoids duplicate revenue. The dry run proposes opening balances, and the reconciliation report proves agreement. |
| E-6 | Months close in order, owner-only reopen of the latest month with a reason; no year-end closing entries yet. | Decided | Mirrors a lock date. Closing entries wait for the accountant's choice of equity accounts. |
| E-7 | Ledger-wide views need organization-wide scope. | Decided | Prevents branch-restricted users from seeing other branches' amounts through totals. |
| E-8 | Stock valuation: perpetual moving weighted average per item (organization level). Negative stock blocked by default. Stock moves dated today only (no backdating). | Decided for milestone B — accountant to validate before real use | Simple and auditable. Backdating would require revaluing later issues. |
| E-9 | Physical picking suggests FEFO by expiry; valuation stays moving average. | Decided | Picking policy and valuation are kept separate (brief §13). |
| E-10 | Purchasing bills follow received quantities (3-way match); price differences between order and bill go to *purchase price differences*. | Decided for milestone C | Prevents paying for undelivered goods; keeps stock at order cost. |
| E-11 | Practitioner compensation is configured per agreement (fixed, percentage or both; basis performed, invoiced or collected). Approved settlements are never recomputed. | Decided for milestone D | No single model fits all clinics. Payroll is a separate, statutory topic and is not built. |
| E-12 | Packages / courses with prepaid sessions | **Not built** | Payment, use, cancellation and refund rules are not defined (brief §8). Needs an owner decision. |
| E-13 | Statutory payroll, insurance deductions, tax tables, device calibration certificates | **Not built** | Local rules are needed. Only non-statutory foundations may be added. |
| E-14 | Supplier messages (RFQ, PO) are prepared for download or print and never sent by email. | Decided | No real external messages. |

## Open items for the owner and the accountant

1. Review and adapt the chart and posting map (E-3, E-4).
2. Choose the year-end closing method and the equity accounts (E-6).
3. Validate stock valuation and the write-off rules before real use (E-8).
4. Define the treatment-package rules, if packages are wanted (E-12).
5. Tax: VAT, e-invoicing and statutory numbering (existing items Q9 and E4).
