import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { displayName } from '../lib/defaultNames';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Metric } from '../components/Metric';
import { PageHeader } from '../components/PageHeader';
import { DataTable, DateText, FilterBar, Money, Pagination, Quantity } from '../components/data';
import { ActionBar, CardGrid, MetricGrid, ModuleTabs } from '../components/layout';
import { Badge, EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import { api, query } from '../lib/api';
import { newRequestKey } from '../lib/clinical';
import { errorMessage } from '../lib/errors';
import { parseMoney } from '../lib/finance';
import { inventoryKeys, type StockBalance, type StockItem, type StockMove, type Warehouse } from '../lib/inventory';
import { showToast } from '../lib/toast';
import type { Page } from '../lib/types';
import { useAccountingSettings } from '../lib/useAccounting';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { pageParam, useUrlState } from '../lib/useUrlState';
import { useOrg } from '../org/context';

// Inventory and medical consumables (docs/architecture/INVENTORY.md). Quantities are in each item's
// base unit; costs appear only for roles that may see them. Every change is a numbered stock document.

function useItems() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: inventoryKeys.items(orgId),
    queryFn: ({ signal }) => api<{ items: StockItem[] }>(`/orgs/${orgId}/inventory/items`, { signal }).then((r) => r.items),
  });
}
function useWarehouses() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: inventoryKeys.warehouses(orgId),
    queryFn: ({ signal }) => api<{ warehouses: Warehouse[] }>(`/orgs/${orgId}/inventory/warehouses`, { signal }).then((r) => r.warehouses),
  });
}

function InventoryNav() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  return (
    <ModuleTabs
      label={t('inventory.nav.label')}
      items={[
        { to: `/app/${orgId}/inventory`, label: t('inventory.nav.stock'), end: true },
        { to: `/app/${orgId}/inventory/items`, label: t('inventory.nav.items') },
        { to: `/app/${orgId}/inventory/moves`, label: t('inventory.nav.moves') },
      ]}
    />
  );
}

type Alerts = {
  today: string;
  expiring: StockBalance[];
  reorder: { itemId: string; code: string; name: string; onHand: number; reorderLevel: number; suggested: number }[];
};

const OPERATIONS = ['issue', 'transfer', 'adjustment', 'write_off', 'opening'] as const;
type Operation = (typeof OPERATIONS)[number];

