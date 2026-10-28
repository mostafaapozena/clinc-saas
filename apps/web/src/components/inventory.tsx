import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, query } from '../lib/api';
import { newRequestKey, type Encounter } from '../lib/clinical';
import { errorMessage } from '../lib/errors';
import { inventoryKeys, type StockDocument, type StockItem, type StockMove, type Warehouse } from '../lib/inventory';
import { showToast } from '../lib/toast';
import { useOrg } from '../org/context';
import { Field, Notice } from './ui';

type Consumption = StockDocument & { moves: StockMove[] };

/**
 * For the treating doctor on their own finalized record: the materials used, taken from a warehouse
 * of the visit's branch (first-expiring lots first). Planned treatment never consumes stock; a
 * mistake is corrected by returning the materials (a linked document), never by editing.
 */
export function MaterialsUsed({ encounter }: { encounter: Encounter }) {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const queryClient = useQueryClient();
  const allowed = can('inventory.consume') && can('inventory.read') && encounter.status === 'finalized';
  const consumptions = useQuery({
    queryKey: inventoryKeys.consumptions(orgId, encounter.id),
    queryFn: ({ signal }) =>
      api<{ consumptions: Consumption[] }>(`/orgs/${orgId}/inventory/consumptions${query({ encounterId: encounter.id })}`, { signal }).then(
        (r) => r.consumptions,
      ),
    enabled: allowed,
  });
  const items = useQuery({
    queryKey: inventoryKeys.items(orgId),
    queryFn: ({ signal }) =>
      api<{ items: StockItem[] }>(`/orgs/${orgId}/inventory/items${query({ status: 'active' })}`, { signal }).then((r) => r.items),
    enabled: allowed,
  });
  const warehouses = useQuery({
    queryKey: inventoryKeys.warehouses(orgId),
    queryFn: ({ signal }) => api<{ warehouses: Warehouse[] }>(`/orgs/${orgId}/inventory/warehouses`, { signal }).then((r) => r.warehouses),
    enabled: allowed,
  });
  const procedures =
    ((encounter.specialty?.data ?? {}) as { procedures?: { id: string; tooth: string | null; description: string }[] }).procedures ?? [];
  const usable = (warehouses.data ?? []).filter((w) => w.branchId === encounter.branchId && w.status === 'active');
  const [target, setTarget] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('1');
  const [confirm, setConfirm] = useState(false);
  const [key, setKey] = useState(newRequestKey);
  const refresh = () => queryClient.invalidateQueries({ queryKey: inventoryKeys.all(orgId) });
  const record = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/inventory/consumptions`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: {
          encounterId: encounter.id,
          recordItemId: target || null,
          warehouseId: warehouseId || usable[0]?.id,
          lines: [{ itemId, qty: Number(qty) }],
          confirm: true,
        },
      }),
    onSuccess: () => {
      showToast(t('inventory.materials.recorded'));
      setKey(newRequestKey());
      setConfirm(false);
      return refresh();
    },
  });
  const [returnKey] = useState(newRequestKey);
  const giveBack = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${orgId}/inventory/consumptions/${id}/return`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `${returnKey}-${id}`.slice(0, 100) },
        body: { reason: t('inventory.materials.returnReason') },
      }),
    onSuccess: () => (showToast(t('inventory.materials.returned')), refresh()),
    onError: (err) => showToast(errorMessage(t, err)),
  });
  if (!allowed) return null;
  const itemName = new Map((items.data ?? []).map((i) => [i.id, `${i.name} (${i.baseUnit})`]));
  const targetLabel = (recordItemId: string | null) => {
    if (!recordItemId) return t('inventory.materials.wholeVisit');
    const p = procedures.find((x) => x.id === recordItemId);
    return p ? `${p.tooth ? `${p.tooth} · ` : ''}${p.description}` : recordItemId;
  };
  const qtyValid = /^\d{1,6}$/.test(qty) && Number(qty) > 0;
  return (
    <section className="card" aria-labelledby="materials-title" data-testid="materials-used">
      <h2 id="materials-title">{t('inventory.materials.title')}</h2>
      <p className="muted small">{t('inventory.materials.hint')}</p>
      {(consumptions.data ?? []).length > 0 && (
        <ul className="data-list">
          {(consumptions.data ?? []).map((d) => (
            <li key={d.id} className="data-row">
              <div className="data-main">
                <h3>
                  <bdi dir="ltr">{d.number}</bdi> · <bdi dir="auto">{targetLabel(d.source.recordItemId)}</bdi>
                </h3>
                <p className="muted">{d.moves.map((m) => `${itemName.get(m.itemId) ?? ''} × ${-m.qty}${m.lot ? ` (${m.lot})` : ''}`).join('، ')}</p>
              </div>
              {d.reversedBy ? (
                <span className="badge">{t('inventory.materials.returnedBadge')}</span>
              ) : (
                <div className="row-actions">
                  <button type="button" className="button button--ghost" disabled={giveBack.isPending} onClick={() => giveBack.mutate(d.id)}>
                    {t('inventory.materials.return')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {usable.length === 0 ? (
        <p className="muted">{t('inventory.materials.noWarehouse')}</p>
      ) : (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            if (itemId && qtyValid && confirm) record.mutate();
          }}
        >
          <Field id="materials-target" label={t('inventory.materials.for')}>
            <select id="materials-target" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{t('inventory.materials.wholeVisit')}</option>
              {procedures.map((p) => (
                <option key={p.id} value={p.id}>
                  {targetLabel(p.id)}
                </option>
              ))}
            </select>
          </Field>
          {usable.length > 1 && (
            <Field id="materials-warehouse" label={t('inventory.warehouse')}>
              <select id="materials-warehouse" value={warehouseId || usable[0]!.id} onChange={(e) => setWarehouseId(e.target.value)}>
                {usable.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field id="materials-item" label={t('inventory.item')}>
            <select id="materials-item" required value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">{t('common.choose')}</option>
              {(items.data ?? []).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.baseUnit})
                </option>
              ))}
            </select>
          </Field>
          <Field id="materials-qty" label={t('inventory.quantity')} error={qty && !qtyValid ? t('inventory.invalidQty') : undefined}>
            <input id="materials-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <label className="choice">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
            <span>{t('inventory.materials.confirm')}</span>
          </label>
          {record.isError && <Notice kind="error">{errorMessage(t, record.error)}</Notice>}
          <div className="form-actions">
            <button type="submit" className="button button--secondary" disabled={!itemId || !qtyValid || !confirm || record.isPending}>
              {t('inventory.materials.record')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
