import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, query } from '../lib/api';
import { newRequestKey, type Encounter } from '../lib/clinical';
import { errorMessage } from '../lib/errors';
import { formatMoney, type FinanceService } from '../lib/finance';
import { orgKeys, useOrg } from '../org/context';
import { Field, Notice } from './ui';

type ChargeStatus = { itemId: string; kind: string; status: string; chargeId: string; description: string };

/**
 * For the treating doctor on their own finalized dental record: turn a procedure (or plan item)
 * into a charge, one at a time, with explicit confirmation. The charge shows the catalog service
 * name; the clinical text stays in the record.
 */
export function ClinicalCharges({ encounter }: { encounter: Encounter }) {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const allowed = can('finance.charge.clinical') && encounter.status === 'finalized' && encounter.specialty?.template === 'dentistry.visit';
  const status = useQuery({
    queryKey: orgKeys.clinicalCharges(orgId, encounter.id),
    queryFn: ({ signal }) => api<{ data: ChargeStatus[] }>(`/orgs/${orgId}/finance/clinical-charges${query({ encounterId: encounter.id })}`, { signal }).then((r) => r.data),
    enabled: allowed,
  });
  if (!allowed) return null;
  const data = (encounter.specialty?.data ?? {}) as { procedures?: { id: string; tooth: string | null; description: string }[]; planItems?: { id: string; tooth: string | null; description: string }[] };
  const items = [
    ...(data.procedures ?? []).map((p) => ({ ...p, kind: 'procedure' as const })),
    ...(data.planItems ?? []).map((p) => ({ ...p, kind: 'plan_item' as const })),
  ];
  if (items.length === 0) return null;
  return (
    <section className="card" aria-labelledby="clinical-charges-title" data-testid="clinical-charges">
      <h2 id="clinical-charges-title">{t('finance.clinical.title')}</h2>
      <p className="muted small">{t('finance.clinical.hint')}</p>
      <ul className="data-list">
        {items.map((item) => (
          <ChargeItem key={`${item.kind}-${item.id}`} encounterId={encounter.id} item={item} charged={status.data?.find((s) => s.itemId === item.id)} />
        ))}
      </ul>
    </section>
  );
}

function ChargeItem({
  encounterId,
  item,
  charged,
}: {
  encounterId: string;
  item: { id: string; tooth: string | null; description: string; kind: 'procedure' | 'plan_item' };
  charged: ChargeStatus | undefined;
}) {
  const { t, i18n } = useTranslation();
  const { orgId } = useOrg();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [serviceId, setServiceId] = useState('');
  const [confirm, setConfirm] = useState(false);
  const key = useRef(newRequestKey());
  const services = useQuery({
    queryKey: orgKeys.financeServices(orgId, 'active'),
    queryFn: ({ signal }) => api<{ data: FinanceService[] }>(`/orgs/${orgId}/finance/services${query({ status: 'active' })}`, { signal }).then((r) => r.data),
    enabled: open,
  });
  const charge = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/finance/charges/clinical`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key.current },
        body: { encounterId, itemId: item.id, kind: item.kind, serviceId, confirm: true },
      }),
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: orgKeys.clinicalCharges(orgId, encounterId) });
    },
  });
  const label = `${item.tooth ? `${t('specialty.dental.tooth', { n: item.tooth })} — ` : ''}${item.description}`;
  return (
    <li className="data-row" data-testid="charge-item">
      <div className="data-main">
        <span className="record-text">{label}</span>
        <span className="muted small">{t(`finance.clinical.kind.${item.kind}`)}</span>
      </div>
      <div className="data-meta">
        {charged ? (
          <span className="badge badge--active">{t('finance.clinical.charged', { service: charged.description })}</span>
        ) : (
          !open && (
            <button type="button" className="button button--secondary" onClick={() => setOpen(true)} aria-label={t('finance.clinical.chargeLabel', { item: label })}>
              {t('finance.clinical.charge')}
            </button>
          )
        )}
      </div>
      {open && !charged && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (confirm) charge.mutate();
          }}
        >
          {charge.isError && <Notice kind="error">{errorMessage(t, charge.error)}</Notice>}
          <Field id={`svc-${item.id}`} label={t('finance.service')}>
            <select
              id={`svc-${item.id}`}
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value);
                key.current = newRequestKey();
              }}
            >
              <option value="">{t('common.choose')}</option>
              {services.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {formatMoney(s.price, s.currency, i18n.language)}
                </option>
              ))}
            </select>
          </Field>
          <label className="choice">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
            {t('finance.clinical.confirm')}
          </label>
          <button type="submit" className="button button--primary" disabled={!serviceId || !confirm || charge.isPending}>
            {t('finance.clinical.create')}
          </button>
          <button type="button" className="button button--secondary" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </button>
        </form>
      )}
    </li>
  );
}