function OperationForm({ items, warehouses }: { items: StockItem[]; warehouses: Warehouse[] }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const queryClient = useQueryClient();
  const active = warehouses.filter((w) => w.status === 'active');
  const [type, setType] = useState<Operation>('issue');
  const [warehouseId, setWarehouseId] = useState(active[0]?.id ?? '');
  const [toWarehouseId, setTo] = useState('');
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [lot, setLot] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(newRequestKey);
  const item = items.find((i) => i.id === itemId);
  const n = /^\d{1,7}$/.test(qty) ? Number(qty) : null;
  const unitCost = cost ? parseMoney(cost) : undefined;
  const save = useMutation({
    mutationFn: () => {
      const line =
        type === 'adjustment'
          ? {
              itemId,
              counted: n,
              lot: lot || '',
              ...(expiry ? { expiry } : {}),
              ...(unitCost !== undefined && unitCost !== null ? { unitCost } : {}),
            }
          : type === 'opening'
            ? { itemId, qty: n, ...(unit ? { unit } : {}), ...(lot ? { lot } : {}), ...(expiry ? { expiry } : {}), unitCost }
            : { itemId, qty: n, ...(unit ? { unit } : {}), ...(lot ? { lot } : {}) };
      return api<{ document: { number: string } }>(`/orgs/${orgId}/inventory/operations`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: { type, warehouseId, ...(type === 'transfer' ? { toWarehouseId } : {}), lines: [line], reason },
      });
    },
    onSuccess: (r) => {
      showToast(t('inventory.saved', { number: r.document.number }));
      setKey(newRequestKey());
      setQty('');
      setLot('');
      setExpiry('');
      setCost('');
      return queryClient.invalidateQueries({ queryKey: inventoryKeys.all(orgId) });
    },
  });
  const needsReason = type === 'adjustment' || type === 'write_off' || type === 'issue';
  return (
    <form
      className="card"
      aria-labelledby="stock-op-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (itemId && n !== null) save.mutate();
      }}
    >
      <h2 id="stock-op-title">{t('inventory.newOperation')}</h2>
      <div className="segmented segmented--wrap" role="group" aria-label={t('inventory.operationType')}>
        {OPERATIONS.map((o) => (
          <button
            key={o}
            type="button"
            className={o === type ? 'segment segment--active' : 'segment'}
            aria-pressed={o === type}
            onClick={() => setType(o)}
          >
            {t(`inventory.types.${o}`)}
          </button>
        ))}
      </div>
      <p className="muted small">{t(`inventory.typeHints.${type}`)}</p>
      <div className="form-grid">
        <Field id="op-warehouse" label={type === 'transfer' ? t('inventory.fromWarehouse') : t('inventory.warehouse')}>
          <select id="op-warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {active.map((w) => (
              <option key={w.id} value={w.id}>
                {displayName(t, w.name)}
              </option>
            ))}
          </select>
        </Field>
        {type === 'transfer' && (
          <Field id="op-to" label={t('inventory.toWarehouse')}>
            <select id="op-to" required value={toWarehouseId} onChange={(e) => setTo(e.target.value)}>
              <option value="">{t('common.choose')}</option>
              {active
                .filter((w) => w.id !== warehouseId)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {displayName(t, w.name)}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <Field id="op-item" label={t('inventory.item')}>
          <select id="op-item" required value={itemId} onChange={(e) => (setItemId(e.target.value), setUnit(''))}>
            <option value="">{t('common.choose')}</option>
            {items
              .filter((i) => i.status === 'active')
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.code} · {i.name}
                </option>
              ))}
          </select>
        </Field>
        <Field
          id="op-qty"
          label={type === 'adjustment' ? t('inventory.counted') : t('inventory.quantity')}
          error={qty && n === null ? t('inventory.invalidQty') : undefined}
        >
          <input id="op-qty" inputMode="numeric" required value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        {item && type !== 'adjustment' && item.purchaseUnits.length > 0 && (
          <Field id="op-unit" label={t('inventory.unit')}>
            <select id="op-unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">{item.baseUnit}</option>
              {item.purchaseUnits.map((u) => (
                <option key={u.unit} value={u.unit}>
                  {t('inventory.unitOf', { unit: u.unit, factor: u.factor, base: item.baseUnit })}
                </option>
              ))}
            </select>
          </Field>
        )}
        {item?.tracking === 'lot' && (
          <Field id="op-lot" label={t('inventory.lot')} hint={type === 'issue' || type === 'transfer' ? t('inventory.fefoHint') : undefined}>
            <input
              id="op-lot"
              maxLength={40}
              value={lot}
              onChange={(e) => setLot(e.target.value)}
              required={type === 'opening' || type === 'adjustment' || type === 'write_off'}
            />
          </Field>
        )}
        {item?.tracking === 'lot' && (type === 'opening' || type === 'adjustment') && (
          <Field id="op-expiry" label={t('inventory.expiry')}>
            <input id="op-expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} required={type === 'opening'} />
          </Field>
        )}
        {(type === 'opening' || type === 'adjustment') && (
          <Field
            id="op-cost"
            label={t('inventory.unitCost')}
            hint={type === 'adjustment' ? t('inventory.costHintAdjust') : t('finance.amountHint')}
            error={cost && unitCost === null ? t('finance.invalidAmount') : undefined}
          >
            <input id="op-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} required={type === 'opening'} />
          </Field>
        )}
        <Field id="op-reason" label={t('inventory.reason')}>
          <input
            id="op-reason"
            maxLength={300}
            minLength={needsReason ? 3 : 0}
            required={needsReason}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>
      {save.isError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
      <ActionBar>
        <button type="submit" className="button button--primary" disabled={save.isPending || !itemId || n === null}>
          {t('inventory.save')}
        </button>
      </ActionBar>
    </form>
  );
}

