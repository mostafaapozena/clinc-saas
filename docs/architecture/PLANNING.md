# Budgets, cash flow and recurring commitments (ERP milestone H2)

This module plans the year, compares the plan with the posted ledger, shows where cash came from and
went, and keeps the clinic's recurring costs (rent, utilities, subscriptions, service contracts) on
time. **Nothing here posts to the ledger.** Every amount comes from journal entries the other
modules already posted. Synthetic data only.

Code: `apps/api/src/modules/planning/` (`planning.model.ts`, `planning.routes.ts`); web
`pages/PlanningPages.tsx`. Tests: `apps/api/test/planning.test.ts`, `apps/web/src/pages/Planning.test.tsx`.
These views are part of the accounting module (`/accounting/...` paths), so switching accounting off
hides them too.

## Access

| Action | Permission | Scope |
| --- | --- | --- |
| Read budgets, budget against actual, cash flow, commitments | `accounting.read` | all branches |
| Save a budget draft; add, change or record commitments | `accounting.manage` | all branches |
| Approve or reopen a budget | `accounting.settings.manage` (owner) | all branches |

Ledger-wide views need organization-wide branch scope, like the statements (`ORG_WIDE_SCOPE_REQUIRED`).

## Budgets (الموازنة التقديرية)

- One budget per **calendar year** and **cost center**: the whole organization (`branchId: null`)
  or a single branch. A branch budget is separate from the organization-wide one; the two are not
  added together.
- Each line is an **income or expense** account with twelve monthly amounts in minor units. Lines
  that are all zero are dropped. Group, asset, liability and equity accounts are refused.
- The screen spreads an annual amount evenly over the months, with the remainder in December, or
  takes each month's amount.
- **Lifecycle:** a draft (saved with `version`) → **approved** by the owner (frozen:
  `BUDGET_APPROVED` on save) → **reopened** by the owner to change it. Every save, approval and
  reopening is audited (`budget.saved`, `budget.approved`, `budget.reopened`).
- A budget never posts and never blocks a posting. Commitments and purchase approvals do not
  check budget availability (owner decision P-3).

## Budget against actual

`GET /accounting/reports/budget-vs-actual?year&through&branchId`

- Covers January through the chosen month. The default is the current month for this year and
  December for other years.
- **Actual:** the posted net of each account in those months. For income that is credit − debit;
  for expenses, debit − credit. With a branch, only lines tagged with that branch count.
- **Variance:** actual − budget.
  - Income at or above budget is favourable.
  - An expense at or below budget is favourable.
  - The percentage used is shown only where a budget exists.
- Accounts with posted amounts but no budget line are listed as **not budgeted**.
- Totals cover income, expenses and the result (income − expenses), planned and actual.

## Cash flow statement (direct method)

`GET /accounting/reports/cash-flow?from&to` (range up to 400 days)

- **Cash** means the ledger accounts behind the organization's cashboxes and bank accounts
  (`CashAccount.accountId`).
- Every posted entry in the range that touches cash is split by its **other lines**. In a balanced
  entry those lines' (credit − debit) add up exactly to the cash movement, so no amount is
  estimated or prorated.
- **Classification by the account on the other side:**

  | Other side | Activity |
  | --- | --- |
  | An account under *Fixed assets* (1500: medical equipment, furniture) | Investing |
  | An equity account (capital, drawings, opening equity) | Financing |
  | Anything else: patients, suppliers, practitioners, expenses, income | Operating |

- **Transfers** between the organization's own cash accounts have no other side, so they cancel out.
- The statement shows the opening cash (before `from`), each activity's inflows and outflows per
  account, the net change and the closing cash. It is **reconciled** when opening + net = closing
  cash balance; a mismatch would mean an entry outside the posting engine.
- **Limitation:** loans and other non-equity financing are classified as operating until the
  accountant marks such accounts. Mapping an account to an activity is an owner decision, P-4.

## Recurring commitments (الالتزامات الدورية)

- A commitment has a name, an **expense account**, an optional branch and supplier, an amount per
  installment, a frequency (monthly, quarterly or yearly), the first due date and an optional end date.
- The payment day is kept across short months: rent due on the 31st falls on 28 February, then
  31 March.
- **Due:**
  - *overdue* before today;
  - *soon* within 7 days.
  - "Today's focus" counts commitments that are due soon or overdue for finance members
    (`finance.commitmentsDue`).
- **Recording a payment posts nothing.**
  1. The clinic pays as usual: a **cash-out voucher** to the commitment's account, or a **posted
     supplier bill** with a line on it.
  2. Recording links that document to the installment due.
  3. The next due date moves on by the frequency, and the commitment ends after its last installment.
- Each voucher or bill can be linked **once**, to one installment of one commitment. This is
  enforced by unique indexes on the separate `pln_commitment_payments` collection, which returns
  `ALREADY_LINKED`.
  - An installment is linked once (`VERSION_CONFLICT` on a concurrent record).
  - A voucher on another account is refused (`other_account`).
  - The amount actually paid is the document's, so a difference from the planned amount is kept
    and audited (`differsFromPlan`).
- Commitments are ended, not deleted. Payment links are append-only.

## Known limitations and owner decisions

- **P-1:** no fiscal year other than the calendar year.
- **P-2:** no budget versions beyond draft and approved (no "revised budget" history); the audit
  log keeps every change.
- **P-3:** no budget availability check on purchases or vouchers.
- **P-4:** cash flow activity is fixed by account class (fixed assets, equity) until accounts can
  be mapped explicitly; there is no indirect-method statement.
- **P-5:** commitments do not create vouchers or bills by themselves. Automatic drafts would need
  the owner's rules for approvals and cash sessions.
