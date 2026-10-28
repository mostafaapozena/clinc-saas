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
- **No depreciation** until the accountant defines a method and accounts (decision E-15), and no
  calibration certificates (E-13).

| Permission | Roles |
| --- | --- |
| `asset.read` | owner, admin, receptionist, accountant, doctor |
| `asset.manage` (register, update, retire, dispose) | owner, admin |
| `asset.maintain` (maintenance records) | owner, admin, receptionist |
