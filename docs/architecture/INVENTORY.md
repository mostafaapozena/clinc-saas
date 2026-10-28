# Inventory and medical consumables (ERP milestone B)

Stock of medical supplies per branch warehouse, with lots and expiry, valuation, and consumption
recorded against performed visits. The valuation method must be validated by the clinic's
accountant before real use (decision E-8). Synthetic data only.

Code:

- API: `apps/api/src/modules/inventory/` — `inventory.model.ts`, the stock engine
  `inventory.stock.ts` and `inventory.routes.ts`.
- Web: `pages/InventoryPages.tsx`, `components/inventory.tsx` (materials used on the record page)
  and `lib/inventory.ts`.
- Tests: `apps/api/test/inventory.test.ts`, the inventory rows of `authorization.test.ts`, and
  `apps/web/src/pages/Inventory.test.tsx`.

## Model

- **Items:**
  - code, name, category, **base unit**;
  - purchase units with integer factors (for example, a box of 100). Existing conversions can never
    change, since they are part of history;
  - tracking: `none`, or `lot` (every stock-in names a lot and an expiry date);
  - reorder level;
  - status. An item with stock on hand cannot be archived.
- **Warehouses** belong to one branch. Branch-restricted users see and move only their branches'
  stock.
- **Balances:** quantity per item, warehouse and lot.
- **Stock documents** are numbered `SD-YYYY-000001`, one per operation. Their **moves** are the
  stock ledger: signed quantity, value, and the item's quantity and value after the move. Documents
  and moves are never edited or deleted. The only updates allowed are linking a return and freeing
  the consumption key.
- **Services are not stock items.** The service catalog (clinical finances) and stock items are
  separate. A visit can produce a charge (billing) and a consumption (stock) independently; both
  link to the record by id.

## Valuation and integrity

- **Perpetual moving weighted average per item** at organization level, in line with the single
  legal entity (E-1). Each item holds its total `onHand` and `stockValue` (integer minor units).
  - A receipt adds its cost.
  - An issue takes `stockValue × qty ÷ onHand`, rounded.
  - The issue that empties the item takes the remaining value exactly, so values always add up to
    what came in. The ERPNext example (10 @ 1.00, 20 @ 1.20, issue 15 = 17.00) is a test.
- **Concurrency:** every stock transaction first takes a write lock on the item (`lockSeq`).
  Concurrent operations on one item conflict, and one is retried. Balances change through
  conditional `$inc` (`qty ≥ n`), so **stock never goes negative**; concurrent issues are tested.
- **No backdating:** documents are dated on the organization's today. Backdated stock would require
  revaluing later issues (E-8).
- **Lots and expiry:**
  - An existing lot keeps its expiry date.
  - Issues and consumption pick **first-expiring-first** (FEFO) when no lot is named, and skip
    expired lots.
  - Naming an expired lot is refused, except for a write-off.
  - Picking policy (FEFO) and valuation (moving average) are independent (E-9).
- Every document creation is idempotent (`Idempotency-Key`).

## Operations and their entries

Entries are posted only when the ledger is set up and the date is on or after the cutover.

| Document | Stock | Debit | Credit |
| --- | --- | --- | --- |
| Opening stock (unit cost given) | In | Inventory | Opening balances |
| Count adjustment, more than recorded | In at average cost | Inventory | Stock adjustments |
| Count adjustment, less than recorded | Out at average cost | Stock adjustments | Inventory |
| Write-off (damaged or expired, reason required) | Out | Stock adjustments | Inventory |
| Internal issue (reason required) | Out | Medical consumables used | Inventory |
| Transfer between warehouses | Out and in at the same value | — (same entity) | — |
| Consumption in a visit | Out | Medical consumables used | Inventory |
| Consumption return | In at the value that left | Inventory | Medical consumables used |
| Purchase receipt / purchase return (milestone C) | In / out | Inventory / goods received not billed | Goods received not billed / inventory |

The ledger's inventory account equals the sum of item values. This is tested.

## Consumption from performed visits

- Only the **treating doctor** (`inventory.consume`, with the clinical treating relationship) can
  record consumption, and only on their own **finalized** record. A draft is not a performed visit.
- Consumption can be for the whole visit, or for one **procedure item** of a dental record.
  Treatment-plan items are refused, so planned treatment never reduces stock.
- **Once per record item:** a unique source key `consumption:<record>:<item>` blocks duplicates,
  including concurrent ones (tested). To correct, the doctor **returns** the consumption. A linked
  document brings the same lots back at the value they left with and frees the key.
- Stock documents hold record and item ids only, never clinical text. Doctors see quantities, not
  costs.

## Alerts and suggestions

- `GET /inventory/alerts` lists lots expiring within 60 days (configurable) and expired lots with
  stock.
- It also lists items at or below their reorder level, for organization-wide users. The suggested
  quantity tops up to twice the reorder level: a simple default, changed when ordering.

## Permissions

| Permission | Roles |
| --- | --- |
| `inventory.read` | owner, admin, receptionist, accountant, doctor |
| `inventory.manage` (items, warehouses) | owner, admin |
| `inventory.move` (opening, count, write-off, issue, transfer) | owner, admin |
| `inventory.consume` (own finalized records) | doctor |
| `inventory.value.read` (costs and values; organization-wide only) | owner, admin, accountant |

## Known limitations

- No serial numbers.
- No per-warehouse costing.
- No backdated documents.
- No stock reservations for appointments.
- Purchase receipts arrive with milestone C.
- The valuation method and write-off accounts need the accountant's validation.
