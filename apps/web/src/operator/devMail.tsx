import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, Loading, Notice } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { opApi } from '../lib/operator';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type DevMailRow = { id: string; to: string; template: string; subject: string; text: string; createdAt: string };

/** Development only: messages the platform would have emailed. Never available in production. */
export function OperatorDevMailPage() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  useDocumentTitle(t('operator.nav.devMail'));
  const list = useQuery({
    queryKey: ['operator', 'dev-mail'],
    queryFn: ({ signal }) => opApi<{ data: DevMailRow[] }>('/dev-mail', { signal }),
  });
  return (
    <>
      <PageHeader title={t('operator.nav.devMail')} subtitle={t('operator.devMail.subtitle')} />
      <Notice kind="warning">{t('operator.devMail.warning')}</Notice>
      {list.isPending && <Loading />}
      {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} />}
      {list.isSuccess && list.data.data.length === 0 && <EmptyState icon="mail">{t('operator.devMail.none')}</EmptyState>}
      {list.isSuccess && list.data.data.length > 0 && (
        <ul className="data-list" data-testid="dev-mail">
          {list.data.data.map((m) => (
            <li key={m.id} className="data-row">
              <div className="data-main">
                <strong>{m.subject}</strong>
                <p className="muted small">
                  <span dir="ltr">{m.to}</span> · {fmt.date(m.createdAt)}
                </p>
                <pre className="record-text dev-mail-text" dir="auto">
                  {m.text}
                </pre>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
