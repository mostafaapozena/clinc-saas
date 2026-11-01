import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Metric } from '../components/Metric';
import { PageHeader } from '../components/PageHeader';
import { Badge, EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import { accountName, accountingKeys, type AccountType } from '../lib/accounting';
import { api, query } from '../lib/api';
import { csvMoney, downloadCsv } from '../lib/csv';
import { errorMessage } from '../lib/errors';
import { moneyInput, parseMoney } from '../lib/finance';
import { showToast } from '../lib/toast';
import { useMoney } from '../lib/money';
import { useAccountingSettings } from '../lib/useAccounting';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useOrg } from '../org/context';
import { AccountingNav } from './AccountingPages';
import { ActionBar, MetricGrid } from '../components/layout';
import { DataTable, FilterBar } from '../components/data';

// Budgets, budget against actual, cash flow and recurring commitments
// (docs/architecture/PLANNING.md). Everything here reads the posted ledger; nothing posts.

type AccountRef = { id: string; code: string; name: string; templateKey: string | null; type: AccountType; status: string };
type BudgetResponse = {
  year: number;
  currency: string;
  budget: { status: 'draft' | 'approved'; version: number; lines: { accountId: string; months: number[] }[] } | null;
  accounts: AccountRef[];
};
type VarianceRow = {
  account: AccountRef;
  annualBudget: number;
  budget: number;
  actual: number;
  variance: number;
  usedPercent: number | null;
  favourable: boolean;
  unbudgeted: boolean;
};
type VarianceResponse = {
  through: number;
  currency: string;
  budget: { status: string } | null;
  rows: VarianceRow[];
  totals: Record<'income' | 'expense' | 'result', { budget: number; actual: number }>;
};
type CashFlowResponse = {
  currency: string;
  opening: number;
  net: number;
  closing: number;
  reconciled: boolean;
  sections: {
    activity: 'operating' | 'investing' | 'financing';
    net: number;
    rows: { account: AccountRef; inflow: number; outflow: number; net: number }[];
  }[];
};
type Commitment = {
  id: string;
  name: string;
  accountId: string;
  amount: number;
  frequency: 'monthly' | 'quarterly' | 'yearly';
  monthlyEquivalent: number;
  nextDue: string | null;
  endDate: string | null;
  status: 'active' | 'ended';
  due: 'overdue' | 'soon' | null;
  version: number;
};

const MONTHS = Array.from({ length: 12 }, (_, i) => i);
const planningKeys = {
  budget: (orgId: string, year: number, branchId: string) => [...accountingKeys.all(orgId), 'budget', year, branchId] as const,
  commitments: (orgId: string) => [...accountingKeys.all(orgId), 'commitments'] as const,
};

function useMonthName() {
  const { i18n } = useTranslation();
  const fmt = new Intl.DateTimeFormat(i18n.language, { month: 'short', timeZone: 'UTC' });
  return (i: number) => fmt.format(new Date(Date.UTC(2026, i, 1)));
}

/** Money input that keeps what is typed until it leaves the field. */
function MoneyCell({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      id={id}
      aria-label={label}
      inputMode="decimal"
      dir="ltr"
      className="input--compact"
      disabled={disabled}
      value={text ?? (value ? moneyInput(value) : '')}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text === null) return;
        const parsed = text.trim() === '' ? 0 : parseMoney(text);
        if (parsed !== null) onChange(parsed);
        setText(null);
      }}
    />
  );
}

/** Even split of an annual amount; the remainder goes to December so the total is exact. */
const spread = (annual: number) => {
  const each = Math.floor(annual / 12);
  return MONTHS.map((i) => (i === 11 ? annual - each * 11 : each));
};

