import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PatientContextHeader } from '../components/PatientContextHeader';
import { useDeferredValue, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { OrganizationLetterhead } from '../components/OrganizationProfile';
import { InvoiceInstallments } from './InstallmentPages';
import { Icon, type IconName } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import { revealAndFocus } from '../lib/a11y';
import { ApiError, api, query } from '../lib/api';
import { newRequestKey } from '../lib/clinical';
import { errorMessage, fieldErrors, fieldMessage } from '../lib/errors';
import { PAYMENT_METHODS, moneyInput, parseMoney, type Account, type Charge, type DocumentContext, type FinanceReport, type FinanceService, type Invoice, type Payment, type Statement, type Adjustment } from '../lib/finance';
import { useFormatters } from '../lib/format';
import { todayIn } from '../lib/time';
import { showToast } from '../lib/toast';
import type { Page, PatientSummary } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { orgKeys, useOrg } from '../org/context';
import { ConfirmAction, DataTable } from '../components/data';
import { ActionBar, CardGrid } from '../components/layout';
import { useMoney } from '../lib/money';

// Clinic finances (docs/architecture/FINANCE.md). Amounts are integer minor units; all totals are
// computed by the API. Labelled printouts are ordinary invoices/receipts — not tax invoices.

function useFinanceSettings() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: orgKeys.financeSettings(orgId),
    queryFn: ({ signal }) => api<{ currency: string | null; currencyLocked: boolean; supportedCurrencies: string[] }>(`/orgs/${orgId}/finance/settings`, { signal }),
  });
}

