import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { OrganizationLetterhead } from '../components/OrganizationProfile';
import { PageHeader } from '../components/PageHeader';
import { ActionBar, ModuleTabs } from '../components/layout';
import { EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import { accountName, type CashAccount, type LedgerAccount } from '../lib/accounting';
import { api } from '../lib/api';
import { newRequestKey } from '../lib/clinical';
import { errorMessage } from '../lib/errors';
import { moneyInput, parseMoney } from '../lib/finance';
import { useFormatters } from '../lib/format';
import { inventoryKeys, type StockItem, type Warehouse } from '../lib/inventory';
import {
  purchasingKeys,
  type GoodsReceipt,
  type PurchaseOrder,
  type PurchaseRequest,
  type PurchaseSettings,
  type RfqDetail,
  type Supplier,
  type SupplierBill,
  type SupplierCredit,
  type SupplierPayment,
} from '../lib/purchasing';
import { showToast } from '../lib/toast';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useOrg } from '../org/context';
import { csvMoney, downloadCsv } from '../lib/csv';
import { ConfirmAction, DataTable, DateText, Quantity } from '../components/data';
import { useOrgMoney } from '../lib/money';

// Suppliers, purchasing and payables (docs/architecture/PURCHASING.md): request → approval → RFQ →
// quotations → order → receipt → bill → payment. Supplier documents are printed or downloaded by the
// clinic; nothing is e-mailed.

function useSuppliers() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: purchasingKeys.suppliers(orgId),
    queryFn: ({ signal }) => api<{ suppliers: Supplier[] }>(`/orgs/${orgId}/purchasing/suppliers`, { signal }).then((r) => r.suppliers),
  });
}
function useStockItems(enabled = true) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: inventoryKeys.items(orgId),
    queryFn: ({ signal }) => api<{ items: StockItem[] }>(`/orgs/${orgId}/inventory/items`, { signal }).then((r) => r.items),
    enabled,
  });
}
function useWarehouses(enabled = true) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: inventoryKeys.warehouses(orgId),
    queryFn: ({ signal }) => api<{ warehouses: Warehouse[] }>(`/orgs/${orgId}/inventory/warehouses`, { signal }).then((r) => r.warehouses),
    enabled,
  });
}
function useExpenseAccounts(enabled: boolean) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ['org', orgId, 'accounting', 'accounts'],
    queryFn: ({ signal }) => api<{ accounts: LedgerAccount[] }>(`/orgs/${orgId}/accounting/accounts`, { signal }).then((r) => r.accounts),
    enabled,
    select: (accounts) =>
      accounts.filter(
        (a) => !a.isGroup && a.status === 'active' && !a.role && (a.type === 'expense' || a.type === 'asset') && !['1200', '1300'].includes(a.code),
      ),
  });
}

function PurchasingNav() {
  const { t } = useTranslation();
  const { orgId, can, detail } = useOrg();
  const orgWide = detail.membership.branchScope.type === 'all';
  const items = [
    { to: `/app/${orgId}/purchasing`, label: t('purchasing.nav.requests'), end: true, show: true },
    { to: `/app/${orgId}/purchasing/orders`, label: t('purchasing.nav.orders'), show: can('purchase.read') },
    { to: `/app/${orgId}/purchasing/bills`, label: t('purchasing.nav.bills'), show: can('purchase.bill.manage') && orgWide },
    { to: `/app/${orgId}/purchasing/suppliers`, label: t('purchasing.nav.suppliers'), show: true },
  ].filter((i) => i.show);
  return <ModuleTabs items={items} label={t('purchasing.nav.label')} />;
}

const statusBadge = (status: string) =>
  ['approved', 'confirmed', 'posted', 'received', 'open'].includes(status)
    ? 'badge badge--active'
    : ['submitted', 'awaiting_approval', 'draft'].includes(status)
      ? 'badge badge--inactive'
      : 'badge';

// ---------------------------------------------------------------------------------------------
// Line editor shared by requests and direct orders

type LineDraft = { itemId: string; description: string; unit: string; qty: string; price: string; expenseAccountId: string };
const emptyLine = (): LineDraft => ({ itemId: '', description: '', unit: '', qty: '1', price: '', expenseAccountId: '' });

