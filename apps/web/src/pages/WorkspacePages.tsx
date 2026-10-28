import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Metric } from '../components/Metric';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, Loading } from '../components/ui';
import { api } from '../lib/api';
import { formatMoney } from '../lib/finance';
import { useFormatters } from '../lib/format';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { orgKeys, useOrg } from '../org/context';

// Role- and specialty-aware workspace (docs/architecture/SPECIALTY_WORKSPACES.md): what this person
// should look at first today. Sections come from the API only for permissions that allow them; a
// doctor's worklist is built from their own records and follows their specialty.

type WorklistItem = {
  patientId: string;
  fullName?: string;
  patientNumber?: number;
  openPlanItems?: number;
  courseId?: string;
  plannedSessions?: number | null;
  completedSessions?: number;
  upcomingSessions?: number;
  nextVisit?: string | null;
  lastVisit?: string;
  recordId?: string;
};
export type Focus = {
  role: string;
  clinical?: {
    specialty: string;
    today: { scheduled: number; waiting: number; inProgress: number; completed: number };
    draftRecords: number;
    worklist: { kind: 'dentistry' | 'physiotherapy' | 'ent'; total: number; items: WorklistItem[] } | null;
  };
  frontDesk?: {
    expected: number;
    waiting: number;
    inProgress: number;
    pendingCharges: number | null;
    cashSession: { id: string; number: string } | null;
  };
  finance?: {
    ledger: boolean;
    openReceivables: number;
    unallocatedReceipts: number;
    payablesDueSoon: { amount: number; bills: number };
    openCashSessions: number;
    monthToClose: string | null;
  };
  approvals?: { purchaseRequests?: number; directBills?: number; settlements?: number };
  stock?: { reorder: number; expiring: number };
};

function useFocus(full = false) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: [...orgKeys.all(orgId), 'focus', full],
    queryFn: ({ signal }) => api<Focus>(`/orgs/${orgId}/workspace/focus${full ? '?full=1' : ''}`, { signal }),
  });
}

function useMoney() {
  const { i18n } = useTranslation();
  const { orgId } = useOrg();
  const settings = useQuery({
    queryKey: orgKeys.financeSettings(orgId),
    queryFn: ({ signal }) => api<{ currency: string | null }>(`/orgs/${orgId}/finance/settings`, { signal }),
  });
  return (minor: number) => (settings.data?.currency ? formatMoney(minor, settings.data.currency, i18n.language) : String(minor));
}

const WORKLIST_ICON = { dentistry: 'tooth', physiotherapy: 'activity', ent: 'ear' } as const;

function WorklistRows({ worklist, compact }: { worklist: NonNullable<NonNullable<Focus['clinical']>['worklist']>; compact: boolean }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const fmt = useFormatters();
  if (worklist.items.length === 0)
    return <EmptyState icon={WORKLIST_ICON[worklist.kind]}>{t(`workspace.worklist.empty.${worklist.kind}`)}</EmptyState>;
  return (
    <ul className="data-list" data-testid="worklist">
      {worklist.items.map((i) => (
        <li key={`${i.patientId}-${i.courseId ?? i.recordId ?? ''}`} className="data-row">
          <div className="data-main">
            <h3>
              <Link to={`/app/${orgId}/patients/${i.patientId}`}>{i.fullName}</Link> <bdi dir="ltr">#{i.patientNumber}</bdi>
            </h3>
            <p className="muted">
              {worklist.kind === 'dentistry' && t('workspace.worklist.openItems', { count: i.openPlanItems })}
              {worklist.kind === 'physiotherapy' &&
                t('workspace.worklist.sessions', { done: i.completedSessions, planned: i.plannedSessions ?? '—', upcoming: i.upcomingSessions })}
              {worklist.kind === 'ent' && t('workspace.worklist.lastVisit', { date: i.lastVisit ? fmt.date(i.lastVisit) : '' })}
              {i.nextVisit ? ` · ${t('workspace.worklist.nextVisit', { date: fmt.date(i.nextVisit) })}` : ''}
            </p>
          </div>
          {worklist.kind === 'ent' && <span className="badge badge--inactive">{t('workspace.worklist.noFollowUpBooked')}</span>}
        </li>
      ))}
      {compact && worklist.total > worklist.items.length && (
        <li className="data-row">
          <Link to={`/app/${orgId}/worklist`}>{t('workspace.worklist.seeAll', { count: worklist.total })}</Link>
        </li>
      )}
    </ul>
  );
}

