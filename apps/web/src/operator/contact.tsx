import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, Loading, Notice } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { opApi } from '../lib/operator';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { ActionBar } from '../components/layout';
import { useOperator, statusFilter } from './shared';

// --- Contact messages from the public contact page -------------------------------------------------

type ContactRow = {
  reference: string;
  createdAt: string;
  status: 'new' | 'reviewed' | 'closed';
  intent: 'demo' | 'question' | 'other';
  organizationName: string | null;
  specialty: string | null;
  language: string;
  contactName: string;
  phone: string | null;
  email: string | null;
};

export function OperatorContactMessagesPage() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const [params, setParams] = useSearchParams();
  const status = statusFilter(params.get('status'), ['new', 'reviewed', 'closed'], 'new');
  const setStatus = (s: string) => setParams(s === 'new' ? {} : { status: s || 'all' }, { replace: true });
  useDocumentTitle(t('operator.nav.contactMessages'));
  const list = useQuery({
    queryKey: ['operator', 'contact-messages', status],
    queryFn: ({ signal }) => opApi<{ data: ContactRow[] }>(`/contact-messages${status ? `?status=${status}` : ''}`, { signal }),
  });
  return (
    <>
      <PageHeader title={t('operator.nav.contactMessages')} subtitle={t('operator.contact.subtitle')} />
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
      {list.isSuccess && list.data.data.length === 0 && <EmptyState icon="message">{t('operator.contact.none')}</EmptyState>}
      {list.isSuccess && list.data.data.length > 0 && (
        <ul className="data-list" data-testid="contact-messages">
          {list.data.data.map((m) => (
            <li key={m.reference} className="data-row">
              <div className="data-main">
                <Link to={`/operator/contact-messages/${m.reference}`}>{t(`site.contact.intents.${m.intent}`)}</Link>
                <p className="muted small">
                  <bdi dir="ltr">{m.reference}</bdi> · {fmt.date(m.createdAt)} · {m.contactName}
                  {m.organizationName && <> · {m.organizationName}</>}
                </p>
              </div>
              <span className="badge">{t(`operator.inquiries.status.${m.status}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function OperatorContactMessagePage() {
  const { t } = useTranslation();
  const { reference = '' } = useParams();
  const fmt = useFormatters();
  const operator = useOperator();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['operator', 'contact-message', reference],
    queryFn: ({ signal }) => opApi<{ message: ContactRow & { message: string } }>(`/contact-messages/${reference}`, { signal }),
  });
  const [contact, setContact] = useState<{ name: string; phone: string | null; email: string | null } | null>(null);
  const reveal = useMutation({
    mutationFn: () =>
      opApi<{ contact: { name: string; phone: string | null; email: string | null } }>(`/contact-messages/${reference}/reveal-contact`, {
        method: 'POST',
      }),
    onSuccess: (r) => setContact(r.contact),
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => opApi(`/contact-messages/${reference}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operator'] }),
  });
  useDocumentTitle(reference);
  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorState message={errorMessage(t, detail.error)} onRetry={() => void detail.refetch()} />;
  const m = detail.data.message;
  const shown = contact ?? { name: m.contactName, phone: m.phone, email: m.email };
  return (
    <>
      <PageHeader title={t(`site.contact.intents.${m.intent}`)} subtitle={m.reference} />
      <p className="muted small">
        <Link to="/operator/contact-messages">{t('operator.contact.back')}</Link>
      </p>
      {(reveal.isError || setStatus.isError) && <Notice kind="error">{errorMessage(t, reveal.error ?? setStatus.error)}</Notice>}
      <section className="card">
        <dl className="details">
          <dt>{t('operator.inquiries.received')}</dt>
          <dd>{fmt.date(m.createdAt)}</dd>
          <dt>{t('operator.inquiries.statusLabel')}</dt>
          <dd>{t(`operator.inquiries.status.${m.status}`)}</dd>
          <dt>{t('operator.contact.organization')}</dt>
          <dd dir="auto">{m.organizationName ?? '—'}</dd>
          <dt>{t('operator.contact.specialty')}</dt>
          <dd>{m.specialty ? t(`site.inquiry.interests.${m.specialty}`, { defaultValue: m.specialty }) : '—'}</dd>
          <dt>{t('operator.contact.message')}</dt>
          <dd className="record-text" dir="auto">
            {m.message}
          </dd>
          <dt>{t('operator.inquiries.contact')}</dt>
          <dd data-testid="contact-message-contact">
            <span className="block">{shown.name}</span>
            {shown.phone && (
              <span className="block">
                <bdi dir="ltr">{shown.phone}</bdi>
              </span>
            )}
            {shown.email && (
              <span className="block">
                <bdi dir="ltr">{shown.email}</bdi>
              </span>
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
              .filter((s) => s !== m.status)
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
