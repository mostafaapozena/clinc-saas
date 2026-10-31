# Reports center

**Route:** `/app/:org/reports` (`pages/ReportsHubPage.tsx`).

**Layout:** the composition follows the owner's target image, adapted to raclinic's identity:

1. header with compact filters;
2. icon category tabs;
3. KPI row;
4. chart row;
5. report cards.

**Data:** only real, scoped data.

## Categories, figures and charts

| Category | Shown when | Figures | Charts | Source |
| --- | --- | --- | --- | --- |
| Financial | `finance.report.read` (figures); `accounting.read` + org-wide (statement links) | Invoiced, collected, owed by patients (documents), discounts | Invoiced vs collected by month (line), collections by method (donut), top services (bars) | `GET /finance/reports/summary`, `GET /finance/reports/trend` |
| Collections | `accounting.read` | Unpaid invoices, patients owing, over 90 days | Aging buckets | `GET /accounting/reports/receivables-aging` |
| Cash and obligations | `accounting.read` + org-wide | Opening, net and closing cash | Cash in and out by activity | `GET /accounting/reports/cash-flow` |
| Operations | `dashboard.read` | Today's appointments, completed, no-show | Today by status | `GET /dashboard` |
| Inventory and purchasing | `inventory.read`, `purchase.bill.manage` + org-wide | Items to reorder, lots expiring, owed to suppliers | Suppliers owed the most | `GET /inventory/alerts`, `GET /purchasing/reports/payables-aging` |
| Equipment and people | `asset.read`, `compensation.read`, `accounting.read` | — (links) | — | — |

A category appears only when the role can open at least one of its reports. The API enforces
every permission again.

## `GET /finance/reports/trend`

- **Parameters:** `months` (1–12, default 6) and an optional `branchId`.
- **Definitions:** the period summary's own.
  - Issued invoices are counted by issue date, active receipts by receipt date.
  - Calendar months in UTC (the same day boundary as the summary).
  - Grouped by currency.
- **Scope:** requires `finance.report.read`; branch scope applies.
- **Tests:** `apps/api/test/reports-trend.test.ts` checks the values, equality with the summary, permission, branch scope, tenancy and bounds.

## Rules

- Collections are labelled "not revenue". The ledger result is never called net profit.
- One currency per figure; amounts in different currencies are never added.
- Empty periods show an explicit message instead of a chart.
- Each chart has a "show as table" view with the exact figures.
- Category, period and branch live in the URL. Report cards open the named report (for example `accounting/reports?report=aging`). That report keeps its own filters in the URL.

## Intentional differences from the target image

- **No "illustrative data" labels and no invented values.** Empty periods are explicit.
- **Six categories instead of four,** matching the modules that exist. On narrow screens they scroll on one row.
- **Content width capped at 1280px** (the existing page width), so on very wide screens the page has side margins.
- **The real logo and sidebar** are used. The generated image's labels and logo are not reproduced.