/** "Today's focus" on the home page; nothing is shown that the role cannot use. */
export function FocusPanel() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const money = useMoney();
  const focus = useFocus();
  if (!focus.isSuccess) return null;
  const f = focus.data;
  const approvals = f.approvals ? (f.approvals.purchaseRequests ?? 0) + (f.approvals.directBills ?? 0) + (f.approvals.settlements ?? 0) : 0;
  if (!f.clinical && !f.frontDesk && !f.finance && !approvals && !f.stock) return null;
  return (
    <section className="card focus-panel" aria-labelledby="focus-title" data-testid="focus-panel">
      <h2 id="focus-title">{t('workspace.focusTitle')}</h2>
      {f.clinical && (
        <div className="focus-group">
          <h3>{t(`workspace.clinicalTitle.${f.clinical.worklist?.kind ?? 'general'}`)}</h3>
          <dl className="metrics metrics--compact">
            <Metric
              icon="calendar"
              label={t('workspace.myVisitsToday')}
              value={f.clinical.today.scheduled + f.clinical.today.waiting + f.clinical.today.inProgress}
              to={`/app/${orgId}/appointments`}
              linkLabel={t('nav.appointments')}
            />
            <Metric
              icon="queue"
              tone={f.clinical.today.waiting ? 'warn' : 'neutral'}
              label={t('workspace.waitingForMe')}
              value={f.clinical.today.waiting}
              to={`/app/${orgId}/queue`}
              linkLabel={t('nav.queue')}
            />
            <Metric
              icon="file"
              tone={f.clinical.draftRecords ? 'warn' : 'neutral'}
              label={t('workspace.draftRecords')}
              value={f.clinical.draftRecords}
            />
            {f.clinical.worklist && (
              <Metric
                icon={WORKLIST_ICON[f.clinical.worklist.kind]}
                tone="brand"
                label={t(`workspace.worklist.metric.${f.clinical.worklist.kind}`)}
                value={f.clinical.worklist.total}
                to={`/app/${orgId}/worklist`}
                linkLabel={t(`nav.worklist.${f.clinical.worklist.kind}`)}
              />
            )}
          </dl>
          {f.clinical.worklist && <WorklistRows worklist={f.clinical.worklist} compact />}
        </div>
      )}
      {f.frontDesk && (
        <div className="focus-group">
          <h3>{t('workspace.frontDeskTitle')}</h3>
          <dl className="metrics metrics--compact">
            <Metric
              icon="calendar"
              label={t('workspace.expectedArrivals')}
              value={f.frontDesk.expected}
              to={`/app/${orgId}/appointments`}
              linkLabel={t('nav.appointments')}
            />
            <Metric
              icon="queue"
              tone={f.frontDesk.waiting ? 'warn' : 'neutral'}
              label={t('workspace.inQueue')}
              value={f.frontDesk.waiting}
              to={`/app/${orgId}/queue`}
              linkLabel={t('nav.queue')}
            />
            {f.frontDesk.pendingCharges !== null && (
              <Metric
                icon="wallet"
                tone={f.frontDesk.pendingCharges ? 'warn' : 'neutral'}
                label={t('workspace.chargesToInvoice')}
                value={f.frontDesk.pendingCharges}
                to={`/app/${orgId}/finance`}
                linkLabel={t('nav.finance')}
              />
            )}
          </dl>
          <p className="muted">
            {f.frontDesk.cashSession ? (
              <Link to={`/app/${orgId}/cash/sessions/${f.frontDesk.cashSession.id}`}>
                {t('workspace.sessionOpen', { number: f.frontDesk.cashSession.number })}
              </Link>
            ) : (
              <Link to={`/app/${orgId}/cash`}>{t('workspace.noSession')}</Link>
            )}
          </p>
        </div>
      )}
      {f.finance && f.finance.ledger && (
        <div className="focus-group">
          <h3>{t('workspace.financeTitle')}</h3>
          <dl className="metrics metrics--compact">
            <Metric
              icon="wallet"
              label={t('workspace.openReceivables')}
              value={f.finance.openReceivables}
              format={money}
              to={`/app/${orgId}/accounting/reports`}
              linkLabel={t('accounting.nav.reports')}
            />
            <Metric icon="patients" label={t('workspace.unallocated')} value={f.finance.unallocatedReceipts} format={money} />
            <Metric
              icon="cart"
              tone={f.finance.payablesDueSoon.bills ? 'warn' : 'neutral'}
              label={t('workspace.payablesDue')}
              value={f.finance.payablesDueSoon.amount}
              format={money}
              to={`/app/${orgId}/purchasing/bills`}
              linkLabel={t('purchasing.nav.bills')}
            />
            <Metric
              icon="cash"
              label={t('workspace.openSessions')}
              value={f.finance.openCashSessions}
              to={`/app/${orgId}/cash`}
              linkLabel={t('nav.cash')}
            />
          </dl>
          {f.finance.monthToClose && (
            <p>
              <Link to={`/app/${orgId}/accounting/periods`}>{t('workspace.monthToClose', { month: f.finance.monthToClose })}</Link>
            </p>
          )}
        </div>
      )}
      {(approvals > 0 || f.stock) && (
        <div className="focus-group">
          <h3>{t('workspace.managementTitle')}</h3>
          <ul className="link-list">
            {(f.approvals?.purchaseRequests ?? 0) > 0 && (
              <li>
                <Link to={`/app/${orgId}/purchasing`}>{t('workspace.requestsToApprove', { count: f.approvals!.purchaseRequests })}</Link>
              </li>
            )}
            {(f.approvals?.directBills ?? 0) > 0 && (
              <li>
                <Link to={`/app/${orgId}/purchasing/bills`}>{t('workspace.billsToApprove', { count: f.approvals!.directBills })}</Link>
              </li>
            )}
            {(f.approvals?.settlements ?? 0) > 0 && (
              <li>
                <Link to={`/app/${orgId}/compensation`}>{t('workspace.settlementsToApprove', { count: f.approvals!.settlements })}</Link>
              </li>
            )}
            {f.stock && f.stock.reorder > 0 && (
              <li>
                <Link to={`/app/${orgId}/inventory`}>{t('workspace.itemsToReorder', { count: f.stock.reorder })}</Link>
              </li>
            )}
            {f.stock && f.stock.expiring > 0 && (
              <li>
                <Link to={`/app/${orgId}/inventory`}>{t('workspace.lotsExpiring', { count: f.stock.expiring })}</Link>
              </li>
            )}
            {approvals === 0 && (!f.stock || (f.stock.reorder === 0 && f.stock.expiring === 0)) && (
              <li className="muted">{t('workspace.nothingWaiting')}</li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
}

/** The doctor's full specialty worklist: open plans, active courses, or follow-ups to book. */
export function WorklistPage() {
  const { t } = useTranslation();
  const focus = useFocus(true);
  const kind = focus.data?.clinical?.worklist?.kind;
  useDocumentTitle(kind ? t(`nav.worklist.${kind}`) : t('workspace.worklistTitle'));
  if (focus.isPending) return <Loading />;
  if (focus.isError) return <ErrorState message={t('errors.UNKNOWN')} onRetry={() => focus.refetch()} />;
  const worklist = focus.data.clinical?.worklist;
  return (
    <>
      <PageHeader
        title={kind ? t(`nav.worklist.${kind}`) : t('workspace.worklistTitle')}
        subtitle={kind ? t(`workspace.worklist.subtitle.${kind}`) : undefined}
      />
      <section className="card" aria-labelledby="worklist-title">
        <h2 id="worklist-title" className="visually-hidden">
          {t('workspace.worklistTitle')}
        </h2>
        {worklist ? <WorklistRows worklist={worklist} compact={false} /> : <EmptyState icon="stethoscope">{t('workspace.noWorklist')}</EmptyState>}
      </section>
    </>
  );
}
