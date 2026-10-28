import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import {
  accountName,
  accountingKeys,
  sourceLabel,
  type CashAccount,
  type CashSession,
  type CashVoucher,
  type LedgerAccount,
} from '../lib/accounting';
import { api } from '../lib/api';
import { newRequestKey } from '../lib/clinical';
import { errorMessage } from '../lib/errors';
import { parseMoney } from '../lib/finance';
import { useFormatters } from '../lib/format';
import { showToast } from '../lib/toast';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useOrg } from '../org/context';
import { useAccountingSettings, useMoney } from '../lib/useAccounting';
import { AccountingNav } from './AccountingPages';

// Cashboxes, bank accounts, cashier sessions, vouchers and bank reconciliation
// (docs/architecture/ACCOUNTING.md, "Cash and banks"). The API computes every expected amount.

type SessionWithName = CashSession & {
  openedByName: string | null;
  mine: boolean;
};
type Movement = {
  entryId: string;
  number: string;
  memo: string;
  sourceType: string;
  event: string;
  amount: number;
  at: string;
};

function useCashAccounts(enabled: boolean) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: [...accountingKeys.cash(orgId), 'accounts'],
    queryFn: ({ signal }) =>
      api<{ accounts: CashAccount[] }>(`/orgs/${orgId}/cash/accounts`, {
        signal,
      }),
    enabled,
  });
}

function useSessions(enabled: boolean) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: [...accountingKeys.cash(orgId), 'sessions'],
    queryFn: ({ signal }) =>
      api<{ sessions: SessionWithName[] }>(`/orgs/${orgId}/cash/sessions`, {
        signal,
      }),
    enabled,
  });
}

function MoneyInput({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const { t } = useTranslation();
  const invalid = value !== '' && parseMoney(value) === null;
  return (
    <Field id={id} label={label} hint={hint ?? t('finance.amountHint')} error={invalid ? t('finance.invalidAmount') : undefined}>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        required
        value={value}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function OpenSessionForm({ boxes }: { boxes: CashAccount[] }) {
  const { t } = useTranslation();
  const { orgId, branches } = useOrg();
  const queryClient = useQueryClient();
  const usable = boxes.filter((b) => b.kind === 'cash' && b.branchId && b.status === 'active');
  const [cashAccountId, setCashAccountId] = useState(usable[0]?.id ?? '');
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const open = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/cash/sessions`, {
        method: 'POST',
        body: { cashAccountId, openingCounted: parseMoney(counted), note },
      }),
    onSuccess: () => {
      showToast(t('cash.sessionOpened'));
      setCounted('');
      return queryClient.invalidateQueries({
        queryKey: accountingKeys.all(orgId),
      });
    },
  });
  if (usable.length === 0) return <p className="muted">{t('cash.noBranchCashbox')}</p>;
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        if (parseMoney(counted) !== null) open.mutate();
      }}
    >
      <Field id="session-box" label={t('cash.cashbox')}>
        <select id="session-box" value={cashAccountId} onChange={(e) => setCashAccountId(e.target.value)}>
          {usable.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} · {branchName.get(b.branchId ?? '') ?? ''}
            </option>
          ))}
        </select>
      </Field>
      <MoneyInput id="session-counted" label={t('cash.openingCounted')} value={counted} onChange={setCounted} />
      <Field id="session-note" label={t('cash.note')} hint={t('cash.noteHint')}>
        <input id="session-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {open.isError && <Notice kind="error">{errorMessage(t, open.error)}</Notice>}
      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={open.isPending}>
          {t('cash.openSession')}
        </button>
      </div>
    </form>
  );
}

function CloseSessionForm({ session, expected, currency }: { session: CashSession; expected: number; currency: string }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const money = useMoney();
  const queryClient = useQueryClient();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const value = parseMoney(counted);
  const close = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/cash/sessions/${session.id}/close`, {
        method: 'POST',
        body: { counted: value, note },
      }),
    onSuccess: () => {
      showToast(t('cash.sessionClosed'));
      return queryClient.invalidateQueries({
        queryKey: accountingKeys.all(orgId),
      });
    },
  });
  const difference = value === null ? null : value - expected;
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        if (value !== null) close.mutate();
      }}
    >
      <MoneyInput
        id={`close-${session.id}`}
        label={t('cash.closingCounted')}
        value={counted}
        onChange={setCounted}
        hint={t('cash.expectedNow', { amount: money(expected, currency) })}
      />
      <Field id={`close-note-${session.id}`} label={t('cash.note')} hint={difference ? t('cash.noteRequired') : t('cash.noteHint')}>
        <input
          id={`close-note-${session.id}`}
          required={Boolean(difference)}
          minLength={difference ? 3 : 0}
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      {difference !== null && difference !== 0 && (
        <Notice kind="warning">
          {difference > 0 ? t('cash.over', { amount: money(difference, currency) }) : t('cash.short', { amount: money(-difference, currency) })}
        </Notice>
      )}
      {close.isError && <Notice kind="error">{errorMessage(t, close.error)}</Notice>}
      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={close.isPending || value === null}>
          {t('cash.closeSession')}
        </button>
      </div>
    </form>
  );
}

