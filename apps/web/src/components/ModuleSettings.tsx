import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { showToast } from '../lib/toast';
import { orgKeys, useOrg } from '../org/context';
import { Notice } from './ui';

const ERP_MODULES = ['accounting', 'cash', 'inventory', 'purchasing', 'compensation', 'assets'] as const;
const REQUIRES: Partial<Record<(typeof ERP_MODULES)[number], (typeof ERP_MODULES)[number]>> = { cash: 'accounting', compensation: 'accounting' };

/**
 * Owner switches for the shared ERP modules. Switching one off hides it and refuses its API;
 * nothing is deleted, and switching it on again shows everything as it was.
 */
export function ModuleSettings() {
  const { t } = useTranslation();
  const { orgId, detail } = useOrg();
  const queryClient = useQueryClient();
  const [on, setOn] = useState<string[]>(() => detail.organization.enabledModules ?? [...ERP_MODULES]);
  const save = useMutation({
    mutationFn: () => api(`/orgs/${orgId}/modules`, { method: 'PUT', body: { enabledModules: on } }),
    onSuccess: () => (showToast(t('settings.modules.saved')), queryClient.invalidateQueries({ queryKey: orgKeys.detail(orgId) })),
  });
  const toggle = (m: (typeof ERP_MODULES)[number], value: boolean) =>
    setOn((cur) => {
      let next = value ? [...new Set([...cur, m, ...(REQUIRES[m] ? [REQUIRES[m]!] : [])])] : cur.filter((x) => x !== m);
      // Switching off a module others need switches those off too.
      if (!value) next = next.filter((x) => REQUIRES[x as (typeof ERP_MODULES)[number]] !== m);
      return next;
    });
  return (
    <section className="card" aria-labelledby="modules-title" data-testid="module-settings">
      <h2 id="modules-title">{t('settings.modules.title')}</h2>
      <p className="muted">{t('settings.modules.intro')}</p>
      <div className="choice-group">
        {ERP_MODULES.map((m) => (
          <label key={m} className="choice">
            <input type="checkbox" checked={on.includes(m)} onChange={(e) => toggle(m, e.target.checked)} />
            <span>
              <strong>{t(`settings.modules.names.${m}`)}</strong> <span className="muted small">{t(`settings.modules.hints.${m}`)}</span>
            </span>
          </label>
        ))}
      </div>
      {save.isError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
      <div className="form-actions">
        <button type="button" className="button button--primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {t('common.save')}
        </button>
      </div>
    </section>
  );
}
