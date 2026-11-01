import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, Loading, Notice } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { opApi, opKeys } from '../lib/operator';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { ActionBar } from '../components/layout';
import { useOperator, statusFilter } from './shared';

// --- Inquiries -------------------------------------------------------------------------------

type InquiryRow = {
  reference: string;
  createdAt: string;
  status: 'new' | 'reviewed' | 'closed';
  country: string;
  organizationType: string;
  interest: string;
  organizationName: string;
  language: string;
  contactName: string;
  phone: string | null;
  email: string | null;
};

export function OperatorInquiriesPage() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  // The filter lives in the URL, so Back and refresh keep it ("all" = every status).
  const [params, setParams] = useSearchParams();
  const status = statusFilter(params.get('status'), ['new', 'reviewed', 'closed'], 'new');
  const setStatus = (s: string) => setParams(s === 'new' ? {} : { status: s || 'all' }, { replace: true });
  useDocumentTitle(t('operator.nav.inquiries'));
  const list = useQuery({
    queryKey: opKeys.inquiries(status),
    queryFn: ({ signal }) => opApi<{ data: InquiryRow[] }>(`/inquiries${status ? `?status=${status}` : ''}`, { signal }),
  });
  return (
    <>
      <PageHeader title={t('operator.nav.inquiries')} subtitle={t('operator.inquiries.subtitle')} />
      <div className="segmented" role="group" aria-label={t('operator.inquiries.filter')}>
        {['new', 'reviewed', 'closed', ''].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            className={`segment${status === s ? ' segment--active' : ''}`}
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
          >
            {s ? t(`operator.inquiries.status.${s}`) : t('operator.inquiries.all')}
          </button>
        ))}
      </div>
      {list.isPending && <Loading />}
      {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} />}
      {list.isSuccess && list.data.data.length === 0 && <EmptyState icon="file">{t('operator.inquiries.none')}</EmptyState>}
      {list.isSuccess && list.data.data.length > 0 && (
        <ul className="data-list">
          {list.data.data.map((i) => (
            <li key={i.reference} className="data-row">
              <div className="data-main">
                <Link to={`/operator/inquiries/${i.reference}`}>{i.organizationName}</Link>
                <p className="muted small">
                  <span dir="ltr">{i.reference}</span> · {fmt.date(i.createdAt)} · {i.contactName}
                </p>
              </div>
              <span className="badge">{t(`operator.inquiries.status.${i.status}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function OperatorInquiryPage() {
  const { t } = useTranslation();
  const { reference = '' } = useParams();
  const fmt = useFormatters();
  const operator = useOperator();
  const queryClient = useQueryClient();
  const inquiry = useQuery({
    queryKey: opKeys.inquiry(reference),
    queryFn: ({ signal }) => opApi<{ inquiry: InquiryRow & { description: string } }>(`/inquiries/${reference}`, { signal }),
  });
  const [contact, setContact] = useState<{ name: string; phone: string | null; email: string | null } | null>(null);
  const reveal = useMutation({
    mutationFn: () => opApi<{ contact: typeof contact }>(`/inquiries/${reference}/reveal-contact`, { method: 'POST' }),
    onSuccess: (r) => setContact(r.contact),
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => opApi(`/inquiries/${reference}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operator'] }),
  });
  useDocumentTitle(reference);
  if (inquiry.isPending) return <Loading />;
  if (inquiry.isError) return <ErrorState message={errorMessage(t, inquiry.error)} onRetry={() => void inquiry.refetch()} />;
  const i = inquiry.data.inquiry;
  return (
    <>
      <PageHeader title={i.organizationName} subtitle={i.reference} />
      <p className="muted small">
        <Link to="/operator/inquiries">{t('operator.inquiries.back')}</Link>
      </p>
      {(reveal.isError || setStatus.isError) && <Notice kind="error">{errorMessage(t, reveal.error ?? setStatus.error)}</Notice>}
      <section className="card">
        <dl className="details">
          <dt>{t('operator.inquiries.received')}</dt>
          <dd>{fmt.date(i.createdAt)}</dd>
          <dt>{t('operator.inquiries.statusLabel')}</dt>
          <dd>{t(`operator.inquiries.status.${i.status}`)}</dd>
          <dt>{t('operator.inquiries.country')}</dt>
          <dd>{t(`countries.${i.country}`, { defaultValue: i.country })}</dd>
          <dt>{t('operator.inquiries.interest')}</dt>
          <dd>{t(`site.inquiry.interests.${i.interest}`, { defaultValue: i.interest })}</dd>
          <dt>{t('operator.inquiries.description')}</dt>
          <dd className="record-text">{i.description}</dd>
          <dt>{t('operator.inquiries.contact')}</dt>
          <dd data-testid="inquiry-contact">
            {contact ? (
              <>
                <span className="block">{contact.name}</span>
                {contact.phone && (
                  <span className="block" dir="ltr">
                    {contact.phone}
                  </span>
                )}
                {contact.email && (
                  <span className="block" dir="ltr">
                    {contact.email}
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="block">{i.contactName}</span>
                {i.phone && (
                  <span className="block" dir="ltr">
                    {i.phone}
                  </span>
                )}
                {i.email && (
                  <span className="block" dir="ltr">
                    {i.email}
                  </span>
                )}
              </>
            )}
          </dd>
        </dl>
        {operator.can('platform.inquiries.manage') && (
          <ActionBar>
            {!contact && (
              <button type="button" className="button button--secondary" disabled={reveal.isPending} onClick={() => reveal.mutate()}>
                {t('operator.inquiries.reveal')}
              </button>
            )}
            {(['new', 'reviewed', 'closed'] as const)
              .filter((s) => s !== i.status)
              .map((s) => (
                <button key={s} type="button" className="button button--ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate(s)}>
                  {t(`operator.inquiries.markAs.${s}`)}
                </button>
              ))}
          </ActionBar>
        )}
        <p className="muted small">{t('operator.inquiries.revealHint')}</p>
      </section>
    </>
  );
}
