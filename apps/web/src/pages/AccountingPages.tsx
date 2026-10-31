import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { Metric } from '../components/Metric';
import { ModuleTabs } from '../components/layout';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import {
  ACCOUNT_TYPES,
  accountName,
  accountingKeys,
  sourceLabel,
  type AccountType,
  type JournalEntry,
  type LedgerAccount,
  type SettingsResponse,
} from '../lib/accounting';
import { api, query } from '../lib/api';
import { newRequestKey } from '../lib/clinical';
import { errorMessage } from '../lib/errors';
import { parseMoney } from '../lib/finance';
import { useFormatters } from '../lib/format';
import { showToast } from '../lib/toast';
import type { Page } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useOrg } from '../org/context';
import { csvMoney, downloadCsv } from '../lib/csv';
import { useAccountingSettings, useMoney } from '../lib/useAccounting';
import { DateText, Pagination } from '../components/data';
import { pageParam, useUrlState } from '../lib/useUrlState';

// General ledger (docs/architecture/ACCOUNTING.md): setup, journal, chart of accounts, statements
// and month closing. The chart is an implementation template pending the clinic accountant's review.

function useAccounts(enabled = true) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: accountingKeys.accounts(orgId),
    queryFn: ({ signal }) =>
      api<{ accounts: LedgerAccount[] }>(`/orgs/${orgId}/accounting/accounts`, {
        signal,
      }),
    enabled,
  });
}

/** Sub-navigation shared by the accounting and cash pages (permission-filtered). */
export function AccountingNav() {
  const { t } = useTranslation();
  const { orgId, can, detail, moduleOn } = useOrg();
  const orgWide = detail.membership.branchScope.type === 'all';
  const items = [
    ...(can('accounting.read')
      ? [
          {
            to: `/app/${orgId}/accounting`,
            label: t('accounting.nav.overview'),
            end: true,
          },
        ]
      : []),
    ...(can('accounting.read') && orgWide
      ? [
          {
            to: `/app/${orgId}/accounting/entries`,
            label: t('accounting.nav.journal'),
          },
          {
            to: `/app/${orgId}/accounting/accounts`,
            label: t('accounting.nav.chart'),
          },
          {
            to: `/app/${orgId}/accounting/reports`,
            label: t('accounting.nav.reports'),
          },
          { to: `/app/${orgId}/accounting/cash-flow`, label: t('accounting.nav.cashFlow') },
          { to: `/app/${orgId}/accounting/budgets`, label: t('accounting.nav.budgets') },
          { to: `/app/${orgId}/accounting/commitments`, label: t('accounting.nav.commitments') },
          { to: `/app/${orgId}/accounting/staff-funds`, label: t('accounting.nav.staffFunds') },
        ]
      : []),
    ...(can('accounting.read')
      ? [
          {
            to: `/app/${orgId}/accounting/periods`,
            label: t('accounting.nav.periods'),
          },
        ]
      : []),
    ...(can('cash.session.operate') && moduleOn('cash') ? [{ to: `/app/${orgId}/cash`, label: t('accounting.nav.cash') }] : []),
  ];
  return <ModuleTabs items={items} label={t('accounting.nav.label')} />;
}

/** Shown instead of a ledger page until accounting is set up. */
function NotSetUp() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  return (
    <EmptyState icon="book">
      <p>{t('accounting.notSetUp')}</p>
      <Link to={`/app/${orgId}/accounting`}>{t('accounting.goToSetup')}</Link>
    </EmptyState>
  );
}

