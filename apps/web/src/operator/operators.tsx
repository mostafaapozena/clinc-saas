import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/PageHeader';
import { ErrorState, Loading, Notice } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { opApi, opKeys, type OperatorSession } from '../lib/operator';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useOperator } from './shared';

// --- Operators and audit ---------------------------------------------------------------------

export function OperatorOperatorsPage() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const operator = useOperator();
  const queryClient = useQueryClient();
  useDocumentTitle(t('operator.nav.operators'));
  const list = useQuery({
    queryKey: opKeys.operators,
    queryFn: ({ signal }) => opApi<{ data: (OperatorSession & { status: string; lastLoginAt: string | null })[] }>('/operators', { signal }),
  });
  const change = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => opApi(`/operators/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: opKeys.operators }),
  });
  return (
    <>
      <PageHeader title={t('operator.nav.operators')} subtitle={t('operator.operators.subtitle')} />
      {change.isError && <Notice kind="error">{errorMessage(t, change.error)}</Notice>}
      {list.isPending && <Loading />}
      {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} />}
      {list.isSuccess && (
        <ul className="data-list">
          {list.data.data.map((o) => (
            <li key={o.id} className="data-row">
              <div className="data-main">
                <strong>{o.displayName}</strong>{' '}
                <span className="muted small" dir="ltr">
                  {o.email}
                </span>
                <p className="muted small">
                  {t(`operator.roles.${o.role}`)} ·{' '}
                  {o.lastLoginAt ? t('operator.operators.lastSignIn', { date: fmt.date(o.lastLoginAt) }) : t('operator.operators.neverSignedIn')}
                </p>
              </div>
              <span className={`badge badge--${o.status === 'active' ? 'active' : 'suspended'}`}>{t(`operator.operators.status.${o.status}`)}</span>
              {operator.can('platform.operators.manage') && o.id !== operator.id && (
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={change.isPending}
                  onClick={() => change.mutate({ id: o.id, status: o.status === 'active' ? 'suspended' : 'active' })}
                >
                  {o.status === 'active' ? t('operator.operators.suspend') : t('operator.operators.reactivate')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
