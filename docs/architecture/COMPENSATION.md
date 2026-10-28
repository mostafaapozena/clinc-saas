# Practitioner compensation (ERP milestone D)

Fees owed to practitioners under explicit agreements: how much, on what basis, for which period.
This is **not payroll**. There are no salaries, taxes, insurance or statutory deductions (decision
E-13). Synthetic data only.

Code:

- API: `apps/api/src/modules/compensation/` (`compensation.model.ts`, the computation in
  `compensation.compute.ts`, `compensation.routes.ts`).
- Web: `pages/CompensationPages.tsx`.
- Tests: `apps/api/test/compensation.test.ts` and the compensation rows of
  `authorization.test.ts`.

## Agreements

- One agreement per practitioner at any date (effective-dated, with no overlap). It has:
  - **basis** — `performed`, `invoiced` or `collected`;
  - **percentage** in basis points;
  - **fixed amount per unit** (performed and invoiced bases only);
  - optional service and branch filters;
  - whether invoice discounts reduce the base (pro rata);
  - whether credit notes reduce it.
- A new agreement ends the current one the day before. It can never start inside an already
  settled period (`409 PERIOD_SETTLED`), so **approved settlements are never re-priced**.
  Agreement terms are immutable (database hook); only the end date can be set.

## What counts, by basis

| Basis | Positive lines | Negative lines |
| --- | --- | --- |
| Performed | Non-voided charges of the practitioner's appointments or clinical records, on the charge date | A charge voided after it was settled |
| Invoiced | Lines of issued invoices, with the discount applied pro rata if configured | Credit notes, pro rata to the practitioner's share of the invoice (if configured) |
| Collected | Allocations of receipts to invoices, pro rata to the practitioner's share | Allocations of receipts reversed later |

- Fee per line = round(base × percentage) + fixed × units.
- A negative line applies only when the item it undoes is settled, earlier or in the same
  settlement.

## Settlements

1. **Draft:** computed for a practitioner and a period that has ended (at most about three months).
   It can be recomputed, adjusted (signed amounts with a reason) or cancelled.
2. **Approve** (owner): the settlement is frozen. Every source item is **claimed once, ever**, via a
   unique index on its source key: two drafts covering the same items cannot both be approved
   (`409 ITEMS_ALREADY_SETTLED`; recompute the other draft). Approval posts *practitioner fees*
   (debit, by branch as cost center) against *practitioner fees payable* (credit, partner =
   practitioner).
3. **Pay** (owner or accountant): partial or full, from a cashbox or bank account, bounded by what
   is still owed. Each payment is idempotent. A payment posts payable (debit) against cash or bank
   (credit). The settlement becomes *paid* when settled in full.

## Visibility

| Permission | Roles |
| --- | --- |
| `compensation.read` (agreements, settlements; organization-wide scope) | owner, admin, accountant |
| `compensation.manage` (agreements, drafts, adjustments) | owner, accountant |
| `compensation.approve` | owner |
| `compensation.pay` | owner, accountant |
| `compensation.own.read` (own approved statements only) | doctor |

Settlement lines carry document numbers and service names only, never clinical text.

## Known limitations

- No payroll.
- No tax withholding on fees.
- No advances to practitioners.
- No automatic monthly runs.
- Collected-basis fees ignore the fixed-per-unit component.
- Charge voids are dated at the end of the period that settles them.
