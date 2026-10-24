import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router';
import { useSession } from '../auth/session';
import { Loading } from '../components/ui';
import { withNext } from '../lib/navigation';
import { usePrivatePageMeta } from '../lib/pageMeta';
import { ORGANIZATION_TYPES } from '../lib/types';
import { SPECIALTY_SOLUTION_CODES } from './solutions';

/**
 * "Create your clinic workspace": carries a public pre-selection into onboarding, through
 * registration for visitors without a session. Only known values are passed on (the server
 * validates them again); they pre-fill a new organization and never change an existing one.
 */
export function StartPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const session = useSession();
  usePrivatePageMeta(t('site.start.title'));

  const query = new URLSearchParams();
  const specialty = params.get('specialty');
  const type = params.get('type');
  if (specialty && SPECIALTY_SOLUTION_CODES.includes(specialty)) query.set('specialty', specialty);
  if (type && (ORGANIZATION_TYPES as readonly string[]).includes(type)) query.set('type', type);
  const onboarding = query.size > 0 ? `/onboarding?${query.toString()}` : '/onboarding';

  if (session.isPending) {
    return (
      <div className="full-page">
        <Loading label={t('site.start.loading')} />
      </div>
    );
  }
  return <Navigate to={session.data ? onboarding : withNext('/register', onboarding)} replace />;
}
