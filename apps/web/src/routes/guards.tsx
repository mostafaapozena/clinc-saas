import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { useSession } from '../auth/session';
import { ErrorState, Loading } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { safeNext } from '../lib/navigation';
import { LAST_ORG_KEY, readStored } from '../lib/storage';
import type { Permission } from '../lib/types';
import { useOrg } from '../org/context';

function FullPage({ children }: { children: ReactNode }) {
  return <div className="full-page">{children}</div>;
}

export function RequireAuth() {
  const { t } = useTranslation();
  const location = useLocation();
  const session = useSession();
  if (session.isPending) return <FullPage><Loading /></FullPage>;
  if (session.isError) {
    return (
      <FullPage>
        <ErrorState message={errorMessage(t, session.error)} onRetry={() => void session.refetch()} />
      </FullPage>
    );
  }
  if (!session.data) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <Outlet />;
}

/** Sign-in and registration: a signed-in visitor goes straight on (to a validated destination). */
export function PublicOnly() {
  const session = useSession();
  const [params] = useSearchParams();
  if (session.isPending) return <FullPage><Loading /></FullPage>;
  if (session.data) return <Navigate to={safeNext(params.get('next'))} replace />;
  return <Outlet />;
}

/** /app → the last used organization, the first one, or onboarding when there is none. */
export function WorkspaceRedirect() {
  const { data } = useSession();
  const memberships = data?.memberships ?? [];
  if (memberships.length === 0) return <Navigate to="/onboarding" replace />;
  const last = readStored(LAST_ORG_KEY);
  const target = memberships.find((m) => m.organization.id === last) ?? memberships[0];
  return <Navigate to={`/app/${target?.organization.id}`} replace />;
}

export function AccessDenied() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  return (
    <section className="card state-card" aria-labelledby="denied-title">
      <h1 id="denied-title">{t('access.deniedTitle')}</h1>
      <p>{t('access.deniedBody')}</p>
      <Link className="button button--secondary" to={`/app/${orgId}`}>
        {t('access.backToHome')}
      </Link>
    </section>
  );
}

/** UX only — the API enforces the same permission independently. */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useOrg();
  return can(permission) ? children : <AccessDenied />;
}

/** UX only: any one of the permissions opens the page (the API checks each request on its own). */
export function RequireAnyPermission({ permissions, children }: { permissions: Permission[]; children: ReactNode }) {
  const { can } = useOrg();
  return permissions.some((p) => can(p)) ? children : <AccessDenied />;
}
