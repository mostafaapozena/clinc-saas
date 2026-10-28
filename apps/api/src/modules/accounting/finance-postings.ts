import type { ClientSession, Types } from 'mongoose';
import { conflict } from '../../http/errors.js';
import type { Adjustment, Invoice, Payment } from '../finance/finance.model.js';
import { CashAccountModel, CashSessionModel, type AccountingSettings } from './accounting.model.js';
import { ledgerToday, mapped, postEntry, settingsOf, type Lean } from './accounting.posting.js';

// Posting rules for patient finances (docs/architecture/ACCOUNTING.md, "Business events").
// Accrual basis: revenue is recognized when an invoice is issued; a receipt is first a liability
// (patient advance) and settles receivables only when allocated, so receipts are never counted as
// revenue. Events dated before the cutover are not posted (opening entries summarize them).
// Every function runs inside the caller's transaction, so the document and its entry commit together.

type Ctx = { organizationId: Types.ObjectId; userId: Types.ObjectId };
const patient = (id: Types.ObjectId) => ({ type: 'patient' as const, id });

/** Settings and today's ledger date, or null when there is nothing to post (no ledger or before cutover). */
async function active(ctx: Ctx, session: ClientSession): Promise<{ settings: Lean<AccountingSettings>; date: string } | null> {
  const settings = await settingsOf(ctx.organizationId, session);
  if (!settings) return null;
  const date = await ledgerToday(ctx.organizationId, session);
  if (date < settings.cutoverDate) return null;
  return { settings, date };
}

export async function postInvoiceIssued(ctx: Ctx, invoice: Lean<Invoice>, session: ClientSession) {
  const on = await active(ctx, session);
  if (!on) return null;
  const { settings, date } = on;
  const discount = invoice.discount?.amount ?? 0;
  const branchId = invoice.branchId;
  return postEntry(
    {
      ...ctx,
      date,
      journal: 'sales',
      memo: invoice.number ?? '',
      lines: [
        {
          accountId: mapped(settings, 'receivable'),
          debit: invoice.total,
          branchId,
          partner: patient(invoice.patientId),
        },
        {
          accountId: mapped(settings, 'salesDiscounts'),
          debit: discount,
          branchId,
        },
        {
          accountId: mapped(settings, 'serviceRevenue'),
          credit: invoice.subtotal,
          branchId,
        },
      ],
      source: { type: 'invoice', id: invoice._id, event: 'issued' },
    },
    session,
    settings,
  );
}

export async function postCreditNote(ctx: Ctx, invoice: Lean<Invoice>, note: Lean<Adjustment>, session: ClientSession) {
  const on = await active(ctx, session);
  if (!on) return null;
  const { settings, date } = on;
  return postEntry(
    {
      ...ctx,
      date,
      journal: 'sales',
      memo: `${note.number} / ${invoice.number ?? ''}`,
      lines: [
        {
          accountId: mapped(settings, 'salesReturns'),
          debit: note.amount,
          branchId: invoice.branchId,
        },
        {
          accountId: mapped(settings, 'receivable'),
          credit: note.amount,
          branchId: invoice.branchId,
          partner: patient(invoice.patientId),
        },
      ],
      source: { type: 'credit_note', id: note._id, event: 'issued' },
    },
    session,
    settings,
  );
}

/**
 * Where a new receipt's money lands: cash goes to the receiving user's open cashier session at
 * that branch, else the branch's cashbox, else the mapped cash account; other methods go to the
 * branch's (or organization's) bank account, else the mapped bank account.
 */
export async function receiptDestination(
  ctx: Ctx,
  branchId: Types.ObjectId,
  method: Payment['method'],
  session: ClientSession,
): Promise<{
  ledgerAccountId: Types.ObjectId | null;
  cashSessionId: Types.ObjectId | null;
}> {
  const settings = await settingsOf(ctx.organizationId, session);
  if (!settings) return { ledgerAccountId: null, cashSessionId: null };
  if (method === 'cash') {
    const open = await CashSessionModel.findOne({
      organizationId: ctx.organizationId,
      status: 'open',
      openedBy: ctx.userId,
      branchId,
    })
      .session(session)
      .lean();
    if (open) {
      const box = await CashAccountModel.findOne({
        organizationId: ctx.organizationId,
        _id: open.cashAccountId,
      })
        .session(session)
        .lean();
      if (box) return { ledgerAccountId: box.accountId, cashSessionId: open._id };
    }
    if (settings.requireCashSession) throw conflict('CASH_SESSION_REQUIRED', 'Open your cashier session at this branch before taking cash');
    const box = await CashAccountModel.findOne({
      organizationId: ctx.organizationId,
      kind: 'cash',
      branchId,
      status: 'active',
    })
      .sort({ createdAt: 1 })
      .session(session)
      .lean();
    return {
      ledgerAccountId: box?.accountId ?? mapped(settings, 'cash'),
      cashSessionId: null,
    };
  }
  const bank =
    (await CashAccountModel.findOne({
      organizationId: ctx.organizationId,
      kind: 'bank',
      branchId,
      status: 'active',
    })
      .sort({ createdAt: 1 })
      .session(session)
      .lean()) ??
    (await CashAccountModel.findOne({
      organizationId: ctx.organizationId,
      kind: 'bank',
      branchId: null,
      status: 'active',
    })
      .sort({ createdAt: 1 })
      .session(session)
      .lean());
  return {
    ledgerAccountId: bank?.accountId ?? mapped(settings, 'bank'),
    cashSessionId: null,
  };
}

