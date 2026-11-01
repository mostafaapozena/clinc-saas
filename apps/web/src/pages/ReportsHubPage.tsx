import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { ChartCard } from '../components/ChartCard';
import { Icon, type IconName } from '../components/Icon';
import { MetricGrid, ReportLink } from '../components/layout';
import { Metric } from '../components/Metric';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState } from '../components/ui';
import { api, query } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatMoney } from '../lib/finance';
import type { Permission } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { moduleOfPath } from '../lib/modules';
import { orgKeys, useBranchFilter, useOrg } from '../org/context';

// Reports center (docs/REPORTS_CENTER.md). Category tabs, the category's key figures and charts
// for the chosen period and branch, then the detailed reports that open directly. Every number
// comes from an existing, permission-checked endpoint; nothing is estimated or drawn for empty
// periods. Auditable statements stay tables in their own pages.

type Report = { key: string; to: string; icon: IconName; permission: Permission; orgWide?: boolean };
type CategoryKey = 'financial' | 'collections' | 'cash' | 'operations' | 'inventory' | 'resources';
type Category = { key: CategoryKey; icon: IconName; reports: Report[] };

const CATEGORIES: Category[] = [
  {
    key: 'financial',
    icon: 'chart',
    reports: [
      { key: 'trialBalance', to: 'accounting/reports?report=trialBalance', icon: 'book', permission: 'accounting.read', orgWide: true },
      { key: 'profitLoss', to: 'accounting/reports?report=profitLoss', icon: 'chart', permission: 'accounting.read', orgWide: true },
      { key: 'balanceSheet', to: 'accounting/reports?report=balanceSheet', icon: 'layers', permission: 'accounting.read', orgWide: true },
      { key: 'ledger', to: 'accounting/reports?report=ledger', icon: 'file', permission: 'accounting.read', orgWide: true },
      { key: 'budgetVsActual', to: 'accounting/budgets', icon: 'chart', permission: 'accounting.read', orgWide: true },
      { key: 'financeSummary', to: 'finance', icon: 'wallet', permission: 'finance.report.read' },
      { key: 'reconciliation', to: 'accounting', icon: 'check', permission: 'accounting.read', orgWide: true },
      { key: 'periods', to: 'accounting/periods', icon: 'calendar', permission: 'accounting.read' },
    ],
  },
  {
    key: 'collections',
    icon: 'wallet',
    reports: [
      { key: 'aging', to: 'accounting/reports?report=aging', icon: 'clock', permission: 'accounting.read' },
      { key: 'installments', to: 'finance/installments', icon: 'calendar', permission: 'finance.account.read' },
      { key: 'financeSummary', to: 'finance', icon: 'wallet', permission: 'finance.report.read' },
    ],
  },
  {
    key: 'cash',
    icon: 'cash',
    reports: [
      { key: 'cashFlow', to: 'accounting/cash-flow', icon: 'cash', permission: 'accounting.read', orgWide: true },
      { key: 'cashSessions', to: 'cash', icon: 'cash', permission: 'cash.session.review' },
      { key: 'commitments', to: 'accounting/commitments', icon: 'calendar', permission: 'accounting.read', orgWide: true },
      { key: 'staffFunds', to: 'accounting/staff-funds', icon: 'wallet', permission: 'accounting.read', orgWide: true },
    ],
  },
  { key: 'operations', icon: 'calendar', reports: [{ key: 'appointments', to: 'appointments', icon: 'calendar', permission: 'appointment.read' }] },
  {
    key: 'inventory',
    icon: 'box',
    reports: [
      { key: 'stock', to: 'inventory', icon: 'box', permission: 'inventory.read' },
      { key: 'stockLedger', to: 'inventory/moves', icon: 'layers', permission: 'inventory.read' },
      { key: 'procurement', to: 'purchasing/orders', icon: 'cart', permission: 'purchase.read' },
      { key: 'payables', to: 'purchasing/bills', icon: 'cart', permission: 'purchase.bill.manage', orgWide: true },
    ],
  },
  {
    key: 'resources',
    icon: 'tool',
    reports: [
      { key: 'equipment', to: 'assets', icon: 'tool', permission: 'asset.read' },
      { key: 'settlements', to: 'compensation', icon: 'users', permission: 'compensation.read', orgWide: true },
      { key: 'staffFunds', to: 'accounting/staff-funds', icon: 'wallet', permission: 'accounting.read', orgWide: true },
    ],
  },
];

