import { useTranslation } from 'react-i18next';
import { type IconName } from '../components/Icon';
import { ReportLink } from '../components/layout';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/ui';
import type { Permission } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useOrg } from '../org/context';

// Reports hub (ERP milestone G): every report the person may open, grouped by area. Each report is
// computed by the API from posted or authorized data only, within the caller's scope; tables with a
// "Download CSV" button export exactly what is on screen.

type Report = { key: string; to: string; icon: IconName; permission: Permission; orgWide?: boolean };
const GROUPS: { key: string; reports: Report[] }[] = [
  {
    key: 'financial',
    reports: [
      { key: 'statements', to: 'accounting/reports', icon: 'book', permission: 'accounting.read', orgWide: true },
      { key: 'reconciliation', to: 'accounting', icon: 'check', permission: 'accounting.read', orgWide: true },
      { key: 'periods', to: 'accounting/periods', icon: 'calendar', permission: 'accounting.read' },
      { key: 'budgetVsActual', to: 'accounting/budgets', icon: 'chart', permission: 'accounting.read', orgWide: true },
      { key: 'cashFlow', to: 'accounting/cash-flow', icon: 'cash', permission: 'accounting.read', orgWide: true },
      { key: 'commitments', to: 'accounting/commitments', icon: 'calendar', permission: 'accounting.read', orgWide: true },
      { key: 'staffFunds', to: 'accounting/staff-funds', icon: 'wallet', permission: 'accounting.read', orgWide: true },
      { key: 'financeSummary', to: 'finance', icon: 'wallet', permission: 'finance.report.read' },
    ],
  },
  {
    key: 'cash',
    reports: [
      { key: 'cashSessions', to: 'cash', icon: 'cash', permission: 'cash.session.review' },
      { key: 'installments', to: 'finance/installments', icon: 'calendar', permission: 'finance.account.read' },
      { key: 'payables', to: 'purchasing/bills', icon: 'cart', permission: 'purchase.bill.manage', orgWide: true },
      { key: 'settlements', to: 'compensation', icon: 'users', permission: 'compensation.read', orgWide: true },
    ],
  },
  {
    key: 'operations',
    reports: [
      { key: 'stock', to: 'inventory', icon: 'box', permission: 'inventory.read' },
      { key: 'stockLedger', to: 'inventory/moves', icon: 'layers', permission: 'inventory.read' },
      { key: 'procurement', to: 'purchasing/orders', icon: 'cart', permission: 'purchase.read' },
      { key: 'equipment', to: 'assets', icon: 'tool', permission: 'asset.read' },
      { key: 'appointments', to: 'appointments', icon: 'calendar', permission: 'appointment.read' },
    ],
  },
];

export function ReportsHubPage() {
  const { t } = useTranslation();
  const { orgId, can, detail } = useOrg();
  useDocumentTitle(t('reportsHub.title'));
  const orgWide = detail.membership.branchScope.type === 'all';
  const groups = GROUPS.map((g) => ({ ...g, reports: g.reports.filter((r) => can(r.permission) && (!r.orgWide || orgWide)) })).filter(
    (g) => g.reports.length,
  );
  return (
    <>
      <PageHeader title={t('reportsHub.title')} subtitle={t('reportsHub.subtitle')} />
      {groups.length === 0 && <EmptyState icon="chart">{t('reportsHub.none')}</EmptyState>}
      <div className="card-grid card-grid--wide">
        {groups.map((g) => (
          <section key={g.key} className="card" aria-labelledby={`reports-${g.key}`}>
            <h2 id={`reports-${g.key}`}>{t(`reportsHub.groups.${g.key}`)}</h2>
            <ul className="report-links" data-testid={`reports-${g.key}`}>
              {g.reports.map((r) => (
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
        ))}
      </div>
      <p className="muted small">{t('reportsHub.note')}</p>
    </>
  );
}
