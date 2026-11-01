import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { SupportConversation, SupportStatusBadge, type SupportDetail } from '../components/support';
import { EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import { api } from '../lib/api';
import { errorMessage, fieldErrors, fieldMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useOrg } from '../org/context';
import { CardGrid } from '../components/layout';

// Help and support (docs/architecture/SUPPORT.md): static, hand-written answers (no AI), the
// contact details raclinic has configured (nothing invented), and support requests to raclinic.

const SUPPORT_CATEGORIES = ['account', 'scheduling', 'records', 'finance', 'subscription', 'other'] as const;
type SupportSummary = {
  id: string;
  reference: string;
  subject: string;
  category: string;
  status: 'open' | 'answered' | 'closed';
  messageCount: number;
  lastActivityAt: string;
};
type Contact = { email: string | null; phone: string | null; hours: { ar: string; en: string } | null };
const supportKey = (orgId: string) => ['org', orgId, 'support'] as const;

function Faq() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const items = t('support.faq', { returnObjects: true }) as { q: string; a: string }[];
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? items.filter((i) => words.every((w) => `${i.q} ${i.a}`.toLowerCase().includes(w))) : items;
  }, [items, query]);
  return (
    <section className="card" aria-labelledby="faq-title">
      <h2 id="faq-title">{t('support.faqTitle')}</h2>
      <p className="muted small">{t('support.faqLabel')}</p>
      <label htmlFor="faq-search" className="visually-hidden">
        {t('support.faqSearch')}
      </label>
      <input id="faq-search" type="search" placeholder={t('support.faqSearch')} value={query} onChange={(e) => setQuery(e.target.value)} />
      {shown.length === 0 ? (
        <EmptyState icon="help">{t('support.faqNone')}</EmptyState>
      ) : (
        <div className="stack-sm" data-testid="faq">
          {shown.map((i) => (
            <details key={i.q}>
              <summary>{i.q}</summary>
              <p>{i.a}</p>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function ContactCard() {
  const { t, i18n } = useTranslation();
  const contact = useQuery({
    queryKey: ['support-contact'],
    queryFn: ({ signal }) => api<{ contact: Contact }>('/public/support-contact', { signal }),
    staleTime: 5 * 60_000,
  });
  const c = contact.data?.contact;
  const none = c && !c.email && !c.phone;
  return (
    <section className="card" aria-labelledby="contact-title">
      <h2 id="contact-title">{t('support.contactTitle')}</h2>
      {contact.isPending && <Loading />}
      {none && (
        <p className="muted" data-testid="contact-none">
          {t('support.contactNone')}
        </p>
      )}
      {c && !none && (
        <dl className="details">
          {c.email && (
            <>
              <dt>{t('auth.email')}</dt>
              <dd dir="ltr">{c.email}</dd>
            </>
          )}
          {c.phone && (
            <>
              <dt>{t('support.phone')}</dt>
              <dd dir="ltr">{c.phone}</dd>
            </>
          )}
          <dt>{t('support.hours')}</dt>
          <dd>{c.hours ? (i18n.resolvedLanguage === 'en' ? c.hours.en : c.hours.ar) : t('support.hoursNone')}</dd>
        </dl>
      )}
    </section>
  );
}

export function SupportPage() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const fmt = useFormatters();
  const queryClient = useQueryClient();
  useDocumentTitle(t('support.title'));
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<string>('other');
  const [body, setBody] = useState('');
  const list = useQuery({
    queryKey: supportKey(orgId),
    queryFn: ({ signal }) => api<{ data: SupportSummary[] }>(`/orgs/${orgId}/support`, { signal }),
  });
  const create = useMutation({
    mutationFn: () => api<{ request: SupportDetail }>(`/orgs/${orgId}/support`, { method: 'POST', body: { subject, category, body } }),
    onSuccess: async () => {
      setSubject('');
      setBody('');
      await queryClient.invalidateQueries({ queryKey: supportKey(orgId) });
    },
  });
  const fields = fieldErrors(create.error);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <>
      <PageHeader title={t('support.title')} subtitle={t('support.subtitle')} />
      <CardGrid wide>
        <Faq />
        <ContactCard />
      </CardGrid>
      <section className="card" aria-labelledby="support-new-title">
        <h2 id="support-new-title">{t('support.newTitle')}</h2>
        <Notice kind="warning">{t('support.noPatientData')}</Notice>
        {create.isSuccess && <Notice kind="success">{t('support.created', { reference: create.data.request.reference })}</Notice>}
        {create.isError && !fields.subject && !fields.body && <Notice kind="error">{errorMessage(t, create.error)}</Notice>}
        <form onSubmit={onSubmit} noValidate aria-label={t('support.newTitle')}>
          <div className="form-grid">
            <Field id="support-subject" label={t('support.subject')} error={fieldMessage(t, 'subject', fields.subject)}>
              <input id="support-subject" value={subject} maxLength={120} required onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field id="support-category" label={t('support.category')}>
              <select id="support-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                {SUPPORT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`support.categories.${c}`)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field id="support-body" label={t('support.message')} error={fieldMessage(t, 'body', fields.body)}>
            <textarea id="support-body" rows={5} maxLength={2000} value={body} required onChange={(e) => setBody(e.target.value)} />
          </Field>
          <button type="submit" className="button button--primary" disabled={create.isPending}>
            {t('support.send')}
          </button>
        </form>
      </section>
      <section className="card" aria-labelledby="support-list-title">
        <h2 id="support-list-title">{t('support.listTitle')}</h2>
        {list.isPending && <Loading />}
        {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} />}
        {list.isSuccess && list.data.data.length === 0 && <EmptyState icon="help">{t('support.none')}</EmptyState>}
        {list.isSuccess && list.data.data.length > 0 && (
          <ul className="data-list" data-testid="support-requests">
            {list.data.data.map((r) => (
              <li key={r.id} className="data-row">
                <div className="data-main">
                  <Link to={`/app/${orgId}/support/${r.id}`}>{r.subject}</Link>
                  <p className="muted small">
                    <span dir="ltr">{r.reference}</span> · {t(`support.categories.${r.category}`)} · {fmt.date(r.lastActivityAt)}
                  </p>
                </div>
                <span className={`badge badge--support-${r.status}`}>{t(`support.status.${r.status}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export function SupportRequestPage() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const { requestId = '' } = useParams();
  const queryClient = useQueryClient();
  const key = [...supportKey(orgId), requestId];
  const detail = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<{ request: SupportDetail }>(`/orgs/${orgId}/support/${requestId}`, { signal }),
  });
  useDocumentTitle(detail.data?.request.subject ?? t('support.title'));
  const update = (data: { request: SupportDetail }) => {
    queryClient.setQueryData(key, data);
    void queryClient.invalidateQueries({ queryKey: supportKey(orgId), exact: true });
  };
  const reply = useMutation({
    mutationFn: (body: string) =>
      api<{ request: SupportDetail }>(`/orgs/${orgId}/support/${requestId}/messages`, { method: 'POST', body: { body } }),
    onSuccess: update,
  });
  const close = useMutation({
    mutationFn: () => api<{ request: SupportDetail }>(`/orgs/${orgId}/support/${requestId}/close`, { method: 'POST' }),
    onSuccess: update,
  });
  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorState message={errorMessage(t, detail.error)} onRetry={() => void detail.refetch()} />;
  const r = detail.data.request;
  return (
    <>
      <PageHeader title={r.subject} subtitle={`${r.reference} · ${t(`support.categories.${r.category}`)}`}>
        <SupportStatusBadge status={r.status} />
      </PageHeader>
      <p className="muted small">
        <Link to={`/app/${orgId}/support`}>{t('support.back')}</Link>
      </p>
      <SupportConversation
        viewer="customer"
        request={r}
        onReply={(body) => reply.mutateAsync(body)}
        replying={reply.isPending}
        replyError={reply.error ?? close.error}
        extraActions={
          r.status !== 'closed' ? (
            <button type="button" className="button button--ghost" disabled={close.isPending} onClick={() => close.mutate()}>
              {t('support.close')}
            </button>
          ) : undefined
        }
      />
      {r.status === 'closed' && <p className="muted small">{t('support.closedHint')}</p>}
    </>
  );
}