/** A money input that accepts "750.50" (Arabic digits too) and yields minor units or null. */
function MoneyField({ id, label, value, onChange, error }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string }) {
  const { t } = useTranslation();
  const invalid = value !== '' && parseMoney(value) === null;
  return (
    <Field id={id} label={label} hint={t('finance.amountHint')} error={invalid ? t('finance.invalidAmount') : error}>
      <input id={id} inputMode="decimal" autoComplete="off" value={value} aria-invalid={invalid || Boolean(error)} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function CurrencySetup() {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const queryClient = useQueryClient();
  const settings = useFinanceSettings();
  const [currency, setCurrency] = useState('EGP');
  const save = useMutation({
    mutationFn: () => api(`/orgs/${orgId}/finance/settings`, { method: 'PUT', body: { currency } }),
    onSuccess: () => {
      showToast(t('finance.currencySaved'));
      return queryClient.invalidateQueries({ queryKey: orgKeys.financeSettings(orgId) });
    },
  });
  if (!settings.isSuccess || settings.data.currency) return null;
  return (
    <Notice kind="info">
      <p>{t('finance.currencyRequired')}</p>
      {can('finance.settings.manage') && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field id="finance-currency" label={t('finance.currency')}>
            <select id="finance-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {settings.data.supportedCurrencies.map((c) => (
                <option key={c} value={c}>
                  {t(`finance.currencies.${c}`)}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className="button button--primary" disabled={save.isPending}>
            {t('finance.setCurrency')}
          </button>
          {save.isError && <span className="field-error">{errorMessage(t, save.error)}</span>}
        </form>
      )}
    </Notice>
  );
}

// ---------------------------------------------------------------------------------------------

export function FinancePage() {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  useDocumentTitle(t('finance.title'));
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const params = { q, status: 'active', pageSize: 10 };
  const patients = useQuery({
    queryKey: orgKeys.patients(orgId, params),
    queryFn: ({ signal }) => api<Page<PatientSummary>>(`/orgs/${orgId}/patients${query(params)}`, { signal }),
    enabled: q.length >= 2 && can('patient.list'),
  });
  return (
    <>
      <PageHeader title={t('finance.title')} subtitle={t('finance.subtitle')} help={t('finance.notTaxNotice')}>
        {can('finance.catalog.read') && (
          <Link className="button button--secondary" to={`/app/${orgId}/finance/services`}>
            {t('finance.services')}
          </Link>
        )}
      </PageHeader>
      <CurrencySetup />
      <CardGrid wide>
        {can('finance.account.read') && (
          <section className="card" aria-labelledby="finance-patients-title">
            <h2 id="finance-patients-title">{t('finance.patientAccounts')}</h2>
            <Field id="finance-search" label={t('patients.search')} hint={t('finance.searchHint')}>
              <input id="finance-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('patients.searchPlaceholder')} />
            </Field>
            {patients.isSuccess && patients.data.data.length === 0 && <EmptyState icon="search">{t('patients.noMatches')}</EmptyState>}
            {patients.isSuccess && patients.data.data.length > 0 && (
              <ul className="data-list" data-testid="finance-patient-results">
                {patients.data.data.map((p) => (
                  <li key={p.id} className="data-row">
                    <Link to={`/app/${orgId}/finance/patients/${p.id}`}>
                      <bdi>{p.fullName}</bdi> (<bdi dir="ltr">#{p.patientNumber}</bdi>)
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {can('finance.report.read') && <FinanceReportCard />}
      </CardGrid>
    </>
  );
}

/** No invoices, payments, adjustments or balances in the period: say so instead of an empty card. */
const isEmptyReport = (r: FinanceReport) =>
  r.invoiced.length + r.collected.length + r.adjustments.length + r.outstanding.length + r.byService.length === 0;

function FinanceReportCard() {
  const { t } = useTranslation();
  const { orgId, timeZone } = useOrg();
  const money = useMoney();
  // The organization's calendar day, not UTC's: just after midnight in Cairo it is already the next day.
  const today = timeZone ? todayIn(timeZone) : new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const params = { from, to };
  const report = useQuery({
    queryKey: orgKeys.financeReport(orgId, params),
    queryFn: ({ signal }) => api<FinanceReport>(`/orgs/${orgId}/finance/reports/summary${query(params)}`, { signal }),
  });
  return (
    <section className="card" aria-labelledby="finance-report-title" data-testid="finance-report">
      <h2 id="finance-report-title">{t('finance.report')}</h2>
      <div className="inline-form">
        <Field id="report-from" label={t('finance.from')}>
          <input id="report-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field id="report-to" label={t('finance.to')}>
          <input id="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {report.isPending && <Loading />}
      {report.isError && <ErrorState message={errorMessage(t, report.error)} />}
      {report.isSuccess && isEmptyReport(report.data) && <EmptyState icon="chart">{t('finance.reportEmpty')}</EmptyState>}
      {report.isSuccess && !isEmptyReport(report.data) && (
        <dl className="details">
          {report.data.invoiced.map((g) => (
            <div key={`inv-${g.currency}`}>
              <dt>{t('finance.invoicedCount', { n: g.count })}</dt>
              <dd>{money(g.total, g.currency)}</dd>
            </div>
          ))}
          {report.data.invoiced.map((g) => (
            <div key={`disc-${g.currency}`}>
              <dt>{t('finance.discounts')}</dt>
              <dd>{money(g.discounts, g.currency)}</dd>
            </div>
          ))}
          {report.data.collected.map((g) => (
            <div key={`col-${g.currency}-${g.method}`}>
              <dt>{t('finance.collectedBy', { method: t(`finance.methods.${g.method}`) })}</dt>
              <dd>{money(g.amount, g.currency)}</dd>
            </div>
          ))}
          {report.data.adjustments.map((g) => (
            <div key={`adj-${g.currency}-${g.type}`}>
              <dt>{t(`finance.adjustmentTypes.${g.type}`)}</dt>
              <dd>{money(g.amount, g.currency)}</dd>
            </div>
          ))}
          {report.data.outstanding.map((g) => (
            <div key={`out-${g.currency}`}>
              <dt>{t('finance.outstandingNow')}</dt>
              <dd data-testid="report-outstanding">{money(g.amount, g.currency)}</dd>
            </div>
          ))}
        </dl>
      )}
      {report.isSuccess && report.data.byService.length > 0 && (
        <>
          <h3>{t('finance.byService')}</h3>
          <ul className="plain-list">
            {report.data.byService.map((s) => (
              <li key={`${s.currency}-${s.service}`} className="small">
                {s.service} × {s.quantity} — {money(s.amount, s.currency)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

export function ServicesPage() {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const money = useMoney();
  useDocumentTitle(t('finance.services'));
  const queryClient = useQueryClient();
  const services = useQuery({
    queryKey: orgKeys.financeServices(orgId),
    queryFn: ({ signal }) => api<{ data: FinanceService[] }>(`/orgs/${orgId}/finance/services`, { signal }).then((r) => r.data),
  });
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/finance/services`, {
        method: 'POST',
        body: { code: code.trim() || nextServiceCode(services.data ?? []), name, price: parseMoney(price) },
      }),
    onSuccess: async () => {
      setCode('');
      setName('');
      setPrice('');
      await queryClient.invalidateQueries({ queryKey: orgKeys.financeServices(orgId) });
    },
  });
  const fields = fieldErrors(create.error);
  return (
    <>
      <PageHeader title={t('finance.services')} subtitle={t('finance.servicesHint')} />
      <CurrencySetup />
      {services.isPending && <Loading />}
      {services.isSuccess && services.data.length === 0 && <EmptyState icon="card">{t('finance.noServices')}</EmptyState>}
      {services.isSuccess && services.data.length > 0 && (
        <ul className="data-list" data-testid="service-list">
          {services.data.map((s) => (
            <ServiceRow key={s.id} service={s} money={money} />
          ))}
        </ul>
      )}
      {can('finance.catalog.manage') && (
        <section className="card" aria-labelledby="new-service-title">
          <h2 id="new-service-title">{t('finance.newService')}</h2>
          {create.isError && Object.keys(fields).length === 0 && <Notice kind="error">{errorMessage(t, create.error)}</Notice>}
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (parseMoney(price) !== null) create.mutate();
            }}
          >
            <Field
              id="service-code"
              label={`${t('finance.serviceCode')} ${t('common.optional')}`}
              hint={t('finance.serviceCodeAuto', { code: nextServiceCode(services.data ?? []) })}
              error={fieldMessage(t, 'code', fields.code)}
            >
              <input id="service-code" dir="ltr" maxLength={20} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </Field>
            <Field id="service-name" label={t('finance.serviceName')} error={fieldMessage(t, 'name', fields.name)}>
              <input id="service-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <MoneyField id="service-price" label={t('finance.price')} value={price} onChange={setPrice} error={fieldMessage(t, 'price', fields.price)} />
            <ActionBar>
              <button type="submit" className="button button--primary" disabled={create.isPending || parseMoney(price) === null}>
                {t('finance.addService')}
              </button>
            </ActionBar>
          </form>
        </section>
      )}
    </>
  );
}

/** The next free "SRV-001"-style code, for a service saved without one. */
function nextServiceCode(services: FinanceService[]) {
  const used = new Set(services.map((s) => s.code));
  for (let n = services.length + 1; ; n++) {
    const code = `SRV-${String(n).padStart(3, '0')}`;
    if (!used.has(code)) return code;
  }
}

function ServiceRow({ service, money }: { service: FinanceService; money: ReturnType<typeof useMoney> }) {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(moneyInput(service.price));
  const update = useMutation({
    mutationFn: (body: object) => api(`/orgs/${orgId}/finance/services/${service.id}`, { method: 'PATCH', body: { ...body, version: service.version } }),
    onSuccess: async () => {
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: orgKeys.financeServices(orgId) });
    },
  });
  return (
    <li className="data-row" data-testid="service-row">
      <div className="data-main">
        <strong>
          <bdi dir="ltr">{service.code}</bdi> — <bdi>{service.name}</bdi>
        </strong>
        <span className="muted small">{money(service.price, service.currency)}</span>
      </div>
      <div className="data-meta">
        <span className={`badge badge--${service.status}`}>{t(`finance.serviceStatus.${service.status}`)}</span>
      </div>
      {can('finance.catalog.manage') && (
        <div className="row-actions">
          {editing ? (
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const minor = parseMoney(price);
                if (minor !== null) update.mutate({ price: minor });
              }}
            >
              <MoneyField id={`price-${service.id}`} label={t('finance.price')} value={price} onChange={setPrice} />
              <button type="submit" className="button button--primary" disabled={update.isPending}>
                {t('common.save')}
              </button>
            </form>
          ) : (
            <button type="button" className="button button--secondary" onClick={() => setEditing(true)}>
              {t('finance.changePrice')}
            </button>
          )}
          {service.status === 'active' ? (
            <ConfirmAction
              label={t('finance.deactivate')}
              message={t('finance.deactivateMessage')}
              confirmLabel={t('finance.deactivateConfirm')}
              pending={update.isPending}
              onConfirm={() => update.mutate({ status: 'inactive' })}
            />
          ) : (
            <button type="button" className="button button--secondary" onClick={() => update.mutate({ status: 'active' })}>
              {t('finance.activate')}
            </button>
          )}
          {update.isError && <span className="field-error">{errorMessage(t, update.error)}</span>}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------

export function PatientAccountPage() {
  const { t } = useTranslation();
  const { patientId = '' } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const payInvoice = params.get('pay');
  const { orgId, can, branches, selectedBranchId } = useOrg();
  const money = useMoney();
  const fmt = useFormatters();
  const queryClient = useQueryClient();
  useDocumentTitle(t('finance.account'));
  const account = useQuery({
    queryKey: orgKeys.financeAccount(orgId, patientId),
    queryFn: ({ signal }) => api<Account>(`/orgs/${orgId}/finance/patients/${patientId}/account`, { signal }),
  });
  const statement = useQuery({
    queryKey: orgKeys.financeStatement(orgId, patientId),
    queryFn: ({ signal }) => api<Statement>(`/orgs/${orgId}/finance/patients/${patientId}/statement`, { signal }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['org', orgId, 'finance'] });
  // null until the user changes the selection: then the default (all pending charges of the first
  // charge's branch — one invoice is for one branch) applies.
  const [picked, setSelected] = useState<string[] | null>(null);
  const makeInvoice = useMutation({
    mutationFn: (charges: Charge[]) =>
      api<{ invoice: Invoice }>(`/orgs/${orgId}/finance/invoices`, { method: 'POST', body: { patientId, branchId: charges[0]?.branchId, chargeIds: charges.map((c) => c.id) } }),
    onSuccess: async ({ invoice }) => {
      setSelected(null);
      showToast(t('finance.invoiceDrafted'));
      await refresh();
      navigate(`/app/${orgId}/finance/invoices/${invoice.id}`);
    },
  });

  if (account.isPending) return <Loading />;
  if (account.isError) {
    if (account.error instanceof ApiError && account.error.status === 404) return <ErrorState message={t('errors.NOT_FOUND')} />;
    return <ErrorState message={errorMessage(t, account.error)} onRetry={() => void account.refetch()} />;
  }
  const a = account.data;
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const pending = a.charges.filter((c) => c.status === 'pending');
  const selected = picked ?? pending.filter((c) => c.branchId === pending[0]?.branchId).map((c) => c.id);
  const chosen = pending.filter((c) => selected.includes(c.id));
  const sameBranch = new Set(chosen.map((c) => c.branchId)).size <= 1;
  const defaultBranch = selectedBranchId !== 'all' ? selectedBranchId : (branches[0]?.id ?? '');

  return (
    <>
      <PatientContextHeader patient={a.patient} />
      <CurrencySetup />
      <section className="card" aria-labelledby="balance-title" data-testid="account-balance">
        <h2 id="balance-title">{t('finance.balance')}</h2>
        <dl className="details">
          <div>
            <dt>{t('finance.outstanding')}</dt>
            <dd data-testid="balance-outstanding">{money(a.balance.outstanding, a.currency)}</dd>
          </div>
          <div>
            <dt>{t('finance.unallocatedCredit')}</dt>
            <dd>{money(a.balance.unallocatedCredit, a.currency)}</dd>
          </div>
          <div>
            <dt>{t('finance.net')}</dt>
            <dd data-testid="balance-net">{money(a.balance.net, a.currency)}</dd>
          </div>
        </dl>
      </section>

      <CardGrid wide>
        <section className="card" aria-labelledby="charges-title">
          <h2 id="charges-title">{t('finance.pendingCharges')}</h2>
          {pending.length === 0 ? (
            <EmptyState icon="wallet">{t('finance.noPendingCharges')}</EmptyState>
          ) : (
            <ul className="data-list" data-testid="pending-charges">
              {pending.map((c) => (
                <li key={c.id} className="data-row">
                  <label className="choice">
                    <input
                      type="checkbox"
                      checked={selected.includes(c.id)}
                      onChange={(e) => setSelected(e.target.checked ? [...selected, c.id] : selected.filter((x) => x !== c.id))}
                    />
                    <bdi>{c.description}</bdi> × {c.quantity} — {money(c.amount, c.currency)}
                  </label>
                  <span className="muted small">
                    {branchName.get(c.branchId) ?? '—'}
                    {c.source.type !== 'manual' && <> · {t(`finance.sources.${c.source.type}`)}</>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {can('finance.invoice.manage') && pending.length > 0 && (
            <>
              {!sameBranch && <p className="field-error">{t('finance.oneBranchPerInvoice')}</p>}
              {makeInvoice.isError && <Notice kind="error">{errorMessage(t, makeInvoice.error)}</Notice>}
              <button type="button" className="button button--primary" disabled={chosen.length === 0 || !sameBranch || makeInvoice.isPending} onClick={() => makeInvoice.mutate(chosen)}>
                {t('finance.createInvoice')}
              </button>
            </>
          )}
          {can('finance.charge.create') && (
            <ActionPanel title={t('finance.addCharge')} icon="plus">
              <AddCharge patientId={patientId} defaultBranch={defaultBranch} onDone={refresh} />
            </ActionPanel>
          )}
        </section>

        <section className="card" aria-labelledby="invoices-title">
          <h2 id="invoices-title">{t('finance.invoices')}</h2>
          {a.invoices.length === 0 ? (
            <EmptyState icon="file">{t('finance.noInvoices')}</EmptyState>
          ) : (
            <ul className="data-list" data-testid="invoice-list">
              {a.invoices.map((i) => (
                <li key={i.id} className="data-row">
                  <div className="data-main">
                    <Link to={`/app/${orgId}/finance/invoices/${i.id}`}>{i.number ?? t('finance.draftInvoice')}</Link>
                    <span className="muted small">
                      {money(i.total, i.currency)} · {t('finance.balanceShort', { amount: money(i.balance, i.currency) })}
                    </span>
                  </div>
                  <div className="data-meta">
                    <span className={`badge badge--invoice-${i.status}`}>{t(`finance.invoiceStatus.${i.status}`)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardGrid>

      <CardGrid wide>
        <section className="card" aria-labelledby="payments-title">
          <h2 id="payments-title">{t('finance.payments')}</h2>
          {a.payments.length === 0 ? (
            <EmptyState icon="wallet">{t('finance.noPayments')}</EmptyState>
          ) : (
            <ul className="data-list" data-testid="payment-list">
              {a.payments.map((p) => (
                <PaymentRow key={p.id} payment={p} invoices={a.invoices} onDone={refresh} />
              ))}
            </ul>
          )}
          {can('finance.payment.record') && a.currency && (
            <ActionPanel title={t('finance.recordPayment')} icon="wallet" open={Boolean(payInvoice)}>
              <RecordPayment patientId={patientId} defaultBranch={defaultBranch} invoices={a.invoices} onDone={refresh} preferredInvoice={payInvoice} />
            </ActionPanel>
          )}
        </section>

        <section className="card" aria-labelledby="statement-title">
          <h2 id="statement-title">{t('finance.statement')}</h2>
          {statement.isSuccess && statement.data.entries.length === 0 && <EmptyState icon="file">{t('finance.noEntries')}</EmptyState>}
          {statement.isSuccess && statement.data.entries.length > 0 && (
            <DataTable
              testId="statement"
              scroll
              rows={statement.data.entries.map((e, index) => ({ ...e, index }))}
              rowKey={(e) => String(e.index)}
              columns={[
                { key: 'at', label: t('finance.date'), cell: (e) => fmt.date(e.at) },
                {
                  key: 'document',
                  label: t('finance.document'),
                  cell: (e) => (
                    <>
                      {t(`finance.entryTypes.${e.type}`)} <bdi dir="ltr">{e.number}</bdi>
                    </>
                  ),
                },
                { key: 'debit', label: t('finance.debit'), numeric: true, cell: (e) => (e.debit ? money(e.debit, e.currency) : '') },
                { key: 'credit', label: t('finance.credit'), numeric: true, cell: (e) => (e.credit ? money(e.credit, e.currency) : '') },
                { key: 'balance', label: t('finance.runningBalance'), numeric: true, cell: (e) => money(e.balance, e.currency) },
              ]}
            />
          )}
        </section>
      </CardGrid>
    </>
  );
}

/** A form that opens from a button-like summary, so the account shows the records first (UX-036). */
function ActionPanel({ title, icon, open, children }: { title: string; icon: IconName; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="action-panel" open={open}>
      <summary className="button button--secondary">
        <Icon name={icon} /> {title}
      </summary>
      {children}
    </details>
  );
}

function AddCharge({ patientId, defaultBranch, onDone }: { patientId: string; defaultBranch: string; onDone: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const { orgId, branches } = useOrg();
  const money = useMoney();
  const [branchId, setBranchId] = useState(defaultBranch);
  const [serviceId, setServiceId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const key = useRef(newRequestKey());
  const services = useQuery({
    queryKey: orgKeys.financeServices(orgId, branchId),
    queryFn: ({ signal }) => api<{ data: FinanceService[] }>(`/orgs/${orgId}/finance/services${query({ branchId, status: 'active' })}`, { signal }).then((r) => r.data),
    enabled: Boolean(branchId),
  });
  const add = useMutation({
    mutationFn: () => api(`/orgs/${orgId}/finance/charges`, { method: 'POST', headers: { 'Idempotency-Key': key.current }, body: { patientId, branchId, serviceId, quantity } }),
    onSuccess: async () => {
      key.current = newRequestKey();
      setServiceId('');
      setQuantity(1);
      showToast(t('finance.chargeAdded'));
      await onDone();
    },
  });
  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    key.current = newRequestKey();
  };
  return (
    <form
      className="specialty-subform"
      aria-label={t('finance.addCharge')}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <h3>{t('finance.addCharge')}</h3>
      {add.isError && <Notice kind="error">{errorMessage(t, add.error)}</Notice>}
      <Field id="charge-branch" label={t('booking.branch')}>
        <select id="charge-branch" value={branchId} onChange={(e) => change(setBranchId)(e.target.value)}>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      <Field id="charge-service" label={t('finance.service')}>
        <select id="charge-service" value={serviceId} onChange={(e) => change(setServiceId)(e.target.value)}>
          <option value="">{t('common.choose')}</option>
          {services.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {money(s.effectivePrice ?? s.price, s.currency)}
            </option>
          ))}
        </select>
      </Field>
      <Field id="charge-quantity" label={t('finance.quantity')}>
        <input id="charge-quantity" type="number" min={1} max={100} value={quantity} onChange={(e) => change(setQuantity)(Math.max(1, Math.min(100, Math.round(Number(e.target.value) || 1))))} />
      </Field>
      <button type="submit" className="button button--secondary" disabled={!serviceId || add.isPending}>
        {t('finance.addCharge')}
      </button>
    </form>
  );
}

function RecordPayment({
  patientId,
  defaultBranch,
  invoices,
  onDone,
  preferredInvoice,
}: {
  patientId: string;
  defaultBranch: string;
  invoices: Invoice[];
  onDone: () => Promise<unknown>;
  /** From an invoice's "record a payment": that invoice is pre-selected and the amount focused (UX-035). */
  preferredInvoice?: string | null;
}) {
  const { t } = useTranslation();
  const { orgId, branches } = useOrg();
  const money = useMoney();
  const open = invoices.filter((i) => i.status === 'issued' && i.balance > 0);
  const [branchId, setBranchId] = useState(defaultBranch);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Payment['method']>('cash');
  const [reference, setReference] = useState('');
  // null = automatic: the oldest open invoice, following the list as it refreshes; '' = keep as credit.
  const [chosenInvoice, setInvoiceId] = useState<string | null>(null);
  const invoiceId = chosenInvoice ?? (open.some((i) => i.id === preferredInvoice) ? preferredInvoice! : (open.at(-1)?.id ?? ''));
  const amountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (preferredInvoice) revealAndFocus(amountRef.current?.querySelector('input') ?? null);
  }, [preferredInvoice]);
  const [done, setDone] = useState<string | null>(null);
  const key = useRef(newRequestKey());
  const minor = parseMoney(amount);
  const target = open.find((i) => i.id === invoiceId);
  const allocation = target && minor ? Math.min(minor, target.balance) : 0;
  const record = useMutation({
    mutationFn: () =>
      api<{ payment: Payment }>(`/orgs/${orgId}/finance/payments`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key.current },
        body: { patientId, branchId, amount: minor, method, reference, allocations: allocation > 0 && target ? [{ invoiceId: target.id, amount: allocation }] : [] },
      }),
    onSuccess: async (r) => {
      setDone(r.payment.id);
      setAmount('');
      setReference('');
      key.current = newRequestKey();
      await onDone();
    },
  });
  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDone(null);
    key.current = newRequestKey();
  };
  return (
    <form
      className="specialty-subform"
      aria-label={t('finance.recordPayment')}
      onSubmit={(e) => {
        e.preventDefault();
        if (minor) record.mutate();
      }}
    >
      <h3>{t('finance.recordPayment')}</h3>
      <p className="muted small">{t('finance.paymentHint')}</p>
      {done && (
        <Notice kind="success">
          {t('finance.paymentRecorded')}{' '}
          <Link to={`/app/${orgId}/finance/payments/${done}/print`}>{t('finance.printReceipt')}</Link>
        </Notice>
      )}
      {record.isError && <Notice kind="error">{errorMessage(t, record.error)}</Notice>}
      <Field id="payment-branch" label={t('booking.branch')}>
        <select id="payment-branch" value={branchId} onChange={(e) => change(setBranchId)(e.target.value)}>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      <div ref={amountRef}>
        <MoneyField id="payment-amount" label={t('finance.amount')} value={amount} onChange={change(setAmount)} />
      </div>
      <Field id="payment-method" label={t('finance.method')}>
        <select id="payment-method" value={method} onChange={(e) => change(setMethod)(e.target.value as Payment['method'])}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {t(`finance.methods.${m}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field id="payment-reference" label={`${t('finance.reference')} ${t('common.optional')}`}>
        <input id="payment-reference" maxLength={60} value={reference} onChange={(e) => change(setReference)(e.target.value)} />
      </Field>
      <Field id="payment-invoice" label={t('finance.applyTo')} hint={t('finance.applyHint')}>
        <select id="payment-invoice" value={invoiceId} onChange={(e) => change(setInvoiceId)(e.target.value)}>
          <option value="">{t('finance.keepAsCredit')}</option>
          {open.map((i) => (
            <option key={i.id} value={i.id}>
              {i.number} — {t('finance.balanceShort', { amount: money(i.balance, i.currency) })}
            </option>
          ))}
        </select>
      </Field>
      {allocation > 0 && minor !== null && minor > allocation && <p className="muted small">{t('finance.remainderAsCredit', { amount: money(minor - allocation, target?.currency) })}</p>}
      <button type="submit" className="button button--primary" disabled={!minor || record.isPending}>
        {t('finance.recordPayment')}
      </button>
    </form>
  );
}

function PaymentRow({ payment, invoices, onDone }: { payment: Payment; invoices: Invoice[]; onDone: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const money = useMoney();
  const fmt = useFormatters();
  const [action, setAction] = useState<null | 'allocate' | 'refund' | 'reverse'>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const open = invoices.filter((i) => i.status === 'issued' && i.balance > 0);
  const [invoiceId, setInvoiceId] = useState(open[0]?.id ?? '');
  const key = useRef(newRequestKey());
  const run = useMutation({
    mutationFn: () => {
      if (action === 'allocate') return api(`/orgs/${orgId}/finance/payments/${payment.id}/allocations`, { method: 'POST', body: { invoiceId, amount: parseMoney(amount) } });
      if (action === 'refund')
        return api(`/orgs/${orgId}/finance/payments/${payment.id}/refunds`, { method: 'POST', headers: { 'Idempotency-Key': key.current }, body: { amount: parseMoney(amount), reason } });
      return api(`/orgs/${orgId}/finance/payments/${payment.id}/reverse`, { method: 'POST', body: { reason } });
    },
    onSuccess: async () => {
      setAction(null);
      setAmount('');
      setReason('');
      key.current = newRequestKey();
      await onDone();
    },
  });
  return (
    <li className="data-row" data-testid="payment-row">
      <div className="data-main">
        <Link to={`/app/${orgId}/finance/payments/${payment.id}/print`}>
          <bdi dir="ltr">{payment.number}</bdi>
        </Link>
        <span className="muted small">
          {fmt.date(payment.receivedAt)} · {money(payment.amount, payment.currency)} · {t(`finance.methods.${payment.method}`)} ·{' '}
          {t('finance.unallocatedShort', { amount: money(payment.unallocated, payment.currency) })}
        </span>
      </div>
      <div className="data-meta">
        <span className={`badge badge--payment-${payment.status}`}>{t(`finance.paymentStatus.${payment.status}`)}</span>
      </div>
      {payment.status === 'active' && (
        <div className="row-actions">
          {payment.unallocated > 0 && can('finance.payment.record') && open.length > 0 && (
            <button type="button" className="button button--secondary" onClick={() => setAction('allocate')}>
              {t('finance.allocate')}
            </button>
          )}
          {payment.unallocated > 0 && can('finance.adjustment.manage') && (
            <button type="button" className="button button--secondary" onClick={() => setAction('refund')}>
              {t('finance.refund')}
            </button>
          )}
          {payment.refunded === 0 && can('finance.adjustment.manage') && (
            <button type="button" className="button button--secondary" onClick={() => setAction('reverse')}>
              {t('finance.reverse')}
            </button>
          )}
        </div>
      )}
      {action && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            run.mutate();
          }}
        >
          {run.isError && <Notice kind="error">{errorMessage(t, run.error)}</Notice>}
          {action === 'allocate' && (
            <Field id={`alloc-${payment.id}`} label={t('finance.applyTo')}>
              <select id={`alloc-${payment.id}`} value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
                {open.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.number} — {t('finance.balanceShort', { amount: money(i.balance, i.currency) })}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {action !== 'reverse' && <MoneyField id={`amt-${payment.id}`} label={t('finance.amount')} value={amount} onChange={setAmount} />}
          {action !== 'allocate' && (
            <Field id={`reason-${payment.id}`} label={t('finance.reason')}>
              <input id={`reason-${payment.id}`} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          {action === 'reverse' && <p className="muted small">{t('finance.reverseHint')}</p>}
          <button type="submit" className={`button ${action === 'reverse' ? 'button--danger' : 'button--primary'}`} disabled={run.isPending}>
            {t(`finance.confirm.${action}`)}
          </button>
          <button type="button" className="button button--secondary" onClick={() => setAction(null)}>
            {t('common.cancel')}
          </button>
        </form>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------

type InvoiceView = DocumentContext & { invoice: Invoice; payments: (Payment & { allocatedHere: number })[]; creditNotes: Adjustment[] };

function useInvoice(invoiceId: string) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: orgKeys.financeInvoice(orgId, invoiceId),
    queryFn: ({ signal }) => api<InvoiceView>(`/orgs/${orgId}/finance/invoices/${invoiceId}`, { signal }),
  });
}

export function InvoicePage() {
  const { t } = useTranslation();
  const { invoiceId = '' } = useParams();
  const { orgId, can } = useOrg();
  const money = useMoney();
  const fmt = useFormatters();
  const queryClient = useQueryClient();
  useDocumentTitle(t('finance.invoice'));
  const view = useInvoice(invoiceId);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['org', orgId, 'finance'] });
  const [discount, setDiscount] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [credit, setCredit] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const issueKey = useRef(newRequestKey());
  const creditKey = useRef(newRequestKey());
  const confirmRef = useRef<HTMLHeadingElement>(null);
  // The confirmation appears below the buttons: bring it into view and onto it (UX-034).
  useEffect(() => {
    if (confirmIssue) revealAndFocus(confirmRef.current);
  }, [confirmIssue]);
  const applyDiscount = useMutation({
    mutationFn: (inv: Invoice) =>
      api(`/orgs/${orgId}/finance/invoices/${inv.id}/discount`, { method: 'PUT', body: { amount: parseMoney(discount) ?? 0, reason: discountReason, version: inv.version } }),
    onSuccess: refresh,
  });
  const issue = useMutation({
    mutationFn: (inv: Invoice) => api(`/orgs/${orgId}/finance/invoices/${inv.id}/issue`, { method: 'POST', headers: { 'Idempotency-Key': issueKey.current }, body: { version: inv.version } }),
    onSuccess: async () => {
      setConfirmIssue(false);
      showToast(t('finance.invoiceIssued'));
      await refresh();
    },
    onError: () => {
      issueKey.current = newRequestKey();
    },
  });
  const discard = useMutation({ mutationFn: (inv: Invoice) => api(`/orgs/${orgId}/finance/invoices/${inv.id}/discard`, { method: 'POST', body: {} }), onSuccess: refresh });
  const creditNote = useMutation({
    mutationFn: (inv: Invoice) =>
      api(`/orgs/${orgId}/finance/invoices/${inv.id}/credit-notes`, { method: 'POST', headers: { 'Idempotency-Key': creditKey.current }, body: { amount: parseMoney(credit), reason: creditReason } }),
    onSuccess: async () => {
      setCredit('');
      setCreditReason('');
      creditKey.current = newRequestKey();
      await refresh();
    },
  });
  if (view.isPending) return <Loading />;
  if (view.isError) return <ErrorState message={errorMessage(t, view.error)} onRetry={() => void view.refetch()} />;
  const { invoice: inv, patient, payments, creditNotes } = view.data;
  return (
    <>
      <PageHeader
        back={
          patient
            ? { to: `/app/${orgId}/finance/patients/${patient.id}`, label: t('finance.account') }
            : { to: `/app/${orgId}/finance`, label: t('nav.finance') }
        }
        title={inv.number ?? t('finance.draftInvoice')} subtitle={patient ? `\u2068${patient.fullName}\u2069 (#${fmt.number(patient.patientNumber)})` : undefined}>
        <span className={`badge badge--invoice-${inv.status}`} data-testid="invoice-status">
          {t(`finance.invoiceStatus.${inv.status}`)}
        </span>
        {inv.status === 'issued' && (
          <Link className="button button--secondary" to={`/app/${orgId}/finance/invoices/${inv.id}/print`}>
            {t('finance.print')}
          </Link>
        )}
      </PageHeader>
      {patient && (
        <p className="muted small">
          <Link to={`/app/${orgId}/finance/patients/${patient.id}`}>{t('finance.backToAccount')}</Link>
        </p>
      )}
      {/* The natural next step for an issued invoice with something left to pay (UX-035). */}
      {inv.status === 'issued' && inv.balance > 0 && patient && can('finance.payment.record') && (
        <ActionBar className="invoice-next">
          <Link className="button button--primary" to={`/app/${orgId}/finance/patients/${patient.id}?pay=${inv.id}`}>
            <Icon name="wallet" /> {t('finance.payThisInvoice')}
          </Link>
        </ActionBar>
      )}
      <InvoiceTable invoice={inv} money={money} />
      <InvoiceInstallments invoice={inv} />
      {inv.status === 'draft' && (
        <section className="card" aria-labelledby="draft-actions-title">
          <h2 id="draft-actions-title">{t('finance.draftActions')}</h2>
          {can('finance.discount.apply') && (
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                applyDiscount.mutate(inv);
              }}
            >
              <MoneyField id="discount-amount" label={t('finance.discount')} value={discount} onChange={setDiscount} />
              <Field id="discount-reason" label={t('finance.reason')}>
                <input id="discount-reason" maxLength={300} value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} />
              </Field>
              <button type="submit" className="button button--secondary" disabled={applyDiscount.isPending}>
                {t('finance.applyDiscount')}
              </button>
              {applyDiscount.isError && <span className="field-error">{errorMessage(t, applyDiscount.error)}</span>}
            </form>
          )}
          <ActionBar>
            <button type="button" id="issue-invoice" className="button button--primary" disabled={confirmIssue} onClick={() => setConfirmIssue(true)}>
              {t('finance.issue')}
            </button>
            <button type="button" className="button button--secondary" disabled={discard.isPending} onClick={() => discard.mutate(inv)}>
              {t('finance.discard')}
            </button>
          </ActionBar>
          {confirmIssue && (
            <div className="confirm-panel" role="alertdialog" aria-labelledby="confirm-issue-title">
              <h3 id="confirm-issue-title" ref={confirmRef} tabIndex={-1}>
                {t('finance.confirmIssueTitle')}
              </h3>
              <p>{t('finance.confirmIssueBody')}</p>
              {issue.isError && <Notice kind="error">{errorMessage(t, issue.error)}</Notice>}
              <ActionBar>
                <button type="button" className="button button--primary" disabled={issue.isPending} onClick={() => issue.mutate(inv)}>
                  {t('finance.confirmIssue')}
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => {
                    setConfirmIssue(false);
                    document.getElementById('issue-invoice')?.focus();
                  }}
                >
                  {t('common.cancel')}
                </button>
              </ActionBar>
            </div>
          )}
        </section>
      )}
      {inv.status === 'issued' && (
        <CardGrid wide>
          <section className="card" aria-labelledby="invoice-payments-title">
            <h2 id="invoice-payments-title">{t('finance.paymentsApplied')}</h2>
            {payments.length === 0 ? (
              <EmptyState icon="wallet">{t('finance.noPayments')}</EmptyState>
            ) : (
              <ul className="plain-list">
                {payments.map((p) => (
                  <li key={p.id} className="small">
                    <bdi dir="ltr">{p.number}</bdi> — {money(p.allocatedHere, p.currency)}
                    {p.status === 'reversed' && <> ({t('finance.paymentStatus.reversed')})</>}
                  </li>
                ))}
              </ul>
            )}
            {creditNotes.length > 0 && (
              <>
                <h3>{t('finance.creditNotes')}</h3>
                <ul className="plain-list">
                  {creditNotes.map((n) => (
                    <li key={n.id} className="small">
                      <bdi dir="ltr">{n.number}</bdi> — {money(n.amount, n.currency)} — {n.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
          {can('finance.adjustment.manage') && inv.balance > 0 && (
            <section className="card" aria-labelledby="credit-note-title">
              <h2 id="credit-note-title">{t('finance.issueCreditNote')}</h2>
              <p className="muted small">{t('finance.creditNoteHint')}</p>
              <ActionPanel title={t('finance.issueCreditNote')} icon="file">
                <form
                onSubmit={(e) => {
                  e.preventDefault();
                  creditNote.mutate(inv);
                }}
              >
                {creditNote.isError && <Notice kind="error">{errorMessage(t, creditNote.error)}</Notice>}
                <MoneyField id="credit-amount" label={t('finance.amount')} value={credit} onChange={setCredit} />
                <Field id="credit-reason" label={t('finance.reason')}>
                  <input id="credit-reason" maxLength={300} value={creditReason} onChange={(e) => setCreditReason(e.target.value)} />
                </Field>
                <button type="submit" className="button button--secondary" disabled={creditNote.isPending || !parseMoney(credit)}>
                  {t('finance.issueCreditNote')}
                </button>
              </form>
              </ActionPanel>
            </section>
          )}
        </CardGrid>
      )}
    </>
  );
}

function InvoiceTable({ invoice: inv, money }: { invoice: Invoice; money: ReturnType<typeof useMoney> }) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  return (
    <section className="card" aria-labelledby="invoice-lines-title">
      <h2 id="invoice-lines-title">{t('finance.lines')}</h2>
      <DataTable
        testId="invoice-lines"
        rows={inv.lines}
        rowKey={(l) => l.chargeId}
        columns={[
          { key: 'service', label: t('finance.service'), cell: (l) => l.description },
          { key: 'quantity', label: t('finance.quantity'), numeric: true, cell: (l) => fmt.number(l.quantity) },
          { key: 'unitPrice', label: t('finance.unitPrice'), numeric: true, cell: (l) => money(l.unitPrice, inv.currency) },
          { key: 'amount', label: t('finance.amount'), numeric: true, cell: (l) => money(l.amount, inv.currency) },
        ]}
      />
      <dl className="details invoice-totals">
        <div>
          <dt>{t('finance.subtotal')}</dt>
          <dd>{money(inv.subtotal, inv.currency)}</dd>
        </div>
        {inv.discount && (
          <div>
            <dt>{t('finance.discountWithReason', { reason: inv.discount.reason })}</dt>
            <dd>−{money(inv.discount.amount, inv.currency)}</dd>
          </div>
        )}
        <div>
          <dt>{t('finance.total')}</dt>
          <dd data-testid="invoice-total">{money(inv.total, inv.currency)}</dd>
        </div>
        {inv.status === 'issued' && (
          <>
            <div>
              <dt>{t('finance.paid')}</dt>
              <dd>{money(inv.paid, inv.currency)}</dd>
            </div>
            {inv.credited > 0 && (
              <div>
                <dt>{t('finance.credited')}</dt>
                <dd>{money(inv.credited, inv.currency)}</dd>
              </div>
            )}
            <div>
              <dt>{t('finance.balanceDue')}</dt>
              <dd data-testid="invoice-balance">{money(inv.balance, inv.currency)}</dd>
            </div>
          </>
        )}
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Printouts: ordinary invoice / receipt with the raclinic identity, clearly labelled.

function PrintFrame({ title, number, context, date, children }: { title: string; number: string; context: DocumentContext; date: string | null; children: React.ReactNode }) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  useDocumentTitle(`${title} ${number}`);
  return (
    <article className="print-document" data-testid="print-document">
      <div className="no-print form-actions">
        <button type="button" className="button button--primary" onClick={() => window.print()}>
          {t('finance.printNow')}
        </button>
        <span className="muted small">{t('finance.printHint')}</span>
      </div>
      <header className="print-header">
        <OrganizationLetterhead />
        <div>
          <h1>
            {title} <bdi dir="ltr">{number}</bdi>
          </h1>
          <p className="muted small">{t('finance.notTaxDocument')}</p>
        </div>
      </header>
      <dl className="details">
        <div>
          <dt>{t('finance.issuer')}</dt>
          <dd>
            {context.organization.name}
            {context.branch && ` — ${context.branch.name}${context.branch.city ? `، ${context.branch.city}` : ''}`}
          </dd>
        </div>
        {context.patient && (
          <div>
            <dt>{t('finance.billedTo')}</dt>
            <dd>
              {context.patient.fullName} (<bdi dir="ltr">#{fmt.number(context.patient.patientNumber)}</bdi>)
            </dd>
          </div>
        )}
        {date && (
          <div>
            <dt>{t('finance.date')}</dt>
            <dd>{fmt.date(date)}</dd>
          </div>
        )}
      </dl>
      {children}
      <footer className="print-footer muted small">{t('finance.generatedBy')}</footer>
    </article>
  );
}

export function InvoicePrintPage() {
  const { t } = useTranslation();
  const { invoiceId = '' } = useParams();
  const money = useMoney();
  const view = useInvoice(invoiceId);
  if (view.isPending) return <Loading />;
  if (view.isError) return <ErrorState message={errorMessage(t, view.error)} />;
  const { invoice } = view.data;
  if (invoice.status !== 'issued') return <ErrorState message={t('finance.printOnlyIssued')} />;
  return (
    <PrintFrame title={t('finance.invoice')} number={invoice.number ?? ''} context={view.data} date={invoice.issuedAt}>
      <InvoiceTable invoice={invoice} money={money} />
    </PrintFrame>
  );
}

export function ReceiptPrintPage() {
  const { t } = useTranslation();
  const { paymentId = '' } = useParams();
  const { orgId } = useOrg();
  const money = useMoney();
  const view = useQuery({
    queryKey: orgKeys.financePayment(orgId, paymentId),
    queryFn: ({ signal }) => api<DocumentContext & { payment: Payment; refunds: Adjustment[] }>(`/orgs/${orgId}/finance/payments/${paymentId}`, { signal }),
  });
  if (view.isPending) return <Loading />;
  if (view.isError) return <ErrorState message={errorMessage(t, view.error)} />;
  const { payment, refunds } = view.data;
  return (
    <PrintFrame title={t('finance.receipt')} number={payment.number} context={view.data} date={payment.receivedAt}>
      {payment.status === 'reversed' && <Notice kind="error">{t('finance.receiptReversed', { reason: payment.reversal?.reason ?? '' })}</Notice>}
      <dl className="details" data-testid="receipt">
        <div>
          <dt>{t('finance.amountReceived')}</dt>
          <dd>{money(payment.amount, payment.currency)}</dd>
        </div>
        <div>
          <dt>{t('finance.method')}</dt>
          <dd>{t(`finance.methods.${payment.method}`)}</dd>
        </div>
        {payment.allocations.map((a) => (
          <div key={a.invoiceId}>
            <dt>{t('finance.appliedToInvoice', { number: a.invoiceNumber ?? '' })}</dt>
            <dd>{money(a.amount, payment.currency)}</dd>
          </div>
        ))}
        {refunds.map((r) => (
          <div key={r.id}>
            <dt>{t('finance.refundNumber', { number: r.number })}</dt>
            <dd>−{money(r.amount, r.currency)}</dd>
          </div>
        ))}
        <div>
          <dt>{t('finance.unallocated')}</dt>
          <dd>{money(payment.unallocated, payment.currency)}</dd>
        </div>
      </dl>
    </PrintFrame>
  );
}