type PostedPayment = Lean<Payment> & {
  ledgerAccountId?: Types.ObjectId | null;
  cashSessionId?: Types.ObjectId | null;
};
const moneyAccount = (settings: Lean<AccountingSettings>, p: PostedPayment) =>
  p.ledgerAccountId ?? mapped(settings, p.method === 'cash' ? 'cash' : 'bank');

export async function postReceipt(ctx: Ctx, payment: PostedPayment, session: ClientSession) {
  const on = await active(ctx, session);
  if (!on) return null;
  const { settings, date } = on;
  return postEntry(
    {
      ...ctx,
      date,
      journal: payment.method === 'cash' ? 'cash' : 'bank',
      memo: payment.number,
      lines: [
        {
          accountId: moneyAccount(settings, payment),
          debit: payment.amount,
          branchId: payment.branchId,
        },
        {
          accountId: mapped(settings, 'patientAdvances'),
          credit: payment.amount,
          branchId: payment.branchId,
          partner: patient(payment.patientId),
        },
      ],
      source: { type: 'payment', id: payment._id, event: 'received' },
      cashSessionId: payment.cashSessionId ?? null,
    },
    session,
    settings,
  );
}

/** The n-th allocation of a receipt (n = its position in `allocations`, from 1). */
export async function postAllocation(ctx: Ctx, payment: Lean<Payment>, n: number, invoiceBranchId: Types.ObjectId, session: ClientSession) {
  const on = await active(ctx, session);
  if (!on) return null;
  const { settings, date } = on;
  const allocation = payment.allocations[n - 1];
  if (!allocation) throw new Error('Unknown allocation');
  return postEntry(
    {
      ...ctx,
      date,
      journal: 'sales',
      memo: payment.number,
      lines: [
        {
          accountId: mapped(settings, 'patientAdvances'),
          debit: allocation.amount,
          branchId: payment.branchId,
          partner: patient(payment.patientId),
        },
        {
          accountId: mapped(settings, 'receivable'),
          credit: allocation.amount,
          branchId: invoiceBranchId,
          partner: patient(payment.patientId),
        },
      ],
      source: { type: 'payment', id: payment._id, event: `allocation-${n}` },
    },
    session,
    settings,
  );
}

export async function postRefund(ctx: Ctx, payment: PostedPayment, refund: Lean<Adjustment>, session: ClientSession) {
  const on = await active(ctx, session);
  if (!on) return null;
  const { settings, date } = on;
  const cashSessionId = payment.method === 'cash' ? await openSessionFor(ctx, payment, session) : null;
  return postEntry(
    {
      ...ctx,
      date,
      journal: payment.method === 'cash' ? 'cash' : 'bank',
      memo: `${refund.number} / ${payment.number}`,
      lines: [
        {
          accountId: mapped(settings, 'patientAdvances'),
          debit: refund.amount,
          branchId: payment.branchId,
          partner: patient(payment.patientId),
        },
        {
          accountId: moneyAccount(settings, payment),
          credit: refund.amount,
          branchId: payment.branchId,
        },
      ],
      source: { type: 'refund', id: refund._id, event: 'paid' },
      cashSessionId,
    },
    session,
    settings,
  );
}

/**
 * Reversal of a receipt (bounced transfer, recording error). Built from the document itself, not
 * from earlier entries, so it is also correct for receipts recorded before the cutover: the money
 * leaves the account, allocated parts go back to receivables, the rest leaves patient advances.
 */
export async function postReceiptReversal(ctx: Ctx, payment: PostedPayment, session: ClientSession) {
  const on = await active(ctx, session);
  if (!on) return null;
  const { settings, date } = on;
  const unallocated = payment.amount - payment.allocated - payment.refunded;
  const cashSessionId = payment.method === 'cash' ? await openSessionFor(ctx, payment, session) : null;
  return postEntry(
    {
      ...ctx,
      date,
      journal: payment.method === 'cash' ? 'cash' : 'bank',
      memo: payment.number,
      lines: [
        {
          accountId: mapped(settings, 'receivable'),
          debit: payment.allocated,
          branchId: payment.branchId,
          partner: patient(payment.patientId),
        },
        {
          accountId: mapped(settings, 'patientAdvances'),
          debit: unallocated,
          branchId: payment.branchId,
          partner: patient(payment.patientId),
        },
        {
          accountId: moneyAccount(settings, payment),
          credit: payment.amount - payment.refunded,
          branchId: payment.branchId,
        },
      ],
      source: { type: 'payment', id: payment._id, event: 'reversed' },
      cashSessionId,
    },
    session,
    settings,
  );
}

/** The acting user's open session on the cashbox the receipt went to (for refunds and reversals in cash). */
async function openSessionFor(ctx: Ctx, payment: PostedPayment, session: ClientSession) {
  if (!payment.ledgerAccountId) return null;
  const box = await CashAccountModel.findOne({
    organizationId: ctx.organizationId,
    accountId: payment.ledgerAccountId,
  })
    .session(session)
    .lean();
  if (!box) return null;
  const open = await CashSessionModel.findOne({
    organizationId: ctx.organizationId,
    cashAccountId: box._id,
    status: 'open',
    openedBy: ctx.userId,
  })
    .session(session)
    .lean();
  return open?._id ?? null;
}
