import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import type { CashAccount } from '../lib/accounting';
import { api } from '../lib/api';
import { newRequestKey } from '../lib/clinical';
import { errorMessage } from '../lib/errors';
import { formatMoney, moneyInput, parseMoney } from '../lib/finance';
import { showToast } from '../lib/toast';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { orgKeys, useOrg } from '../org/context';

// Practitioner compensation (docs/architecture/COMPENSATION.md): agreements, settlements computed
// from real work, approval (frozen) and payment. Not payroll.

type Agreement = {
  id: string;
  practitionerId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  basis: 'performed' | 'invoiced' | 'collected';
  percentBp: number;
  fixedPerUnit: number;
  discountsReduceBase: boolean;
  creditsReduceBase: boolean;
  note: string;
};
type Settlement = {
  id: string;
  number: string;
  practitionerId: string;
  periodFrom: string;
  periodTo: string;
  status: 'draft' | 'approved' | 'paid' | 'cancelled';
  lines: { sourceKey: string; sourceType: string; date: string; description: string; qty: number; base: number; amount: number }[];
  adjustments: { amount: number; reason: string; at: string }[];
  computed: number;
  total: number;
  paid: number;
  remaining: number;
  version: number;
};
const keys = {
  all: (orgId: string) => ['org', orgId, 'compensation'] as const,
  agreements: (orgId: string) => ['org', orgId, 'compensation', 'agreements'] as const,
  settlements: (orgId: string) => ['org', orgId, 'compensation', 'settlements'] as const,
  settlement: (orgId: string, id: string) => ['org', orgId, 'compensation', 'settlement', id] as const,
  mine: (orgId: string) => ['org', orgId, 'compensation', 'mine'] as const,
};

function useMoneyFmt() {
  const { i18n } = useTranslation();
  const { orgId } = useOrg();
  const settings = useQuery({
    queryKey: orgKeys.financeSettings(orgId),
    queryFn: ({ signal }) => api<{ currency: string | null }>(`/orgs/${orgId}/finance/settings`, { signal }),
  });
  const currency = settings.data?.currency;
  return (minor: number) => (currency ? formatMoney(minor, currency, i18n.language) : String(minor));
}
function usePractitioners(enabled: boolean) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ['org', orgId, 'compensation', 'practitioners'],
    queryFn: ({ signal }) =>
      api<{ practitioners: { id: string; displayName: string }[] }>(`/orgs/${orgId}/compensation/practitioners`, { signal }).then(
        (r) => r.practitioners,
      ),
    enabled,
  });
}
const statusClass = (s: string) =>
  s === 'paid' ? 'badge badge--active' : s === 'approved' ? 'badge badge--active' : s === 'draft' ? 'badge badge--inactive' : 'badge';

