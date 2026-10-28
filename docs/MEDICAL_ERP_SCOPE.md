# raclinic medical ERP — scope

raclinic, by Devware, is a medical-management platform for outpatient clinics and multi-specialty
centers: dentistry, physiotherapy and ENT. It is built from five separate areas:

| Area | What it is | Where |
| --- | --- | --- |
| A. Public platform | Website, solutions, tour, contact, inquiries, sign-up | `apps/web/src/public`, `modules/inquiries`, `onboarding` |
| B. Tenant clinic ERP | Organization, team, patients, scheduling, finance, accounting, cash, purchasing, stock, compensation, assets, reports | `modules/*` under `/api/v1/orgs/:orgId` |
| C. Specialty workspaces | Clinical records and specialty views on the shared visit record | `modules/clinical` |
| D. Operator administration | raclinic's own console for organizations, plans, inquiries and support | `modules/platform`, `/operator` |
| E. Platform subscription billing | What a clinic pays raclinic, separate from clinic accounting | `modules/platform` (subscriptions) |

**Clinic accounting (B) and subscription billing (E) never share documents, numbers or ledgers.**

## In scope for the ERP programme

- **Shared foundation:**
  - organization (legal entity, branches as cost centers, time zone, single currency);
  - team, roles, branch scope and approvals;
  - patients and daily operations.

  Most of this already exists and is preserved.
- **Catalog:** services (existing), plus stock items and units for consumables; non-stock purchases.
- **Accounting core:** chart, journals, periods, opening balances, ledger and statements, receivables.
  Built in milestone A.
- **Cash and banks:** cashboxes, bank accounts, sessions, vouchers, transfers and reconciliation.
  Built in milestone A.
- **Inventory and medical consumables:** warehouses, lots and expiry, the stock ledger, valuation
  and consumption from procedures. Milestone B.
- **Suppliers, purchasing and payables:**
  - the request → approval → RFQ → quotation → order → receipt → bill → payment chain;
  - returns and credit notes;
  - expenses.

  Milestone C.
- **Practitioner compensation:** agreements, settlements, approval and payment. Milestone D.
- **Specialty-aware workspaces:** role- and specialty-specific dashboards and navigation.
  Milestone E.
- **Assets and maintenance:** the equipment register and maintenance log. Milestone F.
- **Reports:** a shared hub over posted data, with end-to-end journeys proven. Milestone G.

## Out of scope (needs a separate approved specification or local validation)

- Tax, VAT and e-invoicing (Egypt's ETA, Saudi Arabia's ZATCA); statutory numbering.
- Statutory payroll, insurance deductions and tax tables.
- Insurance claims, prescriptions, inpatient care, and automated diagnosis or treatment suggestions.
- Multi-company or intercompany accounting; multi-currency.
- Bank or payment-provider integrations for clinics; sending supplier email.
- Treatment packages, until their payment and refund rules are defined (E-12).

## Constraints carried by every milestone

- Organization and branch isolation, with isolation tests for every new endpoint.
- Clinical access is kept separate from finance and operations.
- Permissions are explicit, and there is no universal admin bypass.
- Documents are idempotent and concurrency-safe. They are immutable once issued or posted, and
  corrections are linked reversals.
- Arabic-first, bilingual interface; light and dark themes; responsive layouts.
- Synthetic data only.
