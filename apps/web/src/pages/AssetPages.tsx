import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { Badge, EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { parseMoney } from '../lib/finance';
import { useFormatters } from '../lib/format';
import { showToast } from '../lib/toast';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useOrg } from '../org/context';
import { DateText } from '../components/data';
import { ActionBar } from '../components/layout';
import { useOrgMoney } from '../lib/money';

// Equipment register and maintenance (docs/architecture/ASSETS.md). Costs come from the supplier
// bill or cash voucher they were paid with; this page never records a cost twice.

type Asset = {
  id: string;
  code: string;
  name: string;
  category: string;
  serialNumber: string;
  branchId: string;
  location: string;
  purchase: { date: string | null; cost: number };
  capitalized: boolean;
  maintenanceIntervalDays: number | null;
  nextMaintenanceDue: string | null;
  maintenanceDue: boolean;
  status: 'active' | 'out_of_service' | 'retired' | 'disposed';
  disposal: { date: string; reason: string } | null;
  depreciation: Depreciation | null;
  version: number;
};
type Depreciation = {
  usefulLifeMonths: number;
  residualValue: number;
  startMonth: string;
  monthly: number;
  accumulated: number;
  bookValue: number;
  lastMonth: string | null;
  monthsPosted: number;
  fullyDepreciated: boolean;
};
type MaintenanceRecord = {
  id: string;
  date: string;
  kind: 'preventive' | 'corrective' | 'inspection';
  description: string;
  performedBy: string;
  cost: number;
  outOfService: boolean;
};
const keys = { all: (orgId: string) => ['org', orgId, 'assets'] as const, one: (orgId: string, id: string) => ['org', orgId, 'assets', id] as const };
const badge = (s: Asset['status']) => (s === 'active' ? 'badge badge--active' : s === 'out_of_service' ? 'badge badge--suspended' : 'badge');