const PERIODS = ['month', 'last30', 'last90', 'year'] as const;
type Period = (typeof PERIODS)[number];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function periodRange(period: Period, now = new Date()) {
  const to = iso(now);
  const back = (days: number) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1));
  const from = period === 'month' ? `${to.slice(0, 7)}-01` : period === 'year' ? `${to.slice(0, 4)}-01-01` : back(period === 'last30' ? 30 : 90);
  return { from, to };
}

type Summary = {
  invoiced: { currency: string; count: number; discounts: number; total: number }[];
  collected: { currency: string; method: string; amount: number }[];
  outstanding: { currency: string; amount: number }[];
  byService: { currency: string; service: string; amount: number }[];
};
type Trend = { months: string[]; series: { currency: string; invoiced: number[]; collected: number[] }[] };

function useMoney(currency: string | null | undefined) {
  const { i18n } = useTranslation();
  return (minor: number) => (currency ? formatMoney(minor, currency, i18n.language) : String(minor));
}

function useCurrency() {
  const { orgId } = useOrg();
  return (
    useQuery({
      queryKey: orgKeys.financeSettings(orgId),
      queryFn: ({ signal }) => api<{ currency: string | null }>(`/orgs/${orgId}/finance/settings`, { signal }),
    }).data?.currency ?? null
  );
}

