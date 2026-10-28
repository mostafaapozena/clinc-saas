import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchApiStatus, type ApiStatus } from '../api/client';

type ViewState = { state: 'checking' } | ApiStatus;

export function ApiStatusPanel() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ViewState>({ state: 'checking' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchApiStatus(controller.signal)
      .then(setStatus)
      .catch(() => {
        // Aborted because the component unmounted or a re-check started.
      });
    return () => controller.abort();
  }, [attempt]);

  const recheck = () => {
    setStatus({ state: 'checking' });
    setAttempt((n) => n + 1);
  };

  const health = 'health' in status ? status.health : null;
  const dbLabel = !health
    ? t('status.dbUnknown')
    : health.database.status === 'up'
      ? t('status.dbUp')
      : t('status.dbDown');

  return (
    <section className="card" aria-labelledby="status-title">
      <h2 id="status-title">{t('status.services')}</h2>
      <dl className="status-list">
        <div className="status-row">
          <dt>{t('status.api')}</dt>
          <dd>
            <span
              role="status"
              data-testid="api-status"
              data-state={status.state}
              className={`badge badge--${status.state}`}
            >
              {t(`status.${status.state}`)}
            </span>
          </dd>
        </div>
        <div className="status-row">
          <dt>{t('status.database')}</dt>
          <dd>
            <span data-testid="db-status" className={`badge badge--${!health ? 'checking' : health.database.status === 'up' ? 'connected' : 'unreachable'}`}>
              {dbLabel}
            </span>
          </dd>
        </div>
      </dl>
      {health?.database.latencyMs != null && (
        <p className="muted">{t('status.latency', { ms: health.database.latencyMs })}</p>
      )}
      <button type="button" onClick={recheck} disabled={status.state === 'checking'}>
        {t('status.retry')}
      </button>
    </section>
  );
}