export function InventoryPage() {
  const { t } = useTranslation();
  const { orgId, can, branches } = useOrg();
  useDocumentTitle(t('inventory.title'));
  const items = useItems();
  const warehouses = useWarehouses();
  const url = useUrlState();
  const warehouseId = url.get('warehouse');
  const params = { warehouseId: warehouseId || undefined };
  const balances = useQuery({
    queryKey: inventoryKeys.balances(orgId, params),
    queryFn: ({ signal }) => api<{ today: string; balances: StockBalance[] }>(`/orgs/${orgId}/inventory/balances${query(params)}`, { signal }),
  });
  const alerts = useQuery({
    queryKey: inventoryKeys.alerts(orgId),
    queryFn: ({ signal }) => api<Alerts>(`/orgs/${orgId}/inventory/alerts`, { signal }),
  });
  if (items.isPending || warehouses.isPending) return <Loading />;
  if (items.isError) return <ErrorState message={errorMessage(t, items.error)} onRetry={() => items.refetch()} />;
  if (warehouses.isError) return <ErrorState message={errorMessage(t, warehouses.error)} onRetry={() => warehouses.refetch()} />;
  const itemOf = new Map(items.data.map((i) => [i.id, i]));
  const warehouseName = new Map(warehouses.data.map((w) => [w.id, displayName(t, w.name)]));
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const expired = (alerts.data?.expiring ?? []).filter((b) => b.expired);
  return (
    <>
      <PageHeader title={t('inventory.title')} subtitle={t('inventory.subtitle')}>
        {can('purchase.request') && (
          <Link className="button button--secondary" to={`/app/${orgId}/purchasing`}>
            {t('inventory.requestSupplies')}
          </Link>
        )}
      </PageHeader>
      <InventoryNav />
      {alerts.isSuccess && (
        <MetricGrid testId="inventory-metrics">
          <Metric icon="box" label={t('inventory.metrics.items')} value={items.data.filter((i) => i.status === 'active').length} />
          <Metric
            icon="alert"
            tone={alerts.data.reorder.length ? 'warn' : 'neutral'}
            label={t('inventory.metrics.reorder')}
            value={alerts.data.reorder.length}
          />
          <Metric
            icon="clock"
            tone={alerts.data.expiring.length - expired.length ? 'warn' : 'neutral'}
            label={t('inventory.metrics.expiring')}
            value={alerts.data.expiring.length - expired.length}
          />
          <Metric icon="ban" tone={expired.length ? 'bad' : 'neutral'} label={t('inventory.metrics.expired')} value={expired.length} />
        </MetricGrid>
      )}
      {warehouses.data.length === 0 && (
        <EmptyState
          icon="box"
          action={can('inventory.manage') && <Link to={`/app/${orgId}/inventory/items`}>{t('inventory.addWarehouseLink')}</Link>}
        >
          {t('inventory.noWarehouses')}
        </EmptyState>
      )}
      {alerts.isSuccess && (alerts.data.reorder.length > 0 || alerts.data.expiring.length > 0) && (
        <CardGrid wide>
          {alerts.data.reorder.length > 0 && (
            <section className="card" aria-labelledby="reorder-title">
              <h2 id="reorder-title">{t('inventory.reorderTitle')}</h2>
              <ul className="data-list">
                {alerts.data.reorder.map((r) => (
                  <li key={r.itemId} className="data-row">
                    <div className="data-main">
                      <h3>{r.name}</h3>
                      <p className="muted">
                        {t('inventory.reorderLine', { onHand: r.onHand, level: r.reorderLevel, unit: itemOf.get(r.itemId)?.baseUnit ?? '' })}
                      </p>
                    </div>
                    <strong>{t('inventory.suggested', { qty: r.suggested })}</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {alerts.data.expiring.length > 0 && (
            <section className="card" aria-labelledby="expiring-title">
              <h2 id="expiring-title">{t('inventory.expiringTitle')}</h2>
              <ul className="data-list">
                {alerts.data.expiring.map((b) => (
                  <li key={`${b.itemId}-${b.warehouseId}-${b.lot}`} className="data-row">
                    <div className="data-main">
                      <h3>{itemOf.get(b.itemId)?.name}</h3>
                      <p className="muted">
                        {t('inventory.lot')} <bdi dir="ltr">{b.lot}</bdi> · {warehouseName.get(b.warehouseId)} ·{' '}
                        <Quantity value={b.qty} unit={itemOf.get(b.itemId)?.baseUnit} />
                      </p>
                    </div>
                    <Badge tone={b.expired ? 'danger' : 'warning'}>
                      {b.expired ? t('inventory.expired') : t('inventory.expires')} <DateText value={b.expiry} />
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </CardGrid>
      )}
      {can('inventory.move') && warehouses.data.length > 0 && items.data.length > 0 && (
        <OperationForm items={items.data} warehouses={warehouses.data} />
      )}
      {warehouses.data.length > 0 && (
        <section className="card" aria-labelledby="stock-title">
          <h2 id="stock-title">{t('inventory.stockTitle')}</h2>
          <FilterBar active={Boolean(warehouseId)} onReset={() => url.set({ warehouse: null })}>
            <Field id="stock-warehouse" label={t('inventory.warehouse')}>
              <select id="stock-warehouse" value={warehouseId} onChange={(e) => url.set({ warehouse: e.target.value })}>
                <option value="">{t('inventory.allWarehouses')}</option>
                {warehouses.data.map((w) => (
                  <option key={w.id} value={w.id}>
                    {displayName(t, w.name)} · {branchName.get(w.branchId) ?? ''}
                  </option>
                ))}
              </select>
            </Field>
          </FilterBar>
          {balances.isPending && <Loading />}
          {balances.isError && <ErrorState message={errorMessage(t, balances.error)} onRetry={() => balances.refetch()} />}
          {balances.isSuccess && balances.data.balances.length === 0 && <EmptyState icon="box">{t('inventory.noStock')}</EmptyState>}
          {balances.isSuccess && balances.data.balances.length > 0 && (
            <DataTable
              testId="stock-balances"
              caption={t('inventory.stockTitle')}
              rows={balances.data.balances}
              rowKey={(b) => `${b.itemId}-${b.warehouseId}-${b.lot}`}
              columns={[
                {
                  key: 'item',
                  label: t('inventory.item'),
                  cell: (b) => (
                    <>
                      <bdi dir="ltr">{itemOf.get(b.itemId)?.code}</bdi> {itemOf.get(b.itemId)?.name}
                    </>
                  ),
                },
                { key: 'warehouse', label: t('inventory.warehouse'), cell: (b) => warehouseName.get(b.warehouseId) },
                { key: 'lot', label: t('inventory.lot'), cell: (b) => (b.lot ? <bdi dir="ltr">{b.lot}</bdi> : '—') },
                {
                  key: 'expiry',
                  label: t('inventory.expiry'),
                  cell: (b) => (
                    <>
                      <DateText value={b.expiry} /> {b.expired && <Badge tone="danger">{t('inventory.expired')}</Badge>}
                    </>
                  ),
                },
                {
                  key: 'qty',
                  label: t('inventory.quantity'),
                  numeric: true,
                  cell: (b) => <Quantity value={b.qty} unit={itemOf.get(b.itemId)?.baseUnit} />,
                },
              ]}
            />
          )}
        </section>
      )}
    </>
  );
}

function AddItemForm() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [baseUnit, setBaseUnit] = useState('');
  const [packUnit, setPackUnit] = useState('');
  const [packFactor, setPackFactor] = useState('');
  const [tracking, setTracking] = useState<'none' | 'lot'>('none');
  const [reorderLevel, setReorder] = useState('0');
  const add = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/inventory/items`, {
        method: 'POST',
        body: {
          code,
          name,
          category,
          baseUnit,
          purchaseUnits: packUnit && packFactor ? [{ unit: packUnit, factor: Number(packFactor) }] : [],
          tracking,
          reorderLevel: Number(reorderLevel) || 0,
        },
      }),
    onSuccess: () => {
      showToast(t('inventory.itemAdded'));
      setCode('');
      setName('');
      return queryClient.invalidateQueries({ queryKey: inventoryKeys.all(orgId) });
    },
  });
  return (
    <form
      className="card"
      aria-labelledby="add-item-title"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <h2 id="add-item-title">{t('inventory.addItem')}</h2>
      <div className="form-grid">
        <Field id="item-code" label={t('inventory.code')}>
          <input id="item-code" required maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field id="item-name" label={t('inventory.name')}>
          <input id="item-name" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="item-category" label={t('inventory.category')}>
          <input id="item-category" maxLength={60} value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        <Field id="item-unit" label={t('inventory.baseUnit')} hint={t('inventory.baseUnitHint')}>
          <input id="item-unit" required maxLength={20} value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)} />
        </Field>
        <Field id="item-pack" label={t('inventory.packUnit')}>
          <input id="item-pack" maxLength={20} value={packUnit} onChange={(e) => setPackUnit(e.target.value)} />
        </Field>
        <Field id="item-factor" label={t('inventory.packFactor')} hint={t('inventory.packFactorHint')}>
          <input id="item-factor" inputMode="numeric" value={packFactor} onChange={(e) => setPackFactor(e.target.value)} />
        </Field>
        <Field id="item-tracking" label={t('inventory.tracking')}>
          <select id="item-tracking" value={tracking} onChange={(e) => setTracking(e.target.value as 'none' | 'lot')}>
            <option value="none">{t('inventory.trackingNone')}</option>
            <option value="lot">{t('inventory.trackingLot')}</option>
          </select>
        </Field>
        <Field id="item-reorder" label={t('inventory.reorderLevel')}>
          <input id="item-reorder" inputMode="numeric" value={reorderLevel} onChange={(e) => setReorder(e.target.value)} />
        </Field>
      </div>
      {add.isError && <Notice kind="error">{errorMessage(t, add.error)}</Notice>}
      <ActionBar>
        <button type="submit" className="button button--primary" disabled={add.isPending}>
          {t('inventory.addItem')}
        </button>
      </ActionBar>
    </form>
  );
}

function AddWarehouseForm() {
  const { t } = useTranslation();
  const { orgId, branches } = useOrg();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const add = useMutation({
    mutationFn: () => api(`/orgs/${orgId}/inventory/warehouses`, { method: 'POST', body: { name, branchId } }),
    onSuccess: () => {
      showToast(t('inventory.warehouseAdded'));
      setName('');
      return queryClient.invalidateQueries({ queryKey: inventoryKeys.all(orgId) });
    },
  });
  return (
    <form
      className="form-grid"
      aria-label={t('inventory.addWarehouse')}
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <Field id="wh-name" label={t('inventory.warehouseName')}>
        <input id="wh-name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="wh-branch" label={t('inventory.branch')}>
        <select id="wh-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      {add.isError && <Notice kind="error">{errorMessage(t, add.error)}</Notice>}
      <ActionBar>
        <button type="submit" className="button button--secondary" disabled={add.isPending}>
          {t('inventory.addWarehouse')}
        </button>
      </ActionBar>
    </form>
  );
}

export function InventoryItemsPage() {
  const { t } = useTranslation();
  const { can, branches } = useOrg();
  useDocumentTitle(t('inventory.itemsTitle'));
  const settings = useAccountingSettings();
  const items = useItems();
  const warehouses = useWarehouses();
  const currency = settings.data?.settings?.currency ?? settings.data?.prerequisites.currency ?? null;
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  return (
    <>
      <PageHeader title={t('inventory.itemsTitle')} subtitle={t('inventory.itemsSubtitle')} />
      <InventoryNav />
      {items.isPending && <Loading />}
      {items.isError && <ErrorState message={errorMessage(t, items.error)} onRetry={() => items.refetch()} />}
      {items.isSuccess && (
        <section className="card" aria-labelledby="items-title">
          <h2 id="items-title">{t('inventory.items')}</h2>
          {items.data.length === 0 ? (
            <EmptyState icon="box">{t('inventory.noItems')}</EmptyState>
          ) : (
            <DataTable
              testId="stock-items"
              caption={t('inventory.items')}
              rows={items.data}
              rowKey={(i) => i.id}
              rowClassName={(i) => (i.status === 'archived' ? 'row-muted' : undefined)}
              columns={[
                { key: 'code', label: t('inventory.code'), cell: (i) => <bdi dir="ltr">{i.code}</bdi> },
                {
                  key: 'name',
                  label: t('inventory.name'),
                  cell: (i) => (
                    <>
                      {i.name} {i.tracking === 'lot' && <Badge>{t('inventory.lotTracked')}</Badge>}
                      {i.category && <span className="muted"> · {i.category}</span>}
                    </>
                  ),
                },
                {
                  key: 'onHand',
                  label: t('inventory.onHand'),
                  numeric: true,
                  cell: (i) => (
                    <>
                      {i.belowReorder && <Badge tone="warning">{t('inventory.belowReorder')}</Badge>} <Quantity value={i.onHand} unit={i.baseUnit} />
                    </>
                  ),
                },
                {
                  key: 'reorderLevel',
                  label: t('inventory.reorderLevel'),
                  numeric: true,
                  cell: (i) => (i.reorderLevel ? <Quantity value={i.reorderLevel} /> : '—'),
                },
                items.data.some((i) => i.stockValue !== undefined) && {
                  key: 'value',
                  label: t('inventory.value'),
                  numeric: true,
                  cell: (i) => <Money minor={i.stockValue} currency={currency} />,
                },
              ]}
            />
          )}
        </section>
      )}
      {can('inventory.manage') && <AddItemForm />}
      {warehouses.isSuccess && (
        <section className="card" aria-labelledby="warehouses-title">
          <h2 id="warehouses-title">{t('inventory.warehouses')}</h2>
          {warehouses.data.length === 0 ? (
            <EmptyState icon="building">{t('inventory.noWarehouses')}</EmptyState>
          ) : (
            <ul className="data-list">
              {warehouses.data.map((w) => (
                <li key={w.id} className="data-row">
                  <div className="data-main">
                    <h3>{displayName(t, w.name)}</h3>
                    <p className="muted">{branchName.get(w.branchId)}</p>
                  </div>
                  <Badge tone={w.status === 'active' ? 'success' : 'neutral'}>{t(`inventory.status.${w.status}`)}</Badge>
                </li>
              ))}
            </ul>
          )}
          {can('inventory.manage') && <AddWarehouseForm />}
        </section>
      )}
    </>
  );
}

export function InventoryMovesPage() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  useDocumentTitle(t('inventory.movesTitle'));
  const settings = useAccountingSettings();
  const items = useItems();
  const warehouses = useWarehouses();
  const url = useUrlState();
  const itemId = url.get('item');
  const page = pageParam(url.get('page'));
  const params = { itemId: itemId || undefined, page, pageSize: 50 };
  const moves = useQuery({
    queryKey: inventoryKeys.moves(orgId, params),
    queryFn: ({ signal }) => api<Page<StockMove>>(`/orgs/${orgId}/inventory/moves${query(params)}`, { signal }),
  });
  const itemOf = new Map((items.data ?? []).map((i) => [i.id, i]));
  const warehouseName = new Map((warehouses.data ?? []).map((w) => [w.id, displayName(t, w.name)]));
  const currency = settings.data?.settings?.currency ?? settings.data?.prerequisites.currency ?? null;
  return (
    <>
      <PageHeader title={t('inventory.movesTitle')} subtitle={t('inventory.movesSubtitle')} />
      <InventoryNav />
      <section className="card" aria-labelledby="moves-title">
        <h2 id="moves-title" className="visually-hidden">
          {t('inventory.movesTitle')}
        </h2>
        <FilterBar active={Boolean(itemId)} onReset={() => url.set({ item: null, page: null })}>
          <Field id="moves-item" label={t('inventory.item')}>
            <select id="moves-item" value={itemId} onChange={(e) => url.set({ item: e.target.value, page: null })}>
              <option value="">{t('inventory.allItems')}</option>
              {(items.data ?? []).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.code} · {i.name}
                </option>
              ))}
            </select>
          </Field>
        </FilterBar>
        {moves.isPending && <Loading />}
        {moves.isError && <ErrorState message={errorMessage(t, moves.error)} onRetry={() => moves.refetch()} />}
        {moves.isSuccess && moves.data.data.length === 0 && <EmptyState icon="box">{t('inventory.noMoves')}</EmptyState>}
        {moves.isSuccess && moves.data.data.length > 0 && (
          <>
            <DataTable
              testId="stock-moves"
              caption={t('inventory.movesTitle')}
              rows={moves.data.data}
              rowKey={(m) => m.id}
              columns={[
                {
                  key: 'document',
                  label: t('inventory.document'),
                  cell: (m) => (
                    <>
                      <bdi dir="ltr">{m.documentNumber}</bdi> {t(`inventory.types.${m.type}`)}
                    </>
                  ),
                },
                { key: 'date', label: t('inventory.date'), cell: (m) => <DateText value={m.date} /> },
                {
                  key: 'item',
                  label: t('inventory.item'),
                  cell: (m) => (
                    <>
                      {itemOf.get(m.itemId)?.name} {m.lot && <bdi dir="ltr">({m.lot})</bdi>}
                    </>
                  ),
                },
                { key: 'warehouse', label: t('inventory.warehouse'), cell: (m) => warehouseName.get(m.warehouseId) },
                { key: 'qty', label: t('inventory.quantity'), numeric: true, cell: (m) => <Quantity value={m.qty} signed /> },
                { key: 'onHandAfter', label: t('inventory.onHandAfter'), numeric: true, cell: (m) => <Quantity value={m.onHandAfter} /> },
                moves.data.data.some((m) => m.value !== undefined) && {
                  key: 'value',
                  label: t('inventory.value'),
                  numeric: true,
                  cell: (m) => <Money minor={m.value} currency={currency} />,
                },
              ]}
            />
            <Pagination page={page} pageSize={moves.data.pageSize} total={moves.data.total} onPage={(p) => url.set({ page: p > 1 ? p : null })} />
          </>
        )}
      </section>
    </>
  );
}