function MyStatements() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const money = useMoneyFmt();
  const mine = useQuery({
    queryKey: keys.mine(orgId),
    queryFn: ({ signal }) => api<{ settlements: Settlement[] }>(`/orgs/${orgId}/compensation/my-settlements`, { signal }).then((r) => r.settlements),
  });
  return (
    <section className="card" aria-labelledby="my-fees-title">
      <h2 id="my-fees-title">{t('compensation.myStatements')}</h2>
      {mine.isPending && <Loading />}
      {mine.isSuccess && mine.data.length === 0 && <EmptyState icon="wallet">{t('compensation.noStatements')}</EmptyState>}
      {mine.isSuccess && mine.data.length > 0 && (
        <ul className="data-list" data-testid="my-settlements">
          {mine.data.map((s) => (
            <li key={s.id} className="data-row">
              <div className="data-main">
                <h3>
                  <bdi dir="ltr">{s.number}</bdi> ·{' '}
                  <bdi dir="ltr">
                    {s.periodFrom} → {s.periodTo}
                  </bdi>
                </h3>
                <p className="muted">
                  {t('compensation.totalPaid', { total: money(s.total), paid: money(s.paid) })} · {t('compensation.items', { count: s.lines.length })}
                </p>
              </div>
              <span className={statusClass(s.status)}>{t(`compensation.status.${s.status}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CompensationPage() {
  const { t } = useTranslation();
  const { orgId, can, detail } = useOrg();
  useDocumentTitle(t('compensation.title'));
  const money = useMoneyFmt();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const finance = can('compensation.read') && detail.membership.branchScope.type === 'all';
  const practitioners = usePractitioners(finance);
  const agreements = useQuery({
    queryKey: keys.agreements(orgId),
    queryFn: ({ signal }) => api<{ agreements: Agreement[] }>(`/orgs/${orgId}/compensation/agreements`, { signal }).then((r) => r.agreements),
    enabled: finance,
  });
  const settlements = useQuery({
    queryKey: keys.settlements(orgId),
    queryFn: ({ signal }) => api<{ settlements: Settlement[] }>(`/orgs/${orgId}/compensation/settlements`, { signal }).then((r) => r.settlements),
    enabled: finance,
  });
  const name = (id: string) => practitioners.data?.find((p) => p.id === id)?.displayName ?? '';
  const [pid, setPid] = useState('');
  const [from, setFrom] = useState('');
  const [basis, setBasis] = useState<Agreement['basis']>('performed');
  const [percent, setPercent] = useState('');
  const [fixed, setFixed] = useState('');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const addAgreement = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/compensation/agreements`, {
        method: 'POST',
        body: {
          practitionerId: pid,
          effectiveFrom: from,
          basis,
          percentBp: Math.round(Number(percent || 0) * 100),
          fixedPerUnit: fixed ? (parseMoney(fixed) ?? 0) : 0,
        },
      }),
    onSuccess: () => (showToast(t('compensation.agreementSaved')), queryClient.invalidateQueries({ queryKey: keys.all(orgId) })),
  });
  const draft = useMutation({
    mutationFn: () =>
      api<{ settlement: Settlement }>(`/orgs/${orgId}/compensation/settlements`, {
        method: 'POST',
        body: { practitionerId: pid, from: periodFrom, to: periodTo },
      }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: keys.all(orgId) });
      void navigate(`/app/${orgId}/compensation/settlements/${r.settlement.id}`);
    },
  });
  return (
    <>
      <PageHeader title={t('compensation.title')} subtitle={t('compensation.subtitle')} />
      <Notice kind="info">{t('compensation.notPayroll')}</Notice>
      {can('compensation.own.read') && <MyStatements />}
      {finance && (
        <>
          <section className="card" aria-labelledby="agreements-title">
            <h2 id="agreements-title">{t('compensation.agreements')}</h2>
            {agreements.isSuccess && agreements.data.length === 0 && <EmptyState icon="file">{t('compensation.noAgreements')}</EmptyState>}
            {agreements.isSuccess && agreements.data.length > 0 && (
              <ul className="data-list" data-testid="agreements">
                {agreements.data.map((a) => (
                  <li key={a.id} className="data-row">
                    <div className="data-main">
                      <h3>{name(a.practitionerId)}</h3>
                      <p className="muted">
                        {t(`compensation.bases.${a.basis}`)} · {t('compensation.terms', { percent: a.percentBp / 100, fixed: money(a.fixedPerUnit) })}{' '}
                        ·{' '}
                        <bdi dir="ltr">
                          {a.effectiveFrom} → {a.effectiveTo ?? '…'}
                        </bdi>
                      </p>
                    </div>
                    <span className={a.effectiveTo ? 'badge' : 'badge badge--active'}>
                      {a.effectiveTo ? t('compensation.ended') : t('compensation.current')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {can('compensation.manage') && (
            <div className="card-grid card-grid--wide">
              <form
                className="card"
                aria-labelledby="new-agreement-title"
                onSubmit={(e) => {
                  e.preventDefault();
                  addAgreement.mutate();
                }}
              >
                <h2 id="new-agreement-title">{t('compensation.newAgreement')}</h2>
                <p className="muted small">{t('compensation.agreementHint')}</p>
                <div className="form-grid">
                  <Field id="ag-practitioner" label={t('compensation.practitioner')}>
                    <select id="ag-practitioner" required value={pid} onChange={(e) => setPid(e.target.value)}>
                      <option value="">{t('common.choose')}</option>
                      {(practitioners.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.displayName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="ag-from" label={t('compensation.effectiveFrom')}>
                    <input id="ag-from" type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
                  </Field>
                  <Field id="ag-basis" label={t('compensation.basis')}>
                    <select id="ag-basis" value={basis} onChange={(e) => setBasis(e.target.value as Agreement['basis'])}>
                      {(['performed', 'invoiced', 'collected'] as const).map((b) => (
                        <option key={b} value={b}>
                          {t(`compensation.bases.${b}`)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="ag-percent" label={t('compensation.percent')}>
                    <input id="ag-percent" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
                  </Field>
                  {basis !== 'collected' && (
                    <Field id="ag-fixed" label={t('compensation.fixedPerUnit')}>
                      <input id="ag-fixed" inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} />
                    </Field>
                  )}
                </div>
                {addAgreement.isError && <Notice kind="error">{errorMessage(t, addAgreement.error)}</Notice>}
                <div className="form-actions">
                  <button type="submit" className="button button--primary" disabled={addAgreement.isPending || !pid || !from}>
                    {t('compensation.saveAgreement')}
                  </button>
                </div>
              </form>
              <form
                className="card"
                aria-labelledby="new-settlement-title"
                onSubmit={(e) => {
                  e.preventDefault();
                  draft.mutate();
                }}
              >
                <h2 id="new-settlement-title">{t('compensation.newSettlement')}</h2>
                <p className="muted small">{t('compensation.settlementHint')}</p>
                <div className="form-grid">
                  <Field id="st-practitioner" label={t('compensation.practitioner')}>
                    <select id="st-practitioner" required value={pid} onChange={(e) => setPid(e.target.value)}>
                      <option value="">{t('common.choose')}</option>
                      {(practitioners.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.displayName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="st-from" label={t('compensation.from')}>
                    <input id="st-from" type="date" required value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
                  </Field>
                  <Field id="st-to" label={t('compensation.to')}>
                    <input id="st-to" type="date" required value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
                  </Field>
                </div>
                {draft.isError && <Notice kind="error">{errorMessage(t, draft.error)}</Notice>}
                <div className="form-actions">
                  <button type="submit" className="button button--primary" disabled={draft.isPending}>
                    {t('compensation.compute')}
                  </button>
                </div>
              </form>
            </div>
          )}
          <section className="card" aria-labelledby="settlements-title">
            <h2 id="settlements-title">{t('compensation.settlements')}</h2>
            {settlements.isError && <ErrorState message={errorMessage(t, settlements.error)} onRetry={() => settlements.refetch()} />}
            {settlements.isSuccess && settlements.data.length === 0 && <EmptyState icon="wallet">{t('compensation.noSettlements')}</EmptyState>}
            {settlements.isSuccess && settlements.data.length > 0 && (
              <ul className="data-list" data-testid="settlements">
                {settlements.data.map((s) => (
                  <li key={s.id} className="data-row">
                    <div className="data-main">
                      <h3>
                        <Link to={`/app/${orgId}/compensation/settlements/${s.id}`}>
                          <bdi dir="ltr">{s.number}</bdi>
                        </Link>{' '}
                        · {name(s.practitionerId)}
                      </h3>
                      <p className="muted">
                        <bdi dir="ltr">
                          {s.periodFrom} → {s.periodTo}
                        </bdi>{' '}
                        · {t('compensation.totalPaid', { total: money(s.total), paid: money(s.paid) })}
                      </p>
                    </div>
                    <span className={statusClass(s.status)}>{t(`compensation.status.${s.status}`)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}

export function SettlementPage() {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const { settlementId = '' } = useParams();
  const money = useMoneyFmt();
  const queryClient = useQueryClient();
  const view = useQuery({
    queryKey: keys.settlement(orgId, settlementId),
    queryFn: ({ signal }) =>
      api<{ settlement: Settlement }>(`/orgs/${orgId}/compensation/settlements/${settlementId}`, { signal }).then((r) => r.settlement),
  });
  const boxes = useQuery({
    queryKey: ['org', orgId, 'accounting', 'cash', 'accounts'],
    queryFn: ({ signal }) => api<{ accounts: CashAccount[] }>(`/orgs/${orgId}/cash/accounts`, { signal }).then((r) => r.accounts),
    enabled: can('compensation.pay'),
  });
  useDocumentTitle(view.data ? view.data.number : t('compensation.settlement'));
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [box, setBox] = useState('');
  const [payAmount, setPayAmount] = useState<string | null>(null);
  const [key, setKey] = useState(newRequestKey);
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.all(orgId) });
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body: object }) =>
      api(`/orgs/${orgId}/compensation/settlements/${settlementId}/${path}`, { method: 'POST', body }),
    onSuccess: refresh,
  });
  const pay = useMutation({
    mutationFn: (amount: number) =>
      api(`/orgs/${orgId}/compensation/settlements/${settlementId}/payments`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: { cashAccountId: box, amount },
      }),
    onSuccess: () => (showToast(t('compensation.paid')), setKey(newRequestKey()), setPayAmount(null), refresh()),
  });
  if (view.isPending) return <Loading />;
  if (view.isError) return <ErrorState message={errorMessage(t, view.error)} onRetry={() => view.refetch()} />;
  const s = view.data;
  const negative = adjAmount.trim().startsWith('-');
  const adj = parseMoney(adjAmount.replace(/^-/, ''));
  const payValue = parseMoney(payAmount ?? moneyInput(s.remaining));
  return (
    <>
      <PageHeader title={t('compensation.settlementTitle', { number: s.number })} subtitle={`${s.periodFrom} → ${s.periodTo}`}>
        <Link className="button button--secondary" to={`/app/${orgId}/compensation`}>
          {t('compensation.back')}
        </Link>
      </PageHeader>
      <section className="card" aria-labelledby="settlement-lines-title">
        <div className="section-header">
          <h2 id="settlement-lines-title">{t('compensation.lines')}</h2>
          <span className={statusClass(s.status)}>{t(`compensation.status.${s.status}`)}</span>
        </div>
        {s.lines.length === 0 ? (
          <EmptyState icon="inbox">{t('compensation.noLines')}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data-table" data-testid="settlement-lines">
              <thead>
                <tr>
                  <th scope="col">{t('compensation.date')}</th>
                  <th scope="col">{t('compensation.item')}</th>
                  <th scope="col">{t('compensation.base')}</th>
                  <th scope="col">{t('compensation.fee')}</th>
                </tr>
              </thead>
              <tbody>
                {s.lines.map((l) => (
                  <tr key={l.sourceKey}>
                    <td data-label={t('compensation.date')}>
                      <bdi dir="ltr">{l.date}</bdi>
                    </td>
                    <td data-label={t('compensation.item')}>
                      {t(`compensation.sources.${l.sourceType}`)} · <bdi dir="auto">{l.description}</bdi>
                    </td>
                    <td data-label={t('compensation.base')}>{money(l.base)}</td>
                    <td data-label={t('compensation.fee')}>{money(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <dl className="details">
          <dt>{t('compensation.computed')}</dt>
          <dd>{money(s.computed)}</dd>
          {s.adjustments.map((a, i) => (
            <Fragment key={i}>
              <dt>
                {t('compensation.adjustment')} · <bdi dir="auto">{a.reason}</bdi>
              </dt>
              <dd>{money(a.amount)}</dd>
            </Fragment>
          ))}
          <dt>{t('compensation.total')}</dt>
          <dd data-testid="settlement-total">{money(s.total)}</dd>
          {s.status !== 'draft' && (
            <>
              <dt>{t('compensation.paidLabel')}</dt>
              <dd>{money(s.paid)}</dd>
            </>
          )}
        </dl>
        {s.status === 'draft' && <Notice kind="info">{t('compensation.draftNote')}</Notice>}
        {act.isError && <Notice kind="error">{errorMessage(t, act.error)}</Notice>}
        {s.status === 'draft' && (
          <div className="inline-form">
            {can('compensation.manage') && (
              <button
                type="button"
                className="button button--secondary"
                disabled={act.isPending}
                onClick={() => act.mutate({ path: 'recompute', body: {} })}
              >
                {t('compensation.recompute')}
              </button>
            )}
            {can('compensation.approve') && (
              <button
                type="button"
                className="button button--primary"
                disabled={act.isPending}
                onClick={() => act.mutate({ path: 'approve', body: { version: s.version } })}
              >
                {t('compensation.approve')}
              </button>
            )}
            {can('compensation.manage') && (
              <button
                type="button"
                className="button button--ghost"
                disabled={act.isPending}
                onClick={() => act.mutate({ path: 'cancel', body: {} })}
              >
                {t('compensation.cancel')}
              </button>
            )}
          </div>
        )}
      </section>
      {s.status === 'draft' && can('compensation.manage') && (
        <form
          className="card"
          aria-labelledby="adjust-title"
          onSubmit={(e) => {
            e.preventDefault();
            if (adj) act.mutate({ path: 'adjustments', body: { amount: negative ? -adj : adj, reason: adjReason, version: s.version } });
          }}
        >
          <h2 id="adjust-title">{t('compensation.addAdjustment')}</h2>
          <div className="form-grid">
            <Field id="adj-amount" label={t('compensation.amount')} hint={t('compensation.adjustmentHint')}>
              <input id="adj-amount" inputMode="decimal" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} />
            </Field>
            <Field id="adj-reason" label={t('compensation.reason')}>
              <input id="adj-reason" required minLength={3} maxLength={300} value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
            </Field>
          </div>
          <div className="form-actions">
            <button type="submit" className="button button--secondary" disabled={act.isPending || !adj}>
              {t('compensation.addAdjustment')}
            </button>
          </div>
        </form>
      )}
      {s.status === 'approved' && s.remaining > 0 && can('compensation.pay') && (
        <form
          className="card"
          aria-labelledby="pay-fee-title"
          onSubmit={(e) => {
            e.preventDefault();
            if (payValue && box) pay.mutate(payValue);
          }}
        >
          <h2 id="pay-fee-title">{t('compensation.pay')}</h2>
          <div className="form-grid">
            <Field id="fee-box" label={t('compensation.payFrom')}>
              <select id="fee-box" required value={box} onChange={(e) => setBox(e.target.value)}>
                <option value="">{t('common.choose')}</option>
                {(boxes.data ?? [])
                  .filter((b) => b.status === 'active')
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field id="fee-amount" label={t('compensation.amount')}>
              <input
                id="fee-amount"
                inputMode="decimal"
                value={payAmount ?? moneyInput(s.remaining)}
                onChange={(e) => setPayAmount(e.target.value)}
              />
            </Field>
          </div>
          {pay.isError && <Notice kind="error">{errorMessage(t, pay.error)}</Notice>}
          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={pay.isPending}>
              {t('compensation.pay')}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