function BudgetEditor({ data, year, branchId }: { data: BudgetResponse; year: number; branchId: string }) {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const money = useMoney();
  const monthName = useMonthName();
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<Record<string, number[]>>(() =>
    Object.fromEntries((data.budget?.lines ?? []).map((l) => [l.accountId, l.months])),
  );
  const [open, setOpen] = useState<string | null>(null);
  const approved = data.budget?.status === 'approved';
  const editable = can('accounting.manage') && !approved;
  const refresh = () => queryClient.invalidateQueries({ queryKey: accountingKeys.all(orgId) });
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/accounting/budgets`, {
        method: 'PUT',
        body: {
          year,
          branchId: branchId || null,
          lines: Object.entries(lines).map(([accountId, months]) => ({ accountId, months })),
          version: data.budget?.version ?? null,
        },
      }),
    onSuccess: () => (showToast(t('planning.budget.saved')), refresh()),
  });
  const transition = useMutation({
    mutationFn: (to: 'approve' | 'reopen') =>
      api(`/orgs/${orgId}/accounting/budgets/${to}`, { method: 'POST', body: { year, branchId: branchId || null, version: data.budget!.version } }),
    onSuccess: () => refresh(),
  });
  const total = (type: AccountType) =>
    data.accounts.filter((a) => a.type === type).reduce((s, a) => s + (lines[a.id] ?? []).reduce((x, v) => x + v, 0), 0);
  return (
    <section className="card" aria-labelledby="budget-title" data-testid="budget-editor">
      <div className="section-header">
        <h2 id="budget-title">{t('planning.budget.title', { year })}</h2>
        <span className={approved ? 'badge badge--active' : 'badge'}>{t(`planning.budget.status.${data.budget?.status ?? 'none'}`)}</span>
      </div>
      <p className="muted small">{approved ? t('planning.budget.approvedHint') : t('planning.budget.hint')}</p>
      {(['income', 'expense'] as const).map((type) => (
        <div key={type} className="table-wrap">
          <table className="data-table">
            <caption>{t(`accounting.types.${type}`)}</caption>
            <thead>
              <tr>
                <th scope="col">{t('accounting.account')}</th>
                <th scope="col">{t('planning.budget.annual')}</th>
                <th scope="col">
                  <span className="visually-hidden">{t('planning.budget.months')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.accounts
                .filter((a) => a.type === type)
                .map((a) => {
                  const months = lines[a.id] ?? MONTHS.map(() => 0);
                  const annual = months.reduce((s, v) => s + v, 0);
                  const name = `${a.code} · ${accountName(t, a)}`;
                  return (
                    <Fragment key={a.id}>
                      <tr>
                        <td data-label={t('accounting.account')}>
                          <bdi dir="ltr">{a.code}</bdi> {accountName(t, a)}
                        </td>
                        <td data-label={t('planning.budget.annual')}>
                          {editable ? (
                            <MoneyCell
                              id={`annual-${a.id}`}
                              label={t('planning.budget.annualFor', { account: name })}
                              value={annual}
                              onChange={(v) => setLines((cur) => ({ ...cur, [a.id]: spread(v) }))}
                            />
                          ) : (
                            money(annual, data.currency)
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="button button--ghost"
                            aria-expanded={open === a.id}
                            onClick={() => setOpen(open === a.id ? null : a.id)}
                          >
                            {t('planning.budget.byMonth')}
                          </button>
                        </td>
                      </tr>
                      {open === a.id && (
                        <tr>
                          <td colSpan={3}>
                            <div className="month-grid">
                              {MONTHS.map((i) => (
                                <label key={i} className="month-cell" htmlFor={`m-${a.id}-${i}`}>
                                  <span className="muted small">{monthName(i)}</span>
                                  {editable ? (
                                    <MoneyCell
                                      id={`m-${a.id}-${i}`}
                                      label={`${name} ${monthName(i)}`}
                                      value={months[i] ?? 0}
                                      onChange={(v) => setLines((cur) => ({ ...cur, [a.id]: months.map((x, j) => (j === i ? v : x)) }))}
                                    />
                                  ) : (
                                    <span id={`m-${a.id}-${i}`}>{money(months[i] ?? 0, data.currency)}</span>
                                  )}
                                </label>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              <tr className="row-total">
                <th scope="row">{t('accounting.totalOf', { type: t(`accounting.types.${type}`) })}</th>
                <td data-label={t('planning.budget.annual')}>{money(total(type), data.currency)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      ))}
      <p>
        <strong>{t('planning.budget.plannedResult')}</strong> {money(total('income') - total('expense'), data.currency)}
      </p>
      {save.isError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
      {transition.isError && <Notice kind="error">{errorMessage(t, transition.error)}</Notice>}
      <ActionBar>
        {editable && (
          <button type="button" className="button button--primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {t('planning.budget.save')}
          </button>
        )}
        {can('accounting.settings.manage') && data.budget && (
          <button
            type="button"
            className="button button--secondary"
            disabled={transition.isPending}
            onClick={() => transition.mutate(approved ? 'reopen' : 'approve')}
          >
            {approved ? t('planning.budget.reopen') : t('planning.budget.approve')}
          </button>
        )}
      </ActionBar>
    </section>
  );
}

function VarianceReport({ year, branchId }: { year: number; branchId: string }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const money = useMoney();
  const monthName = useMonthName();
  const [through, setThrough] = useState('');
  const params = { year, through: through || undefined, branchId: branchId || undefined };
  const report = useQuery({
    queryKey: accountingKeys.report(orgId, 'budgetVsActual', params),
    queryFn: ({ signal }) => api<VarianceResponse>(`/orgs/${orgId}/accounting/reports/budget-vs-actual${query(params)}`, { signal }),
  });
  const d = report.data;
  return (
    <section className="card" aria-labelledby="variance-title">
      <div className="section-header">
        <h2 id="variance-title">{t('planning.variance.title')}</h2>
        {d && (
          <button
            type="button"
            className="button button--secondary"
            onClick={() =>
              downloadCsv(`budget-vs-actual-${year}-${d.through}.csv`, [
                [
                  t('accounting.code'),
                  t('accounting.account'),
                  t('planning.variance.budget'),
                  t('planning.variance.actual'),
                  t('planning.variance.variance'),
                ],
                ...d.rows.map((r) => [r.account.code, accountName(t, r.account), csvMoney(r.budget), csvMoney(r.actual), csvMoney(r.variance)]),
              ])
            }
          >
            {t('reportsHub.downloadCsv')}
          </button>
        )}
      </div>
      <FilterBar>
        <Field id="variance-through" label={t('planning.variance.through')}>
          <select id="variance-through" value={through || String(d?.through ?? '')} onChange={(e) => setThrough(e.target.value)}>
            {MONTHS.map((i) => (
              <option key={i} value={String(i + 1)}>
                {monthName(i)}
              </option>
            ))}
          </select>
        </Field>
      </FilterBar>
      {report.isPending && <Loading />}
      {report.isError && <ErrorState message={errorMessage(t, report.error)} onRetry={() => report.refetch()} />}
      {d && !d.budget && <Notice kind="info">{t('planning.variance.noBudget')}</Notice>}
      {d && d.rows.length === 0 && <EmptyState icon="book">{t('accounting.noMovements')}</EmptyState>}
      {d && d.rows.length > 0 && (
        <>
          <MetricGrid columns="compact">
            <Metric icon="chart" label={t('planning.variance.resultBudget')} value={d.totals.result.budget} format={(v) => money(v, d.currency)} />
            <Metric icon="wallet" label={t('planning.variance.resultActual')} value={d.totals.result.actual} format={(v) => money(v, d.currency)} />
          </MetricGrid>
          <DataTable
            testId="budget-vs-actual"
            rows={d.rows}
            rowKey={(r) => r.account.id}
            columns={[
              {
                key: 'account',
                label: t('accounting.account'),
                cell: (r) => (
                  <>
                    <bdi dir="ltr">{r.account.code}</bdi> {accountName(t, r.account)}
                    {r.unbudgeted && <Badge tone="warning"> {t('planning.variance.unbudgeted')}</Badge>}
                  </>
                ),
              },
              { key: 'budget', label: t('planning.variance.budget'), numeric: true, cell: (r) => money(r.budget, d.currency) },
              { key: 'actual', label: t('planning.variance.actual'), numeric: true, cell: (r) => money(r.actual, d.currency) },
              {
                key: 'variance',
                label: t('planning.variance.variance'),
                numeric: true,
                cell: (r) => (
                  <>
                    <Badge tone={r.favourable ? 'success' : 'danger'}>{money(r.variance, d.currency)}</Badge>
                    <span className="visually-hidden">{r.favourable ? t('planning.variance.favourable') : t('planning.variance.unfavourable')}</span>
                  </>
                ),
              },
              { key: 'used', label: t('planning.variance.used'), numeric: true, cell: (r) => (r.usedPercent === null ? '—' : `${r.usedPercent}%`) },
            ]}
          />
        </>
      )}
    </section>
  );
}

export function BudgetsPage() {
  const { t } = useTranslation();
  const { orgId, branches } = useOrg();
  useDocumentTitle(t('planning.budget.pageTitle'));
  const settings = useAccountingSettings();
  const today = settings.data?.today ?? null;
  const [year, setYear] = useState<number | null>(null);
  const [branchId, setBranchId] = useState('');
  const y = year ?? (today ? Number(today.slice(0, 4)) : null);
  const budget = useQuery({
    queryKey: planningKeys.budget(orgId, y ?? 0, branchId),
    queryFn: ({ signal }) =>
      api<BudgetResponse>(`/orgs/${orgId}/accounting/budgets${query({ year: y!, branchId: branchId || undefined })}`, { signal }),
    enabled: y !== null && settings.data?.configured === true,
  });
  return (
    <>
      <PageHeader title={t('planning.budget.pageTitle')} subtitle={t('planning.budget.subtitle')} />
      <AccountingNav />
      {settings.isSuccess && !settings.data.configured && <Notice kind="info">{t('accounting.notSetUp')}</Notice>}
      {y !== null && (
        <section className="card" aria-labelledby="budget-filters">
          <h2 id="budget-filters" className="visually-hidden">
            {t('accounting.reportFilters')}
          </h2>
          <FilterBar>
            <Field id="budget-year" label={t('planning.budget.year')}>
              <select id="budget-year" value={y} onChange={(e) => setYear(Number(e.target.value))}>
                {[y - 1, y, y + 1].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="budget-branch" label={t('accounting.costCenter')}>
              <select id="budget-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">{t('planning.budget.wholeOrganization')}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          </FilterBar>
        </section>
      )}
      {budget.isPending && budget.fetchStatus !== 'idle' && <Loading />}
      {budget.isError && <ErrorState message={errorMessage(t, budget.error)} onRetry={() => budget.refetch()} />}
      {budget.isSuccess && y !== null && (
        <>
          <BudgetEditor key={`${y}-${branchId}-${budget.data.budget?.version ?? 'new'}`} data={budget.data} year={y} branchId={branchId} />
          <VarianceReport year={y} branchId={branchId} />
        </>
      )}
    </>
  );
}

export function CashFlowPage() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const money = useMoney();
  useDocumentTitle(t('planning.cashFlow.title'));
  const settings = useAccountingSettings();
  const today = settings.data?.today ?? '';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = { from: from || (today ? `${today.slice(0, 7)}-01` : ''), to: to || today };
  const report = useQuery({
    queryKey: accountingKeys.report(orgId, 'cashFlow', params),
    queryFn: ({ signal }) => api<CashFlowResponse>(`/orgs/${orgId}/accounting/reports/cash-flow${query(params)}`, { signal }),
    enabled: Boolean(params.from && params.to) && settings.data?.configured === true,
  });
  const d = report.data;
  return (
    <>
      <PageHeader title={t('planning.cashFlow.title')} subtitle={t('planning.cashFlow.subtitle')} />
      <AccountingNav />
      <section className="card" aria-labelledby="cash-flow-filters">
        <h2 id="cash-flow-filters" className="visually-hidden">
          {t('accounting.reportFilters')}
        </h2>
        <FilterBar>
          <Field id="cf-from" label={t('accounting.from')}>
            <input id="cf-from" type="date" value={params.from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field id="cf-to" label={t('accounting.to')}>
            <input id="cf-to" type="date" value={params.to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </FilterBar>
      </section>
      {report.isPending && report.fetchStatus !== 'idle' && <Loading />}
      {report.isError && <ErrorState message={errorMessage(t, report.error)} onRetry={() => report.refetch()} />}
      {d && (
        <section className="card" aria-labelledby="cash-flow-title" data-testid="cash-flow">
          <div className="section-header">
            <h2 id="cash-flow-title">{t('planning.cashFlow.statement')}</h2>
            <button
              type="button"
              className="button button--secondary"
              onClick={() =>
                downloadCsv(`cash-flow-${params.from}-${params.to}.csv`, [
                  [
                    t('planning.cashFlow.activity'),
                    t('accounting.code'),
                    t('accounting.account'),
                    t('planning.cashFlow.inflow'),
                    t('planning.cashFlow.outflow'),
                  ],
                  ...d.sections.flatMap((s) =>
                    s.rows.map((r) => [
                      t(`planning.cashFlow.${s.activity}`),
                      r.account.code,
                      accountName(t, r.account),
                      csvMoney(r.inflow),
                      csvMoney(r.outflow),
                    ]),
                  ),
                ])
              }
            >
              {t('reportsHub.downloadCsv')}
            </button>
          </div>
          <span className={d.reconciled ? 'badge badge--success' : 'badge badge--danger'}>
            {d.reconciled ? t('planning.cashFlow.reconciled') : t('planning.cashFlow.notReconciled')}
          </span>
          <MetricGrid columns="compact">
            <Metric icon="cash" label={t('planning.cashFlow.opening')} value={d.opening} format={(v) => money(v, d.currency)} />
            <Metric icon="chart" label={t('planning.cashFlow.net')} value={d.net} format={(v) => money(v, d.currency)} />
            <Metric icon="cash" label={t('planning.cashFlow.closing')} value={d.closing} format={(v) => money(v, d.currency)} />
          </MetricGrid>
          {d.sections.map((s) => (
            <div key={s.activity} className="table-wrap">
              <table className="data-table">
                <caption>{t(`planning.cashFlow.${s.activity}`)}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('accounting.account')}</th>
                    <th scope="col">{t('planning.cashFlow.inflow')}</th>
                    <th scope="col">{t('planning.cashFlow.outflow')}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.rows.length === 0 && (
                    <tr>
                      <td colSpan={3} className="muted">
                        {t('planning.cashFlow.none')}
                      </td>
                    </tr>
                  )}
                  {s.rows.map((r) => (
                    <tr key={r.account.id}>
                      <td data-label={t('accounting.account')}>
                        <bdi dir="ltr">{r.account.code}</bdi> {accountName(t, r.account)}
                      </td>
                      <td data-label={t('planning.cashFlow.inflow')}>{money(r.inflow, d.currency)}</td>
                      <td data-label={t('planning.cashFlow.outflow')}>{money(r.outflow, d.currency)}</td>
                    </tr>
                  ))}
                  <tr className="row-total">
                    <th scope="row">{t('planning.cashFlow.netOf', { activity: t(`planning.cashFlow.${s.activity}`) })}</th>
                    <td colSpan={2}>{money(s.net, d.currency)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

type Voucher = { id: string; number: string; type: string; date: string; counterAccountId: string | null; amount: number; memo: string };
type Bill = {
  id: string;
  number: string;
  billDate: string;
  status: string;
  total: number;
  lines: { expenseAccountId: string | null; amount: number }[];
};

function RecordPayment({ c, currency, onDone }: { c: Commitment; currency: string; onDone: () => void }) {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const money = useMoney();
  const [choice, setChoice] = useState('');
  const vouchers = useQuery({
    queryKey: [...accountingKeys.cash(orgId), 'vouchers'],
    queryFn: ({ signal }) => api<{ vouchers: Voucher[] }>(`/orgs/${orgId}/cash/vouchers`, { signal }),
    enabled: can('cash.voucher.create'),
  });
  const bills = useQuery({
    queryKey: ['org', orgId, 'purchasing', 'bills', 'posted'],
    queryFn: ({ signal }) => api<{ bills: Bill[] }>(`/orgs/${orgId}/purchasing/bills?status=posted`, { signal }),
    enabled: can('purchase.bill.manage'),
  });
  const options = [
    ...(vouchers.data?.vouchers ?? [])
      .filter((v) => v.type === 'out' && v.counterAccountId === c.accountId)
      .map((v) => ({ value: `v:${v.id}`, label: `${v.number} · ${v.date} · ${money(v.amount, currency)} · ${v.memo}` })),
    ...(bills.data?.bills ?? [])
      .filter((b) => b.lines.some((l) => l.expenseAccountId === c.accountId))
      .map((b) => ({ value: `b:${b.id}`, label: `${b.number} · ${b.billDate} · ${money(b.total, currency)}` })),
  ];
  const record = useMutation({
    mutationFn: () => {
      const [kind, docId] = choice.split(':');
      return api(`/orgs/${orgId}/accounting/commitments/${c.id}/record`, {
        method: 'POST',
        body: { voucherId: kind === 'v' ? docId : null, billId: kind === 'b' ? docId : null, version: c.version },
      });
    },
    onSuccess: () => (showToast(t('planning.commitments.recorded')), onDone()),
  });
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (choice) record.mutate();
      }}
    >
      <Field id={`pay-${c.id}`} label={t('planning.commitments.paidBy')} hint={t('planning.commitments.paidByHint')}>
        <select id={`pay-${c.id}`} value={choice} required onChange={(e) => setChoice(e.target.value)}>
          <option value="">{options.length ? t('planning.commitments.choose') : t('planning.commitments.noDocuments')}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      {record.isError && <Notice kind="error">{errorMessage(t, record.error)}</Notice>}
      <button type="submit" className="button button--primary" disabled={!choice || record.isPending}>
        {t('planning.commitments.record')}
      </button>
    </form>
  );
}

function AddCommitment({ accounts, onDone }: { accounts: AccountRef[]; onDone: () => void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<Commitment['frequency']>('monthly');
  const [firstDue, setFirstDue] = useState('');
  const [endDate, setEndDate] = useState('');
  const add = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/accounting/commitments`, {
        method: 'POST',
        body: { name, accountId, amount: parseMoney(amount) ?? 0, frequency, firstDue, endDate: endDate || null },
      }),
    onSuccess: () => {
      showToast(t('planning.commitments.added'));
      setName('');
      setAmount('');
      onDone();
    },
  });
  return (
    <form
      className="card"
      aria-labelledby="add-commitment-title"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <h2 id="add-commitment-title">{t('planning.commitments.add')}</h2>
      <div className="form-grid">
        <Field id="cm-name" label={t('planning.commitments.name')}>
          <input id="cm-name" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="cm-account" label={t('accounting.account')}>
          <select id="cm-account" required value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">{t('accounting.chooseAccount')}</option>
            {accounts
              .filter((a) => a.type === 'expense' && a.status === 'active')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {accountName(t, a)}
                </option>
              ))}
          </select>
        </Field>
        <Field id="cm-amount" label={t('planning.commitments.amount')}>
          <input id="cm-amount" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id="cm-frequency" label={t('planning.commitments.frequency')}>
          <select id="cm-frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as Commitment['frequency'])}>
            {(['monthly', 'quarterly', 'yearly'] as const).map((f) => (
              <option key={f} value={f}>
                {t(`planning.commitments.frequencies.${f}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="cm-first" label={t('planning.commitments.firstDue')}>
          <input id="cm-first" type="date" required value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
        </Field>
        <Field id="cm-end" label={t('planning.commitments.endDate')}>
          <input id="cm-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
      </div>
      {add.isError && <Notice kind="error">{errorMessage(t, add.error)}</Notice>}
      <ActionBar>
        <button type="submit" className="button button--primary" disabled={add.isPending}>
          {t('planning.commitments.add')}
        </button>
      </ActionBar>
    </form>
  );
}

export function CommitmentsPage() {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const money = useMoney();
  const queryClient = useQueryClient();
  useDocumentTitle(t('planning.commitments.title'));
  const [paying, setPaying] = useState<string | null>(null);
  const list = useQuery({
    queryKey: planningKeys.commitments(orgId),
    queryFn: ({ signal }) =>
      api<{ today: string; currency: string; commitments: Commitment[]; monthlyTotal: number }>(`/orgs/${orgId}/accounting/commitments`, { signal }),
  });
  const year = list.data ? Number(list.data.today.slice(0, 4)) : 0;
  const accounts = useQuery({
    queryKey: planningKeys.budget(orgId, year, ''),
    queryFn: ({ signal }) => api<BudgetResponse>(`/orgs/${orgId}/accounting/budgets${query({ year })}`, { signal }),
    enabled: year > 0,
  });
  const names = new Map((accounts.data?.accounts ?? []).map((a) => [a.id, `${a.code} · ${accountName(t, a)}`]));
  const refresh = () => (setPaying(null), queryClient.invalidateQueries({ queryKey: accountingKeys.all(orgId) }));
  const d = list.data;
  return (
    <>
      <PageHeader title={t('planning.commitments.title')} subtitle={t('planning.commitments.subtitle')} />
      <AccountingNav />
      <Notice kind="info">{t('planning.commitments.onceNotice')}</Notice>
      <section className="card" aria-labelledby="commitments-title">
        <div className="section-header">
          <h2 id="commitments-title">{t('planning.commitments.register')}</h2>
          {d && <span className="muted">{t('planning.commitments.monthlyTotal', { amount: money(d.monthlyTotal, d.currency) })}</span>}
        </div>
        {list.isPending && <Loading />}
        {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => list.refetch()} />}
        {d && d.commitments.length === 0 && <EmptyState icon="calendar">{t('planning.commitments.none')}</EmptyState>}
        {d && d.commitments.length > 0 && (
          <ul className="data-list" data-testid="commitments">
            {d.commitments.map((c) => (
              <li key={c.id} className="data-row data-row--stack">
                <div className="data-main">
                  <h3>{c.name}</h3>
                  <p className="muted">
                    {money(c.amount, d.currency)} · {t(`planning.commitments.frequencies.${c.frequency}`)} · {names.get(c.accountId) ?? ''}
                    {c.nextDue && ` · ${t('planning.commitments.nextDue', { date: c.nextDue })}`}
                  </p>
                </div>
                {c.due && (
                  <span className={c.due === 'overdue' ? 'badge badge--danger' : 'badge badge--warning'}>
                    {t(`planning.commitments.due.${c.due}`)}
                  </span>
                )}
                <span className={c.status === 'active' ? 'badge badge--active' : 'badge'}>{t(`planning.commitments.status.${c.status}`)}</span>
                {can('accounting.manage') && c.status === 'active' && (
                  <button
                    type="button"
                    className="button button--secondary"
                    aria-expanded={paying === c.id}
                    onClick={() => setPaying(paying === c.id ? null : c.id)}
                  >
                    {t('planning.commitments.record')}
                  </button>
                )}
                {paying === c.id && <RecordPayment c={c} currency={d.currency} onDone={refresh} />}
              </li>
            ))}
          </ul>
        )}
      </section>
      {can('accounting.manage') && accounts.data && <AddCommitment accounts={accounts.data.accounts} onDone={refresh} />}
    </>
  );
}
