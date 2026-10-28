# Clinic accounting: general ledger, cash and banks (ERP milestone A)

The clinic's own books, built on top of patient finances ([FINANCE.md](FINANCE.md)). They are
separate from the platform's subscription billing ([SUBSCRIPTIONS.md](SUBSCRIPTIONS.md)).
Development uses synthetic data only.

> **Not a statutory or tax system.** The chart of accounts and the posting rules are an
> *implementation template* (`raclinic.clinic@1`) that the clinic's accountant must review before
> real use (decision E-3 in [ERP_DECISIONS.md](../ERP_DECISIONS.md)). No certified statements, tax
> returns, VAT or e-invoicing.

Code: `apps/api/src/modules/accounting/`:

| File | Contents |
| --- | --- |
| `accounting.model.ts` | Data model |
| `accounting.chart.ts` | Template chart and mappings |
| `accounting.posting.ts` | Posting engine |
| `finance-postings.ts` | Patient-finance rules |
| `accounting.routes.ts` | Ledger API |
| `cash.routes.ts` | Cash and bank API |
| `accounting.setup.ts` | Ledger creation |

The web pages are `pages/AccountingPages.tsx` and `pages/CashPages.tsx`. Tests are in `apps/api/test/accounting.test.ts`, the accounting rows of
`authorization.test.ts`, and `apps/web/src/pages/Accounting.test.tsx`.

## Model and invariants

- **One legal entity per organization; branches are cost centers.** Every entry line can carry a
  branch. There is no intercompany accounting.
- **One currency per organization:** the clinic-finance currency, fixed once prices exist. Amounts
  are integer minor units. Different currencies are never summed, and there is no foreign-exchange
  accounting. This boundary is enforced, not assumed.
- **Accrual basis.**
  - Revenue is recognized when an invoice is **issued**.
  - A receipt is a liability (*patient advances*) until it is **allocated** to an invoice, so money
    received is never counted as revenue.
  - Performed but not yet invoiced services (pending charges) are not recognized. This
    simplification is listed for the accountant's review.
- **Balanced, immutable entries.**
  - `postEntry` refuses an entry when:
    - debits and credits are not equal and above zero;
    - a line has both a debit and a credit;
    - an account is archived, is a group, or belongs to another organization;
    - the date is before the cutover or in a closed month.
  - Database hooks refuse deleting, replacing or editing a posted entry. The only permitted update
    links its reversal, once.
- **Idempotent posting.** Each document posting has a source key `type:id:event` with a unique
  index (for example, `invoice:<id>:issued` or `payment:<id>:allocation-2`). Replaying a request
  posts nothing new.
- **Same transaction as the document.** An invoice and its entry commit together or not at all.
- **Financial dates** are the organization's local calendar dates (`YYYY-MM-DD`). They never come
  from the browser.
- **Corrections are linked reversals.**
  - Manual, opening and voucher entries are reversed by a new entry (`reversalOf` / `reversedBy`).
  - Document postings are corrected through their document: a credit note, a receipt reversal or a
    refund. Any other correction is refused with `409 DOCUMENT_POSTING`.
  - An entry matched to a bank statement line cannot be reversed until it is unmatched.
- **Control accounts:**
  - receivables;
  - patient advances;
  - payables;
  - goods received not billed;
  - stock;
  - practitioner fees payable.

  These accounts change only through their documents. Manual entries may touch them only in an
  **opening** entry, dated on the cutover date.
- **Clinical privacy:**
  - Entry memos carry document numbers only (`INV-…`, `RCPT-…`).
  - Partner references (patient, supplier, practitioner) are ids.
  - No clinical text reaches the ledger. This is tested.

## Business events and their entries

| Event | Debit | Credit |
| --- | --- | --- |
| Invoice issued | Patient receivables (total) + Discounts given (discount) | Service revenue (subtotal) |
| Credit note | Credit notes to patients | Patient receivables |
| Receipt recorded | Cashbox / bank (by method and cashier session) | Patient advances |
| Allocation of a receipt to an invoice | Patient advances | Patient receivables |
| Refund from a receipt | Patient advances | Same cashbox / bank |
| Receipt reversed | Patient receivables (allocated part) + Patient advances (unallocated part) | Cashbox / bank |
| Cash session: opening or closing count differs | Cashbox, or cash over/short | The other one of the two |
| Cash voucher, out | Chosen expense, equity or liability account | Cashbox / bank |
| Cash voucher, in | Cashbox / bank | Chosen income, equity or liability account |
| Transfer | Receiving cashbox / bank | Sending cashbox / bank |
| Opening balances | As entered (receivables, advances, cash…) | Opening balances (equity) |

A receipt reversal is built from the document itself, not from earlier entries. It is therefore
also correct for receipts recorded before the cutover.

Where receipt money lands:

- **Cash** goes to the receiving user's open session at that branch. Without a session, it goes to
  the branch's cashbox, and otherwise to the mapped cash account.
- **Card and transfer** go to the branch's bank account, otherwise the organization's.

