# Installment plans, rescheduling and write-offs (ERP milestone H6)

A patient can pay an issued invoice in installments. A plan **only schedules** the invoice's open
balance:

- receipts are recorded and allocated to the invoice as usual;
- the plan's progress is read from the invoice itself (paid + credited since the plan started);
- so no amount is counted twice, and a plan never posts anything.

Synthetic data only.

Code: `apps/api/src/modules/installments/`; web `pages/InstallmentPages.tsx` (invoice card and
`/finance/installments`). Tests: `apps/api/test/installments.test.ts`,
`apps/web/src/pages/Installments.test.tsx`.

## Plans

| Action | Endpoint | Permission |
| --- | --- | --- |
| List (`status=overdue/active/completed/cancelled`, `patientId`, `invoiceId`) | `GET /finance/installment-plans` | `finance.account.read` |
| Create | `POST /finance/installment-plans` | `finance.invoice.manage` |
| Reschedule what is left | `POST /finance/installment-plans/:id/reschedule` | `finance.invoice.manage` |
| Cancel | `POST /finance/installment-plans/:id/cancel` | `finance.invoice.manage` |

- **Creating a plan**
  - Only an **issued** invoice with an open balance can be put on installments
    (`INVOICE_NOT_OPEN`).
  - A schedule has 1–60 installments with strictly increasing dates, none before today. The
    amounts must add up **exactly** to the open balance (`must_equal_open_balance`).
  - The web form splits the balance into equal monthly installments, with the rounding in the
    last one, and allows edits.
  - An invoice has **one active plan** at a time (unique index → `PLAN_EXISTS`).
- **Progress**
  - Settled = invoice paid + credited − the same at plan start, applied to the installments in
    date order.
  - Each installment is *paid*, *part paid*, *due* or *overdue* (past its date and not fully
    covered).
  - The plan is *overdue* while any installment is overdue, and *completed* when everything is
    settled.
- **Rescheduling**
  - Covers only the unsettled amount.
  - The settled part of earlier installments stays in the schedule as it was.
  - The replaced schedule is kept in `revisions` with the reason.
  - Version-checked and audited (`installment_plan.rescheduled`).
- **Branch scope** applies, since plans live in the invoice's branch.
- **Today's focus** shows how many plans have a missed installment (`installmentsOverdue`), for
  members with `finance.account.read`.

## Bad-debt write-off

- **Endpoint:** `POST /finance/invoices/:id/write-offs { amount, reason }`.
- **Permission:** `finance.writeoff`, the **owner** only, with an `Idempotency-Key`.
- **Effect on the invoice:**
  - Reduces the invoice's open balance through `credited`, like a credit note. It cannot exceed
    the open balance (`OVER_CREDIT`).
  - Creates an adjustment of type `write_off`, numbered `WO-YYYY-NNNNNN`. It shows on the
    patient statement as a credit.
- **Posting** (when the ledger runs on that date): Dr *Bad debts* (6950, created on first use),
  Cr *Patient receivables* (with the patient as partner).
- **Audit:** `invoice.written_off`.
- **Undo:** only a reversing entry, plus a new charge if the patient later pays. That is a
  decision for the accountant.

## Known limitations and owner decisions

- **I-1:** no interest, late fees or down-payment rules.
- **I-2:** no reminders are sent to patients, since no messaging is connected.
- **I-3:** write-offs do not reduce practitioner fees calculated on invoiced amounts (only credit
  notes do). Whether bad debts should reduce fees is an owner decision.
- **I-4:** a plan covers one invoice; several invoices are planned separately.
