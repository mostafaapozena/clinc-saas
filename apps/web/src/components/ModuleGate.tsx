import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { moduleOfPath } from '../lib/modules';
import { useOrg } from '../org/context';
import { EmptyState } from './ui';

/**
 * Routes of a switchable module (lib/modules.ts) open only while the module is on: a bookmarked or
 * typed link to a switched-off module explains why instead of showing a page whose API refuses.
 */
export function ModuleGate({ path, children }: { path: string; children: ReactNode }) {
  const { t } = useTranslation();
  const { orgId, moduleOn, can } = useOrg();
  const module = moduleOfPath(path);
  if (!module || moduleOn(module)) return <>{children}</>;
  return (
    <EmptyState icon="lock">
      <p>{t('errors.MODULE_DISABLED')}</p>
      {can('organization.update') && <Link to={`/app/${orgId}/settings`}>{t('nav.settings')}</Link>}
    </EmptyState>
  );
}