function LinesEditor({
  lines,
  setLines,
  items,
  accounts,
  needAccounts,
}: {
  lines: LineDraft[];
  setLines: (l: LineDraft[]) => void;
  items: StockItem[];
  accounts: LedgerAccount[];
  needAccounts: boolean;
}) {
  const { t } = useTranslation();
  const update = (i: number, patch: Partial<LineDraft>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <>
      <div className="table-wrap">
        <table className="data-table entry-lines">
          <thead>
            <tr>
              <th scope="col">{t('purchasing.itemOrService')}</th>
              <th scope="col">{t('purchasing.unit')}</th>
              <th scope="col">{t('purchasing.qty')}</th>
              <th scope="col">{t('purchasing.unitPrice')}</th>
              {needAccounts && <th scope="col">{t('purchasing.expenseAccount')}</th>}
              <th scope="col">
                <span className="visually-hidden">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const item = items.find((x) => x.id === l.itemId);
              return (
                <tr key={i}>
                  <td data-label={t('purchasing.itemOrService')}>
                    <select
                      aria-label={t('purchasing.lineItem', { n: i + 1 })}
                      value={l.itemId}
                      onChange={(e) => update(i, { itemId: e.target.value, unit: '' })}
                    >
                      <option value="">{t('purchasing.nonStock')}</option>
                      {items
                        .filter((x) => x.status === 'active')
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.code} · {x.name}
                          </option>
                        ))}
                    </select>
                    {!l.itemId && (
                      <input
                        aria-label={t('purchasing.lineDescription', { n: i + 1 })}
                        placeholder={t('purchasing.description')}
                        value={l.description}
                        onChange={(e) => update(i, { description: e.target.value })}
                      />
                    )}
                  </td>
                  <td data-label={t('purchasing.unit')}>
                    {item ? (
                      <select
                        aria-label={t('purchasing.lineUnit', { n: i + 1 })}
                        value={l.unit}
                        onChange={(e) => update(i, { unit: e.target.value })}
                      >
                        <option value="">{item.baseUnit}</option>
                        {item.purchaseUnits.map((u) => (
                          <option key={u.unit} value={u.unit}>
                            {u.unit} ({u.factor} {item.baseUnit})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        aria-label={t('purchasing.lineUnit', { n: i + 1 })}
                        placeholder={t('purchasing.unitPlaceholder')}
                        value={l.unit}
                        onChange={(e) => update(i, { unit: e.target.value })}
                      />
                    )}
                  </td>
                  <td data-label={t('purchasing.qty')}>
                    <input
                      aria-label={t('purchasing.lineQty', { n: i + 1 })}
                      inputMode="numeric"
                      value={l.qty}
                      onChange={(e) => update(i, { qty: e.target.value })}
                    />
                  </td>
                  <td data-label={t('purchasing.unitPrice')}>
                    <input
                      aria-label={t('purchasing.linePrice', { n: i + 1 })}
                      inputMode="decimal"
                      value={l.price}
                      onChange={(e) => update(i, { price: e.target.value })}
                    />
                  </td>
                  {needAccounts && (
                    <td data-label={t('purchasing.expenseAccount')}>
                      {!l.itemId && (
                        <select
                          aria-label={t('purchasing.lineAccount', { n: i + 1 })}
                          value={l.expenseAccountId}
                          onChange={(e) => update(i, { expenseAccountId: e.target.value })}
                        >
                          <option value="">{t('common.choose')}</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} · {accountName(t, a)}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  )}
                  <td>
                    {lines.length > 1 && (
                      <button type="button" className="button button--ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                        {t('purchasing.removeLine')}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="button button--secondary" onClick={() => setLines([...lines, emptyLine()])} disabled={lines.length >= 50}>
        {t('purchasing.addLine')}
      </button>
    </>
  );
}
const toLines = (lines: LineDraft[]) =>
  lines.map((l) => ({
    ...(l.itemId ? { itemId: l.itemId } : { description: l.description }),
    ...(l.unit ? { unit: l.unit } : {}),
    qty: Number(l.qty),
    unitPrice: parseMoney(l.price) ?? 0,
    ...(l.expenseAccountId && !l.itemId ? { expenseAccountId: l.expenseAccountId } : {}),
  }));
const linesValid = (lines: LineDraft[]) =>
  lines.every(
    (l) =>
      (l.itemId || l.description.trim().length >= 2) &&
      /^\d{1,7}$/.test(l.qty) &&
      Number(l.qty) > 0 &&
      (l.price === '' || parseMoney(l.price) !== null),
  );

// ---------------------------------------------------------------------------------------------
// Requests (and the purchasing home)

function NewRequestForm() {
  const { t } = useTranslation();
  const { orgId, branches, selectedBranchId } = useOrg();
  const queryClient = useQueryClient();
  const items = useStockItems();
  const [branchId, setBranchId] = useState(selectedBranchId !== 'all' ? selectedBranchId : (branches[0]?.id ?? ''));
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [key, setKey] = useState(newRequestKey);
  const save = useMutation({
    mutationFn: () =>
      api<{ request: PurchaseRequest }>(`/orgs/${orgId}/purchasing/requests`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: { branchId, reason, lines: toLines(lines) },
      }),
    onSuccess: (r) => {
      showToast(
        r.request.status === 'approved'
          ? t('purchasing.requestAutoApproved', { number: r.request.number })
          : t('purchasing.requestSent', { number: r.request.number }),
      );
      setKey(newRequestKey());
      setLines([emptyLine()]);
      setReason('');
      return queryClient.invalidateQueries({ queryKey: purchasingKeys.all(orgId) });
    },
  });
  return (
    <form
      className="card"
      aria-labelledby="new-request-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (linesValid(lines)) save.mutate();
      }}
    >
      <h2 id="new-request-title">{t('purchasing.newRequest')}</h2>
      <div className="form-grid">
        <Field id="request-branch" label={t('purchasing.branch')}>
          <select id="request-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="request-reason" label={t('purchasing.reason')}>
          <input id="request-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <LinesEditor lines={lines} setLines={setLines} items={items.data ?? []} accounts={[]} needAccounts={false} />
      <p className="muted small">{t('purchasing.estimateHint')}</p>
      {save.isError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
      <ActionBar>
        <button type="submit" className="button button--primary" disabled={save.isPending || !linesValid(lines)}>
          {t('purchasing.sendRequest')}
        </button>
      </ActionBar>
    </form>
  );
}

function RequestActions({ request, suppliers }: { request: PurchaseRequest; suppliers: Supplier[] }) {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [key] = useState(newRequestKey);
  const refresh = () => queryClient.invalidateQueries({ queryKey: purchasingKeys.all(orgId) });
  const decide = useMutation({
    mutationFn: (action: 'approve' | 'reject' | 'cancel') =>
      api(`/orgs/${orgId}/purchasing/requests/${request.id}/${action}`, {
        method: 'POST',
        body: action === 'cancel' ? {} : { version: request.version, reason },
      }),
    onSuccess: refresh,
  });
  const rfq = useMutation({
    mutationFn: () =>
      api<{ rfq: { id: string } }>(`/orgs/${orgId}/purchasing/rfqs`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: { requestId: request.id, supplierIds: picked },
      }),
    onSuccess: (r) => {
      showToast(t('purchasing.rfqCreated'));
      void refresh();
      void navigate(`/app/${orgId}/purchasing/rfqs/${r.rfq.id}`);
    },
  });
  return (
    <div className="stack">
      {request.status === 'submitted' && can('purchase.approve') && (
        <div className="inline-form">
          <Field id={`reject-reason-${request.id}`} label={t('purchasing.decisionReason')}>
            <input id={`reject-reason-${request.id}`} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <button type="button" className="button button--primary" disabled={decide.isPending} onClick={() => decide.mutate('approve')}>
            {t('purchasing.approve')}
          </button>
          <button
            type="button"
            className="button button--secondary"
            disabled={decide.isPending || reason.trim().length < 3}
            onClick={() => decide.mutate('reject')}
          >
            {t('purchasing.reject')}
          </button>
        </div>
      )}
      {request.status === 'approved' && can('purchase.order.manage') && (
        <div className="inline-form">
          <fieldset className="choice-group" aria-label={t('purchasing.inviteSuppliers')}>
            {suppliers
              .filter((s) => s.status === 'active')
              .map((s) => (
                <label key={s.id} className="choice">
                  <input
                    type="checkbox"
                    checked={picked.includes(s.id)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))}
                  />
                  <span>{s.name}</span>
                </label>
              ))}
          </fieldset>
          <button type="button" className="button button--secondary" disabled={picked.length === 0 || rfq.isPending} onClick={() => rfq.mutate()}>
            {t('purchasing.requestQuotations')}
          </button>
          <Link className="button button--secondary" to={`/app/${orgId}/purchasing/orders?request=${request.id}`}>
            {t('purchasing.orderDirectly')}
          </Link>
        </div>
      )}
      {['submitted', 'approved'].includes(request.status) && (
        <button type="button" className="button button--ghost" disabled={decide.isPending} onClick={() => decide.mutate('cancel')}>
          {t('purchasing.cancelRequest')}
        </button>
      )}
      {(decide.isError || rfq.isError) && <Notice kind="error">{errorMessage(t, decide.error ?? rfq.error)}</Notice>}
    </div>
  );
}

function SettingsCard() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const { money } = useOrgMoney();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: purchasingKeys.settings(orgId),
    queryFn: ({ signal }) => api<{ settings: PurchaseSettings }>(`/orgs/${orgId}/purchasing/settings`, { signal }).then((r) => r.settings),
  });
  const [threshold, setThreshold] = useState<string | null>(null);
  const [separation, setSeparation] = useState<PurchaseSettings['separation'] | null>(null);
  const save = useMutation({
    mutationFn: (s: PurchaseSettings) =>
      api(`/orgs/${orgId}/purchasing/settings`, {
        method: 'PUT',
        body: {
          approvalThreshold: parseMoney(threshold ?? moneyInput(s.approvalThreshold)) ?? 0,
          separation: separation ?? s.separation,
          version: s.version,
        },
      }),
    onSuccess: () => (showToast(t('purchasing.settingsSaved')), queryClient.invalidateQueries({ queryKey: purchasingKeys.settings(orgId) })),
  });
  if (!settings.isSuccess) return null;
  const s = settings.data;
  const sep = separation ?? s.separation;
  return (
    <form
      className="card"
      aria-labelledby="purchasing-settings-title"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(s);
      }}
    >
      <h2 id="purchasing-settings-title">{t('purchasing.settingsTitle')}</h2>
      <p className="muted">{t('purchasing.settingsIntro', { amount: money(s.approvalThreshold) })}</p>
      <div className="form-grid">
        <Field id="approval-threshold" label={t('purchasing.threshold')} hint={t('purchasing.thresholdHint')}>
          <input
            id="approval-threshold"
            inputMode="decimal"
            value={threshold ?? moneyInput(s.approvalThreshold)}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </Field>
      </div>
      <div className="choice-group">
        {(['approve', 'receive', 'pay'] as const).map((k) => (
          <label key={k} className="choice">
            <input type="checkbox" checked={sep[k]} onChange={(e) => setSeparation({ ...sep, [k]: e.target.checked })} />
            <span>{t(`purchasing.separation.${k}`)}</span>
          </label>
        ))}
      </div>
      {save.isError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
      <ActionBar>
        <button type="submit" className="button button--secondary" disabled={save.isPending}>
          {t('common.save')}
        </button>
      </ActionBar>
    </form>
  );
}

