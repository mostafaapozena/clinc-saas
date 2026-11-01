import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, Loading } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { opApi } from '../lib/operator';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { SupportConversation, SupportStatusBadge, type SupportDetail } from '../components/support';
import { useOperator, statusFilter } from './shared';

// --- Support queue and development mail sink (milestone 5) -------------------------------------

type QueueRow = {
  id: string;
  reference: string;
  subject: string;
  category: string;
  status: string;
  messageCount: number;
  lastActivityAt: string;
  organization: { id: string; name: string };
};

export function OperatorSupportPage() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const [params, setParams] = useSearchParams();
  const status = statusFilter(params.get('status'), ['open', 'answered', 'closed'], 'open');
  const setStatus = (s: string) => setParams(s === 'open' ? {} : { status: s || 'all' }, { replace: true });
  useDocumentTitle(t('operator.nav.support'));
  const list = useQuery({
    queryKey: ['operator', 'support', status],
    queryFn: ({ signal }) => opApi<{ data: QueueRow[] }>(`/support${status ? `?status=${status}` : ''}`, { signal }),
  });
  return (
    <>
      <PageHeader title={t('operator.nav.support')} subtitle={t('operator.support.subtitle')} />
      <div className="segmented" role="group" aria-label={t('operator.inquiries.filter')}>
        {['open', 'answered', 'closed', ''].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            className={`segment${status === s ? ' segment--active' : ''}`}
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
          >
            {s ? t(`support.status.${s}`) : t('operator.inquiries.all')}
          </button>
        ))}
      </div>
      {list.isPending && <Loading />}
      {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} />}
      {list.isSuccess && list.data.data.length === 0 && <EmptyState icon="help">{t('operator.support.none')}</EmptyState>}
      {list.isSuccess && list.data.data.length > 0 && (
        <ul className="data-list" data-testid="support-queue">
          {list.data.data.map((r) => (
            <li key={r.id} className="data-row">
              <div className="data-main">
                <Link to={`/operator/support/${r.reference}`}>{r.subject}</Link>
                <p className="muted small">
                  {r.organization.name} · <span dir="ltr">{r.reference}</span> · {t(`support.categories.${r.category}`)} ·{' '}
                  {fmt.date(r.lastActivityAt)}
                </p>
              </div>
              <SupportStatusBadge status={r.status} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function OperatorSupportRequestPage() {
  const { t } = useTranslation();
  const { reference = '' } = useParams();
  const operator = useOperator();
  const queryClient = useQueryClient();
  const key = ['operator', 'support-request', reference];
  const detail = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      opApi<{
        request: SupportDetail & { organization: { id: string; name: string }; requester: { displayName: string; email: string } | null };
      }>(`/support/${reference}`, { signal }),
  });
  useDocumentTitle(reference);
  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: key });
    await queryClient.invalidateQueries({ queryKey: ['operator', 'support'] });
  };
  const reply = useMutation({
    mutationFn: (body: string) => opApi(`/support/${reference}/messages`, { method: 'POST', body: { body } }),
    onSuccess: done,
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => opApi(`/support/${reference}/status`, { method: 'POST', body: { status } }),
    onSuccess: done,
  });
  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorState message={errorMessage(t, detail.error)} onRetry={() => void detail.refetch()} />;
  const r = detail.data.request;
  const manage = operator.can('platform.support.manage');
  return (
    <>
      <PageHeader title={r.subject} subtitle={`${r.reference} · ${r.organization.name}`}>
        <SupportStatusBadge status={r.status} />
      </PageHeader>
      <p className="muted small">
        <Link to="/operator/support">{t('operator.support.back')}</Link>
        {r.requester && (
          <>
            {' '}
            · {t('operator.support.requester')}: {r.requester.displayName} <span dir="ltr">{r.requester.email}</span>
          </>
        )}
      </p>
      {manage ? (
        <SupportConversation
          viewer="operator"
          request={r}
          onReply={(body) => reply.mutateAsync(body)}
          replying={reply.isPending}
          replyError={reply.error ?? setStatus.error}
          extraActions={(['open', 'answered', 'closed'] as const)
            .filter((s) => s !== r.status)
            .map((s) => (
              <button key={s} type="button" className="button button--ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate(s)}>
                {t(`operator.support.markAs.${s}`)}
              </button>
            ))}
        />
      ) : (
        <EmptyState icon="lock">{t('operator.support.readOnly')}</EmptyState>
      )}
    </>
  );
}