function SetupCard({ data }: { data: SettingsResponse }) {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const queryClient = useQueryClient();
  const [cutoverDate, setCutoverDate] = useState(() => (data.today ? `${data.today.slice(0, 7)}-01` : ''));
  const [requireCashSession, setRequireCashSession] = useState(false);
  const setup = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/accounting/setup`, {
        method: 'POST',
        body: { cutoverDate, requireCashSession },
      }),
    onSuccess: () => {
      showToast(t('accounting.setupDone'));
      return queryClient.invalidateQueries({
        queryKey: accountingKeys.all(orgId),
      });
    },
  });
  const missing = !data.prerequisites.currency || !data.prerequisites.timeZone;
  return (
    <section className="card" aria-labelledby="accounting-setup-title">
      <h2 id="accounting-setup-title">{t('accounting.setupTitle')}</h2>
      <p>{t('accounting.setupIntro')}</p>
      <Notice kind="warning">{t('accounting.templateNotice')}</Notice>
      {missing && <Notice kind="info">{t('accounting.prerequisites')}</Notice>}
      {!can('accounting.settings.manage') ? (
        <p className="muted">{t('accounting.ownerSetsUp')}</p>
      ) : (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            setup.mutate();
          }}
        >
          <Field id="cutover-date" label={t('accounting.cutoverDate')} hint={t('accounting.cutoverHint')}>
            <input id="cutover-date" type="date" required value={cutoverDate} onChange={(e) => setCutoverDate(e.target.value)} />
          </Field>
          <label className="choice">
            <input type="checkbox" checked={requireCashSession} onChange={(e) => setRequireCashSession(e.target.checked)} />
            <span>{t('accounting.requireCashSession')}</span>
          </label>
          {setup.isError && <Notice kind="error">{errorMessage(t, setup.error)}</Notice>}
          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={missing || setup.isPending}>
              {t('accounting.setUp')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

type Reconciliation = {
  currency: string;
  rows: {
    key: string;
    subledger: number;
    ledger: number;
    difference: number;
  }[];
};
type Preview = {
  cutoverDate: string;
  currency: string;
  documentsBefore: { invoices: number; receipts: number };
  proposal: { key: string; accountId: string; debit: number; credit: number }[];
  openingEntriesPosted: number;
};

function MigrationCard() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const money = useMoney();
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: accountingKeys.report(orgId, 'migration', {}),
    queryFn: ({ signal }) => api<Preview>(`/orgs/${orgId}/accounting/migration/preview`, { signal }),
  });
  const [key] = useState(newRequestKey);
  const post = useMutation({
    mutationFn: (p: Preview) =>
      api(`/orgs/${orgId}/accounting/entries`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: {
          date: p.cutoverDate,
          journal: 'opening',
          memo: t('accounting.openingMemo'),
          lines: p.proposal
            .filter((l) => l.debit || l.credit)
            .map((l) => ({
              accountId: l.accountId,
              debit: l.debit,
              credit: l.credit,
            })),
        },
      }),
    onSuccess: () => {
      showToast(t('accounting.openingPosted'));
      return queryClient.invalidateQueries({
        queryKey: accountingKeys.all(orgId),
      });
    },
  });
  if (!preview.isSuccess) return null;
  const p = preview.data;
  const hasAmounts = p.proposal.some((l) => l.debit || l.credit);
  return (
    <section className="card" aria-labelledby="migration-title">
      <h2 id="migration-title">{t('accounting.migrationTitle')}</h2>
      <p>
        {t('accounting.migrationIntro', {
          date: p.cutoverDate,
          invoices: p.documentsBefore.invoices,
          receipts: p.documentsBefore.receipts,
        })}
      </p>
      {hasAmounts ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('accounting.account')}</th>
                <th scope="col" className="num">{t('accounting.debit')}</th>
                <th scope="col" className="num">{t('accounting.credit')}</th>
              </tr>
            </thead>
            <tbody>
              {p.proposal.map((l) => (
                <tr key={l.key}>
                  <td data-label={t('accounting.account')}>{t(`accounting.mappingKeys.${l.key}`)}</td>
                  <td className="num" data-label={t('accounting.debit')}>{l.debit ? money(l.debit, p.currency) : ''}</td>
                  <td className="num" data-label={t('accounting.credit')}>{l.credit ? money(l.credit, p.currency) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">{t('accounting.migrationNothing')}</p>
      )}
      {p.openingEntriesPosted > 0 && <Notice kind="info">{t('accounting.openingAlready', { count: p.openingEntriesPosted })}</Notice>}
      {hasAmounts && p.openingEntriesPosted === 0 && (
        <div className="form-actions">
          <button type="button" className="button button--secondary" disabled={post.isPending} onClick={() => post.mutate(p)}>
            {t('accounting.postOpening')}
          </button>
        </div>
      )}
      {post.isError && <Notice kind="error">{errorMessage(t, post.error)}</Notice>}
    </section>
  );
}

export function AccountingPage() {
  const { t } = useTranslation();
  const { orgId, can, detail } = useOrg();
  useDocumentTitle(t('accounting.title'));
  const money = useMoney();
  const settings = useAccountingSettings();
  const orgWide = detail.membership.branchScope.type === 'all';
  const configured = settings.data?.configured === true;
  const accounts = useAccounts(configured && orgWide);
  const reconciliation = useQuery({
    queryKey: accountingKeys.report(orgId, 'reconciliation', {}),
    queryFn: ({ signal }) =>
      api<Reconciliation>(`/orgs/${orgId}/accounting/reports/reconciliation`, {
        signal,
      }),
    enabled: configured && orgWide,
  });
  if (settings.isPending) return <Loading />;
  if (settings.isError) return <ErrorState message={errorMessage(t, settings.error)} onRetry={() => settings.refetch()} />;
  const s = settings.data.settings;
  const byCode = (role: 'cash' | 'bank' | null, key?: string) =>
    (accounts.data?.accounts ?? []).filter((a) => (key ? a.id === s?.mappings[key] : a.role === role)).reduce((sum, a) => sum + (a.balance ?? 0), 0);
  return (
    <>
      <PageHeader title={t('accounting.title')} subtitle={t('accounting.subtitle')} />
      <AccountingNav />
      {!configured || !s ? (
        <SetupCard data={settings.data} />
      ) : (
        <>
          <Notice kind="info">
            {t('accounting.status', {
              date: s.cutoverDate,
              currency: t(`finance.currencies.${s.currency}`),
            })}{' '}
            {s.lockedThrough ? t('accounting.lockedThrough', { date: s.lockedThrough }) : t('accounting.noClosedMonth')}
          </Notice>
          {!orgWide && <Notice kind="info">{t('accounting.branchScopeNotice')}</Notice>}
          {orgWide && accounts.isSuccess && (
            <dl className="metrics metrics--auto" data-testid="accounting-metrics">
              <Metric icon="cash" label={t('accounting.metrics.cash')} value={byCode('cash')} format={(v) => money(v, s.currency)} />
              <Metric icon="building" label={t('accounting.metrics.bank')} value={byCode('bank')} format={(v) => money(v, s.currency)} />
              <Metric
                icon="wallet"
                label={t('accounting.metrics.receivable')}
                value={byCode(null, 'receivable')}
                format={(v) => money(v, s.currency)}
              />
              <Metric
                icon="patients"
                label={t('accounting.metrics.advances')}
                value={byCode(null, 'patientAdvances')}
                format={(v) => money(v, s.currency)}
              />
            </dl>
          )}
          <div className="card-grid card-grid--wide">
            {reconciliation.isSuccess && (
              <section className="card" aria-labelledby="reconciliation-title">
                <h2 id="reconciliation-title">{t('accounting.reconciliationTitle')}</h2>
                <p className="muted">{t('accounting.reconciliationIntro')}</p>
                <dl className="details">
                  {reconciliation.data.rows.map((r) => (
                    <Fragment key={r.key}>
                      <dt>{t(`accounting.mappingKeys.${r.key}`)}</dt>
                      <dd>
                        {money(r.ledger, reconciliation.data.currency)} · {t('accounting.subledger')}{' '}
                        {money(r.subledger, reconciliation.data.currency)}{' '}
                        <span className={r.difference === 0 ? 'badge badge--success' : 'badge badge--danger'}>
                          {r.difference === 0
                            ? t('accounting.agrees')
                            : t('accounting.differs', {
                                amount: money(r.difference, reconciliation.data.currency),
                              })}
                        </span>
                      </dd>
                    </Fragment>
                  ))}
                </dl>
              </section>
            )}
            {can('accounting.manage') && orgWide && <MigrationCard />}
            <section className="card" aria-labelledby="template-title">
              <h2 id="template-title">{t('accounting.templateTitle')}</h2>
              <p>{t('accounting.templateNotice')}</p>
              <p className="muted">{t('accounting.accrualNotice')}</p>
            </section>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Journal

const JOURNAL_FILTERS = ['', 'sales', 'cash', 'bank', 'purchases', 'inventory', 'general', 'opening', 'compensation'];

type LineDraft = {
  accountId: string;
  debit: string;
  credit: string;
  branchId: string;
};
const emptyLine = (): LineDraft => ({
  accountId: '',
  debit: '',
  credit: '',
  branchId: '',
});

function ManualEntryForm({
  accounts,
  settings,
  onDone,
}: {
  accounts: LedgerAccount[];
  settings: NonNullable<SettingsResponse['settings']>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { orgId, branches } = useOrg();
  const money = useMoney();
  const queryClient = useQueryClient();
  const [date, setDate] = useState('');
  const [journal, setJournal] = useState<'general' | 'opening'>('general');
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()]);
  const [key, setKey] = useState(newRequestKey);
  const postable = accounts.filter((a) => !a.isGroup && a.status === 'active');
  const parsed = lines.map((l) => ({
    ...l,
    d: l.debit ? parseMoney(l.debit) : 0,
    c: l.credit ? parseMoney(l.credit) : 0,
  }));
  const debit = parsed.reduce((s, l) => s + (l.d ?? 0), 0);
  const credit = parsed.reduce((s, l) => s + (l.c ?? 0), 0);
  const valid = parsed.every((l) => l.d !== null && l.c !== null) && debit === credit && debit > 0;
  const post = useMutation({
    mutationFn: () =>
      api<{ entry: JournalEntry }>(`/orgs/${orgId}/accounting/entries`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: {
          date: journal === 'opening' ? settings.cutoverDate : date,
          journal,
          memo,
          lines: parsed
            .filter((l) => l.accountId && ((l.d ?? 0) > 0 || (l.c ?? 0) > 0))
            .map((l) => ({
              accountId: l.accountId,
              debit: l.d ?? 0,
              credit: l.c ?? 0,
              branchId: l.branchId || null,
            })),
        },
      }),
    onSuccess: (r) => {
      showToast(t('accounting.entryPosted', { number: r.entry.number }));
      setKey(newRequestKey());
      setLines([emptyLine(), emptyLine()]);
      setMemo('');
      onDone();
      return queryClient.invalidateQueries({
        queryKey: accountingKeys.all(orgId),
      });
    },
  });
  const update = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <form
      className="card"
      aria-labelledby="new-entry-title"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (valid) post.mutate();
      }}
    >
      <h2 id="new-entry-title">{t('accounting.newEntry')}</h2>
      <p className="muted">{t('accounting.controlAccountsNote')}</p>
      <div className="form-grid">
        <Field id="entry-journal" label={t('accounting.journal')}>
          <select id="entry-journal" value={journal} onChange={(e) => setJournal(e.target.value as 'general' | 'opening')}>
            <option value="general">{t('accounting.journals.general')}</option>
            <option value="opening">{t('accounting.journals.opening')}</option>
          </select>
        </Field>
        <Field
          id="entry-date"
          label={t('accounting.date')}
          hint={journal === 'opening' ? t('accounting.openingDateHint', { date: settings.cutoverDate }) : undefined}
        >
          <input
            id="entry-date"
            type="date"
            required={journal === 'general'}
            disabled={journal === 'opening'}
            value={journal === 'opening' ? settings.cutoverDate : date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field id="entry-memo" label={t('accounting.memo')}>
          <input id="entry-memo" required minLength={3} maxLength={200} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </Field>
      </div>
      <div className="table-wrap">
        <table className="data-table entry-lines">
          <thead>
            <tr>
              <th scope="col">{t('accounting.account')}</th>
              <th scope="col" className="num">{t('accounting.debit')}</th>
              <th scope="col" className="num">{t('accounting.credit')}</th>
              <th scope="col">{t('accounting.costCenter')}</th>
              <th scope="col">
                <span className="visually-hidden">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td data-label={t('accounting.account')}>
                  <select
                    aria-label={t('accounting.lineAccount', { n: i + 1 })}
                    value={l.accountId}
                    onChange={(e) => update(i, { accountId: e.target.value })}
                  >
                    <option value="">{t('accounting.chooseAccount')}</option>
                    {postable.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {accountName(t, a)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="num" data-label={t('accounting.debit')}>
                  <input
                    aria-label={t('accounting.lineDebit', { n: i + 1 })}
                    inputMode="decimal"
                    value={l.debit}
                    onChange={(e) => update(i, { debit: e.target.value, credit: '' })}
                  />
                </td>
                <td className="num" data-label={t('accounting.credit')}>
                  <input
                    aria-label={t('accounting.lineCredit', { n: i + 1 })}
                    inputMode="decimal"
                    value={l.credit}
                    onChange={(e) => update(i, { credit: e.target.value, debit: '' })}
                  />
                </td>
                <td data-label={t('accounting.costCenter')}>
                  <select
                    aria-label={t('accounting.lineBranch', { n: i + 1 })}
                    value={l.branchId}
                    onChange={(e) => update(i, { branchId: e.target.value })}
                  >
                    <option value="">{t('accounting.organizationLevel')}</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {lines.length > 2 && (
                    <button type="button" className="button button--ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                      {t('accounting.removeLine')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="toolbar">
        <button
          type="button"
          className="button button--secondary"
          onClick={() => setLines((ls) => [...ls, emptyLine()])}
          disabled={lines.length >= 100}
        >
          {t('accounting.addLine')}
        </button>
        <p className={debit === credit && debit > 0 ? 'entry-totals' : 'entry-totals entry-totals--off'} aria-live="polite">
          {t('accounting.totals', {
            debit: money(debit, settings.currency),
            credit: money(credit, settings.currency),
          })}{' '}
          {debit !== credit &&
            t('accounting.unbalanced', {
              amount: money(Math.abs(debit - credit), settings.currency),
            })}
        </p>
      </div>
      {post.isError && <Notice kind="error">{errorMessage(t, post.error)}</Notice>}
      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={!valid || post.isPending}>
          {t('accounting.postEntry')}
        </button>
      </div>
    </form>
  );
}

export function JournalPage() {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  useDocumentTitle(t('accounting.journalTitle'));
  const money = useMoney();
  const settings = useAccountingSettings();
  // Filters and page in the address: dates and a journal code only.
  const url = useUrlState();
  const from = url.get('from');
  const to = url.get('to');
  const journal = url.get('journal');
  const page = pageParam(url.get('page'));
  const [showForm, setShowForm] = useState(false);
  const configured = settings.data?.configured === true;
  const accounts = useAccounts(configured && can('accounting.manage'));
  const params = {
    from: from || undefined,
    to: to || undefined,
    journal: journal || undefined,
    page,
    pageSize: 20,
  };
  const entries = useQuery({
    queryKey: accountingKeys.entries(orgId, params),
    queryFn: ({ signal }) => api<Page<JournalEntry>>(`/orgs/${orgId}/accounting/entries${query(params)}`, { signal }),
    enabled: configured,
  });
  const s = settings.data?.settings;
  return (
    <>
      <PageHeader title={t('accounting.journalTitle')} subtitle={t('accounting.journalSubtitle')}>
        {configured && can('accounting.manage') && (
          <button type="button" className="button button--primary" aria-expanded={showForm} onClick={() => setShowForm((v) => !v)}>
            {t('accounting.newEntry')}
          </button>
        )}
      </PageHeader>
      <AccountingNav />
      {settings.isSuccess && !configured && <NotSetUp />}
      {showForm && s && accounts.isSuccess && <ManualEntryForm accounts={accounts.data.accounts} settings={s} onDone={() => setShowForm(false)} />}
      {configured && (
        <section className="card" aria-labelledby="journal-list-title">
          <h2 id="journal-list-title" className="visually-hidden">
            {t('accounting.entries')}
          </h2>
          <div className="filters">
            <Field id="journal-from" label={t('accounting.from')}>
              <input id="journal-from" type="date" value={from} onChange={(e) => url.set({ from: e.target.value, page: null })} />
            </Field>
            <Field id="journal-to" label={t('accounting.to')}>
              <input id="journal-to" type="date" value={to} onChange={(e) => url.set({ to: e.target.value, page: null })} />
            </Field>
            <Field id="journal-filter" label={t('accounting.journal')}>
              <select id="journal-filter" value={journal} onChange={(e) => url.set({ journal: e.target.value, page: null })}>
                {JOURNAL_FILTERS.map((j) => (
                  <option key={j} value={j}>
                    {j ? t(`accounting.journals.${j}`) : t('accounting.allJournals')}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {entries.isPending && <Loading />}
          {entries.isError && <ErrorState message={errorMessage(t, entries.error)} onRetry={() => entries.refetch()} />}
          {entries.isSuccess && entries.data.data.length === 0 && <EmptyState icon="book">{t('accounting.noEntries')}</EmptyState>}
          {entries.isSuccess && entries.data.data.length > 0 && (
            <>
              <div className="table-wrap">
                <table className="data-table" data-testid="journal-entries">
                  <thead>
                    <tr>
                      <th scope="col">{t('accounting.number')}</th>
                      <th scope="col">{t('accounting.date')}</th>
                      <th scope="col">{t('accounting.journal')}</th>
                      <th scope="col">{t('accounting.event')}</th>
                      <th scope="col">{t('accounting.memo')}</th>
                      <th scope="col">{t('accounting.amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.data.data.map((e) => (
                      <tr key={e.id}>
                        <td data-label={t('accounting.number')}>
                          <Link to={`/app/${orgId}/accounting/entries/${e.id}`}>
                            <bdi dir="ltr">{e.number}</bdi>
                          </Link>
                          {e.reversedBy && <span className="badge">{t('accounting.reversed')}</span>}
                          {e.reversalOf && <span className="badge">{t('accounting.reversal')}</span>}
                        </td>
                        <td data-label={t('accounting.date')}>
                          <DateText value={e.date} />
                        </td>
                        <td data-label={t('accounting.journal')}>{t(`accounting.journals.${e.journal}`)}</td>
                        <td data-label={t('accounting.event')}>{sourceLabel(t, e.source)}</td>
                        <td data-label={t('accounting.memo')}>
                          <bdi dir="auto">{e.memo}</bdi>
                        </td>
                        <td data-label={t('accounting.amount')}>{money(e.total, e.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={entries.data.pageSize} total={entries.data.total} onPage={(p) => url.set({ page: p > 1 ? p : null })} />
            </>
          )}
        </section>
      )}
    </>
  );
}

export function EntryPage() {
  const { t } = useTranslation();
  const { orgId, can, branches } = useOrg();
  const { entryId = '' } = useParams();
  const money = useMoney();
  const queryClient = useQueryClient();
  const entry = useQuery({
    queryKey: accountingKeys.entry(orgId, entryId),
    queryFn: ({ signal }) => api<{ entry: JournalEntry }>(`/orgs/${orgId}/accounting/entries/${entryId}`, { signal }),
  });
  useDocumentTitle(entry.data ? entry.data.entry.number : t('accounting.entry'));
  const [reason, setReason] = useState('');
  const reverse = useMutation({
    mutationFn: () => api<{ entry: JournalEntry }>(`/orgs/${orgId}/accounting/entries/${entryId}/reverse`, { method: 'POST', body: { reason } }),
    onSuccess: (r) => {
      showToast(t('accounting.entryReversed', { number: r.entry.number }));
      return queryClient.invalidateQueries({
        queryKey: accountingKeys.all(orgId),
      });
    },
  });
  if (entry.isPending) return <Loading />;
  if (entry.isError) return <ErrorState message={errorMessage(t, entry.error)} onRetry={() => entry.refetch()} />;
  const e = entry.data.entry;
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const reversible = ['manual', 'opening', 'voucher'].includes(e.source.type) && !e.reversedBy && !e.reversalOf;
  return (
    <>
      <PageHeader title={t('accounting.entryTitle', { number: e.number })} subtitle={sourceLabel(t, e.source)}>
        <Link className="button button--secondary" to={`/app/${orgId}/accounting/entries`}>
          {t('accounting.backToJournal')}
        </Link>
      </PageHeader>
      <AccountingNav />
      <section className="card" aria-labelledby="entry-detail-title">
        <h2 id="entry-detail-title" className="visually-hidden">
          {t('accounting.entry')}
        </h2>
        <dl className="details">
          <dt>{t('accounting.date')}</dt>
          <dd>
            <DateText value={e.date} />
          </dd>
          <dt>{t('accounting.journal')}</dt>
          <dd>{t(`accounting.journals.${e.journal}`)}</dd>
          <dt>{t('accounting.memo')}</dt>
          <dd>
            <bdi dir="auto">{e.memo || '—'}</bdi>
          </dd>
          {e.reversalOf && (
            <>
              <dt>{t('accounting.reversalOf')}</dt>
              <dd>
                <Link to={`/app/${orgId}/accounting/entries/${e.reversalOf}`}>{t('accounting.openOriginal')}</Link>
              </dd>
            </>
          )}
          {e.reversedBy && (
            <>
              <dt>{t('accounting.reversedBy')}</dt>
              <dd>
                <Link to={`/app/${orgId}/accounting/entries/${e.reversedBy}`}>{t('accounting.openReversal')}</Link>
              </dd>
            </>
          )}
        </dl>
        <div className="table-wrap">
          <table className="data-table" data-testid="entry-lines">
            <thead>
              <tr>
                <th scope="col">{t('accounting.account')}</th>
                <th scope="col">{t('accounting.costCenter')}</th>
                <th scope="col" className="num">{t('accounting.debit')}</th>
                <th scope="col" className="num">{t('accounting.credit')}</th>
              </tr>
            </thead>
            <tbody>
              {e.lines.map((l, i) => (
                <tr key={i}>
                  <td data-label={t('accounting.account')}>
                    <bdi dir="ltr">{l.accountCode}</bdi>{' '}
                    {accountName(t, {
                      name: l.accountName,
                      templateKey: l.accountTemplateKey,
                    })}
                    {l.partner && <span className="muted"> · {t(`accounting.partners.${l.partner.type}`)}</span>}
                  </td>
                  <td data-label={t('accounting.costCenter')}>
                    {l.branchId ? (branchName.get(l.branchId) ?? '—') : t('accounting.organizationLevel')}
                  </td>
                  <td className="num" data-label={t('accounting.debit')}>{l.debit ? money(l.debit, e.currency) : ''}</td>
                  <td className="num" data-label={t('accounting.credit')}>{l.credit ? money(l.credit, e.currency) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {can('accounting.manage') && reversible && (
        <form
          className="card"
          aria-labelledby="reverse-title"
          onSubmit={(ev) => {
            ev.preventDefault();
            reverse.mutate();
          }}
        >
          <h2 id="reverse-title">{t('accounting.reverseTitle')}</h2>
          <p className="muted">{t('accounting.reverseIntro')}</p>
          <Field id="reverse-reason" label={t('accounting.reason')}>
            <input id="reverse-reason" required minLength={3} maxLength={200} value={reason} onChange={(ev) => setReason(ev.target.value)} />
          </Field>
          {reverse.isError && <Notice kind="error">{errorMessage(t, reverse.error)}</Notice>}
          <div className="form-actions">
            <button type="submit" className="button button--secondary" disabled={reverse.isPending}>
              {t('accounting.reverse')}
            </button>
          </div>
        </form>
      )}
      {!reversible && !e.reversedBy && !e.reversalOf && <Notice kind="info">{t('accounting.documentPostingNote')}</Notice>}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Chart of accounts

export function ChartPage() {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  useDocumentTitle(t('accounting.chartTitle'));
  const money = useMoney();
  const queryClient = useQueryClient();
  const settings = useAccountingSettings();
  const configured = settings.data?.configured === true;
  const accounts = useAccounts(configured);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('expense');
  const [parentId, setParentId] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/accounting/accounts`, {
        method: 'POST',
        body: { code, name, type, parentId: parentId || null },
      }),
    onSuccess: () => {
      showToast(t('accounting.accountAdded'));
      setCode('');
      setName('');
      return queryClient.invalidateQueries({
        queryKey: accountingKeys.accounts(orgId),
      });
    },
  });
  const archive = useMutation({
    mutationFn: (a: LedgerAccount) =>
      api(`/orgs/${orgId}/accounting/accounts/${a.id}`, {
        method: 'PATCH',
        body: {
          status: a.status === 'active' ? 'archived' : 'active',
          version: a.version,
        },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: accountingKeys.accounts(orgId),
      }),
    onError: (err) => showToast(errorMessage(t, err)),
  });
  const currency = settings.data?.settings?.currency;
  const list = accounts.data?.accounts ?? [];
  const depth = (a: LedgerAccount): number => {
    let d = 0;
    let p = a.parentId;
    while (p && d < 5) {
      d += 1;
      p = list.find((x) => x.id === p)?.parentId ?? null;
    }
    return d;
  };
  return (
    <>
      <PageHeader title={t('accounting.chartTitle')} subtitle={t('accounting.chartSubtitle')} />
      <AccountingNav />
      {settings.isSuccess && !configured && <NotSetUp />}
      {configured && <Notice kind="warning">{t('accounting.templateNotice')}</Notice>}
      {accounts.isError && <ErrorState message={errorMessage(t, accounts.error)} onRetry={() => accounts.refetch()} />}
      {accounts.isSuccess && (
        <section className="card" aria-labelledby="chart-title">
          <h2 id="chart-title" className="visually-hidden">
            {t('accounting.chartTitle')}
          </h2>
          <div className="table-wrap">
            <table className="data-table" data-testid="chart-of-accounts">
              <thead>
                <tr>
                  <th scope="col">{t('accounting.code')}</th>
                  <th scope="col">{t('accounting.account')}</th>
                  <th scope="col">{t('accounting.type')}</th>
                  <th scope="col" className="num">{t('accounting.balance')}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t('common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id} className={a.isGroup ? 'row-group' : a.status === 'archived' ? 'row-muted' : undefined}>
                    <td data-label={t('accounting.code')}>
                      <bdi dir="ltr">{a.code}</bdi>
                    </td>
                    <td data-label={t('accounting.account')} style={{ paddingInlineStart: `${12 + depth(a) * 16}px` }}>
                      {accountName(t, a)}
                      {a.status === 'archived' && <span className="badge">{t('accounting.archived')}</span>}
                    </td>
                    <td data-label={t('accounting.type')}>{t(`accounting.types.${a.type}`)}</td>
                    <td className="num" data-label={t('accounting.balance')}>{a.isGroup ? '' : money(a.balance ?? 0, currency)}</td>
                    <td>
                      {can('accounting.manage') && !a.isGroup && !a.templateKey && (
                        <button type="button" className="button button--ghost" disabled={archive.isPending} onClick={() => archive.mutate(a)}>
                          {a.status === 'active' ? t('accounting.archive') : t('accounting.restore')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {accounts.isSuccess && can('accounting.manage') && (
        <form
          className="card"
          aria-labelledby="add-account-title"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <h2 id="add-account-title">{t('accounting.addAccount')}</h2>
          <div className="form-grid">
            <Field id="account-code" label={t('accounting.code')} hint={t('accounting.codeHint')}>
              <input id="account-code" required inputMode="numeric" pattern="\d{3,8}" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <Field id="account-name" label={t('accounting.accountName')}>
              <input id="account-name" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field id="account-type" label={t('accounting.type')}>
              <select id="account-type" value={type} onChange={(e) => (setType(e.target.value as AccountType), setParentId(''))}>
                {ACCOUNT_TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`accounting.types.${ty}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="account-parent" label={t('accounting.parent')}>
              <select id="account-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">{t('accounting.noParent')}</option>
                {list
                  .filter((a) => a.isGroup && a.type === type)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {accountName(t, a)}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          {create.isError && <Notice kind="error">{errorMessage(t, create.error)}</Notice>}
          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={create.isPending}>
              {t('accounting.addAccount')}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Statements

const REPORTS = ['trialBalance', 'profitLoss', 'balanceSheet', 'ledger', 'aging'] as const;
type ReportName = (typeof REPORTS)[number];
type Row = LedgerAccount & {
  opening?: number;
  debit?: number;
  credit?: number;
  closing?: number;
  amount?: number;
};
type Group = { type: AccountType; rows: Row[]; total: number };

function monthStart(today: string | null) {
  return today ? `${today.slice(0, 7)}-01` : '';
}

export function ReportsPage() {
  const { t } = useTranslation();
  const { orgId, branches } = useOrg();
  useDocumentTitle(t('accounting.reportsTitle'));
  const settings = useAccountingSettings();
  const configured = settings.data?.configured === true;
  const today = settings.data?.today ?? null;
  const [search, setSearch] = useSearchParams();
  const setParam = (key: string, value: string) =>
    setSearch(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: key !== 'report' },
    );
  const asked = search.get('report');
  const report: ReportName = (REPORTS as readonly string[]).includes(asked ?? '') ? (asked as ReportName) : 'trialBalance';
  const setReport = (r: ReportName) => setParam('report', r);
  const from = search.get('from') ?? '';
  const setFrom = (v: string) => setParam('from', v);
  const to = search.get('to') ?? '';
  const setTo = (v: string) => setParam('to', v);
  const branchId = search.get('branch') ?? '';
  const setBranchId = (v: string) => setParam('branch', v);
  const accountId = search.get('account') ?? '';
  const setAccountId = (v: string) => setParam('account', v);
  const accounts = useAccounts(configured && report === 'ledger');
  const fromValue = from || monthStart(today);
  const toValue = to || today || '';
  const params =
    report === 'balanceSheet'
      ? { asOf: toValue }
      : report === 'aging'
        ? {}
        : report === 'ledger'
          ? { from: fromValue, to: toValue, accountId }
          : {
              from: fromValue,
              to: toValue,
              ...(report === 'profitLoss' && branchId ? { branchId } : {}),
            };
  const path = {
    trialBalance: 'trial-balance',
    profitLoss: 'profit-loss',
    balanceSheet: 'balance-sheet',
    ledger: 'ledger',
    aging: 'receivables-aging',
  }[report];
  const result = useQuery({
    queryKey: accountingKeys.report(orgId, report, params),
    queryFn: ({ signal }) => api<Record<string, unknown>>(`/orgs/${orgId}/accounting/reports/${path}${query(params)}`, { signal }),
    enabled: configured && Boolean(toValue) && (report !== 'ledger' || Boolean(accountId)),
  });
  return (
    <>
      <PageHeader title={t('accounting.reportsTitle')} subtitle={t('accounting.reportsSubtitle')} />
      <AccountingNav />
      {settings.isSuccess && !configured && <NotSetUp />}
      {configured && (
        <section className="card" aria-labelledby="report-filters-title">
          <h2 id="report-filters-title" className="visually-hidden">
            {t('accounting.reportFilters')}
          </h2>
          <div className="segmented segmented--wrap" role="group" aria-label={t('accounting.report')}>
            {REPORTS.map((r) => (
              <button
                key={r}
                type="button"
                className={r === report ? 'segment segment--active' : 'segment'}
                aria-pressed={r === report}
                onClick={() => setReport(r)}
              >
                {t(`accounting.reports.${r}`)}
              </button>
            ))}
          </div>
          <div className="filters">
            {report !== 'balanceSheet' && report !== 'aging' && (
              <Field id="report-from" label={t('accounting.from')}>
                <input id="report-from" type="date" value={fromValue} onChange={(e) => setFrom(e.target.value)} />
              </Field>
            )}
            {report !== 'aging' && (
              <Field id="report-to" label={report === 'balanceSheet' ? t('accounting.asOf') : t('accounting.to')}>
                <input id="report-to" type="date" value={toValue} onChange={(e) => setTo(e.target.value)} />
              </Field>
            )}
            {report === 'profitLoss' && (
              <Field id="report-branch" label={t('accounting.costCenter')}>
                <select id="report-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  <option value="">{t('accounting.allBranches')}</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {report === 'ledger' && (
              <Field id="report-account" label={t('accounting.account')}>
                <select id="report-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">{t('accounting.chooseAccount')}</option>
                  {(accounts.data?.accounts ?? [])
                    .filter((a) => !a.isGroup)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {accountName(t, a)}
                      </option>
                    ))}
                </select>
              </Field>
            )}
          </div>
        </section>
      )}
      {result.isPending && result.fetchStatus !== 'idle' && <Loading />}
      {result.isError && <ErrorState message={errorMessage(t, result.error)} onRetry={() => result.refetch()} />}
      {result.isSuccess && <ReportView name={report} data={result.data} />}
    </>
  );
}

/** A whole statement in one table: fixed columns, so the amounts of every section line up. */
function StatementTable({ sections, currency, label, result }: { sections: Group[]; currency: string; label: string; result?: { label: string; amount: number } }) {
  const { t } = useTranslation();
  const money = useMoney();
  return (
    <div className="table-wrap">
      <table className="data-table data-table--scroll statement-table" data-testid="statement">
        <caption className="visually-hidden">{label}</caption>
        <colgroup>
          <col className="statement-label" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{t('accounting.account')}</th>
            <th scope="col" className="num">
              {t('accounting.amountIn', { currency })}
            </th>
          </tr>
        </thead>
        {sections.map((group) => (
          <tbody key={group.type}>
            <tr className="statement-section">
              <th scope="colgroup" colSpan={2}>
                {t(`accounting.types.${group.type}`)}
              </th>
            </tr>
            {group.rows.length === 0 && (
              <tr>
                <td colSpan={2} className="muted">
                  {t('accounting.noAccounts')}
                </td>
              </tr>
            )}
            {group.rows.map((r) => (
              <tr key={r.id}>
                <td data-label={t('accounting.account')}>
                  {r.code && <bdi dir="ltr">{r.code}</bdi>} {accountName(t, r)}
                </td>
                <td className="num" data-label={t('accounting.amount')}>
                  {money(r.amount ?? 0, currency)}
                </td>
              </tr>
            ))}
            <tr className="row-total">
              <th scope="row">{t('accounting.totalOf', { type: t(`accounting.types.${group.type}`) })}</th>
              <td className="num" data-label={t('accounting.amount')}>
                {money(group.total, currency)}
              </td>
            </tr>
          </tbody>
        ))}
        {result && (
          <tbody>
            <tr className="row-total statement-grand">
              <th scope="row">{result.label}</th>
              <td className="num" data-label={t('accounting.amount')}>
                {money(result.amount, currency)}
              </td>
            </tr>
          </tbody>
        )}
      </table>
    </div>
  );
}

function ReportView({ name, data }: { name: ReportName; data: Record<string, unknown> }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const money = useMoney();
  const currency = data.currency as string;
  if (name === 'trialBalance') {
    const rows = data.rows as Row[];
    const totals = data.totals as {
      opening: number;
      debit: number;
      credit: number;
      closing: number;
    };
    return (
      <section className="card" aria-labelledby="tb-title">
        <div className="section-header">
          <h2 id="tb-title">{t('accounting.reports.trialBalance')}</h2>
          <button
            type="button"
            className="button button--secondary"
            onClick={() =>
              downloadCsv(`trial-balance-${String(data.from)}-${String(data.to)}.csv`, [
                [
                  t('accounting.code'),
                  t('accounting.account'),
                  t('accounting.opening'),
                  t('accounting.debit'),
                  t('accounting.credit'),
                  t('accounting.closing'),
                ],
                ...rows.map((r) => [
                  r.code,
                  accountName(t, r),
                  csvMoney(r.opening ?? 0),
                  csvMoney(r.debit ?? 0),
                  csvMoney(r.credit ?? 0),
                  csvMoney(r.closing ?? 0),
                ]),
              ])
            }
          >
            {t('reportsHub.downloadCsv')}
          </button>
        </div>
        <span className={data.balanced ? 'badge badge--success' : 'badge badge--danger'}>
          {data.balanced ? t('accounting.balanced') : t('accounting.notBalanced')}
        </span>
        {rows.length === 0 ? (
          <EmptyState icon="book">{t('accounting.noMovements')}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data-table data-table--scroll" data-testid="trial-balance">
              <thead>
                <tr>
                  <th scope="col">{t('accounting.account')}</th>
                  <th scope="col" className="num">{t('accounting.opening')}</th>
                  <th scope="col" className="num">{t('accounting.debit')}</th>
                  <th scope="col" className="num">{t('accounting.credit')}</th>
                  <th scope="col" className="num">{t('accounting.closing')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label={t('accounting.account')}>
                      <bdi dir="ltr">{r.code}</bdi> {accountName(t, r)}
                    </td>
                    <td className="num" data-label={t('accounting.opening')}>{money(r.opening ?? 0, currency)}</td>
                    <td className="num" data-label={t('accounting.debit')}>{money(r.debit ?? 0, currency)}</td>
                    <td className="num" data-label={t('accounting.credit')}>{money(r.credit ?? 0, currency)}</td>
                    <td className="num" data-label={t('accounting.closing')}>{money(r.closing ?? 0, currency)}</td>
                  </tr>
                ))}
                <tr className="row-total">
                  <th scope="row">{t('accounting.total')}</th>
                  <td className="num" data-label={t('accounting.opening')}>{money(totals.opening, currency)}</td>
                  <td className="num" data-label={t('accounting.debit')}>{money(totals.debit, currency)}</td>
                  <td className="num" data-label={t('accounting.credit')}>{money(totals.credit, currency)}</td>
                  <td className="num" data-label={t('accounting.closing')}>{money(totals.closing, currency)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">{t('accounting.signNote')}</p>
      </section>
    );
  }
  if (name === 'profitLoss') {
    const income = data.income as Group;
    const expense = data.expense as Group;
    return (
      <section className="card" aria-labelledby="pl-title">
        <h2 id="pl-title">{t('accounting.reports.profitLoss')}</h2>
        <StatementTable
          label={t('accounting.reports.profitLoss')}
          sections={[income, expense]}
          currency={currency}
          result={{ label: t('accounting.resultPerLedger'), amount: data.result as number }}
        />
        <p className="muted">{t('accounting.resultNote')}</p>
      </section>
    );
  }
  if (name === 'balanceSheet') {
    const assets = data.assets as Group;
    const liabilities = data.liabilities as Group;
    const equity = data.equity as Group & { accumulatedResult: number };
    return (
      <section className="card" aria-labelledby="bs-title">
        <h2 id="bs-title">{t('accounting.reports.balanceSheet')}</h2>
        <span className={data.balanced ? 'badge badge--success' : 'badge badge--danger'}>
          {data.balanced ? t('accounting.balanced') : t('accounting.notBalanced')}
        </span>
        <StatementTable
          label={t('accounting.reports.balanceSheet')}
          currency={currency}
          sections={[
            assets,
            liabilities,
            {
            ...equity,
            rows: [
              ...equity.rows,
              {
                id: 'result',
                code: '',
                name: t('accounting.accumulatedResult'),
                templateKey: null,
                amount: equity.accumulatedResult,
              } as Row,
            ],
          },
          ]}
        />
      </section>
    );
  }
  if (name === 'ledger') {
    const lines = data.lines as {
      entryId: string;
      number: string;
      date: string;
      memo: string;
      source: { type: string; event: string };
      debit: number;
      credit: number;
      balance: number;
    }[];
    return (
      <section className="card" aria-labelledby="ledger-title">
        <h2 id="ledger-title">{t('accounting.reports.ledger')}</h2>
        <p>
          {t('accounting.opening')}: {money(data.opening as number, currency)} · {t('accounting.closing')}: {money(data.closing as number, currency)}
        </p>
        {data.truncated === true && <Notice kind="info">{t('accounting.truncated')}</Notice>}
        {lines.length === 0 ? (
          <EmptyState icon="book">{t('accounting.noMovements')}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('accounting.date')}</th>
                  <th scope="col">{t('accounting.number')}</th>
                  <th scope="col">{t('accounting.event')}</th>
                  <th scope="col" className="num">{t('accounting.debit')}</th>
                  <th scope="col" className="num">{t('accounting.credit')}</th>
                  <th scope="col" className="num">{t('accounting.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td data-label={t('accounting.date')}>
                      <DateText value={l.date} />
                    </td>
                    <td data-label={t('accounting.number')}>
                      <bdi dir="ltr">{l.number}</bdi>
                    </td>
                    <td data-label={t('accounting.event')}>
                      {sourceLabel(t, l.source)} <bdi dir="auto">{l.memo}</bdi>
                    </td>
                    <td className="num" data-label={t('accounting.debit')}>{l.debit ? money(l.debit, currency) : ''}</td>
                    <td className="num" data-label={t('accounting.credit')}>{l.credit ? money(l.credit, currency) : ''}</td>
                    <td className="num" data-label={t('accounting.balance')}>{money(l.balance, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }
  const rows = data.rows as {
    patientId: string;
    fullName: string;
    patientNumber: string;
    count: number;
    buckets: Record<string, number>;
    total: number;
  }[];
  const totals = data.totals as Record<string, number>;
  const buckets = ['d0_30', 'd31_60', 'd61_90', 'd90plus'];
  return (
    <section className="card" aria-labelledby="aging-title">
      <div className="section-header">
        <h2 id="aging-title">{t('accounting.reports.aging')}</h2>
        {rows.length > 0 && (
          <button
            type="button"
            className="button button--secondary"
            onClick={() =>
              downloadCsv('receivables-aging.csv', [
                [t('accounting.patient'), ...buckets.map((b) => t(`accounting.buckets.${b}`)), t('accounting.total')],
                ...rows.map((r) => [`${r.fullName} #${r.patientNumber}`, ...buckets.map((b) => csvMoney(r.buckets[b] ?? 0)), csvMoney(r.total)]),
              ])
            }
          >
            {t('reportsHub.downloadCsv')}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon="check">{t('accounting.noOpenInvoices')}</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="data-table data-table--scroll" data-testid="aging">
            <thead>
              <tr>
                <th scope="col">{t('accounting.patient')}</th>
                {buckets.map((b) => (
                  <th key={b} scope="col" className="num">
                    {t(`accounting.buckets.${b}`)}
                  </th>
                ))}
                <th scope="col" className="num">{t('accounting.total')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.patientId}>
                  <td data-label={t('accounting.patient')}>
                    <Link to={`/app/${orgId}/finance/patients/${r.patientId}`}>{r.fullName}</Link> <bdi dir="ltr">{r.patientNumber}</bdi>
                  </td>
                  {buckets.map((b) => (
                    <td key={b} className="num" data-label={t(`accounting.buckets.${b}`)}>
                      {money(r.buckets[b] ?? 0, currency)}
                    </td>
                  ))}
                  <td className="num" data-label={t('accounting.total')}>{money(r.total, currency)}</td>
                </tr>
              ))}
              <tr className="row-total">
                <th scope="row">{t('accounting.total')}</th>
                {buckets.map((b) => (
                  <td key={b} className="num" data-label={t(`accounting.buckets.${b}`)}>
                    {money(totals[b] ?? 0, currency)}
                  </td>
                ))}
                <td className="num" data-label={t('accounting.total')}>{money(totals.total ?? 0, currency)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Periods

type Periods = {
  lockedThrough: string | null;
  months: {
    month: string;
    start: string;
    end: string;
    status: 'closed' | 'open';
    ended: boolean;
  }[];
  history: {
    month: string;
    action: 'closed' | 'reopened';
    reason: string;
    at: string;
  }[];
};

export function PeriodsPage() {
  const { t } = useTranslation();
  const { orgId, can, detail } = useOrg();
  useDocumentTitle(t('accounting.periodsTitle'));
  const fmt = useFormatters();
  const queryClient = useQueryClient();
  const settings = useAccountingSettings();
  const configured = settings.data?.configured === true;
  const periods = useQuery({
    queryKey: accountingKeys.periods(orgId),
    queryFn: ({ signal }) => api<Periods>(`/orgs/${orgId}/accounting/periods`, { signal }),
    enabled: configured,
  });
  const [reason, setReason] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: accountingKeys.all(orgId) });
  const close = useMutation({
    mutationFn: (month: string) =>
      api(`/orgs/${orgId}/accounting/periods/close`, {
        method: 'POST',
        body: { month },
      }),
    onSuccess: () => (showToast(t('accounting.monthClosed')), refresh()),
  });
  const reopen = useMutation({
    mutationFn: (month: string) =>
      api(`/orgs/${orgId}/accounting/periods/reopen`, {
        method: 'POST',
        body: { month, reason },
      }),
    onSuccess: () => (showToast(t('accounting.monthReopened')), setReason(''), refresh()),
  });
  const orgWide = detail.membership.branchScope.type === 'all';
  const months = periods.data?.months ?? [];
  const nextToClose = [...months].reverse().find((m) => m.status === 'open');
  const latestClosed = months.find((m) => m.status === 'closed');
  return (
    <>
      <PageHeader title={t('accounting.periodsTitle')} subtitle={t('accounting.periodsSubtitle')} />
      <AccountingNav />
      {settings.isSuccess && !configured && <NotSetUp />}
      {periods.isError && <ErrorState message={errorMessage(t, periods.error)} onRetry={() => periods.refetch()} />}
      {periods.isSuccess && (
        <section className="card" aria-labelledby="months-title">
          <h2 id="months-title">{t('accounting.months')}</h2>
          <ul className="data-list" data-testid="periods">
            {months.map((m) => (
              <li key={m.month} className="data-row">
                <div className="data-main">
                  <h3>
                    <bdi dir="ltr">{m.month}</bdi>
                  </h3>
                  <p className="muted">
                    <bdi dir="ltr">
                      {m.start} → {m.end}
                    </bdi>
                  </p>
                </div>
                <span className={m.status === 'closed' ? 'badge' : 'badge badge--active'}>{t(`accounting.periodStatus.${m.status}`)}</span>
                <div className="row-actions">
                  {m === nextToClose && m.ended && orgWide && can('accounting.period.close') && (
                    <button type="button" className="button button--secondary" disabled={close.isPending} onClick={() => close.mutate(m.month)}>
                      {t('accounting.closeMonth')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {close.isError && <Notice kind="error">{errorMessage(t, close.error)}</Notice>}
        </section>
      )}
      {periods.isSuccess && latestClosed && can('accounting.period.reopen') && (
        <form
          className="card"
          aria-labelledby="reopen-title"
          onSubmit={(e) => {
            e.preventDefault();
            reopen.mutate(latestClosed.month);
          }}
        >
          <h2 id="reopen-title">{t('accounting.reopenTitle', { month: latestClosed.month })}</h2>
          <p className="muted">{t('accounting.reopenIntro')}</p>
          <Field id="reopen-reason" label={t('accounting.reason')}>
            <input id="reopen-reason" required minLength={10} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {reopen.isError && <Notice kind="error">{errorMessage(t, reopen.error)}</Notice>}
          <div className="form-actions">
            <button type="submit" className="button button--secondary" disabled={reopen.isPending}>
              {t('accounting.reopen')}
            </button>
          </div>
        </form>
      )}
      {periods.isSuccess && periods.data.history.length > 0 && (
        <section className="card" aria-labelledby="period-history-title">
          <h2 id="period-history-title">{t('accounting.periodHistory')}</h2>
          <ul className="data-list">
            {periods.data.history.map((h, i) => (
              <li key={i} className="data-row">
                <div className="data-main">
                  <h3>
                    {t(`accounting.periodActions.${h.action}`)} <bdi dir="ltr">{h.month}</bdi>
                  </h3>
                  {h.reason && (
                    <p>
                      <bdi dir="auto">{h.reason}</bdi>
                    </p>
                  )}
                </div>
                <span className="muted">{fmt.date(h.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
