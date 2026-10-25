import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { Field, Notice } from './ui';

// A support conversation, shared by the clinic's support page and the operator queue.

export type SupportDetail = {
  id: string;
  reference: string;
  subject: string;
  category: string;
  status: 'open' | 'answered' | 'closed';
  messageCount: number;
  lastActivityAt: string;
  version: number;
  messages: { author: 'customer' | 'operator'; displayName: string; body: string; at: string }[];
};

export function SupportStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span className={`badge badge--support-${status}`} data-testid="support-status">
      {t(`support.status.${status}`)}
    </span>
  );
}

export function SupportConversation({
  request,
  onReply,
  replying,
  replyError,
  extraActions,
  viewer,
}: {
  request: SupportDetail;
  onReply: (body: string) => Promise<unknown>;
  replying: boolean;
  replyError: unknown;
  extraActions?: ReactNode;
  viewer: 'customer' | 'operator';
}) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const [body, setBody] = useState('');
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <section className="card" aria-labelledby="conversation-title">
      <h2 id="conversation-title">{t('support.conversation')}</h2>
      <ol className="timeline" data-testid="support-messages">
        {request.messages.map((m, i) => (
          <li key={i} className={`timeline-item support-message support-message--${m.author}`}>
            <div className="timeline-head">
              <strong>{m.author === 'operator' ? t('support.fromRaclinic') : m.displayName}</strong>
              <span className="muted small">{fmt.dateTime(m.at, zone)}</span>
            </div>
            <p className="record-text">{m.body}</p>
          </li>
        ))}
      </ol>
      {replyError !== null && replyError !== undefined && <Notice kind="error">{errorMessage(t, replyError)}</Notice>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onReply(body).then(
            () => setBody(''),
            () => undefined,
          );
        }}
        aria-label={t('support.reply')}
      >
        {viewer === 'customer' && <p className="muted small">{t('support.noPatientDataShort')}</p>}
        <Field id="support-reply" label={t('support.reply')}>
          <textarea id="support-reply" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="form-actions">
          <button type="submit" className="button button--primary" disabled={replying || !body.trim()}>
            {t('support.sendReply')}
          </button>
          {extraActions}
        </div>
      </form>
    </section>
  );
}
