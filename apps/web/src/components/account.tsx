import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../auth/session';
import { api } from '../lib/api';
import { errorMessage, fieldErrors, fieldMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { ASSIGNABLE_ROLES, ORG_WIDE_ROLES, type BranchScope, type Role } from '../lib/types';
import { useOrg } from '../org/context';
import { BranchScopeFields } from './BranchScopeFields';
import { EmptyState, ErrorState, Field, Loading, Notice } from './ui';
import { ConfirmAction } from './data';

// Account pieces of milestone 5: email verification, the user's sessions, and invitations.

export function EmailVerificationCard() {
  const { t } = useTranslation();
  const user = useSession().data?.user;
  const request = useMutation({
    mutationFn: () => api<{ accepted?: boolean; alreadyVerified?: boolean }>('/auth/email-verification/request', { method: 'POST' }),
  });
  if (!user || user.emailVerified) return null;
  return (
    <section className="card" aria-labelledby="verify-card-title">
      <h2 id="verify-card-title">{t('account.verifyCardTitle')}</h2>
      <p className="muted">{t('account.verifyCardHint')}</p>
      {request.isSuccess && <Notice kind="success">{t('account.verifySent')}</Notice>}
      {request.isError && <Notice kind="error">{errorMessage(t, request.error)}</Notice>}
      <button
        type="button"
        className="button button--secondary"
        disabled={request.isPending || request.isSuccess}
        onClick={() => request.mutate()}
      >
        {t('account.verifySend')}
      </button>
    </section>
  );
}

type SessionRow = { id: string; current: boolean; device: string | null; createdAt: string; lastSeenAt: string; expiresAt: string };

export function SessionsCard() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const queryClient = useQueryClient();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const sessions = useQuery({
    queryKey: ['me', 'sessions'],
    queryFn: ({ signal }) => api<{ data: SessionRow[] }>('/me/sessions', { signal }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['me', 'sessions'] });
  const revoke = useMutation({ mutationFn: (id: string) => api<void>(`/me/sessions/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const revokeOthers = useMutation({
    mutationFn: () => api<{ revoked: number }>('/me/sessions/revoke-others', { method: 'POST' }),
    onSuccess: refresh,
  });
  return (
    <section className="card" aria-labelledby="sessions-title">
      <h2 id="sessions-title">{t('account.sessionsTitle')}</h2>
      <p className="muted small">{t('account.sessionsHint')}</p>
      {(revoke.isError || revokeOthers.isError) && <Notice kind="error">{errorMessage(t, revoke.error ?? revokeOthers.error)}</Notice>}
      {sessions.isPending && <Loading />}
      {sessions.isError && <ErrorState message={errorMessage(t, sessions.error)} onRetry={() => void sessions.refetch()} />}
      {sessions.isSuccess && (
        <>
          <ul className="data-list" data-testid="sessions">
            {sessions.data.data.map((s) => (
              <li key={s.id} className="data-row">
                <div className="data-main">
                  <strong>{s.device ?? t('account.unknownDevice')}</strong>{' '}
                  {s.current && <span className="badge badge--active">{t('account.thisDevice')}</span>}
                  <p className="muted small">
                    {t('account.sessionSince', { time: fmt.dateTime(s.createdAt, zone) })} ·{' '}
                    {t('account.sessionLastSeen', { time: fmt.dateTime(s.lastSeenAt, zone) })}
                  </p>
                </div>
                {!s.current && (
                  <button type="button" className="button button--ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)}>
                    {t('account.signOutDevice')}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {sessions.data.data.some((s) => !s.current) && (
            <button
              type="button"
              className="button button--secondary"
              disabled={revokeOthers.isPending}
              onClick={() => revokeOthers.mutate()}
            >
              {t('account.signOutOthers')}
            </button>
          )}
        </>
      )}
    </section>
  );
}

type Invitation = { id: string; email: string; role: Role; expiresAt: string; createdAt: string };
const ALL: BranchScope = { type: 'all', branchIds: [] };

export function InvitationsCard() {
  const { t } = useTranslation();
  const { orgId, branches } = useOrg();
  const fmt = useFormatters();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('receptionist');
  const [scope, setScope] = useState<BranchScope>(ALL);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const key = ['org', orgId, 'invitations'];
  const list = useQuery({ queryKey: key, queryFn: ({ signal }) => api<{ data: Invitation[] }>(`/orgs/${orgId}/invitations`, { signal }) });
  const invite = useMutation({
    mutationFn: () =>
      api<{ invitation: Invitation; mailer: string }>(`/orgs/${orgId}/invitations`, {
        method: 'POST',
        body: { email, role, branchScope: ORG_WIDE_ROLES.includes(role) ? ALL : scope },
      }),
    onSuccess: async (res) => {
      setSentTo(res.mailer === 'none' ? null : res.invitation.email);
      setEmail('');
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api<void>(`/orgs/${orgId}/invitations/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const emailError = fieldMessage(t, 'email', fieldErrors(invite.error).email);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    invite.mutate();
  };
  return (
    <section className="card" aria-labelledby="invite-title">
      <h2 id="invite-title">{t('account.inviteTitle')}</h2>
      <p className="muted">{t('account.inviteHint')}</p>
      {invite.isSuccess && (
        <Notice kind="success">{sentTo ? t('account.inviteSent', { email: sentTo }) : t('account.inviteSavedNoMail')}</Notice>
      )}
      {invite.isError && !emailError && <Notice kind="error">{errorMessage(t, invite.error)}</Notice>}
      <form onSubmit={onSubmit} noValidate aria-label={t('account.inviteTitle')}>
        <div className="inline-form">
          <Field id="invite-email" label={t('team.email')} error={emailError}>
            <input
              id="invite-email"
              type="email"
              dir="ltr"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field id="invite-role" label={t('team.role')}>
            <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {!ORG_WIDE_ROLES.includes(role) && <BranchScopeFields idPrefix="invite" scope={scope} branches={branches} onChange={setScope} />}
        <button type="submit" className="button button--primary" disabled={invite.isPending}>
          {t('account.inviteSubmit')}
        </button>
      </form>
      <h3>{t('account.pendingInvitations')}</h3>
      {list.isSuccess && list.data.data.length === 0 && <EmptyState icon="mail">{t('account.noInvitations')}</EmptyState>}
      {list.isSuccess && list.data.data.length > 0 && (
        <ul className="data-list" data-testid="invitations">
          {list.data.data.map((i) => (
            <li key={i.id} className="data-row">
              <div className="data-main">
                <span dir="ltr">{i.email}</span> · {t(`roles.${i.role}`)}
                <p className="muted small">{t('account.invitationExpires', { date: fmt.date(i.expiresAt) })}</p>
              </div>
              <ConfirmAction
                label={t('account.revokeInvitation')}
                message={t('account.revokeMessage', { email: i.email })}
                confirmLabel={t('account.revokeConfirm')}
                pending={revoke.isPending}
                onConfirm={() => revoke.mutate(i.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