function MySessionCard({ boxes, sessions, currency }: { boxes: CashAccount[]; sessions: SessionWithName[]; currency: string }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const fmt = useFormatters();
  const myUserOpen = sessions.filter((s) => s.status === 'open' && s.mine);
  return (
    <section className="card" aria-labelledby="my-session-title">
      <h2 id="my-session-title">{t('cash.mySession')}</h2>
      {myUserOpen.length === 0 ? (
        <>
          <p className="muted">{t('cash.noOpenSession')}</p>
          <OpenSessionForm boxes={boxes} />
        </>
      ) : (
        <ul className="data-list">
          {myUserOpen.map((s) => (
            <li key={s.id} className="data-row">
              <div className="data-main">
                <h3>
                  <Link to={`/app/${orgId}/cash/sessions/${s.id}`}>
                    <bdi dir="ltr">{s.number}</bdi>
                  </Link>
                </h3>
                <p className="muted">
                  {boxes.find((b) => b.id === s.cashAccountId)?.name} · {t('cash.openedAt', { at: fmt.date(s.openedAt) })}
                </p>
              </div>
              <span className="badge badge--active">{t('cash.status.open')}</span>
              <div className="row-actions">
                <Link className="button button--secondary" to={`/app/${orgId}/cash/sessions/${s.id}`}>
                  {t('cash.countAndClose')}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">
        {t('cash.currencyNote', {
          currency: t(`finance.currencies.${currency}`),
        })}
      </p>
    </section>
  );
}

function VoucherForm({ boxes, accounts }: { boxes: CashAccount[]; accounts: LedgerAccount[] }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const queryClient = useQueryClient();
  const active = boxes.filter((b) => b.status === 'active');
  const [type, setType] = useState<'in' | 'out' | 'transfer'>('out');
  const [cashAccountId, setCashAccountId] = useState(active[0]?.id ?? '');
  const [toCashAccountId, setTo] = useState('');
  const [counterAccountId, setCounter] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [reference, setReference] = useState('');
  const [key, setKey] = useState(newRequestKey);
  // Counter accounts: postable, not cash/bank (use a transfer) and not receivable/payable control accounts.
  const counters = accounts.filter(
    (a) =>
      !a.isGroup &&
      a.status === 'active' &&
      !a.role &&
      (type === 'out' ? ['expense', 'equity', 'liability'] : ['income', 'equity', 'liability']).includes(a.type),
  );
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/cash/vouchers`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body:
          type === 'transfer'
            ? {
                type,
                cashAccountId,
                toCashAccountId,
                amount: parseMoney(amount),
                memo,
                reference,
              }
            : {
                type,
                cashAccountId,
                counterAccountId,
                amount: parseMoney(amount),
                memo,
                reference,
              },
      }),
    onSuccess: () => {
      showToast(t('cash.voucherSaved'));
      setKey(newRequestKey());
      setAmount('');
      setMemo('');
      setReference('');
      return queryClient.invalidateQueries({
        queryKey: accountingKeys.all(orgId),
      });
    },
  });
  return (
    <form
      className="card"
      aria-labelledby="voucher-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (parseMoney(amount)) save.mutate();
      }}
    >
      <h2 id="voucher-title">{t('cash.newVoucher')}</h2>
      <div className="segmented" role="group" aria-label={t('cash.voucherType')}>
        {(['out', 'in', 'transfer'] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={type === v ? 'segment segment--active' : 'segment'}
            aria-pressed={type === v}
            onClick={() => (setType(v), setCounter(''))}
          >
            {t(`cash.voucherTypes.${v}`)}
          </button>
        ))}
      </div>
      <div className="form-grid">
        <Field id="voucher-from" label={type === 'in' ? t('cash.into') : t('cash.from')}>
          <select id="voucher-from" value={cashAccountId} onChange={(e) => setCashAccountId(e.target.value)}>
            {active.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        {type === 'transfer' ? (
          <Field id="voucher-to" label={t('cash.to')}>
            <select id="voucher-to" required value={toCashAccountId} onChange={(e) => setTo(e.target.value)}>
              <option value="">{t('common.choose')}</option>
              {active
                .filter((b) => b.id !== cashAccountId)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </Field>
        ) : (
          <Field id="voucher-counter" label={type === 'out' ? t('cash.expenseAccount') : t('cash.incomeAccount')}>
            <select id="voucher-counter" required value={counterAccountId} onChange={(e) => setCounter(e.target.value)}>
              <option value="">{t('common.choose')}</option>
              {counters.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {accountName(t, a)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <MoneyInput id="voucher-amount" label={t('cash.amount')} value={amount} onChange={setAmount} />
        <Field id="voucher-memo" label={t('cash.memo')}>
          <input id="voucher-memo" required minLength={3} maxLength={200} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </Field>
        <Field id="voucher-ref" label={t('cash.reference')}>
          <input id="voucher-ref" maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
      {save.isError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={save.isPending}>
          {t('cash.saveVoucher')}
        </button>
      </div>
    </form>
  );
}

function AddCashAccountForm() {
  const { t } = useTranslation();
  const { orgId, branches } = useOrg();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'cash' | 'bank'>('cash');
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const add = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/cash/accounts`, {
        method: 'POST',
        body: { name, kind, branchId: branchId || null },
      }),
    onSuccess: () => {
      showToast(t('cash.accountAdded'));
      setName('');
      return queryClient.invalidateQueries({
        queryKey: accountingKeys.all(orgId),
      });
    },
  });
  return (
    <form
      className="form-grid"
      aria-label={t('cash.addAccount')}
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <Field id="cash-account-name" label={t('cash.accountName')}>
        <input id="cash-account-name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="cash-account-kind" label={t('cash.kind')}>
        <select id="cash-account-kind" value={kind} onChange={(e) => setKind(e.target.value as 'cash' | 'bank')}>
          <option value="cash">{t('cash.kinds.cash')}</option>
          <option value="bank">{t('cash.kinds.bank')}</option>
        </select>
      </Field>
      <Field id="cash-account-branch" label={t('cash.branch')}>
        <select id="cash-account-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {kind === 'bank' && <option value="">{t('accounting.organizationLevel')}</option>}
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      {add.isError && <Notice kind="error">{errorMessage(t, add.error)}</Notice>}
      <div className="form-actions">
        <button type="submit" className="button button--secondary" disabled={add.isPending}>
          {t('cash.addAccount')}
        </button>
      </div>
    </form>
  );
}

export function CashPage() {
  const { t } = useTranslation();
  const { orgId, can, branches, detail } = useOrg();
  useDocumentTitle(t('cash.title'));
  const money = useMoney();
  const fmt = useFormatters();
  const settings = useAccountingSettings();
  const configured = settings.data?.configured === true;
  const boxes = useCashAccounts(configured);
  const sessions = useSessions(configured);
  const orgWide = detail.membership.branchScope.type === 'all';
  const ledger = useQuery({
    queryKey: accountingKeys.accounts(orgId),
    queryFn: ({ signal }) =>
      api<{ accounts: LedgerAccount[] }>(`/orgs/${orgId}/accounting/accounts`, {
        signal,
      }),
    enabled: configured && can('cash.voucher.create') && orgWide && can('accounting.read'),
  });
  const vouchers = useQuery({
    queryKey: [...accountingKeys.cash(orgId), 'vouchers'],
    queryFn: ({ signal }) =>
      api<{ vouchers: CashVoucher[] }>(`/orgs/${orgId}/cash/vouchers`, {
        signal,
      }),
    enabled: configured && can('cash.voucher.create'),
  });
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const currency = settings.data?.settings?.currency ?? '';
  if (settings.isPending) return <Loading />;
  if (settings.isError) return <ErrorState message={errorMessage(t, settings.error)} onRetry={() => settings.refetch()} />;
  return (
    <>
      <PageHeader title={t('cash.title')} subtitle={t('cash.subtitle')} />
      <AccountingNav />
      {!configured && (
        <EmptyState icon="cash">
          <p>{t('cash.notSetUp')}</p>
          {can('accounting.read') && <Link to={`/app/${orgId}/accounting`}>{t('accounting.goToSetup')}</Link>}
        </EmptyState>
      )}
      {boxes.isError && <ErrorState message={errorMessage(t, boxes.error)} onRetry={() => boxes.refetch()} />}
      {configured && boxes.isSuccess && sessions.isSuccess && (
        <div className="card-grid card-grid--wide">
          <MySessionCard boxes={boxes.data.accounts} sessions={sessions.data.sessions} currency={currency} />
          <section className="card" aria-labelledby="cash-accounts-title">
            <h2 id="cash-accounts-title">{t('cash.accounts')}</h2>
            {boxes.data.accounts.length === 0 ? (
              <EmptyState icon="cash">{t('cash.noAccounts')}</EmptyState>
            ) : (
              <ul className="data-list" data-testid="cash-accounts">
                {boxes.data.accounts.map((a) => (
                  <li key={a.id} className="data-row">
                    <div className="data-main">
                      <h3>{a.name}</h3>
                      <p className="muted">
                        {t(`cash.kinds.${a.kind}`)} · {a.branchId ? branchName.get(a.branchId) : t('accounting.organizationLevel')}
                      </p>
                    </div>
                    {a.balance !== undefined && <strong>{money(a.balance, currency)}</strong>}
                    <div className="row-actions">
                      {a.kind === 'bank' && can('accounting.manage') && orgWide && (
                        <Link className="button button--secondary" to={`/app/${orgId}/cash/accounts/${a.id}/statement`}>
                          {t('cash.reconcile')}
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {can('accounting.manage') && orgWide && <AddCashAccountForm />}
          </section>
        </div>
      )}
      {configured && can('cash.voucher.create') && boxes.isSuccess && ledger.isSuccess && (
        <VoucherForm boxes={boxes.data.accounts} accounts={ledger.data.accounts} />
      )}
      {configured && sessions.isSuccess && sessions.data.sessions.length > 0 && (
        <section className="card" aria-labelledby="sessions-title">
          <h2 id="sessions-title">{can('cash.session.review') ? t('cash.allSessions') : t('cash.mySessions')}</h2>
          <div className="table-wrap">
            <table className="data-table" data-testid="cash-sessions">
              <thead>
                <tr>
                  <th scope="col">{t('cash.session')}</th>
                  <th scope="col">{t('cash.cashier')}</th>
                  <th scope="col">{t('cash.opened')}</th>
                  <th scope="col">{t('cash.statusLabel')}</th>
                  <th scope="col">{t('cash.difference')}</th>
                </tr>
              </thead>
              <tbody>
                {sessions.data.sessions.map((s) => (
                  <tr key={s.id}>
                    <td data-label={t('cash.session')}>
                      <Link to={`/app/${orgId}/cash/sessions/${s.id}`}>
                        <bdi dir="ltr">{s.number}</bdi>
                      </Link>
                    </td>
                    <td data-label={t('cash.cashier')}>{s.openedByName ?? '—'}</td>
                    <td data-label={t('cash.opened')}>{fmt.date(s.openedAt)}</td>
                    <td data-label={t('cash.statusLabel')}>
                      <span className={s.status === 'open' ? 'badge badge--active' : 'badge'}>{t(`cash.status.${s.status}`)}</span>
                    </td>
                    <td data-label={t('cash.difference')}>{s.difference === null ? '' : money(s.difference, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {vouchers.isSuccess && vouchers.data.vouchers.length > 0 && (
        <section className="card" aria-labelledby="vouchers-title">
          <h2 id="vouchers-title">{t('cash.recentVouchers')}</h2>
          <ul className="data-list">
            {vouchers.data.vouchers.map((v) => (
              <li key={v.id} className="data-row">
                <div className="data-main">
                  <h3>
                    <Link to={`/app/${orgId}/accounting/entries/${v.entryId}`}>
                      <bdi dir="ltr">{v.number}</bdi>
                    </Link>{' '}
                    {t(`cash.voucherTypes.${v.type}`)}
                  </h3>
                  <p className="muted">
                    <bdi dir="auto">{v.memo}</bdi> · <bdi dir="ltr">{v.date}</bdi>
                  </p>
                </div>
                <strong>{money(v.amount, currency)}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function CashSessionPage() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const { sessionId = '' } = useParams();
  const money = useMoney();
  const fmt = useFormatters();
  const settings = useAccountingSettings();
  const data = useQuery({
    queryKey: accountingKeys.cashSession(orgId, sessionId),
    queryFn: ({ signal }) =>
      api<{
        session: SessionWithName;
        cashAccount: CashAccount;
        movements: Movement[];
        expectedNow: number;
      }>(`/orgs/${orgId}/cash/sessions/${sessionId}`, { signal }),
  });
  useDocumentTitle(data.data ? data.data.session.number : t('cash.session'));
  if (data.isPending) return <Loading />;
  if (data.isError) return <ErrorState message={errorMessage(t, data.error)} onRetry={() => data.refetch()} />;
  const { session: s, cashAccount, movements, expectedNow } = data.data;
  const currency = settings.data?.settings?.currency ?? '';
  const canClose = s.status === 'open';
  return (
    <>
      <PageHeader title={t('cash.sessionTitle', { number: s.number })} subtitle={cashAccount.name}>
        <Link className="button button--secondary" to={`/app/${orgId}/cash`}>
          {t('cash.backToCash')}
        </Link>
      </PageHeader>
      <AccountingNav />
      <div className="card-grid card-grid--wide">
        <section className="card" aria-labelledby="session-summary-title">
          <h2 id="session-summary-title">{t('cash.summary')}</h2>
          <dl className="details">
            <dt>{t('cash.cashier')}</dt>
            <dd>{s.openedByName ?? '—'}</dd>
            <dt>{t('cash.opened')}</dt>
            <dd>{fmt.date(s.openedAt)}</dd>
            <dt>{t('cash.openingCounted')}</dt>
            <dd>{money(s.openingCounted, currency)}</dd>
            {s.openingCounted !== s.openingExpected && (
              <>
                <dt>{t('cash.openingExpected')}</dt>
                <dd>{money(s.openingExpected, currency)}</dd>
              </>
            )}
            <dt>{s.status === 'open' ? t('cash.expectedNowLabel') : t('cash.closingExpected')}</dt>
            <dd data-testid="session-expected">{money(s.status === 'open' ? expectedNow : s.closingExpected, currency)}</dd>
            {s.status === 'closed' && (
              <>
                <dt>{t('cash.closingCounted')}</dt>
                <dd>{money(s.closingCounted, currency)}</dd>
                <dt>{t('cash.difference')}</dt>
                <dd>{money(s.difference, currency)}</dd>
              </>
            )}
            {s.note && (
              <>
                <dt>{t('cash.note')}</dt>
                <dd>
                  <bdi dir="auto">{s.note}</bdi>
                </dd>
              </>
            )}
          </dl>
        </section>
        {canClose && (
          <section className="card" aria-labelledby="close-title">
            <h2 id="close-title">{t('cash.closeTitle')}</h2>
            <p className="muted">{s.mine ? t('cash.closeIntro') : t('cash.closeAsReviewer')}</p>
            <CloseSessionForm session={s} expected={expectedNow} currency={currency} />
          </section>
        )}
      </div>
      <section className="card" aria-labelledby="movements-title">
        <h2 id="movements-title">{t('cash.movements')}</h2>
        {movements.length === 0 ? (
          <EmptyState icon="cash">{t('cash.noMovements')}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data-table" data-testid="session-movements">
              <thead>
                <tr>
                  <th scope="col">{t('accounting.number')}</th>
                  <th scope="col">{t('accounting.event')}</th>
                  <th scope="col">{t('cash.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.entryId}>
                    <td data-label={t('accounting.number')}>
                      <bdi dir="ltr">{m.number}</bdi>
                    </td>
                    <td data-label={t('accounting.event')}>
                      {sourceLabel(t, { type: m.sourceType, event: m.event })} <bdi dir="ltr">{m.memo}</bdi>
                    </td>
                    <td data-label={t('cash.amount')}>{money(m.amount, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

type Statement = {
  account: CashAccount;
  lines: {
    id: string;
    date: string;
    amount: number;
    description: string;
    reference: string;
    status: 'unmatched' | 'matched';
    entryId: string | null;
  }[];
  unmatchedEntries: {
    entryId: string;
    number: string;
    date: string;
    memo: string;
    amount: number;
  }[];
};

export function BankStatementPage() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const { cashAccountId = '' } = useParams();
  const money = useMoney();
  const queryClient = useQueryClient();
  const settings = useAccountingSettings();
  const currency = settings.data?.settings?.currency ?? '';
  const data = useQuery({
    queryKey: accountingKeys.statement(orgId, cashAccountId),
    queryFn: ({ signal }) => api<Statement>(`/orgs/${orgId}/cash/accounts/${cashAccountId}/statement`, { signal }),
  });
  useDocumentTitle(t('cash.statementTitle'));
  const [csv, setCsv] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: accountingKeys.all(orgId) });
  const importLines = useMutation({
    mutationFn: () => api<{ imported: number }>(`/orgs/${orgId}/cash/accounts/${cashAccountId}/statement`, { method: 'POST', body: { csv } }),
    onSuccess: (r) => (showToast(t('cash.imported', { count: r.imported })), setCsv(''), refresh()),
  });
  const match = useMutation({
    mutationFn: ({ lineId, entryId }: { lineId: string; entryId: string }) =>
      api(`/orgs/${orgId}/cash/statement-lines/${lineId}/match`, {
        method: 'POST',
        body: { entryId },
      }),
    onSuccess: refresh,
    onError: (err) => showToast(errorMessage(t, err)),
  });
  const unmatch = useMutation({
    mutationFn: (lineId: string) =>
      api(`/orgs/${orgId}/cash/statement-lines/${lineId}/unmatch`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: refresh,
  });
  if (data.isPending) return <Loading />;
  if (data.isError) return <ErrorState message={errorMessage(t, data.error)} onRetry={() => data.refetch()} />;
  const st = data.data;
  return (
    <>
      <PageHeader title={t('cash.statementTitle')} subtitle={st.account.name}>
        <Link className="button button--secondary" to={`/app/${orgId}/cash`}>
          {t('cash.backToCash')}
        </Link>
      </PageHeader>
      <AccountingNav />
      <Notice kind="info">{t('cash.noBankConnection')}</Notice>
      <form
        className="card"
        aria-labelledby="import-title"
        onSubmit={(e) => {
          e.preventDefault();
          importLines.mutate();
        }}
      >
        <h2 id="import-title">{t('cash.importTitle')}</h2>
        <Field id="statement-csv" label={t('cash.csvLabel')} hint={t('cash.csvHint')}>
          <textarea id="statement-csv" rows={5} dir="ltr" required value={csv} onChange={(e) => setCsv(e.target.value)} />
        </Field>
        {importLines.isError && <Notice kind="error">{errorMessage(t, importLines.error)}</Notice>}
        <div className="form-actions">
          <button type="submit" className="button button--primary" disabled={importLines.isPending}>
            {t('cash.import')}
          </button>
        </div>
      </form>
      <section className="card" aria-labelledby="lines-title">
        <h2 id="lines-title">{t('cash.statementLines')}</h2>
        <p>
          {t('cash.ledgerBalance', {
            amount: money(st.account.balance ?? 0, currency),
          })}
        </p>
        {st.lines.length === 0 ? (
          <EmptyState icon="inbox">{t('cash.noLines')}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data-table" data-testid="statement-lines">
              <thead>
                <tr>
                  <th scope="col">{t('accounting.date')}</th>
                  <th scope="col">{t('cash.description')}</th>
                  <th scope="col">{t('cash.amount')}</th>
                  <th scope="col">{t('cash.match')}</th>
                </tr>
              </thead>
              <tbody>
                {st.lines.map((l) => {
                  const candidates = st.unmatchedEntries.filter((e) => e.amount === l.amount);
                  return (
                    <tr key={l.id}>
                      <td data-label={t('accounting.date')}>
                        <bdi dir="ltr">{l.date}</bdi>
                      </td>
                      <td data-label={t('cash.description')}>
                        <bdi dir="auto">{l.description}</bdi> {l.reference && <bdi dir="ltr">{l.reference}</bdi>}
                      </td>
                      <td data-label={t('cash.amount')}>{money(l.amount, currency)}</td>
                      <td data-label={t('cash.match')}>
                        {l.status === 'matched' ? (
                          <>
                            <span className="badge badge--active">{t('cash.matched')}</span>{' '}
                            <button type="button" className="button button--ghost" onClick={() => unmatch.mutate(l.id)}>
                              {t('cash.unmatch')}
                            </button>
                          </>
                        ) : candidates.length === 0 ? (
                          <span className="muted">{t('cash.noCandidate')}</span>
                        ) : (
                          <select
                            aria-label={t('cash.matchWith', { date: l.date })}
                            defaultValue=""
                            onChange={(e) =>
                              e.target.value &&
                              match.mutate({
                                lineId: l.id,
                                entryId: e.target.value,
                              })
                            }
                          >
                            <option value="">{t('cash.chooseEntry')}</option>
                            {candidates.map((c) => (
                              <option key={c.entryId} value={c.entryId}>
                                {c.number} · {c.date} · {c.memo}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
