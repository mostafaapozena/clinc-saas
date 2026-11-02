import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { DateEcho, EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import { api, query } from '../lib/api';
import { newRequestKey } from '../lib/clinical';
import { errorMessage } from '../lib/errors';
import { moneyInput, parseMoney } from '../lib/finance';
import { showToast } from '../lib/toast';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { orgKeys, useOrg } from '../org/context';
import { DataTable, DateText } from '../components/data';
import { ActionBar } from '../components/layout';
import { useCurrencyMoney } from '../lib/money';

// Installment plans, rescheduling and bad-debt write-offs on patient invoices
// (docs/architecture/INSTALLMENTS.md). The plan only schedules the open balance: receipts are
// recorded as usual and the API reads progress from the invoice.

type State = 'paid' | 'partial' | 'due' | 'overdue';
type Plan = {
  id: string;
  number: string;
  invoiceId: string;
  invoiceNumber: string | null;
  total: number;
  settled: number;
  remaining: number;
  status: 'active' | 'overdue' | 'completed' | 'cancelled';
  schedule: { dueDate: string; amount: number; covered: number; state: State }[];
  revisions: { at: string; reason: string }[];
  version: number;
};
type Item = { dueDate: string; amount: string };
const keys = { plans: (orgId: string, params: object) => [...orgKeys.all(orgId), 'installments', params] as const };
const badge: Record<State | Plan['status'], string> = {
  paid: 'badge badge--active',
  completed: 'badge badge--active',
  partial: 'badge badge--warning',
  due: 'badge',
  active: 'badge',
  overdue: 'badge badge--danger',
  cancelled: 'badge',
};

function addMonths(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
/** Equal monthly installments; the last one takes the rounding so the total is exact. */
function generateSchedule(total: number, count: number, firstDue: string): Item[] {
  const each = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => ({
    dueDate: addMonths(firstDue, i),
    amount: moneyInput(i === count - 1 ? total - each * (count - 1) : each),
  }));
}

function ScheduleEditor({
  total,
  currency,
  submitLabel,
  onSubmit,
  pending,
  withReason,
}: {
  total: number;
  currency: string;
  submitLabel: string;
  onSubmit: (items: { dueDate: string; amount: number }[], reason: string) => void;
  pending: boolean;
  withReason?: boolean;
}) {
  const { t } = useTranslation();
  const money = useCurrencyMoney(currency);
  const [count, setCount] = useState('3');
  const [firstDue, setFirstDue] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [reason, setReason] = useState('');
  const sum = items.reduce((s, i) => s + (parseMoney(i.amount) ?? 0), 0);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending)
          onSubmit(
            items.map((i) => ({ dueDate: i.dueDate, amount: parseMoney(i.amount) ?? 0 })),
            reason,
          );
      }}
    >
      <div className="inline-form">
        <Field id="ip-count" label={t('installments.count')}>
          <input id="ip-count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
        </Field>
        <Field id="ip-first" label={t('installments.firstDue')}>
          <input id="ip-first" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
        </Field>
        <button
          type="button"
          className="button button--secondary"
          disabled={!firstDue || !(Number(count) >= 1 && Number(count) <= 60)}
          onClick={() => setItems(generateSchedule(total, Number(count), firstDue))}
        >
          {t('installments.generate')}
        </button>
      </div>
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="data-table" data-testid="schedule-editor">
            <thead>
              <tr>
                <th scope="col">{t('installments.dueDate')}</th>
                <th scope="col">{t('installments.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td>
                    <input
                      aria-label={`${t('installments.dueDate')} ${i + 1}`}
                      aria-describedby={`due-${i}-day`}
                      type="date"
                      value={it.dueDate}
                      onChange={(e) => setItems((cur) => cur.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))}
                    />
                    <DateEcho id={`due-${i}-day`} value={it.dueDate} />
                  </td>
                  <td>
                    <input
                      aria-label={`${t('installments.amount')} ${i + 1}`}
                      inputMode="decimal"
                      dir="ltr"
                      value={it.amount}
                      onChange={(e) => setItems((cur) => cur.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {items.length > 0 && sum !== total && <Notice kind="warning">{t('installments.sumMismatch', { sum: money(sum), total: money(total) })}</Notice>}
      {withReason && (
        <Field id="ip-reason" label={t('installments.reason')}>
          <input id="ip-reason" required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      <ActionBar>
        <button type="submit" className="button button--primary" disabled={pending || items.length === 0 || sum !== total}>
          {submitLabel}
        </button>
      </ActionBar>
    </form>
  );
}

function WriteOff({ invoiceId, balance, currency, onDone }: { invoiceId: string; balance: number; currency: string; onDone: () => void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const money = useCurrencyMoney(currency);
  const [amount, setAmount] = useState(() => moneyInput(balance));
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(newRequestKey);
  const run = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/finance/invoices/${invoiceId}/write-offs`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: { amount: parseMoney(amount) ?? 0, reason },
      }),
    onSuccess: () => (showToast(t('installments.writtenOff')), setKey(newRequestKey()), onDone()),
  });
  return (
    <form
      className="stack"
      aria-label={t('installments.writeOff')}
      onSubmit={(e) => {
        e.preventDefault();
        if (!run.isPending) run.mutate();
      }}
    >
      <Notice kind="warning">{t('installments.writeOffNotice', { balance: money(balance) })}</Notice>
      <div className="form-grid">
        <Field id="wo-amount" label={t('installments.amount')}>
          <input id="wo-amount" required inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id="wo-reason" label={t('installments.reason')}>
          <input id="wo-reason" required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      {run.isError && <Notice kind="error">{errorMessage(t, run.error)}</Notice>}
      <ActionBar>
        <button type="submit" className="button button--secondary" disabled={run.isPending}>
          {t('installments.writeOff')}
        </button>
      </ActionBar>
    </form>
  );
}

function PlanTable({ plan, currency }: { plan: Plan; currency: string }) {
  const { t } = useTranslation();
  const money = useCurrencyMoney(currency);
  return (
    <DataTable
      testId="installment-schedule"
      rows={plan.schedule.map((s, index) => ({ ...s, index }))}
      rowKey={(s) => String(s.index)}
      columns={[
        { key: 'dueDate', label: t('installments.dueDate'), cell: (s) => <DateText value={s.dueDate} /> },
        { key: 'amount', label: t('installments.amount'), numeric: true, cell: (s) => money(s.amount) },
        { key: 'covered', label: t('installments.covered'), numeric: true, cell: (s) => money(s.covered) },
        { key: 'state', label: t('installments.state'), cell: (s) => <span className={badge[s.state]}>{t(`installments.states.${s.state}`)}</span> },
      ]}
    />
  );
}

/** On an issued invoice: its installment plan, or the form to start one; write-off for the owner. */
export function InvoiceInstallments({ invoice }: { invoice: { id: string; status: string; balance: number; currency: string } }) {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const money = useCurrencyMoney(invoice.currency);
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'reschedule' | 'writeOff' | null>(null);
  const params = { invoiceId: invoice.id };
  const plans = useQuery({
    queryKey: keys.plans(orgId, params),
    queryFn: ({ signal }) => api<{ plans: Plan[] }>(`/orgs/${orgId}/finance/installment-plans${query(params)}`, { signal }),
    enabled: invoice.status === 'issued',
  });
  const refresh = () => (setMode(null), queryClient.invalidateQueries({ queryKey: orgKeys.all(orgId) }));
  const create = useMutation({
    mutationFn: (schedule: { dueDate: string; amount: number }[]) =>
      api(`/orgs/${orgId}/finance/installment-plans`, { method: 'POST', body: { invoiceId: invoice.id, schedule } }),
    onSuccess: () => (showToast(t('installments.created')), refresh()),
  });
  const plan = plans.data?.plans.find((p) => p.status !== 'cancelled');
  const reschedule = useMutation({
    mutationFn: ({ schedule, reason }: { schedule: { dueDate: string; amount: number }[]; reason: string }) =>
      api(`/orgs/${orgId}/finance/installment-plans/${plan!.id}/reschedule`, { method: 'POST', body: { schedule, reason, version: plan!.version } }),
    onSuccess: () => (showToast(t('installments.rescheduled')), refresh()),
  });
  if (invoice.status !== 'issued' || !plans.data) return null;
  if (!plan && invoice.balance <= 0) return null;
  const manage = can('finance.invoice.manage');
  return (
    <section className="card" aria-labelledby="installments-title" data-testid="invoice-installments">
      <div className="section-header">
        <h2 id="installments-title">{t('installments.title')}</h2>
        {plan && <span className={badge[plan.status]}>{t(`installments.planStatus.${plan.status}`)}</span>}
      </div>
      {plan ? (
        <>
          <p className="muted">
            {t('installments.progress', { settled: money(plan.settled), total: money(plan.total), remaining: money(plan.remaining) })}
          </p>
          <PlanTable plan={plan} currency={invoice.currency} />
          {plan.revisions.length > 0 && <p className="muted small">{t('installments.revised', { count: plan.revisions.length })}</p>}
        </>
      ) : (
        <p className="muted">{t('installments.none', { balance: money(invoice.balance) })}</p>
      )}
      {!plan && manage && (
        <ScheduleEditor
          total={invoice.balance}
          currency={invoice.currency}
          submitLabel={t('installments.create')}
          pending={create.isPending}
          onSubmit={(s) => create.mutate(s)}
        />
      )}
      {create.isError && <Notice kind="error">{errorMessage(t, create.error)}</Notice>}
      <div className="inline-form">
        {plan && plan.remaining > 0 && manage && (
          <button
            type="button"
            className="button button--secondary"
            aria-expanded={mode === 'reschedule'}
            onClick={() => setMode(mode === 'reschedule' ? null : 'reschedule')}
          >
            {t('installments.reschedule')}
          </button>
        )}
        {invoice.balance > 0 && can('finance.writeoff') && (
          <button
            type="button"
            className="button button--ghost"
            aria-expanded={mode === 'writeOff'}
            onClick={() => setMode(mode === 'writeOff' ? null : 'writeOff')}
          >
            {t('installments.writeOff')}
          </button>
        )}
      </div>
      {mode === 'reschedule' && plan && (
        <ScheduleEditor
          total={plan.remaining}
          currency={invoice.currency}
          withReason
          submitLabel={t('installments.saveSchedule')}
          pending={reschedule.isPending}
          onSubmit={(schedule, reason) => reschedule.mutate({ schedule, reason })}
        />
      )}
      {reschedule.isError && <Notice kind="error">{errorMessage(t, reschedule.error)}</Notice>}
      {mode === 'writeOff' && <WriteOff invoiceId={invoice.id} balance={invoice.balance} currency={invoice.currency} onDone={refresh} />}
    </section>
  );
}

export function InstallmentsPage() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  useDocumentTitle(t('installments.pageTitle'));
  const [status, setStatus] = useState<'overdue' | 'active' | 'completed'>('overdue');
  const params = { status };
  const list = useQuery({
    queryKey: keys.plans(orgId, params),
    queryFn: ({ signal }) => api<{ plans: Plan[] }>(`/orgs/${orgId}/finance/installment-plans${query(params)}`, { signal }),
  });
  return (
    <>
      <PageHeader title={t('installments.pageTitle')} subtitle={t('installments.subtitle')} />
      <section className="card" aria-labelledby="plans-title">
        <div className="section-header">
          <h2 id="plans-title">{t('installments.plans')}</h2>
          <div className="segmented" role="group" aria-label={t('installments.state')}>
            {(['overdue', 'active', 'completed'] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={s === status ? 'segment segment--active' : 'segment'}
                aria-pressed={s === status}
                onClick={() => setStatus(s)}
              >
                {t(`installments.planStatus.${s}`)}
              </button>
            ))}
          </div>
        </div>
        {list.isPending && <Loading />}
        {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => list.refetch()} />}
        {list.data && list.data.plans.length === 0 && <EmptyState icon="calendar">{t('installments.noPlans')}</EmptyState>}
        {list.data && list.data.plans.length > 0 && (
          <ul className="data-list" data-testid="installment-plans">
            {list.data.plans.map((p) => {
              const next = p.schedule.find((s) => s.state !== 'paid');
              return (
                <li key={p.id} className="data-row">
                  <div className="data-main">
                    <h3>
                      <Link to={`/app/${orgId}/finance/invoices/${p.invoiceId}`}>
                        <bdi dir="ltr">{p.invoiceNumber ?? p.number}</bdi>
                      </Link>
                    </h3>
                    <p className="muted">
                      <bdi dir="ltr">{p.number}</bdi>
                      {next && ` · ${t('installments.nextDue', { date: next.dueDate })}`}
                    </p>
                  </div>
                  <span className={badge[p.status]}>{t(`installments.planStatus.${p.status}`)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