function AddAssetForm() {
  const { t } = useTranslation();
  const { orgId, branches } = useOrg();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [serial, setSerial] = useState('');
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState('');
  const [cost, setCost] = useState('');
  const [intervalDays, setIntervalDays] = useState('');
  const add = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/assets`, {
        method: 'POST',
        body: {
          code,
          name,
          category,
          serialNumber: serial,
          branchId,
          location,
          purchase: { date: date || null, cost: cost ? (parseMoney(cost) ?? 0) : 0 },
          maintenanceIntervalDays: intervalDays ? Number(intervalDays) : null,
        },
      }),
    onSuccess: () => {
      showToast(t('assets.added'));
      setCode('');
      setName('');
      return queryClient.invalidateQueries({ queryKey: keys.all(orgId) });
    },
  });
  return (
    <form
      className="card"
      aria-labelledby="add-asset-title"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <h2 id="add-asset-title">{t('assets.add')}</h2>
      <p className="muted small">{t('assets.addHint')}</p>
      <div className="form-grid">
        <Field id="asset-code" label={t('assets.code')}>
          <input id="asset-code" required maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field id="asset-name" label={t('assets.name')}>
          <input id="asset-name" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="asset-category" label={t('assets.category')}>
          <input id="asset-category" maxLength={60} value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        <Field id="asset-serial" label={t('assets.serial')}>
          <input id="asset-serial" dir="ltr" maxLength={60} value={serial} onChange={(e) => setSerial(e.target.value)} />
        </Field>
        <Field id="asset-branch" label={t('assets.branch')}>
          <select id="asset-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="asset-location" label={t('assets.location')}>
          <input id="asset-location" maxLength={80} value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <Field id="asset-date" label={t('assets.purchaseDate')}>
          <input id="asset-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="asset-cost" label={t('assets.cost')} hint={t('assets.costHint')}>
          <input id="asset-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
        <Field id="asset-interval" label={t('assets.interval')}>
          <input id="asset-interval" inputMode="numeric" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} />
        </Field>
      </div>
      {add.isError && <Notice kind="error">{errorMessage(t, add.error)}</Notice>}
      <ActionBar>
        <button type="submit" className="button button--primary" disabled={add.isPending}>
          {t('assets.add')}
        </button>
      </ActionBar>
    </form>
  );
}

/** Posts every ended month not yet posted for each depreciated asset (accountants). */
function DepreciationRun() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const { money } = useOrgMoney();
  const queryClient = useQueryClient();
  const schedule = useQuery({
    queryKey: [...keys.all(orgId), 'depreciation'],
    queryFn: ({ signal }) =>
      api<{ through: string; assets: { id: string; code: string; name: string; due: { month: string; amount: number }[] }[] }>(
        `/orgs/${orgId}/assets/depreciation/schedule`,
        { signal },
      ),
  });
  const [month, setMonth] = useState('');
  const through = month || schedule.data?.through || '';
  const due = (schedule.data?.assets ?? []).flatMap((a) => a.due.filter((d) => d.month <= through).map((d) => ({ ...d, code: a.code })));
  const run = useMutation({
    mutationFn: () => api<{ total: number }>(`/orgs/${orgId}/assets/depreciation/run`, { method: 'POST', body: { month: through } }),
    onSuccess: (r) => (
      showToast(t('assets.depreciation.ran', { amount: money(r.total) })),
      queryClient.invalidateQueries({ queryKey: ['org', orgId] })
    ),
  });
  if (!schedule.data || schedule.data.assets.length === 0) return null;
  return (
    <section className="card" aria-labelledby="dep-run-title" data-testid="depreciation-run">
      <h2 id="dep-run-title">{t('assets.depreciation.runTitle')}</h2>
      <p className="muted small">{t('assets.depreciation.runHint')}</p>
      <div className="inline-form">
        <Field id="dep-month" label={t('assets.depreciation.through')}>
          <input id="dep-month" type="month" value={through} max={schedule.data.through} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <button type="button" className="button button--primary" disabled={run.isPending || due.length === 0} onClick={() => run.mutate()}>
          {t('assets.depreciation.run')}
        </button>
      </div>
      <p>
        {due.length
          ? t('assets.depreciation.due', { count: due.length, amount: money(due.reduce((s, d) => s + d.amount, 0)) })
          : t('assets.depreciation.nothingDue')}
      </p>
      {run.isError && <Notice kind="error">{errorMessage(t, run.error)}</Notice>}
    </section>
  );
}

function DepreciationCard({ asset }: { asset: Asset }) {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const { money } = useOrgMoney();
  const queryClient = useQueryClient();
  const [life, setLife] = useState('');
  const [residual, setResidual] = useState('');
  const [start, setStart] = useState(asset.purchase.date?.slice(0, 7) ?? '');
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/assets/${asset.id}/depreciation`, {
        method: 'PUT',
        body: {
          usefulLifeMonths: Number(life),
          residualValue: residual ? (parseMoney(residual) ?? 0) : 0,
          startMonth: start,
          version: asset.version,
        },
      }),
    onSuccess: () => (showToast(t('assets.depreciation.saved')), queryClient.invalidateQueries({ queryKey: keys.all(orgId) })),
  });
  const d = asset.depreciation;
  if (!asset.capitalized) return null;
  const editable = can('accounting.manage') && (!d || !d.lastMonth) && (asset.status === 'active' || asset.status === 'out_of_service');
  return (
    <section className="card" aria-labelledby="dep-title" data-testid="depreciation">
      <h2 id="dep-title">{t('assets.depreciation.title')}</h2>
      {d ? (
        <dl className="details">
          <dt>{t('assets.depreciation.method')}</dt>
          <dd>{t('assets.depreciation.straightLine', { months: d.usefulLifeMonths })}</dd>
          <dt>{t('assets.depreciation.monthly')}</dt>
          <dd>{money(d.monthly)}</dd>
          <dt>{t('assets.depreciation.accumulated')}</dt>
          <dd>
            {money(d.accumulated)} · {t('assets.depreciation.posted', { done: d.monthsPosted, total: d.usefulLifeMonths })}
          </dd>
          <dt>{t('assets.depreciation.bookValue')}</dt>
          <dd>{money(d.bookValue)}</dd>
        </dl>
      ) : (
        <p className="muted">{t('assets.depreciation.none')}</p>
      )}
      {editable && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <p className="muted small">{t('assets.depreciation.setupHint')}</p>
          <div className="form-grid">
            <Field id="dep-life" label={t('assets.depreciation.life')}>
              <input id="dep-life" required inputMode="numeric" value={life} onChange={(e) => setLife(e.target.value)} />
            </Field>
            <Field id="dep-residual" label={t('assets.depreciation.residual')}>
              <input id="dep-residual" inputMode="decimal" value={residual} onChange={(e) => setResidual(e.target.value)} />
            </Field>
            <Field id="dep-start" label={t('assets.depreciation.start')}>
              <input id="dep-start" type="month" required value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
          </div>
          {save.isError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
          <ActionBar>
            <button type="submit" className="button button--primary" disabled={save.isPending}>
              {t('assets.depreciation.save')}
            </button>
          </ActionBar>
        </form>
      )}
    </section>
  );
}