const context = (parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(' · ');

/** Financial: invoiced and collected from the documents — never presented as revenue or profit. */
function FinancialSection({
  range,
  branchId,
  periodLabel,
  branchLabel,
}: {
  range: { from: string; to: string };
  branchId: string;
  periodLabel: string;
  branchLabel: string;
}) {
  const { t, i18n } = useTranslation();
  const { orgId, can } = useOrg();
  const currency = useCurrency();
  const money = useMoney(currency);
  const enabled = can('finance.report.read');
  const params = { ...range, branchId: branchId || undefined };
  const summary = useQuery({
    queryKey: [...orgKeys.all(orgId), 'reports', 'summary', params],
    queryFn: ({ signal }) => api<Summary>(`/orgs/${orgId}/finance/reports/summary${query(params)}`, { signal }),
    enabled,
  });
  const trendParams = { months: 6, branchId: branchId || undefined };
  const trend = useQuery({
    queryKey: [...orgKeys.all(orgId), 'reports', 'trend', trendParams],
    queryFn: ({ signal }) => api<Trend>(`/orgs/${orgId}/finance/reports/trend${query(trendParams)}`, { signal }),
    enabled,
  });
  if (!enabled) return null;
  const s = summary.data;
  const ofCurrency = <T extends { currency: string }>(rows: T[] = []) => rows.filter((r) => r.currency === currency);
  const invoiced = ofCurrency(s?.invoiced)[0];
  const collected = ofCurrency(s?.collected);
  const collectedTotal = collected.reduce((sum, r) => sum + r.amount, 0);
  const outstanding = ofCurrency(s?.outstanding)[0]?.amount ?? 0;
  const services = ofCurrency(s?.byService).slice(0, 6);
  const series = trend.data?.series.find((x) => x.currency === currency);
  const monthFmt = new Intl.DateTimeFormat(i18n.language, { month: 'short', timeZone: 'UTC' });
  const months = (trend.data?.months ?? []).map((m) => monthFmt.format(new Date(`${m}-01T00:00:00Z`)));
  const failed = summary.isError ? <ErrorState message={errorMessage(t, summary.error)} onRetry={() => summary.refetch()} /> : undefined;
  return (
    <>
      <MetricGrid testId="report-kpis" label={t('reportsHub.kpis')}>
        <Metric
          icon="file"
          label={t('reportsHub.kpi.invoiced')}
          value={invoiced?.total ?? 0}
          format={money}
          hint={t('reportsHub.source.invoices', { count: invoiced?.count ?? 0 })}
        />
        <Metric icon="wallet" label={t('reportsHub.kpi.collected')} value={collectedTotal} format={money} hint={t('reportsHub.source.receipts')} />
        <Metric icon="clock" label={t('reportsHub.kpi.outstanding')} value={outstanding} format={money} hint={t('reportsHub.source.openInvoices')} />
        <Metric
          icon="minus"
          label={t('reportsHub.kpi.discounts')}
          value={invoiced?.discounts ?? 0}
          format={money}
          hint={t('reportsHub.source.invoiceDiscounts')}
        />
      </MetricGrid>
      <div className="chart-grid chart-grid--two">
        <ChartCard
          wide
          testId="chart-trend"
          title={t('reportsHub.charts.trend')}
          icon="activity"
          kind="line"
          labels={months}
          series={[
            { key: 'invoiced', label: t('reportsHub.kpi.invoiced'), values: series?.invoiced ?? [] },
            { key: 'collected', label: t('reportsHub.kpi.collected'), values: series?.collected ?? [] },
          ]}
          format={money}
          loading={trend.isPending}
          context={context([t('reportsHub.lastMonths', { count: 6 }), currency, branchLabel])}
          empty={t('reportsHub.noData')}
        />
        <ChartCard
          testId="chart-methods"
          title={t('reportsHub.charts.methods')}
          icon="card"
          kind="donut"
          labels={collected.map((r) => t(`finance.methods.${r.method}`, { defaultValue: r.method }))}
          series={[{ key: 'amount', label: t('reportsHub.kpi.collected'), values: collected.map((r) => r.amount) }]}
          format={money}
          loading={summary.isPending}
          error={failed}
          context={context([periodLabel, currency, branchLabel])}
          empty={t('reportsHub.noReceipts')}
        />
        <ChartCard
          testId="chart-services"
          title={t('reportsHub.charts.services')}
          icon="stethoscope"
          kind="hbar"
          labels={services.map((r) => r.service)}
          series={[{ key: 'amount', label: t('reportsHub.kpi.invoiced'), values: services.map((r) => r.amount) }]}
          format={money}
          loading={summary.isPending}
          error={failed}
          context={context([periodLabel, currency, t('reportsHub.source.issuedInvoices')])}
          empty={t('reportsHub.noInvoices')}
        />
      </div>
    </>
  );
}

type Aging = { currency: string; rows: unknown[]; totals: Record<'d0_30' | 'd31_60' | 'd61_90' | 'd90plus' | 'total', number> };
function CollectionsSection() {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const aging = useQuery({
    queryKey: [...orgKeys.all(orgId), 'reports', 'aging'],
    queryFn: ({ signal }) => api<Aging>(`/orgs/${orgId}/accounting/reports/receivables-aging`, { signal }),
    enabled: can('accounting.read'),
  });
  const money = useMoney(aging.data?.currency);
  if (!can('accounting.read')) return null;
  const buckets = ['d0_30', 'd31_60', 'd61_90', 'd90plus'] as const;
  const totals = aging.data?.totals;
  return (
    <>
      <MetricGrid testId="report-kpis" label={t('reportsHub.kpis')}>
        <Metric
          icon="clock"
          label={t('reportsHub.kpi.openReceivables')}
          value={totals?.total ?? 0}
          format={money}
          hint={t('reportsHub.source.openInvoicesNow')}
        />
        <Metric icon="patients" label={t('reportsHub.kpi.patientsOwing')} value={aging.data?.rows.length ?? 0} />
        <Metric
          icon="alert"
          tone={totals?.d90plus ? 'warn' : 'neutral'}
          label={t('accounting.buckets.d90plus')}
          value={totals?.d90plus ?? 0}
          format={money}
        />
      </MetricGrid>
      <div className="chart-grid chart-grid--two">
        <ChartCard
          testId="chart-aging"
          title={t('reportsHub.charts.aging')}
          icon="clock"
          kind="hbar"
          labels={buckets.map((b) => t(`accounting.buckets.${b}`))}
          series={[{ key: 'amount', label: t('reportsHub.kpi.openReceivables'), values: buckets.map((b) => totals?.[b] ?? 0) }]}
          format={money}
          loading={aging.isPending}
          context={context([t('reportsHub.asOfToday'), aging.data?.currency, t('reportsHub.source.issuedInvoices')])}
          empty={t('accounting.noOpenInvoices')}
        />
      </div>
    </>
  );
}

type CashFlow = {
  currency: string;
  opening: number;
  net: number;
  closing: number;
  sections: { activity: string; rows: { inflow: number; outflow: number }[] }[];
};
function CashSection({ range, periodLabel }: { range: { from: string; to: string }; periodLabel: string }) {
  const { t } = useTranslation();
  const { orgId, can, detail } = useOrg();
  const enabled = can('accounting.read') && detail.membership.branchScope.type === 'all';
  const flow = useQuery({
    queryKey: [...orgKeys.all(orgId), 'reports', 'cashflow', range],
    queryFn: ({ signal }) => api<CashFlow>(`/orgs/${orgId}/accounting/reports/cash-flow${query(range)}`, { signal }),
    enabled,
  });
  const money = useMoney(flow.data?.currency);
  if (!enabled) return null;
  const d = flow.data;
  const sections = d?.sections ?? [];
  return (
    <>
      <MetricGrid testId="report-kpis" label={t('reportsHub.kpis')}>
        <Metric icon="cash" label={t('planning.cashFlow.opening')} value={d?.opening ?? 0} format={money} hint={t('reportsHub.source.ledgerCash')} />
        <Metric icon="activity" label={t('planning.cashFlow.net')} value={d?.net ?? 0} format={money} hint={periodLabel} />
        <Metric icon="cash" label={t('planning.cashFlow.closing')} value={d?.closing ?? 0} format={money} hint={t('reportsHub.source.ledgerCash')} />
      </MetricGrid>
      <div className="chart-grid chart-grid--two">
        <ChartCard
          testId="chart-cashflow"
          title={t('reportsHub.charts.cashflow')}
          icon="cash"
          kind="bar"
          labels={sections.map((s) => t(`planning.cashFlow.${s.activity}`))}
          series={[
            { key: 'in', label: t('planning.cashFlow.inflow'), values: sections.map((s) => s.rows.reduce((a, r) => a + r.inflow, 0)) },
            { key: 'out', label: t('planning.cashFlow.outflow'), values: sections.map((s) => s.rows.reduce((a, r) => a + r.outflow, 0)) },
          ]}
          format={money}
          loading={flow.isPending}
          context={context([periodLabel, d?.currency, t('reportsHub.source.ledgerCash')])}
          empty={t('planning.cashFlow.none')}
        />
      </div>
    </>
  );
}

function OperationsSection({ branchId, branchLabel }: { branchId: string; branchLabel: string }) {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const params = { branchId: branchId || undefined };
  const today = useQuery({
    queryKey: [...orgKeys.all(orgId), 'reports', 'dashboard', params],
    queryFn: ({ signal }) => api<{ date: string; counts: Record<string, number> }>(`/orgs/${orgId}/dashboard${query(params)}`, { signal }),
    enabled: can('dashboard.read'),
  });
  if (!can('dashboard.read')) return null;
  const counts = today.data?.counts ?? {};
  const keys = ['scheduled', 'waiting', 'inProgress', 'completed', 'noShow', 'cancelled'];
  return (
    <>
      <MetricGrid testId="report-kpis" label={t('reportsHub.kpis')}>
        <Metric icon="calendar" label={t('reportsHub.kpi.appointmentsToday')} value={keys.reduce((s, k) => s + (counts[k] ?? 0), 0)} />
        <Metric icon="checkCircle" tone="ok" label={t('reportsHub.status.completed')} value={counts.completed ?? 0} />
        <Metric icon="userX" label={t('reportsHub.status.noShow')} value={counts.noShow ?? 0} />
      </MetricGrid>
      <div className="chart-grid chart-grid--two">
        <ChartCard
          testId="chart-appointments"
          title={t('reportsHub.charts.appointments')}
          icon="calendar"
          kind="bar"
          labels={keys.map((k) => t(`reportsHub.status.${k}`))}
          series={[{ key: 'count', label: t('reportsHub.kpi.appointmentsToday'), values: keys.map((k) => counts[k] ?? 0) }]}
          format={(v) => String(v)}
          loading={today.isPending}
          context={context([t('reportsHub.today'), branchLabel])}
          empty={t('reportsHub.noAppointments')}
        />
      </div>
    </>
  );
}

function InventorySection() {
  const { t } = useTranslation();
  const { orgId, can, detail } = useOrg();
  const alerts = useQuery({
    queryKey: [...orgKeys.all(orgId), 'reports', 'stock-alerts'],
    queryFn: ({ signal }) => api<{ expiring: unknown[]; reorder: unknown[] }>(`/orgs/${orgId}/inventory/alerts`, { signal }),
    enabled: can('inventory.read'),
  });
  const payablesOn = can('purchase.bill.manage') && detail.membership.branchScope.type === 'all';
  const payables = useQuery({
    queryKey: [...orgKeys.all(orgId), 'reports', 'payables'],
    queryFn: ({ signal }) =>
      api<{ rows: { name: string; total: number }[]; total: number }>(`/orgs/${orgId}/purchasing/reports/payables-aging`, { signal }),
    enabled: payablesOn,
  });
  const currency = useCurrency();
  const money = useMoney(currency);
  if (!can('inventory.read') && !payablesOn) return null;
  const top = (payables.data?.rows ?? []).slice(0, 6);
  return (
    <>
      <MetricGrid testId="report-kpis" label={t('reportsHub.kpis')}>
        {can('inventory.read') && (
          <Metric
            icon="box"
            tone={alerts.data?.reorder.length ? 'warn' : 'neutral'}
            label={t('reportsHub.kpi.reorder')}
            value={alerts.data?.reorder.length ?? 0}
          />
        )}
        {can('inventory.read') && (
          <Metric
            icon="clock"
            tone={alerts.data?.expiring.length ? 'warn' : 'neutral'}
            label={t('reportsHub.kpi.expiring')}
            value={alerts.data?.expiring.length ?? 0}
          />
        )}
        {payablesOn && (
          <Metric
            icon="cart"
            label={t('reportsHub.kpi.payables')}
            value={payables.data?.total ?? 0}
            format={money}
            hint={t('reportsHub.source.openBills')}
          />
        )}
      </MetricGrid>
      {payablesOn && (
        <div className="chart-grid chart-grid--two">
          <ChartCard
            testId="chart-payables"
            title={t('reportsHub.charts.payables')}
            icon="cart"
            kind="hbar"
            labels={top.map((r) => r.name)}
            series={[{ key: 'total', label: t('reportsHub.kpi.payables'), values: top.map((r) => r.total) }]}
            format={money}
            loading={payables.isPending}
            context={context([t('reportsHub.asOfToday'), currency, t('reportsHub.source.openBills')])}
            empty={t('reportsHub.noPayables')}
          />
        </div>
      )}
    </>
  );
}

export function ReportsHubPage() {
  const { t } = useTranslation();
  const { orgId, can, detail, branches, moduleOn } = useOrg();
  useDocumentTitle(t('reportsHub.title'));
  const [search, setSearch] = useSearchParams();
  const orgWide = detail.membership.branchScope.type === 'all';
  const categories = CATEGORIES.map((c) => ({
    ...c,
    reports: c.reports.filter((r) => {
      const module = moduleOfPath(r.to.split('?')[0]!);
      return can(r.permission) && (!r.orgWide || orgWide) && (!module || moduleOn(module));
    }),
  })).filter((c) => c.reports.length);
  const active = categories.find((c) => c.key === search.get('category')) ?? categories[0];
  const period: Period = (PERIODS as readonly string[]).includes(search.get('period') ?? '') ? (search.get('period') as Period) : 'month';
  // One scope model: the branch chosen at the top of the page applies here too (no second branch filter).
  const branchId = useBranchFilter() ?? '';
  const set = (key: string, value: string) =>
    setSearch(
      (cur) => {
        const next = new URLSearchParams(cur);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const range = periodRange(period);
  const periodLabel = t(`reportsHub.periods.${period}`);
  const branchLabel = branchId ? (branches.find((b) => b.id === branchId)?.name ?? '') : t('reportsHub.allBranches');
  const select = (key: CategoryKey) => set('category', key === categories[0]?.key ? '' : key);
  return (
    <>
      <PageHeader title={t('reportsHub.title')} subtitle={t('reportsHub.subtitle')}>
        <div className="report-filters" role="group" aria-label={t('reportsHub.filters')}>
          <label className="report-filter">
            <span className="visually-hidden">{t('reportsHub.period')}</span>
            <Icon name="calendar" aria-hidden="true" />
            <select value={period} onChange={(e) => set('period', e.target.value === 'month' ? '' : e.target.value)}>
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {t(`reportsHub.periods.${p}`)}
                </option>
              ))}
            </select>
          </label>
          <span className="report-scope" data-testid="report-scope">
            <Icon name="building" aria-hidden="true" />
            {t('reportsHub.scope', { branch: branchLabel })}
          </span>
        </div>
      </PageHeader>
      {!active ? (
        <EmptyState icon="chart">{t('reportsHub.none')}</EmptyState>
      ) : (
        <>
          <div className="report-categories" role="tablist" aria-label={t('reportsHub.categories')}>
            {categories.map((c, i) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                id={`tab-${c.key}`}
                aria-controls="report-panel"
                aria-selected={c.key === active.key}
                tabIndex={c.key === active.key ? 0 : -1}
                className="report-category"
                onClick={() => select(c.key)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                  // Arrow keys follow the reading direction.
                  const forward = (e.key === 'ArrowLeft') === (document.documentElement.dir === 'rtl');
                  const next = categories[(i + (forward ? 1 : -1) + categories.length) % categories.length]!;
                  select(next.key);
                  document.getElementById(`tab-${next.key}`)?.focus();
                }}
              >
                <span className="report-category-icon" aria-hidden="true">
                  <Icon name={c.icon} />
                </span>
                <span>{t(`reportsHub.groups.${c.key}`)}</span>
              </button>
            ))}
          </div>
          <div id="report-panel" role="tabpanel" aria-labelledby={`tab-${active.key}`} className="report-panel">
            {active.key === 'financial' && <FinancialSection range={range} branchId={branchId} periodLabel={periodLabel} branchLabel={branchLabel} />}
            {active.key === 'collections' && <CollectionsSection />}
            {active.key === 'cash' && <CashSection range={range} periodLabel={periodLabel} />}
            {active.key === 'operations' && <OperationsSection branchId={branchId} branchLabel={branchLabel} />}
            {active.key === 'inventory' && <InventorySection />}
            <section aria-labelledby="available-reports" className="report-directory">
              <h2 id="available-reports">{t('reportsHub.available')}</h2>
              <p className="muted small">{t('reportsHub.availableHint')}</p>
              <ul className="report-links report-links--cards" data-testid={`reports-${active.key}`}>
                {active.reports.map((r) => (
                  <li key={r.key}>
                    <ReportLink
                      to={`/app/${orgId}/${r.to}`}
                      icon={r.icon}
                      title={t(`reportsHub.reports.${r.key}.title`)}
                      description={t(`reportsHub.reports.${r.key}.body`)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <p className="muted small">{t('reportsHub.note')}</p>
        </>
      )}
    </>
  );
}
