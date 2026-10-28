import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { currentToasts, dismissToast, subscribeToasts } from '../lib/toast';
import { Icon } from './Icon';

/** Rendered once per layout (workspace, operator console). */
export function ToastRegion() {
  const { t } = useTranslation();
  const items = useSyncExternalStore(subscribeToasts, currentToasts, currentToasts);
  return (
    <div className="toast-region" aria-live="polite">
      {items.map((toast) => (
        <div key={toast.id} className="toast">
          <Icon name="checkCircle" />
          <span>{toast.message}</span>
          <button type="button" className="icon-button" aria-label={t('shell.dismissMessage')} onClick={() => dismissToast(toast.id)}>
            <Icon name="close" />
          </button>
        </div>
      ))}
    </div>
  );
}