export function AssetsPage() {
  const { t } = useTranslation();
  const { orgId, can, branches, detail } = useOrg();
  const orgWide = detail.membership.branchScope.type === 'all';
  useDocumentTitle(t('assets.title'));
  const list = useQuery({
    queryKey: keys.all(orgId),
    queryFn: ({ signal }) => api<{ today: string; assets: Asset[] }>(`/orgs/${orgId}/assets`, { signal }),
  });
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const due = (list.data?.assets ?? []).filter((a) => a.maintenanceDue);
  return (
    <>
      <PageHeader title={t('assets.title')} subtitle={t('assets.subtitle')} help={t('assets.depreciationNotice')} />
      {due.length > 0 && <Notice kind="warning">{t('assets.dueNotice', { count: due.length })}</Notice>}
      <section className="card" aria-labelledby="assets-title">
        <h2 id="assets-title">{t('assets.register')}</h2>
        {list.isPending && <Loading />}
        {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => list.refetch()} />}
        {list.isSuccess && list.data.assets.length === 0 && <EmptyState icon="settings">{t('assets.none')}</EmptyState>}
        {list.isSuccess && list.data.assets.length > 0 && (
          <ul className="data-list" data-testid="assets">
            {list.data.assets.map((a) => (
              <li key={a.id} className="data-row">
                <div className="data-main">
                  <h3>
                    <Link to={`/app/${orgId}/assets/${a.id}`}>{a.name}</Link> <bdi dir="ltr">{a.code}</bdi>
                  </h3>
                  <p className="muted">
                    {branchName.get(a.branchId)}
                    {a.location && ` · ${a.location}`}
                    {a.nextMaintenanceDue && ` · ${t('assets.nextDue', { date: a.nextMaintenanceDue })}`}
                  </p>
                </div>
                {a.maintenanceDue && <Badge tone="warning">{t('assets.maintenanceDue')}</Badge>}
                <span className={badge(a.status)}>{t(`assets.status.${a.status}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {can('accounting.manage') && orgWide && <DepreciationRun />}
      {can('asset.manage') && <AddAssetForm />}
    </>
  );
}

export function AssetPage() {
  const { t } = useTranslation();
  const { orgId, can, branches } = useOrg();
  const { assetId = '' } = useParams();
  const { money } = useOrgMoney();
  const fmt = useFormatters();
  const queryClient = useQueryClient();
  const view = useQuery({
    queryKey: keys.one(orgId, assetId),
    queryFn: ({ signal }) => api<{ asset: Asset; maintenance: MaintenanceRecord[] }>(`/orgs/${orgId}/assets/${assetId}`, { signal }),
  });
  useDocumentTitle(view.data ? view.data.asset.name : t('assets.title'));
  const [date, setDate] = useState('');
  const [kind, setKind] = useState<MaintenanceRecord['kind']>('preventive');
  const [description, setDescription] = useState('');
  const [performedBy, setPerformedBy] = useState('');
  const [outOfService, setOutOfService] = useState(false);
  const [reason, setReason] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.all(orgId) });
  const log = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/assets/${assetId}/maintenance`, { method: 'POST', body: { date, kind, description, performedBy, outOfService } }),
    onSuccess: () => (showToast(t('assets.logged')), setDescription(''), refresh()),
  });
  const retire = useMutation({
    mutationFn: (disposal: boolean) =>
      api(`/orgs/${orgId}/assets/${assetId}/retire`, { method: 'POST', body: { disposal, reason, version: view.data!.asset.version } }),
    onSuccess: refresh,
  });
  if (view.isPending) return <Loading />;
  if (view.isError) return <ErrorState message={errorMessage(t, view.error)} onRetry={() => view.refetch()} />;
  const { asset: a, maintenance } = view.data;
  const live = a.status === 'active' || a.status === 'out_of_service';
  return (
    <>
      <PageHeader back={{ to: `/app/${orgId}/assets`, label: t('assets.back') }} title={a.name} subtitle={a.code} />
      <section className="card" aria-labelledby="asset-detail-title">
        <div className="section-header">
          <h2 id="asset-detail-title">{t('assets.details')}</h2>
          <span className={badge(a.status)}>{t(`assets.status.${a.status}`)}</span>
        </div>
        <dl className="details">
          <dt>{t('assets.branch')}</dt>
          <dd>{branches.find((b) => b.id === a.branchId)?.name}</dd>
          <dt>{t('assets.location')}</dt>
          <dd>{a.location || '—'}</dd>
          <dt>{t('assets.serial')}</dt>
          <dd>
            <bdi dir="ltr">{a.serialNumber || '—'}</bdi>
          </dd>
          <dt>{t('assets.purchaseDate')}</dt>
          <dd>
            <bdi dir="ltr">{a.purchase.date ?? '—'}</bdi>
          </dd>
          <dt>{t('assets.cost')}</dt>
          <dd>
            {money(a.purchase.cost)} {a.capitalized && <span className="badge">{t('assets.capitalized')}</span>}
          </dd>
          <dt>{t('assets.nextDueLabel')}</dt>
          <dd>
            <bdi dir="ltr">{a.nextMaintenanceDue ?? '—'}</bdi>
          </dd>
          {a.disposal && (
            <>
              <dt>{t('assets.retiredOn')}</dt>
              <dd>
                <DateText value={a.disposal.date} /> · <bdi dir="auto">{a.disposal.reason}</bdi>
              </dd>
            </>
          )}
        </dl>
      </section>
      <DepreciationCard asset={a} />
      {live && can('asset.maintain') && (
        <form
          className="card"
          aria-labelledby="log-title"
          onSubmit={(e) => {
            e.preventDefault();
            log.mutate();
          }}
        >
          <h2 id="log-title">{t('assets.logMaintenance')}</h2>
          <p className="muted small">{t('assets.logHint')}</p>
          <div className="form-grid">
            <Field id="m-date" label={t('assets.date')}>
              <input id="m-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field id="m-kind" label={t('assets.kind')}>
              <select id="m-kind" value={kind} onChange={(e) => setKind(e.target.value as MaintenanceRecord['kind'])}>
                {(['preventive', 'corrective', 'inspection'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`assets.kinds.${k}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="m-desc" label={t('assets.workDone')}>
              <input id="m-desc" required minLength={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field id="m-by" label={t('assets.performedBy')}>
              <input id="m-by" maxLength={120} value={performedBy} onChange={(e) => setPerformedBy(e.target.value)} />
            </Field>
          </div>
          <label className="choice">
            <input type="checkbox" checked={outOfService} onChange={(e) => setOutOfService(e.target.checked)} />
            <span>{t('assets.markOutOfService')}</span>
          </label>
          {log.isError && <Notice kind="error">{errorMessage(t, log.error)}</Notice>}
          <ActionBar>
            <button type="submit" className="button button--primary" disabled={log.isPending}>
              {t('assets.save')}
            </button>
          </ActionBar>
        </form>
      )}
      <section className="card" aria-labelledby="history-title">
        <h2 id="history-title">{t('assets.history')}</h2>
        {maintenance.length === 0 ? (
          <EmptyState icon="settings">{t('assets.noHistory')}</EmptyState>
        ) : (
          <ul className="data-list" data-testid="maintenance-log">
            {maintenance.map((m) => (
              <li key={m.id} className="data-row">
                <div className="data-main">
                  <h3>
                    {t(`assets.kinds.${m.kind}`)} · <DateText value={m.date} />
                  </h3>
                  <p className="muted">
                    <bdi dir="auto">{m.description}</bdi>
                    {m.performedBy && ` · ${m.performedBy}`} · {fmt.date(m.date)}
                  </p>
                </div>
                {m.outOfService && <span className="badge badge--suspended">{t('assets.status.out_of_service')}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {live && can('asset.manage') && (
        <section className="card" aria-labelledby="retire-title">
          <h2 id="retire-title">{t('assets.retireTitle')}</h2>
          <p className="muted small">{a.capitalized ? t('assets.disposeHintCapitalized') : t('assets.disposeHint')}</p>
          <Field id="retire-reason" label={t('assets.reason')}>
            <input id="retire-reason" required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {retire.isError && <Notice kind="error">{errorMessage(t, retire.error)}</Notice>}
          <div className="inline-form">
            <button
              type="button"
              className="button button--secondary"
              disabled={retire.isPending || reason.trim().length < 3}
              onClick={() => retire.mutate(false)}
            >
              {t('assets.retire')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={retire.isPending || reason.trim().length < 3}
              onClick={() => retire.mutate(true)}
            >
              {t('assets.dispose')}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