The receipt stores the chosen account and session (`ledgerAccountId`, `cashSessionId`).

## Cutover and migration (no reposting of history)

- Setup takes a **cutover date**, preferably the first day of a month. Business events on or after
  it are posted; earlier documents are never reposted.
- The cutover cannot be earlier than documents already recorded (invoices, receipts, credit notes,
  refunds, stock documents): those were never posted, so setup refuses with
  `409 DOCUMENTS_AFTER_CUTOVER`. The demo seed starts the ledger on the first day of the month,
  or on today when documents of the month exist already.
- `GET /accounting/migration/preview` is a dry run. It recomputes patient receivables and
  unallocated advances **at the start of the cutover date** from the documents, as of that instant:
  - credit notes, allocations and refunds after the cutover are excluded;
  - receipts reversed before the cutover do not count.

  It proposes opening lines and posts nothing. An accountant reviews them and posts an opening
  entry (manual, journal `opening`). The overview page offers to do this once.
- `GET /accounting/reports/reconciliation` compares the ledger with the sub-ledgers:
  - open invoices against receivables;
  - unallocated receipts against advances.

  A difference shows a missing opening balance or a posting problem. A synthetic rehearsal of this
  flow is tested: history before the cutover, preview, opening entry, a later payment of an old
  invoice, and zero differences.
- **Recovery:** a wrong opening entry is reversed and posted again. Nothing is deleted.

## Periods

- `lockedThrough` acts as a lock date. Months close **in order**, only after they have ended, and
  only when no cashier session that opened in them is still open.
- Postings dated on or before the lock are refused server-side (`409 PERIOD_CLOSED`) for every
  path: documents, vouchers and manual entries.
- Only the owner reopens, and only the latest closed month, with a reason of at least 10
  characters. Every change goes to the period history and the audit log.
- There are no year-end closing entries. The balance sheet shows the accumulated result as its own
  equity line until the accountant decides on closing entries.

## Statements

All statements are computed from posted entries, within ranges of at most about 400 days.

| Statement | What it shows |
| --- | --- |
| Trial balance | Opening, period debits and credits, closing; checks it balances |
| General ledger | One account, with a running balance; at most 1,000 entries per request |
| Income and expenses | Optionally by branch, labelled *result per ledger*, never "net profit" |
| Balance sheet | As of a date, with the balance check |
| Receivables aging | Open invoices by age (0–30, 31–60, 61–90, 90+ days) per patient |

Ledger-wide views need **organization-wide scope**. A branch-restricted accountant gets
`403 ORG_WIDE_SCOPE_REQUIRED`; amounts of other branches would otherwise leak. Receivables aging,
periods and cash stay branch-scoped.

## Cash and banks

- **Cash accounts:** cashboxes (always branch-owned) and bank accounts (branch or organization). Each
  has its own ledger account under "Cash and banks". An account can be archived only when its
  balance is zero and no session is open.
- **Cashier sessions:**
  - One open session per cashbox (unique index; concurrent opens are tested) and one per user and
    branch.
  - At opening, the counted cash is compared with the ledger balance. Any difference is posted to
    cash over/short and needs a note.
  - Movements are the session's cash lines. The expected closing amount is the counted opening plus
    those movements.
  - At closing, the cashier (or a reviewer) enters the counted cash. A difference posts to cash
    over/short with a required note.
  - A closed session cannot be reopened. Corrections go through a reviewer's voucher or a manual
    entry.
  - Optional rule (`requireCashSession`): cash receipts need the receiving user's open session at
    that branch.
- **Vouchers:**
  - Types: in, out, and transfer (one entry with both sides, so never one-sided).
  - A cashbox never goes below zero.
  - Counter accounts may not be cash or bank accounts, or control accounts.
  - Vouchers are idempotent and numbered `CV-YYYY-000001`.
- **Bank reconciliation:** statement lines are entered or pasted as CSV (`date,amount,description,reference`,
  at most 500 lines). Each line is matched to one entry that moves exactly that amount on that bank
  account; an entry can match only one line. There is **no bank connection**.

## Permissions

| Permission | Roles |
| --- | --- |
| `accounting.read` | owner, admin, accountant |
| `accounting.manage` (chart, manual entries, cash accounts, statements, migration) | owner, accountant |
| `accounting.settings.manage` (setup, posting map, session rule) | owner |
| `accounting.period.close` | owner, accountant |
| `accounting.period.reopen` | owner |
| `cash.session.operate` | owner, admin, receptionist, accountant |
| `cash.session.review` (all sessions in scope, close for others) | owner, admin, accountant |
| `cash.voucher.create` | owner, admin, accountant |

Doctors and viewers have no accounting access. No permission grants clinical access.

## Known limitations

- No VAT or tax, e-invoicing, statutory formats or retention rules (needs Q9 and E4).
- No year-end closing entries; no budgets.
- No multi-currency or exchange differences.
- No bank feeds.
- Practitioner compensation, purchasing, stock and assets post through later milestones (see
  [ERP_EXECUTION_PLAN.md](../ERP_EXECUTION_PLAN.md)).