export function PurchasingPage() {
  const { t } = useTranslation();
  const { orgId, can, branches } = useOrg();
  useDocumentTitle(t('purchasing.title'));
  const { money } = useOrgMoney();
  const fmt = useFormatters();
  const suppliers = useSuppliers();
  const requests = useQuery({
    queryKey: purchasingKeys.requests(orgId),
    queryFn: ({ signal }) => api<{ requests: PurchaseRequest[] }>(`/orgs/${orgId}/purchasing/requests`, { signal }).then((r) => r.requests),
  });
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const pending = (requests.data ?? []).filter((r) => r.status === 'submitted');
  return (
    <>
      <PageHeader title={t('purchasing.title')} subtitle={t('purchasing.subtitle')} />
      <PurchasingNav />
      {can('purchase.approve') && pending.length > 0 && <Notice kind="warning">{t('purchasing.pendingApprovals', { count: pending.length })}</Notice>}
      <NewRequestForm />
      <section className="card" aria-labelledby="requests-title">
        <h2 id="requests-title">{can('purchase.read') ? t('purchasing.requests') : t('purchasing.myRequests')}</h2>
        {requests.isPending && <Loading />}
        {requests.isError && <ErrorState message={errorMessage(t, requests.error)} onRetry={() => requests.refetch()} />}
        {requests.isSuccess && requests.data.length === 0 && <EmptyState icon="cart">{t('purchasing.noRequests')}</EmptyState>}
        {requests.isSuccess && requests.data.length > 0 && (
          <ul className="data-list" data-testid="purchase-requests">
            {requests.data.map((r) => (
              <li key={r.id} className="data-row data-row--stacked">
                <div className="data-main">
                  <h3>
                    <bdi dir="ltr">{r.number}</bdi> · {branchName.get(r.branchId)}
                  </h3>
                  <p className="muted">
                    {r.lines.map((l) => `${l.description} × ${l.qty} ${l.unit}`).join('، ')} ·{' '}
                    {t('purchasing.estimated', { amount: money(r.estimatedTotal) })} · {fmt.date(r.createdAt)}
                  </p>
                  {r.decision?.automatic && <p className="muted small">{t('purchasing.autoApproved')}</p>}
                  {r.decision?.reason && (
                    <p className="small">
                      <bdi dir="auto">{r.decision.reason}</bdi>
                    </p>
                  )}
                </div>
                <span className={statusBadge(r.status)}>{t(`purchasing.requestStatus.${r.status}`)}</span>
                <RequestActions request={r} suppliers={suppliers.data ?? []} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {can('purchase.settings.manage') && <SettingsCard />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// RFQ: quotations and comparison

function QuotationForm({ detail, supplier }: { detail: RfqDetail; supplier: Supplier }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const queryClient = useQueryClient();
  const existing = detail.quotations.find((q) => q.supplierId === supplier.id);
  const [prices, setPrices] = useState<string[]>(() =>
    detail.rfq.lines.map((_, i) =>
      existing?.lines.find((l) => l.lineIndex === i) ? moneyInput(existing.lines.find((l) => l.lineIndex === i)!.unitPrice) : '',
    ),
  );
  const [leads, setLeads] = useState<string[]>(() =>
    detail.rfq.lines.map((_, i) => String(existing?.lines.find((l) => l.lineIndex === i)?.leadTimeDays ?? '')),
  );
  const [reference, setReference] = useState(existing?.reference ?? '');
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/purchasing/rfqs/${detail.rfq.id}/quotations`, {
        method: 'PUT',
        body: {
          supplierId: supplier.id,
          reference,
          lines: detail.rfq.lines.flatMap((l, i) =>
            prices[i] && parseMoney(prices[i]!) !== null
              ? [{ lineIndex: i, unitPrice: parseMoney(prices[i]!)!, qty: l.qty, leadTimeDays: Number(leads[i]) || 0 }]
              : [],
          ),
        },
      }),
    onSuccess: () => (
      showToast(t('purchasing.quotationSaved')),
      queryClient.invalidateQueries({ queryKey: purchasingKeys.rfq(orgId, detail.rfq.id) })
    ),
  });
  return (
    <form
      className="card"
      aria-label={t('purchasing.quotationOf', { supplier: supplier.name })}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h3>{supplier.name}</h3>
      <div className="form-grid">
        {detail.rfq.lines.map((l, i) => (
          <Field key={`p${i}`} id={`q-${supplier.id}-${i}`} label={t('purchasing.priceFor', { item: l.description, unit: l.unit })}>
            <input
              id={`q-${supplier.id}-${i}`}
              inputMode="decimal"
              value={prices[i] ?? ''}
              onChange={(e) => setPrices(prices.map((p, j) => (j === i ? e.target.value : p)))}
            />
          </Field>
        ))}
        {detail.rfq.lines.map((l, i) => (
          <Field key={`l${i}`} id={`ql-${supplier.id}-${i}`} label={t('purchasing.leadTimeFor', { item: l.description })}>
            <input
              id={`ql-${supplier.id}-${i}`}
              inputMode="numeric"
              value={leads[i] ?? ''}
              onChange={(e) => setLeads(leads.map((p, j) => (j === i ? e.target.value : p)))}
            />
          </Field>
        ))}
        <Field id={`qr-${supplier.id}`} label={t('purchasing.supplierReference')}>
          <input id={`qr-${supplier.id}`} maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
      {save.isError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
      <ActionBar>
        <button type="submit" className="button button--secondary" disabled={save.isPending}>
          {t('purchasing.saveQuotation')}
        </button>
      </ActionBar>
    </form>
  );
}

export function RfqPage() {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const { rfqId = '' } = useParams();
  const { money } = useOrgMoney();
  const suppliers = useSuppliers();
  const warehouses = useWarehouses();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: purchasingKeys.rfq(orgId, rfqId),
    queryFn: ({ signal }) => api<RfqDetail>(`/orgs/${orgId}/purchasing/rfqs/${rfqId}`, { signal }),
  });
  useDocumentTitle(detail.data ? detail.data.rfq.number : t('purchasing.rfq'));
  const [warehouseId, setWarehouseId] = useState('');
  const [key] = useState(newRequestKey);
  const order = useMutation({
    mutationFn: (q: { supplierId: string; quotationId: string }) =>
      api<{ order: PurchaseOrder }>(`/orgs/${orgId}/purchasing/orders`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `${key}-${q.quotationId}`.slice(0, 100) },
        body: { supplierId: q.supplierId, branchId: detail.data!.rfq.branchId, quotationId: q.quotationId, ...(warehouseId ? { warehouseId } : {}) },
      }),
    onSuccess: (r) => {
      showToast(t('purchasing.orderCreated', { number: r.order.number }));
      void queryClient.invalidateQueries({ queryKey: purchasingKeys.all(orgId) });
      void navigate(`/app/${orgId}/purchasing/orders/${r.order.id}`);
    },
  });
  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorState message={errorMessage(t, detail.error)} onRetry={() => detail.refetch()} />;
  const d = detail.data;
  const name = (id: string | null) => suppliers.data?.find((s) => s.id === id)?.name ?? '';
  const branchStores = (warehouses.data ?? []).filter((w) => w.branchId === d.rfq.branchId && w.status === 'active');
  return (
    <>
      <PageHeader
        back={{ to: `/app/${orgId}/purchasing`, label: t('purchasing.title') }}
        title={t('purchasing.rfqTitle', { number: d.rfq.number })}
        subtitle={t(`purchasing.rfqStatus.${d.rfq.status}`)}
      >
        <Link className="button button--secondary" to={`/app/${orgId}/purchasing/rfqs/${d.rfq.id}/print`}>
          {t('purchasing.printRfq')}
        </Link>
      </PageHeader>
      <PurchasingNav />
      <section className="card" aria-labelledby="comparison-title">
        <h2 id="comparison-title">{t('purchasing.comparison')}</h2>
        {d.quotations.length === 0 ? (
          <EmptyState icon="inbox">{t('purchasing.noQuotations')}</EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table" data-testid="quotation-comparison">
                <thead>
                  <tr>
                    <th scope="col">{t('purchasing.itemOrService')}</th>
                    {d.totals.map((q) => (
                      <th key={q.supplierId} scope="col">
                        {name(q.supplierId)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.comparison.map((row) => (
                    <tr key={row.lineIndex}>
                      <th scope="row">
                        {row.description} × {row.qty} {row.unit}
                      </th>
                      {d.totals.map((q) => {
                        const offer = row.offers.find((o) => o.supplierId === q.supplierId);
                        return (
                          <td key={q.supplierId} data-label={name(q.supplierId)}>
                            {offer ? (
                              <>
                                {money(offer.unitPrice)} · {t('purchasing.days', { count: offer.leadTimeDays })}{' '}
                                {row.bestPrice === q.supplierId && <span className="badge badge--active">{t('purchasing.bestPrice')}</span>}{' '}
                                {row.fastest === q.supplierId && <span className="badge">{t('purchasing.fastest')}</span>}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="row-total">
                    <th scope="row">{t('purchasing.total')}</th>
                    {d.totals.map((q) => (
                      <td key={q.supplierId} data-label={name(q.supplierId)}>
                        {money(q.total)} · {t('purchasing.linesCovered', { count: q.linesCovered, total: d.rfq.lines.length })}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            {d.rfq.status === 'open' && can('purchase.order.manage') && (
              <div className="inline-form">
                {d.rfq.lines.some((l) => l.itemId) && (
                  <Field id="order-warehouse" label={t('purchasing.receiveInto')}>
                    <select id="order-warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                      <option value="">{t('common.choose')}</option>
                      {branchStores.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {d.totals.map((q) => (
                  <button
                    key={q.supplierId}
                    type="button"
                    className="button button--primary"
                    disabled={order.isPending}
                    onClick={() => order.mutate(q)}
                  >
                    {t('purchasing.orderFrom', { supplier: name(q.supplierId) })}
                  </button>
                ))}
              </div>
            )}
            {order.isError && <Notice kind="error">{errorMessage(t, order.error)}</Notice>}
          </>
        )}
      </section>
      {d.rfq.status === 'open' &&
        can('purchase.order.manage') &&
        d.rfq.supplierIds.map((sid) => {
          const s = suppliers.data?.find((x) => x.id === sid);
          return s ? <QuotationForm key={sid} detail={d} supplier={s} /> : null;
        })}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Orders

function NewOrderForm({ requestId }: { requestId: string | null }) {
  const { t } = useTranslation();
  const { orgId, branches, selectedBranchId } = useOrg();
  const queryClient = useQueryClient();
  const suppliers = useSuppliers();
  const items = useStockItems();
  const warehouses = useWarehouses();
  const accounts = useExpenseAccounts(true);
  const [supplierId, setSupplierId] = useState('');
  const [branchId, setBranchId] = useState(selectedBranchId !== 'all' ? selectedBranchId : (branches[0]?.id ?? ''));
  const [warehouseId, setWarehouseId] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [key, setKey] = useState(newRequestKey);
  const save = useMutation({
    mutationFn: () =>
      api<{ order: PurchaseOrder }>(`/orgs/${orgId}/purchasing/orders`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: { supplierId, branchId, ...(warehouseId ? { warehouseId } : {}), ...(requestId ? { requestId } : {}), lines: toLines(lines) },
      }),
    onSuccess: (r) => {
      showToast(t('purchasing.orderCreated', { number: r.order.number }));
      setKey(newRequestKey());
      setLines([emptyLine()]);
      return queryClient.invalidateQueries({ queryKey: purchasingKeys.all(orgId) });
    },
  });
  return (
    <form
      className="card"
      aria-labelledby="new-order-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (supplierId && linesValid(lines)) save.mutate();
      }}
    >
      <h2 id="new-order-title">{requestId ? t('purchasing.orderForRequest') : t('purchasing.newOrder')}</h2>
      <p className="muted small">{t('purchasing.directOrderHint')}</p>
      <div className="form-grid">
        <Field id="order-supplier" label={t('purchasing.supplier')}>
          <select id="order-supplier" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">{t('common.choose')}</option>
            {(suppliers.data ?? [])
              .filter((s) => s.status === 'active')
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </Field>
        <Field id="order-branch" label={t('purchasing.branch')}>
          <select id="order-branch" value={branchId} onChange={(e) => (setBranchId(e.target.value), setWarehouseId(''))}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="order-store" label={t('purchasing.receiveInto')}>
          <select id="order-store" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">{t('purchasing.noStockLines')}</option>
            {(warehouses.data ?? [])
              .filter((w) => w.branchId === branchId && w.status === 'active')
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <LinesEditor lines={lines} setLines={setLines} items={items.data ?? []} accounts={accounts.data ?? []} needAccounts />
      {save.isError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
      <ActionBar>
        <button type="submit" className="button button--primary" disabled={save.isPending || !supplierId || !linesValid(lines)}>
          {t('purchasing.createOrder')}
        </button>
      </ActionBar>
    </form>
  );
}

export function PurchaseOrdersPage() {
  const { t } = useTranslation();
  const { orgId, can, branches } = useOrg();
  useDocumentTitle(t('purchasing.ordersTitle'));
  const { money } = useOrgMoney();
  const suppliers = useSuppliers();
  const [search] = useSearchParams();
  const requestId = search.get('request');
  const orders = useQuery({
    queryKey: purchasingKeys.orders(orgId),
    queryFn: ({ signal }) => api<{ orders: PurchaseOrder[] }>(`/orgs/${orgId}/purchasing/orders`, { signal }).then((r) => r.orders),
  });
  const name = (id: string) => suppliers.data?.find((s) => s.id === id)?.name ?? '';
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  return (
    <>
      <PageHeader title={t('purchasing.ordersTitle')} subtitle={t('purchasing.ordersSubtitle')} />
      <PurchasingNav />
      {can('purchase.order.manage') && <NewOrderForm requestId={requestId} />}
      <section className="card" aria-labelledby="orders-title">
        <h2 id="orders-title">{t('purchasing.orders')}</h2>
        {orders.isPending && <Loading />}
        {orders.isError && <ErrorState message={errorMessage(t, orders.error)} onRetry={() => orders.refetch()} />}
        {orders.isSuccess && orders.data.length === 0 && <EmptyState icon="cart">{t('purchasing.noOrders')}</EmptyState>}
        {orders.isSuccess && orders.data.length > 0 && (
          <ul className="data-list" data-testid="purchase-orders">
            {orders.data.map((o) => (
              <li key={o.id} className="data-row">
                <div className="data-main">
                  <h3>
                    <Link to={`/app/${orgId}/purchasing/orders/${o.id}`}>
                      <bdi dir="ltr">{o.number}</bdi>
                    </Link>{' '}
                    · {name(o.supplierId)}
                  </h3>
                  <p className="muted">
                    {branchName.get(o.branchId)} · {money(o.total)} ·{' '}
                    {t('purchasing.receivedOf', {
                      received: o.lines.reduce((s, l) => s + (l.received ?? 0), 0),
                      total: o.lines.reduce((s, l) => s + l.qty, 0),
                    })}
                  </p>
                </div>
                <span className={statusBadge(o.status)}>{t(`purchasing.orderStatus.${o.status}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function ReceiveForm({ order, kind }: { order: PurchaseOrder; kind: 'receipts' | 'returns' }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const queryClient = useQueryClient();
  const items = useStockItems();
  const [qtys, setQtys] = useState<string[]>(() => order.lines.map(() => ''));
  const [lots, setLots] = useState<string[]>(() => order.lines.map(() => ''));
  const [expiries, setExpiries] = useState<string[]>(() => order.lines.map(() => ''));
  const [note, setNote] = useState('');
  const [key, setKey] = useState(newRequestKey);
  const lotTracked = (i: number) => items.data?.find((x) => x.id === order.lines[i]!.itemId)?.tracking === 'lot';
  const lines = order.lines.flatMap((_, i) =>
    /^\d{1,7}$/.test(qtys[i] ?? '') && Number(qtys[i]) > 0
      ? [
          {
            lineIndex: i,
            qty: Number(qtys[i]),
            ...(lots[i] ? { lot: lots[i] } : {}),
            ...(kind === 'receipts' && expiries[i] ? { expiry: expiries[i] } : {}),
          },
        ]
      : [],
  );
  const save = useMutation({
    mutationFn: () =>
      api<{ receipt: GoodsReceipt }>(`/orgs/${orgId}/purchasing/orders/${order.id}/${kind}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: { lines, note },
      }),
    onSuccess: (r) => {
      showToast(t(kind === 'receipts' ? 'purchasing.received' : 'purchasing.returned', { number: r.receipt.number }));
      setKey(newRequestKey());
      setQtys(order.lines.map(() => ''));
      return queryClient.invalidateQueries({ queryKey: ['org', orgId] });
    },
  });
  return (
    <form
      className="card"
      aria-labelledby={`${kind}-title`}
      onSubmit={(e) => {
        e.preventDefault();
        if (lines.length) save.mutate();
      }}
    >
      <h2 id={`${kind}-title`}>{kind === 'receipts' ? t('purchasing.receiveGoods') : t('purchasing.returnGoods')}</h2>
      <p className="muted small">{kind === 'receipts' ? t('purchasing.receiveHint') : t('purchasing.returnHint')}</p>
      <div className="form-grid">
        {order.lines.map((l, i) => {
          const open = kind === 'receipts' ? l.qty - (l.received ?? 0) : (l.received ?? 0) - (l.billed ?? 0);
          if (open <= 0) return null;
          return (
            <div key={i} className="stack">
              <Field id={`${kind}-${i}`} label={t('purchasing.qtyOf', { item: l.description, unit: l.unit, open })}>
                <input
                  id={`${kind}-${i}`}
                  inputMode="numeric"
                  value={qtys[i]}
                  onChange={(e) => setQtys(qtys.map((q, j) => (j === i ? e.target.value : q)))}
                />
              </Field>
              {l.itemId && lotTracked(i) && (
                <Field id={`${kind}-lot-${i}`} label={t('inventory.lot')}>
                  <input
                    id={`${kind}-lot-${i}`}
                    maxLength={40}
                    value={lots[i]}
                    onChange={(e) => setLots(lots.map((q, j) => (j === i ? e.target.value : q)))}
                  />
                </Field>
              )}
              {kind === 'receipts' && l.itemId && lotTracked(i) && (
                <Field id={`${kind}-exp-${i}`} label={t('inventory.expiry')}>
                  <input
                    id={`${kind}-exp-${i}`}
                    type="date"
                    value={expiries[i]}
                    onChange={(e) => setExpiries(expiries.map((q, j) => (j === i ? e.target.value : q)))}
                  />
                </Field>
              )}
            </div>
          );
        })}
        <Field id={`${kind}-note`} label={t('purchasing.note')}>
          <input
            id={`${kind}-note`}
            maxLength={300}
            required={kind === 'returns'}
            minLength={kind === 'returns' ? 3 : 0}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
      {save.isError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
      <ActionBar>
        <button type="submit" className="button button--primary" disabled={save.isPending || lines.length === 0}>
          {kind === 'receipts' ? t('purchasing.confirmReceipt') : t('purchasing.confirmReturn')}
        </button>
      </ActionBar>
    </form>
  );
}

function BillFromOrderForm({ order }: { order: PurchaseOrder }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const queryClient = useQueryClient();
  const [reference, setReference] = useState('');
  const [billDate, setBillDate] = useState('');
  const [qtys, setQtys] = useState<string[]>(() => order.lines.map((l) => String(Math.max((l.received ?? 0) - (l.billed ?? 0), 0) || '')));
  const [prices, setPrices] = useState<string[]>(() => order.lines.map((l) => moneyInput(l.unitPrice)));
  const [key, setKey] = useState(newRequestKey);
  const lines = order.lines.flatMap((_, i) =>
    /^\d{1,7}$/.test(qtys[i] ?? '') && Number(qtys[i]) > 0 && parseMoney(prices[i] ?? '') !== null
      ? [{ orderLineIndex: i, qty: Number(qtys[i]), unitPrice: parseMoney(prices[i]!)! }]
      : [],
  );
  const save = useMutation({
    mutationFn: () =>
      api<{ bill: SupplierBill }>(`/orgs/${orgId}/purchasing/bills`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: { supplierId: order.supplierId, supplierReference: reference, orderId: order.id, billDate, lines },
      }),
    onSuccess: (r) => {
      showToast(t('purchasing.billRecorded', { number: r.bill.number }));
      setKey(newRequestKey());
      return queryClient.invalidateQueries({ queryKey: ['org', orgId] });
    },
  });
  if (!order.lines.some((l) => (l.received ?? 0) > (l.billed ?? 0))) return null;
  return (
    <form
      className="card"
      aria-labelledby="bill-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (lines.length) save.mutate();
      }}
    >
      <h2 id="bill-title">{t('purchasing.recordBill')}</h2>
      <p className="muted small">{t('purchasing.billHint')}</p>
      <div className="form-grid">
        <Field id="bill-ref" label={t('purchasing.supplierInvoiceNumber')}>
          <input id="bill-ref" required maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field id="bill-date" label={t('purchasing.billDate')}>
          <input id="bill-date" type="date" required value={billDate} onChange={(e) => setBillDate(e.target.value)} />
        </Field>
        {order.lines.map((l, i) =>
          (l.received ?? 0) > (l.billed ?? 0) ? (
            <div key={i} className="stack">
              <Field
                id={`bill-qty-${i}`}
                label={t('purchasing.qtyOf', { item: l.description, unit: l.unit, open: (l.received ?? 0) - (l.billed ?? 0) })}
              >
                <input
                  id={`bill-qty-${i}`}
                  inputMode="numeric"
                  value={qtys[i]}
                  onChange={(e) => setQtys(qtys.map((q, j) => (j === i ? e.target.value : q)))}
                />
              </Field>
              <Field id={`bill-price-${i}`} label={t('purchasing.billedPrice')}>
                <input
                  id={`bill-price-${i}`}
                  inputMode="decimal"
                  value={prices[i]}
                  onChange={(e) => setPrices(prices.map((q, j) => (j === i ? e.target.value : q)))}
                />
              </Field>
            </div>
          ) : null,
        )}
      </div>
      {save.isError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
      <ActionBar>
        <button type="submit" className="button button--primary" disabled={save.isPending || !reference || !billDate || lines.length === 0}>
          {t('purchasing.recordBill')}
        </button>
      </ActionBar>
    </form>
  );
}

type OrderView = {
  order: PurchaseOrder;
  supplier: Supplier | null;
  branch: { name: string; city: string } | null;
  receipts: GoodsReceipt[];
  bills: SupplierBill[];
};

export function PurchaseOrderPage() {
  const { t } = useTranslation();
  const { orgId, can, detail: org } = useOrg();
  const { orderId = '' } = useParams();
  const { money } = useOrgMoney();
  const fmt = useFormatters();
  const queryClient = useQueryClient();
  const view = useQuery({
    queryKey: purchasingKeys.order(orgId, orderId),
    queryFn: ({ signal }) => api<OrderView>(`/orgs/${orgId}/purchasing/orders/${orderId}`, { signal }),
  });
  useDocumentTitle(view.data ? view.data.order.number : t('purchasing.order'));
  const [reason, setReason] = useState('');
  const act = useMutation({
    mutationFn: (action: 'confirm' | 'cancel' | 'close') =>
      api(`/orgs/${orgId}/purchasing/orders/${orderId}/${action}`, { method: 'POST', body: { version: view.data!.order.version, reason } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: purchasingKeys.all(orgId) }),
  });
  if (view.isPending) return <Loading />;
  if (view.isError) return <ErrorState message={errorMessage(t, view.error)} onRetry={() => view.refetch()} />;
  const { order: o, supplier, receipts, bills } = view.data;
  const orgWide = org.membership.branchScope.type === 'all';
  return (
    <>
      <PageHeader
        back={{ to: `/app/${orgId}/purchasing/orders`, label: t('purchasing.ordersTitle') }}
        title={t('purchasing.orderTitle', { number: o.number })}
        subtitle={supplier?.name}
      >
        <Link className="button button--secondary" to={`/app/${orgId}/purchasing/orders/${o.id}/print`}>
          {t('purchasing.printOrder')}
        </Link>
      </PageHeader>
      <PurchasingNav />
      <section className="card" aria-labelledby="order-lines-title">
        <div className="section-header">
          <h2 id="order-lines-title">{t('purchasing.lines')}</h2>
          <span className={statusBadge(o.status)}>{t(`purchasing.orderStatus.${o.status}`)}</span>
        </div>
        <DataTable
          testId="order-lines"
          rows={o.lines.map((l, index) => ({ ...l, index }))}
          rowKey={(l) => String(l.index)}
          columns={[
            { key: 'item', label: t('purchasing.itemOrService'), cell: (l) => l.description },
            { key: 'qty', label: t('purchasing.qty'), numeric: true, cell: (l) => <Quantity value={l.qty} unit={l.unit} /> },
            { key: 'unitPrice', label: t('purchasing.unitPrice'), numeric: true, cell: (l) => money(l.unitPrice) },
            {
              key: 'received',
              label: t('purchasing.receivedCol'),
              numeric: true,
              cell: (l) => (l.received === undefined ? '' : <Quantity value={l.received} />),
            },
            {
              key: 'billed',
              label: t('purchasing.billedCol'),
              numeric: true,
              cell: (l) => (l.billed === undefined ? '' : <Quantity value={l.billed} />),
            },
            {
              key: 'returned',
              label: t('purchasing.returnedCol'),
              numeric: true,
              cell: (l) => (l.returned === undefined ? '' : <Quantity value={l.returned} />),
            },
          ]}
          footer={
            <tr className="row-total">
              <th scope="row">{t('purchasing.total')}</th>
              <td colSpan={5} className="num">
                {money(o.total)}
              </td>
            </tr>
          }
        />
        {can('purchase.order.manage') && ['draft', 'confirmed', 'received'].includes(o.status) && (
          <div className="inline-form">
            {o.status === 'draft' && (
              <button type="button" className="button button--primary" disabled={act.isPending} onClick={() => act.mutate('confirm')}>
                {t('purchasing.confirmOrder')}
              </button>
            )}
            <Field id="order-reason" label={t('purchasing.closeReason')}>
              <input id="order-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            {o.lines.every((l) => !l.received && !l.billed) ? (
              <ConfirmAction
                label={t('purchasing.cancelOrder')}
                message={t('purchasing.cancelOrderMessage', { number: o.number })}
                confirmLabel={t('purchasing.cancelOrderConfirm')}
                pending={act.isPending}
                onConfirm={() => act.mutate('cancel')}
              />
            ) : (
              <button
                type="button"
                className="button button--secondary"
                disabled={act.isPending || reason.trim().length < 3}
                onClick={() => act.mutate('close')}
              >
                {t('purchasing.closeOrder')}
              </button>
            )}
          </div>
        )}
        {o.closeReason && (
          <p className="muted">
            <bdi dir="auto">{o.closeReason}</bdi>
          </p>
        )}
        {act.isError && <Notice kind="error">{errorMessage(t, act.error)}</Notice>}
      </section>
      {o.status === 'confirmed' && can('purchase.receive') && <ReceiveForm order={o} kind="receipts" />}
      {can('purchase.bill.manage') && orgWide && o.status !== 'cancelled' && o.status !== 'draft' && <BillFromOrderForm order={o} />}
      {can('purchase.receive') && o.lines.some((l) => (l.received ?? 0) > (l.billed ?? 0)) && <ReceiveForm order={o} kind="returns" />}
      {(receipts.length > 0 || bills.length > 0) && (
        <section className="card" aria-labelledby="order-history-title">
          <h2 id="order-history-title">{t('purchasing.history')}</h2>
          <ul className="data-list">
            {receipts.map((r) => (
              <li key={r.id} className="data-row">
                <div className="data-main">
                  <h3>
                    <bdi dir="ltr">{r.number}</bdi> {t(`purchasing.receiptKind.${r.kind}`)}
                  </h3>
                  <p className="muted">
                    {r.lines.map((l) => `${o.lines[l.lineIndex]?.description ?? ''} × ${l.qty}${l.lot ? ` (${l.lot})` : ''}`).join('، ')} ·{' '}
                    {fmt.date(r.createdAt)}
                  </p>
                </div>
              </li>
            ))}
            {bills.map((b) => (
              <li key={b.id} className="data-row">
                <div className="data-main">
                  <h3>
                    <Link to={`/app/${orgId}/purchasing/bills/${b.id}`}>
                      <bdi dir="ltr">{b.number}</bdi>
                    </Link>{' '}
                    · <bdi dir="ltr">{b.supplierReference}</bdi>
                  </h3>
                  <p className="muted">
                    {money(b.total)} · {t('purchasing.balanceLeft', { amount: money(b.balance) })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** Printable supplier document (order or quotation request), prepared by the clinic; nothing is e-mailed. */
function PrintFrame({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  const { detail } = useOrg();
  return (
    <article className="print-document">
      <header className="print-header">
        <OrganizationLetterhead />
        <div>
          <h1>{title}</h1>
          <p>{detail.organization.name}</p>
        </div>
      </header>
      {children}
      <p className="muted small">{t('purchasing.printNote')}</p>
      <ActionBar className="no-print">
        <button type="button" className="button button--primary" onClick={() => window.print()}>
          {t('purchasing.print')}
        </button>
      </ActionBar>
    </article>
  );
}

export function PurchaseOrderPrintPage() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const { orderId = '' } = useParams();
  const { money } = useOrgMoney();
  const view = useQuery({
    queryKey: purchasingKeys.order(orgId, orderId),
    queryFn: ({ signal }) => api<OrderView>(`/orgs/${orgId}/purchasing/orders/${orderId}`, { signal }),
  });
  useDocumentTitle(view.data ? view.data.order.number : t('purchasing.order'));
  if (view.isPending) return <Loading />;
  if (view.isError) return <ErrorState message={errorMessage(t, view.error)} />;
  const { order: o, supplier, branch } = view.data;
  return (
    <PrintFrame title={t('purchasing.orderTitle', { number: o.number })}>
      <dl className="details">
        <dt>{t('purchasing.supplier')}</dt>
        <dd>{supplier?.name}</dd>
        <dt>{t('purchasing.deliverTo')}</dt>
        <dd>
          {branch?.name} {branch?.city}
        </dd>
        {o.expectedDate && (
          <>
            <dt>{t('purchasing.expectedDate')}</dt>
            <dd>
              <DateText value={o.expectedDate} />
            </dd>
          </>
        )}
      </dl>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">{t('purchasing.itemOrService')}</th>
            <th scope="col">{t('purchasing.qty')}</th>
            <th scope="col">{t('purchasing.unitPrice')}</th>
            <th scope="col">{t('purchasing.amount')}</th>
          </tr>
        </thead>
        <tbody>
          {o.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.description}</td>
              <td>
                {l.qty} {l.unit}
              </td>
              <td>{money(l.unitPrice)}</td>
              <td>{money(l.amount)}</td>
            </tr>
          ))}
          <tr className="row-total">
            <th scope="row" colSpan={3}>
              {t('purchasing.total')}
            </th>
            <td>{money(o.total)}</td>
          </tr>
        </tbody>
      </table>
    </PrintFrame>
  );
}

export function RfqPrintPage() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const { rfqId = '' } = useParams();
  const detail = useQuery({
    queryKey: purchasingKeys.rfq(orgId, rfqId),
    queryFn: ({ signal }) => api<RfqDetail>(`/orgs/${orgId}/purchasing/rfqs/${rfqId}`, { signal }),
  });
  useDocumentTitle(detail.data ? detail.data.rfq.number : t('purchasing.rfq'));
  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorState message={errorMessage(t, detail.error)} />;
  const r = detail.data.rfq;
  return (
    <PrintFrame title={t('purchasing.rfqTitle', { number: r.number })}>
      <p>{t('purchasing.rfqIntro')}</p>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">{t('purchasing.itemOrService')}</th>
            <th scope="col">{t('purchasing.qty')}</th>
            <th scope="col">{t('purchasing.yourPrice')}</th>
            <th scope="col">{t('purchasing.yourLeadTime')}</th>
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.description}</td>
              <td>
                {l.qty} {l.unit}
              </td>
              <td />
              <td />
            </tr>
          ))}
        </tbody>
      </table>
      {r.dueDate && <p>{t('purchasing.replyBy', { date: r.dueDate })}</p>}
    </PrintFrame>
  );
}

// ---------------------------------------------------------------------------------------------
// Bills, payments, credits

function DirectBillForm() {
  const { t } = useTranslation();
  const { orgId, branches } = useOrg();
  const queryClient = useQueryClient();
  const suppliers = useSuppliers();
  const accounts = useExpenseAccounts(true);
  const [supplierId, setSupplierId] = useState('');
  const [reference, setReference] = useState('');
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [billDate, setBillDate] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [key, setKey] = useState(newRequestKey);
  const value = parseMoney(amount);
  const save = useMutation({
    mutationFn: () =>
      api<{ bill: SupplierBill }>(`/orgs/${orgId}/purchasing/bills`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: {
          supplierId,
          supplierReference: reference,
          branchId,
          billDate,
          lines: [{ description, qty: 1, unitPrice: value, expenseAccountId: accountId }],
        },
      }),
    onSuccess: (r) => {
      showToast(
        r.bill.status === 'awaiting_approval'
          ? t('purchasing.billAwaiting', { number: r.bill.number })
          : t('purchasing.billRecorded', { number: r.bill.number }),
      );
      setKey(newRequestKey());
      setReference('');
      setAmount('');
      setDescription('');
      return queryClient.invalidateQueries({ queryKey: ['org', orgId] });
    },
  });
  return (
    <form
      className="card"
      aria-labelledby="direct-bill-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (value) save.mutate();
      }}
    >
      <h2 id="direct-bill-title">{t('purchasing.directBill')}</h2>
      <p className="muted small">{t('purchasing.directBillHint')}</p>
      <div className="form-grid">
        <Field id="db-supplier" label={t('purchasing.supplier')}>
          <select id="db-supplier" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">{t('common.choose')}</option>
            {(suppliers.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="db-ref" label={t('purchasing.supplierInvoiceNumber')}>
          <input id="db-ref" required maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field id="db-branch" label={t('purchasing.costCenter')}>
          <select id="db-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="db-date" label={t('purchasing.billDate')}>
          <input id="db-date" type="date" required value={billDate} onChange={(e) => setBillDate(e.target.value)} />
        </Field>
        <Field id="db-desc" label={t('purchasing.description')}>
          <input id="db-desc" required minLength={2} maxLength={160} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field id="db-amount" label={t('purchasing.amount')} error={amount && value === null ? t('finance.invalidAmount') : undefined}>
          <input id="db-amount" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id="db-account" label={t('purchasing.expenseAccount')}>
          <select id="db-account" required value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">{t('common.choose')}</option>
            {(accounts.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {accountName(t, a)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {save.isError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
      <ActionBar>
        <button type="submit" className="button button--primary" disabled={save.isPending}>
          {t('purchasing.recordBill')}
        </button>
      </ActionBar>
    </form>
  );
}

type Aging = {
  today: string;
  rows: { supplierId: string; name: string; notDue: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number; total: number }[];
  total: number;
};

export function BillsPage() {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  useDocumentTitle(t('purchasing.billsTitle'));
  const { money } = useOrgMoney();
  const queryClient = useQueryClient();
  const suppliers = useSuppliers();
  const bills = useQuery({
    queryKey: purchasingKeys.bills(orgId),
    queryFn: ({ signal }) => api<{ bills: SupplierBill[] }>(`/orgs/${orgId}/purchasing/bills`, { signal }).then((r) => r.bills),
  });
  const aging = useQuery({
    queryKey: purchasingKeys.aging(orgId),
    queryFn: ({ signal }) => api<Aging>(`/orgs/${orgId}/purchasing/reports/payables-aging`, { signal }),
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) =>
      api(`/orgs/${orgId}/purchasing/bills/${id}/approve`, { method: 'POST', body: { decision } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org', orgId] }),
    onError: (err) => showToast(errorMessage(t, err)),
  });
  const name = (id: string) => suppliers.data?.find((s) => s.id === id)?.name ?? '';
  const buckets = ['notDue', 'd1_30', 'd31_60', 'd61_90', 'd90plus'] as const;
  return (
    <>
      <PageHeader title={t('purchasing.billsTitle')} subtitle={t('purchasing.billsSubtitle')} />
      <PurchasingNav />
      {aging.isSuccess && (
        <section className="card" aria-labelledby="aging-title">
          <div className="section-header">
            <h2 id="aging-title">{t('purchasing.aging')}</h2>
            {aging.data.rows.length > 0 && (
              <button
                type="button"
                className="button button--secondary"
                onClick={() =>
                  downloadCsv('payables-aging.csv', [
                    [t('purchasing.supplier'), ...buckets.map((b) => t(`purchasing.buckets.${b}`)), t('purchasing.total')],
                    ...aging.data.rows.map((r) => [r.name, ...buckets.map((b) => csvMoney(r[b])), csvMoney(r.total)]),
                  ])
                }
              >
                {t('reportsHub.downloadCsv')}
              </button>
            )}
          </div>
          {aging.data.rows.length === 0 ? (
            <EmptyState icon="check">{t('purchasing.nothingOwed')}</EmptyState>
          ) : (
            <DataTable
              testId="payables-aging"
              rows={aging.data.rows}
              rowKey={(r) => r.supplierId}
              columns={[
                { key: 'supplier', label: t('purchasing.supplier'), cell: (r) => r.name },
                ...buckets.map((b) => ({
                  key: b,
                  label: t(`purchasing.buckets.${b}`),
                  numeric: true,
                  cell: (r: (typeof aging.data.rows)[number]) => (r[b] ? money(r[b]) : ''),
                })),
                { key: 'total', label: t('purchasing.total'), numeric: true, cell: (r) => money(r.total) },
              ]}
            />
          )}
        </section>
      )}
      {can('purchase.bill.manage') && <DirectBillForm />}
      <section className="card" aria-labelledby="bills-title">
        <h2 id="bills-title">{t('purchasing.bills')}</h2>
        {bills.isPending && <Loading />}
        {bills.isError && <ErrorState message={errorMessage(t, bills.error)} onRetry={() => bills.refetch()} />}
        {bills.isSuccess && bills.data.length === 0 && <EmptyState icon="file">{t('purchasing.noBills')}</EmptyState>}
        {bills.isSuccess && bills.data.length > 0 && (
          <ul className="data-list" data-testid="supplier-bills">
            {bills.data.map((b) => (
              <li key={b.id} className="data-row">
                <div className="data-main">
                  <h3>
                    <Link to={`/app/${orgId}/purchasing/bills/${b.id}`}>
                      <bdi dir="ltr">{b.number}</bdi>
                    </Link>{' '}
                    · {name(b.supplierId)} · <bdi dir="ltr">{b.supplierReference}</bdi>
                  </h3>
                  <p className="muted">
                    {money(b.total)} · {t('purchasing.balanceLeft', { amount: money(b.balance) })} · {t('purchasing.due', { date: b.dueDate })}
                  </p>
                </div>
                <span className={statusBadge(b.status)}>{t(`purchasing.billStatus.${b.status}`)}</span>
                {b.status === 'awaiting_approval' && can('purchase.approve') && (
                  <div className="row-actions">
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: b.id, decision: 'approve' })}
                    >
                      {t('purchasing.approve')}
                    </button>
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: b.id, decision: 'reject' })}
                    >
                      {t('purchasing.reject')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function PayForm({ bill }: { bill: SupplierBill }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const queryClient = useQueryClient();
  const boxes = useQuery({
    queryKey: ['org', orgId, 'accounting', 'cash', 'accounts'],
    queryFn: ({ signal }) => api<{ accounts: CashAccount[] }>(`/orgs/${orgId}/cash/accounts`, { signal }).then((r) => r.accounts),
  });
  const [cashAccountId, setCashAccountId] = useState('');
  const [amount, setAmount] = useState(moneyInput(bill.balance));
  const [reference, setReference] = useState('');
  const [key, setKey] = useState(newRequestKey);
  const value = parseMoney(amount);
  const pay = useMutation({
    mutationFn: () =>
      api<{ payment: SupplierPayment }>(`/orgs/${orgId}/purchasing/payments`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: { supplierId: bill.supplierId, cashAccountId, amount: value, allocations: [{ billId: bill.id, amount: value }], reference },
      }),
    onSuccess: (r) => {
      showToast(t('purchasing.paid', { number: r.payment.number }));
      setKey(newRequestKey());
      return queryClient.invalidateQueries({ queryKey: ['org', orgId] });
    },
  });
  return (
    <form
      className="card"
      aria-labelledby="pay-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (value && cashAccountId) pay.mutate();
      }}
    >
      <h2 id="pay-title">{t('purchasing.payBill')}</h2>
      <div className="form-grid">
        <Field id="pay-from" label={t('purchasing.payFrom')}>
          <select id="pay-from" required value={cashAccountId} onChange={(e) => setCashAccountId(e.target.value)}>
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
        <Field id="pay-amount" label={t('purchasing.amount')} error={amount && value === null ? t('finance.invalidAmount') : undefined}>
          <input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id="pay-ref" label={t('purchasing.reference')}>
          <input id="pay-ref" maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
      {pay.isError && <Notice kind="error">{errorMessage(t, pay.error)}</Notice>}
      <ActionBar>
        <button type="submit" className="button button--primary" disabled={pay.isPending}>
          {t('purchasing.pay')}
        </button>
      </ActionBar>
    </form>
  );
}

function CreditForm({ bill }: { bill: SupplierBill }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const queryClient = useQueryClient();
  const [qtys, setQtys] = useState<string[]>(() => bill.lines.map(() => ''));
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(newRequestKey);
  const lines = bill.lines.flatMap((_, i) =>
    /^\d{1,7}$/.test(qtys[i] ?? '') && Number(qtys[i]) > 0 ? [{ billLineIndex: i, qty: Number(qtys[i]) }] : [],
  );
  const save = useMutation({
    mutationFn: () =>
      api<{ credit: SupplierCredit }>(`/orgs/${orgId}/purchasing/bills/${bill.id}/credits`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: { supplierReference: reference, lines, reason },
      }),
    onSuccess: (r) => {
      showToast(t('purchasing.credited', { number: r.credit.number }));
      setKey(newRequestKey());
      return queryClient.invalidateQueries({ queryKey: ['org', orgId] });
    },
  });
  return (
    <form
      className="card"
      aria-labelledby="credit-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (lines.length) save.mutate();
      }}
    >
      <h2 id="credit-title">{t('purchasing.creditNote')}</h2>
      <p className="muted small">{t('purchasing.creditHint')}</p>
      <div className="form-grid">
        {bill.lines.map((l, i) =>
          l.qty - l.credited > 0 ? (
            <Field key={i} id={`credit-${i}`} label={t('purchasing.qtyOf', { item: l.description, unit: '', open: l.qty - l.credited })}>
              <input
                id={`credit-${i}`}
                inputMode="numeric"
                value={qtys[i]}
                onChange={(e) => setQtys(qtys.map((q, j) => (j === i ? e.target.value : q)))}
              />
            </Field>
          ) : null,
        )}
        <Field id="credit-ref" label={t('purchasing.supplierCreditNumber')}>
          <input id="credit-ref" maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field id="credit-reason" label={t('purchasing.reason')}>
          <input id="credit-reason" required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      {save.isError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
      <ActionBar>
        <button type="submit" className="button button--secondary" disabled={save.isPending || lines.length === 0}>
          {t('purchasing.recordCredit')}
        </button>
      </ActionBar>
    </form>
  );
}

export function BillPage() {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const { billId = '' } = useParams();
  const { money } = useOrgMoney();
  const suppliers = useSuppliers();
  const view = useQuery({
    queryKey: purchasingKeys.bill(orgId, billId),
    queryFn: ({ signal }) =>
      api<{ bill: SupplierBill; payments: SupplierPayment[]; credits: SupplierCredit[] }>(`/orgs/${orgId}/purchasing/bills/${billId}`, { signal }),
  });
  useDocumentTitle(view.data ? view.data.bill.number : t('purchasing.bill'));
  if (view.isPending) return <Loading />;
  if (view.isError) return <ErrorState message={errorMessage(t, view.error)} onRetry={() => view.refetch()} />;
  const { bill: b, payments, credits } = view.data;
  return (
    <>
      <PageHeader
        back={{ to: `/app/${orgId}/purchasing/bills`, label: t('purchasing.billsTitle') }}
        title={t('purchasing.billTitle', { number: b.number })}
        subtitle={suppliers.data?.find((s) => s.id === b.supplierId)?.name}
      />
      <PurchasingNav />
      <section className="card" aria-labelledby="bill-summary-title">
        <div className="section-header">
          <h2 id="bill-summary-title">{t('purchasing.summary')}</h2>
          <span className={statusBadge(b.status)}>{t(`purchasing.billStatus.${b.status}`)}</span>
        </div>
        <dl className="details">
          <dt>{t('purchasing.supplierInvoiceNumber')}</dt>
          <dd>
            <bdi dir="ltr">{b.supplierReference}</bdi>
          </dd>
          <dt>{t('purchasing.billDate')}</dt>
          <dd>
            <DateText value={b.billDate} />
          </dd>
          <dt>{t('purchasing.dueDate')}</dt>
          <dd>
            <DateText value={b.dueDate} />
          </dd>
          <dt>{t('purchasing.total')}</dt>
          <dd>{money(b.total)}</dd>
          <dt>{t('purchasing.paidCol')}</dt>
          <dd>{money(b.paid)}</dd>
          <dt>{t('purchasing.creditedCol')}</dt>
          <dd>{money(b.credited)}</dd>
          <dt>{t('purchasing.balance')}</dt>
          <dd data-testid="bill-balance">{money(b.balance)}</dd>
        </dl>
        <ul className="data-list">
          {b.lines.map((l, i) => (
            <li key={i} className="data-row">
              <div className="data-main">
                <h3>{l.description}</h3>
                <p className="muted">
                  {l.qty} × {money(l.unitPrice)} = {money(l.amount)}
                  {l.credited > 0 && ` · ${t('purchasing.creditedQty', { qty: l.credited })}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
        {b.orderId && <Link to={`/app/${orgId}/purchasing/orders/${b.orderId}`}>{t('purchasing.openOrder')}</Link>}
      </section>
      {b.status === 'posted' && b.balance > 0 && can('purchase.pay') && <PayForm bill={b} />}
      {b.status === 'posted' && b.balance > 0 && can('purchase.bill.manage') && <CreditForm bill={b} />}
      {(payments.length > 0 || credits.length > 0) && (
        <section className="card" aria-labelledby="bill-history-title">
          <h2 id="bill-history-title">{t('purchasing.history')}</h2>
          <ul className="data-list">
            {payments.map((p) => (
              <li key={p.id} className="data-row">
                <div className="data-main">
                  <h3>
                    <bdi dir="ltr">{p.number}</bdi> {t('purchasing.payment')}
                  </h3>
                  <p className="muted">
                    {money(p.allocations.find((a) => a.billId === b.id)?.amount ?? 0)} · <DateText value={p.date} />
                  </p>
                </div>
              </li>
            ))}
            {credits.map((c) => (
              <li key={c.id} className="data-row">
                <div className="data-main">
                  <h3>
                    <bdi dir="ltr">{c.number}</bdi> {t('purchasing.creditNote')}
                  </h3>
                  <p className="muted">
                    {money(c.amount)} · <bdi dir="auto">{c.reason}</bdi>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Suppliers

export function SuppliersPage() {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  useDocumentTitle(t('purchasing.suppliersTitle'));
  const queryClient = useQueryClient();
  const suppliers = useSuppliers();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [terms, setTerms] = useState('30');
  const add = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/purchasing/suppliers`, { method: 'POST', body: { code, name, phone, paymentTermsDays: Number(terms) || 0 } }),
    onSuccess: () => {
      showToast(t('purchasing.supplierAdded'));
      setCode('');
      setName('');
      setPhone('');
      return queryClient.invalidateQueries({ queryKey: purchasingKeys.suppliers(orgId) });
    },
  });
  return (
    <>
      <PageHeader title={t('purchasing.suppliersTitle')} subtitle={t('purchasing.suppliersSubtitle')} />
      <PurchasingNav />
      <section className="card" aria-labelledby="suppliers-title">
        <h2 id="suppliers-title">{t('purchasing.suppliers')}</h2>
        {suppliers.isPending && <Loading />}
        {suppliers.isSuccess && suppliers.data.length === 0 && <EmptyState icon="users">{t('purchasing.noSuppliers')}</EmptyState>}
        {suppliers.isSuccess && suppliers.data.length > 0 && (
          <ul className="data-list" data-testid="suppliers">
            {suppliers.data.map((s) => (
              <li key={s.id} className="data-row">
                <div className="data-main">
                  <h3>
                    {s.name} <bdi dir="ltr">{s.code}</bdi>
                  </h3>
                  <p className="muted">
                    {s.phone && <bdi dir="ltr">{s.phone}</bdi>} {t('purchasing.terms', { days: s.paymentTermsDays })}
                  </p>
                </div>
                <span className={s.status === 'active' ? 'badge badge--active' : 'badge'}>{t(`purchasing.supplierStatus.${s.status}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {can('purchase.supplier.manage') && (
        <form
          className="card"
          aria-labelledby="add-supplier-title"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <h2 id="add-supplier-title">{t('purchasing.addSupplier')}</h2>
          <div className="form-grid">
            <Field id="sup-code" label={t('purchasing.code')}>
              <input id="sup-code" required maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <Field id="sup-name" label={t('purchasing.supplierName')}>
              <input id="sup-name" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field id="sup-phone" label={t('purchasing.phone')}>
              <input id="sup-phone" dir="ltr" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field id="sup-terms" label={t('purchasing.paymentTerms')}>
              <input id="sup-terms" inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value)} />
            </Field>
          </div>
          {add.isError && <Notice kind="error">{errorMessage(t, add.error)}</Notice>}
          <ActionBar>
            <button type="submit" className="button button--primary" disabled={add.isPending}>
              {t('purchasing.addSupplier')}
            </button>
          </ActionBar>
        </form>
      )}
    </>
  );
}
