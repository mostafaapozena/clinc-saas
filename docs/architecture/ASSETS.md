# Equipment register and maintenance (ERP milestone F)

The clinic's equipment (dental units, autoclaves, ultrasound devices…): where it is, who looks
after it, its purchase, its maintenance schedule and history, and its retirement. Synthetic data only.

Code: `apps/api/src/modules/assets/` (`assets.model.ts`, `assets.routes.ts`); web
`pages/AssetPages.tsx`. Tests: `apps/api/test/assets.test.ts`.

- **Register:** code, name, category, serial number, branch (branch scope applies), location,
  custodian (an active team member), purchase date and cost, supplier, and optionally the
  **supplier bill** it was bought with. When that bill has a line on an asset account (for example
  *Medical equipment*), the asset is **capitalized**: the cost sits in that ledger account. The
  register never posts the purchase again.
- **Maintenance:** each record holds a date (not in the future), kind (preventive, corrective or
  inspection), the work done, who did it, an optional supplier, and links to the supplier bill or
  cash voucher that carries the cost. **Costs are recorded once**, by the bill or voucher, never by
  the maintenance record.
  - A record can put the equipment **out of service**; the next record without that flag puts it
    back in service.
  - The next due date follows the interval (date + interval days) unless given explicitly.
  - Records are append-only.
- **Alerts:** equipment due within 14 days (or overdue) and out-of-service equipment appear in
  "Today's focus" for equipment managers and on the register.
- **Retire or dispose:**
  - Retired equipment stays on record, with no more maintenance.
  - **Disposal** (the equipment is gone) writes off a capitalized cost: *other expenses* (debit)
    against the asset account (credit), once.
  - Proceeds from a sale are recorded as a cash-in voucher.
- **Depreciation (milestone H4):** straight-line, for capitalized equipment only. Code:
  `assets/depreciation.routes.ts`. Test: `apps/api/test/depreciation.test.ts`.
  - **Method inputs:** the clinic's accountant (`accounting.manage`) enters, per asset, the useful
    life in months, the residual value (below cost) and the first month (not before the ledger
    start). Nothing is assumed: there are no default lives and no tax rates.
  - **Method fixed after posting:** once a month is posted the method cannot change
    (`DEPRECIATION_STARTED`).
  - **Monthly amount:** (cost − residual) ÷ life. The last month takes the rounding, so the total
    is exact.
  - **Run:** `POST /assets/depreciation/run { month }` posts every **ended** month not yet posted
    for each active or out-of-service asset (`not_ended` otherwise). It posts one entry per asset
    and month, dated the month end: Dr *Depreciation* (6700), Cr *Accumulated depreciation*
    (1590). Both lines carry the asset's branch.
  - **Run safety:**
    - The source key `asset:<id>:depreciation-YYYY-MM` makes reruns post nothing twice.
    - A closed month is refused.
    - The run is audited (`asset.depreciated`).
  - **Schedule:** `GET /assets/depreciation/schedule?month` shows what each asset posted and what
    is due.
  - **Accumulated depreciation is document-only:** vouchers and manual entries cannot post to it.
  - **Disposal** clears it: Dr accumulated depreciation, Dr *other expenses* (book value),
    Cr the asset account (cost).
- No calibration certificates (E-13).

| Permission | Roles |
| --- | --- |
| `asset.read` | owner, admin, receptionist, accountant, doctor |
| `asset.manage` (register, update, retire, dispose) | owner, admin |
| `asset.maintain` (maintenance records) | owner, admin, receptionist |
