# Employee advances and petty-cash custody (ERP milestone H3)

The clinic sometimes hands money to a team member:

- **an advance (سلفة):** the member pays it back;
- **custody (عهدة):** petty cash the member spends on the clinic's behalf and settles with
  receipts and whatever is left.

Each amount is one **staff fund document**, the sub-ledger of what that member holds. Every
movement posts a balanced entry through the posting engine. Synthetic data only.

Code: `apps/api/src/modules/staff-funds/`; web `pages/StaffFundsPages.tsx`. Tests:
`apps/api/test/staff-funds.test.ts`, `apps/web/src/pages/StaffFunds.test.tsx`. These are part of
the accounting module (`/accounting/staff-funds`).

## Accounts

| Template key | Code | Type | Changed only by |
| --- | --- | --- | --- |
| `staffAdvances` (سلف الموظفين) | 1250 | asset | advance documents |
| `staffCustody` (العهد النقدية) | 1260 | asset | custody documents |

- **New ledgers** get both accounts from the template.
- **Ledgers created earlier** get them on first use, under *Assets*, with the template code or the
  next free one (`ensureTemplateAccount`).
- **Cash vouchers and manual entries never post to these accounts.** A voucher counter account is
  refused with `account_not_allowed`; a manual entry, even an opening one, with `CONTROL_ACCOUNT`.
  So the open documents always add up to the ledger balance.
- Lines on these accounts carry the member as partner (`partner.type: 'member'`).

## Postings

| Movement | Debit | Credit | Who |
| --- | --- | --- | --- |
| Issue (advance or custody) | staff advances / custody (member) | cashbox or bank | `accounting.manage` |
| Cash returned | cashbox or bank | staff advances / custody (member) | `accounting.manage` |
| Custody receipts | expense accounts (one line per receipt) | custody (member) | `accounting.manage` |
| Write-off of what is left | other expenses | staff advances / custody (member) | owner (`accounting.settings.manage`) |

- **Dates:** every movement is dated today in the organization's time zone, on an open date
  (cutover and period lock apply).
- **Cash checks:**
  - A cashbox never goes below zero (`INSUFFICIENT_CASH`).
  - Movements through a cashbox join the user's open cashier session on it, like vouchers.
- **Amount limits:**
  - No movement may exceed the outstanding amount (`more_than_outstanding`).
  - At zero the document is **settled**; a settled document refuses further movements
    (`STAFF_FUND_SETTLED`).
- **Custody receipts** must be on active expense accounts. Advances cannot be settled with receipts
  (`NOT_CUSTODY`).
- **Write-off** takes the whole outstanding amount, with a reason. It is audited
  (`staff_fund.written_off`).

## Safety

- **Idempotent issue:** handing out requires an `Idempotency-Key`.
  - A retry with the same key and body replays the first result.
  - The same key with another body is refused (`IDEMPOTENCY_KEY_REUSED`).
  - The web form keeps one key until the issue succeeds.
- **Concurrency:** each settlement carries the document `version`.
  - A retried request with an old version is refused (`VERSION_CONFLICT`).
  - The posting source key includes the movement's position, so nothing posts twice.
- **Audit:** issue, settlement and write-off (`staff_fund.issued`, `staff_fund.settled`,
  `staff_fund.written_off`).
- **Records are never deleted.** Movements are appended to the document.

## Access and visibility

- **Ledger-wide:** views and actions need organization-wide scope.
- **Read:** `accounting.read` (owner, admin, accountant).
- **Act:** `accounting.manage` (owner, accountant).
- **Member list:** the picker uses `GET /accounting/staff-funds/members`, which returns active
  members' names and roles only.
- **Today's focus:** finance members see open amounts past their settlement date
  (`finance.staffFundsOverdue`).

## Known limitations and owner decisions

- **S-1: payroll deduction.** Recovering an advance from pay waits for the HR and payroll
  foundation. That will post *salaries payable* against *staff advances* through the same document.
- **S-2: custody shortfalls.** A shortfall is written off or returned. It is not converted into an
  advance automatically.
- **S-3: approvals.** There is no approval step or per-member limit before handing out. Owner
  decision on limits and approvers.
- **S-4: member's own view.** Members do not see their own advances yet (no self-service page).
