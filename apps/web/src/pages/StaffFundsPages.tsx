import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { displayName } from '../lib/defaultNames';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import { accountName, accountingKeys, type LedgerAccount } from '../lib/accounting';
import { api } from '../lib/api';
import { newRequestKey } from '../lib/clinical';
import { errorMessage } from '../lib/errors';
import { parseMoney } from '../lib/finance';
import { showToast } from '../lib/toast';
import { useMoney } from '../lib/useAccounting';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useOrg } from '../org/context';
import { AccountingNav } from './AccountingPages';

// Employee cash advances (سلف) and petty-cash custody (عهد) — docs/architecture/STAFF_FUNDS.md.
// Every action posts through the API; this page only sends what was entered.

type Kind = 'advance' | 'custody';
type Fund = {
  id: string;
  number: string;
  kind: Kind;
  memberName: string | null;
  purpose: string;
  amount: number;
  dueDate: string | null;
  returned: number;
  expensed: number;
  writtenOff: number;
  outstanding: number;
  overdue: boolean;
  status: 'open' | 'settled';
  movements: { type: 'issue' | 'return' | 'expense' | 'write_off'; date: string; amount: number; memo: string }[];
  version: number;
};
type CashBox = { id: string; name: string; kind: 'cash' | 'bank'; status: string };

const fundsKey = (orgId: string) => [...accountingKeys.all(orgId), 'staffFunds'] as const;

function useBoxes() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: [...accountingKeys.cash(orgId), 'accounts'],
    queryFn: ({ signal }) => api<{ accounts: CashBox[] }>(`/orgs/${orgId}/cash/accounts`, { signal }),
  });
}

function BoxSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const boxes = useBoxes();
  return (
    <Field id={id} label={t('staffFunds.cashAccount')}>
      <select id={id} required value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('staffFunds.chooseCashAccount')}</option>
        {(boxes.data?.accounts ?? [])
          .filter((b) => b.status === 'active')
          .map((b) => (
            <option key={b.id} value={b.id}>
              {displayName(t, b.name)}
            </option>
          ))}
      </select>
    </Field>
  );
}

function IssueForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [kind, setKind] = useState<Kind>('advance');
  const [membershipId, setMembershipId] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [dueDate, setDueDate] = useState('');
  // One key per filled form: a retried submit after a lost response is replayed, not issued twice.
  const [requestKey, setRequestKey] = useState(newRequestKey);
  const members = useQuery({
    queryKey: [...fundsKey(orgId), 'members'],
    queryFn: ({ signal }) =>
      api<{ members: { id: string; name: string; role: string }[] }>(`/orgs/${orgId}/accounting/staff-funds/members`, { signal }),
  });
  const issue = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/accounting/staff-funds`, {
        method: 'POST',
        headers: { 'Idempotency-Key': requestKey },
        body: { kind, membershipId, cashAccountId, amount: parseMoney(amount) ?? 0, purpose, dueDate: dueDate || null },
      }),
    onSuccess: () => {
      showToast(t('staffFunds.issued'));
      setAmount('');
      setPurpose('');
      setRequestKey(newRequestKey());
      onDone();
    },
  });
  return (
    <form
      className="card"
      aria-labelledby="issue-fund-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (!issue.isPending) issue.mutate();
      }}
    >
      <h2 id="issue-fund-title">{t('staffFunds.issue')}</h2>
      <div className="segmented" role="group" aria-label={t('staffFunds.kind')}>
        {(['advance', 'custody'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={k === kind ? 'segment segment--active' : 'segment'}
            aria-pressed={k === kind}
            onClick={() => setKind(k)}
          >
            {t(`staffFunds.kinds.${k}`)}
          </button>
        ))}
      </div>
      <p className="muted small">{t(`staffFunds.kindHint.${kind}`)}</p>
      <div className="form-grid">
        <Field id="fund-member" label={t('staffFunds.member')}>
          <select id="fund-member" required value={membershipId} onChange={(e) => setMembershipId(e.target.value)}>
            <option value="">{t('staffFunds.chooseMember')}</option>
            {(members.data?.members ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {t(`roles.${m.role}`, { defaultValue: m.role })}
              </option>
            ))}
          </select>
        </Field>
        <BoxSelect id="fund-box" value={cashAccountId} onChange={setCashAccountId} />
        <Field id="fund-amount" label={t('staffFunds.amount')}>
          <input id="fund-amount" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id="fund-purpose" label={t('staffFunds.purpose')}>
          <input id="fund-purpose" required minLength={3} maxLength={200} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </Field>
        <Field id="fund-due" label={t('staffFunds.dueDate')}>
          <input id="fund-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>
      {issue.isError && <Notice kind="error">{errorMessage(t, issue.error)}</Notice>}
      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={issue.isPending}>
          {t('staffFunds.issue')}
        </button>
      </div>
    </form>
  );
}

function FundActions({ fund, currency, onDone }: { fund: Fund; currency: string; onDone: () => void }) {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const money = useMoney();
  const [action, setAction] = useState<'return' | 'expenses' | 'write-off' | null>(null);
  const [cashAccountId, setCashAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState([{ accountId: '', amount: '', memo: '' }]);
  const expenseAccounts = useQuery({
    queryKey: accountingKeys.accounts(orgId),
    queryFn: ({ signal }) => api<{ accounts: LedgerAccount[] }>(`/orgs/${orgId}/accounting/accounts`, { signal }),
    enabled: action === 'expenses',
  });
  const run = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/accounting/staff-funds/${fund.id}/${action}`, {
        method: 'POST',
        body:
          action === 'return'
            ? { cashAccountId, amount: parseMoney(amount) ?? 0, version: fund.version }
            : action === 'expenses'
              ? { lines: lines.map((l) => ({ accountId: l.accountId, amount: parseMoney(l.amount) ?? 0, memo: l.memo })), version: fund.version }
              : { reason, version: fund.version },
      }),
    onSuccess: () => (showToast(t('staffFunds.saved')), setAction(null), onDone()),
  });
  const choices = [
    { key: 'return' as const, show: true },
    { key: 'expenses' as const, show: fund.kind === 'custody' },
    { key: 'write-off' as const, show: can('accounting.settings.manage') },
  ].filter((c) => c.show);
  return (
    <div className="stack">
      <div className="inline-form">
        {choices.map((c) => (
          <button
            key={c.key}
            type="button"
            className="button button--secondary"
            aria-expanded={action === c.key}
            onClick={() => setAction(action === c.key ? null : c.key)}
          >
            {t(`staffFunds.actions.${c.key}`)}
          </button>
        ))}
      </div>
      {action && (
        <form
          className="stack"
          aria-label={t(`staffFunds.actions.${action}`)}
          onSubmit={(e) => {
            e.preventDefault();
            if (!run.isPending) run.mutate();
          }}
        >
          {action === 'return' && (
            <div className="form-grid">
              <BoxSelect id={`ret-box-${fund.id}`} value={cashAccountId} onChange={setCashAccountId} />
              <Field
                id={`ret-amount-${fund.id}`}
                label={t('staffFunds.amount')}
                hint={t('staffFunds.upTo', { amount: money(fund.outstanding, currency) })}
              >
                <input id={`ret-amount-${fund.id}`} required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
            </div>
          )}
          {action === 'expenses' &&
            lines.map((l, i) => (
              <div key={i} className="form-grid">
                <Field id={`exp-acct-${fund.id}-${i}`} label={t('accounting.account')}>
                  <select
                    id={`exp-acct-${fund.id}-${i}`}
                    required
                    value={l.accountId}
                    onChange={(e) => setLines((cur) => cur.map((x, j) => (j === i ? { ...x, accountId: e.target.value } : x)))}
                  >
                    <option value="">{t('accounting.chooseAccount')}</option>
                    {(expenseAccounts.data?.accounts ?? [])
                      .filter((a) => a.type === 'expense' && !a.isGroup && a.status === 'active')
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {accountName(t, a)}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field id={`exp-amount-${fund.id}-${i}`} label={t('staffFunds.amount')}>
                  <input
                    id={`exp-amount-${fund.id}-${i}`}
                    required
                    inputMode="decimal"
                    value={l.amount}
                    onChange={(e) => setLines((cur) => cur.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                  />
                </Field>
                <Field id={`exp-memo-${fund.id}-${i}`} label={t('staffFunds.receipt')}>
                  <input
                    id={`exp-memo-${fund.id}-${i}`}
                    maxLength={200}
                    value={l.memo}
                    onChange={(e) => setLines((cur) => cur.map((x, j) => (j === i ? { ...x, memo: e.target.value } : x)))}
                  />
                </Field>
              </div>
            ))}
          {action === 'expenses' && (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setLines((cur) => [...cur, { accountId: '', amount: '', memo: '' }])}
            >
              {t('staffFunds.addReceipt')}
            </button>
          )}
          {action === 'write-off' && (
            <>
              <Notice kind="warning">{t('staffFunds.writeOffNotice', { amount: money(fund.outstanding, currency) })}</Notice>
              <Field id={`wo-reason-${fund.id}`} label={t('staffFunds.reason')}>
                <input
                  id={`wo-reason-${fund.id}`}
                  required
                  minLength={3}
                  maxLength={300}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
            </>
          )}
          {run.isError && <Notice kind="error">{errorMessage(t, run.error)}</Notice>}
          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={run.isPending}>
              {t('staffFunds.confirm')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function StaffFundsPage() {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const money = useMoney();
  const queryClient = useQueryClient();
  useDocumentTitle(t('staffFunds.title'));
  const [status, setStatus] = useState<'open' | 'settled'>('open');
  const list = useQuery({
    queryKey: [...fundsKey(orgId), status],
    queryFn: ({ signal }) =>
      api<{ currency: string; funds: Fund[]; totals: Record<Kind, number> }>(`/orgs/${orgId}/accounting/staff-funds?status=${status}`, { signal }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: accountingKeys.all(orgId) });
  const d = list.data;
  return (
    <>
      <PageHeader title={t('staffFunds.title')} subtitle={t('staffFunds.subtitle')} />
      <AccountingNav />
      <section className="card" aria-labelledby="funds-title">
        <div className="section-header">
          <h2 id="funds-title">{t('staffFunds.register')}</h2>
          <div className="segmented" role="group" aria-label={t('staffFunds.status')}>
            {(['open', 'settled'] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={s === status ? 'segment segment--active' : 'segment'}
                aria-pressed={s === status}
                onClick={() => setStatus(s)}
              >
                {t(`staffFunds.statuses.${s}`)}
              </button>
            ))}
          </div>
        </div>
        {d && status === 'open' && (
          <p className="muted" data-testid="staff-fund-totals">
            {t('staffFunds.totals', { advance: money(d.totals.advance, d.currency), custody: money(d.totals.custody, d.currency) })}
          </p>
        )}
        {list.isPending && <Loading />}
        {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => list.refetch()} />}
        {d && d.funds.length === 0 && <EmptyState icon="wallet">{t('staffFunds.none')}</EmptyState>}
        {d && d.funds.length > 0 && (
          <ul className="data-list" data-testid="staff-funds">
            {d.funds.map((f) => (
              <li key={f.id} className="data-row data-row--stack">
                <div className="data-main">
                  <h3>
                    {f.memberName} · <bdi dir="ltr">{f.number}</bdi>
                  </h3>
                  <p className="muted">
                    {t(`staffFunds.kinds.${f.kind}`)} · {f.purpose} · {t('staffFunds.issuedAmount', { amount: money(f.amount, d.currency) })}
                    {f.dueDate && ` · ${t('staffFunds.due', { date: f.dueDate })}`}
                  </p>
                  <p className="small">
                    {t('staffFunds.breakdown', {
                      returned: money(f.returned, d.currency),
                      expensed: money(f.expensed, d.currency),
                      writtenOff: money(f.writtenOff, d.currency),
                    })}
                  </p>
                </div>
                {f.overdue && <span className="badge badge--danger">{t('staffFunds.overdue')}</span>}
                <span className={f.status === 'open' ? 'badge badge--warning' : 'badge badge--success'}>
                  {f.status === 'open' ? t('staffFunds.outstanding', { amount: money(f.outstanding, d.currency) }) : t('staffFunds.statuses.settled')}
                </span>
                {f.status === 'open' && can('accounting.manage') && <FundActions fund={f} currency={d.currency} onDone={refresh} />}
              </li>
            ))}
          </ul>
        )}
      </section>
      {can('accounting.manage') && <IssueForm onDone={refresh} />}
    </>
  );
}
