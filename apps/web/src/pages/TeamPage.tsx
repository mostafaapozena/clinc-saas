import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { BranchScopeFields } from '../components/BranchScopeFields';
import { PageHeader } from '../components/PageHeader';
import { InvitationsCard } from '../components/account';
import { EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import { describedBy } from '../lib/a11y';
import { api } from '../lib/api';
import { errorMessage, fieldErrors, fieldMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { ASSIGNABLE_ROLES, ORG_WIDE_ROLES, type BranchScope, type Member, type Role } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { orgKeys, useOrg } from '../org/context';

const ALL: BranchScope = { type: 'all', branchIds: [] };

export function TeamPage() {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  useDocumentTitle(t('nav.team'));

  const members = useQuery({
    queryKey: orgKeys.members(orgId),
    queryFn: ({ signal }) => api<{ data: Member[] }>(`/orgs/${orgId}/members`, { signal }).then((r) => r.data),
  });

  return (
    <>
      <PageHeader title={t('team.title')} subtitle={t('team.subtitle')} />
      {notice && <Notice kind="success">{notice}</Notice>}
      {can('member.add') && <AddMemberForm onAdded={(name) => setNotice(t('team.added', { name }))} />}
      {can('member.add') && <InvitationsCard />}

      <section className="card" aria-labelledby="members-title">
        <h2 id="members-title">{t('team.members')}</h2>
        {members.isPending && <Loading />}
        {members.isError && <ErrorState message={errorMessage(t, members.error)} onRetry={() => void members.refetch()} />}
        {members.isSuccess && members.data.length === 0 && <EmptyState>{t('team.empty')}</EmptyState>}
        {members.isSuccess && members.data.length > 0 && (
          <ul className="data-list" aria-label={t('team.members')}>
            {members.data.map((member) =>
              editingId === member.id ? (
                <EditMemberRow
                  key={member.id}
                  member={member}
                  onDone={(message) => {
                    setEditingId(null);
                    if (message) setNotice(message);
                  }}
                />
              ) : (
                <MemberRow key={member.id} member={member} onEdit={() => setEditingId(member.id)} onNotice={setNotice} />
              ),
            )}
          </ul>
        )}
      </section>
    </>
  );
}

function useBranchNames() {
  const { branches } = useOrg();
  const fmt = useFormatters();
  const { t } = useTranslation();
  const names = new Map(branches.map((b) => [b.id, b.name]));
  return (scope: BranchScope) =>
    scope.type === 'all' ? t('team.scopeAll') : fmt.list(scope.branchIds.map((id) => names.get(id) ?? '—'));
}

function MemberRow({
  member,
  onEdit,
  onNotice,
}: {
  member: Member;
  onEdit: () => void;
  onNotice: (message: string) => void;
}) {
  const { t } = useTranslation();
  const { orgId, detail, can } = useOrg();
  const queryClient = useQueryClient();
  const describeScope = useBranchNames();
  const name = member.user?.displayName ?? '—';
  const actorIsOwner = detail.membership.role === 'owner';
  // Mirrors the API rules for a clear UI; the API enforces them regardless.
  const manageable = can('member.update') && !member.isSelf && (member.role !== 'owner' || actorIsOwner);
  const roleEditable = manageable && member.role !== 'owner';

  const setStatus = useMutation({
    mutationFn: (status: Member['status']) =>
      api<{ member: Member }>(`/orgs/${orgId}/members/${member.id}`, { method: 'PATCH', body: { status } }),
    onSuccess: async ({ member: saved }) => {
      await queryClient.invalidateQueries({ queryKey: orgKeys.all(orgId) });
      onNotice(t(saved.status === 'suspended' ? 'team.suspendedNotice' : 'team.reactivatedNotice', { name }));
    },
  });

  // Clinical audit access is an explicit capability that only owners assign (metadata only).
  const auditEligible = ['owner', 'admin', 'doctor'].includes(member.role);
  const hasAudit = member.capabilities.includes('clinical_audit');
  const setAudit = useMutation({
    mutationFn: (on: boolean) =>
      api<{ member: Member }>(`/orgs/${orgId}/members/${member.id}`, {
        method: 'PATCH',
        body: { capabilities: on ? [...member.capabilities, 'clinical_audit'] : member.capabilities.filter((c) => c !== 'clinical_audit') },
      }),
    onSuccess: async ({ member: saved }) => {
      await queryClient.invalidateQueries({ queryKey: orgKeys.all(orgId) });
      onNotice(t(saved.capabilities.includes('clinical_audit') ? 'team.auditGrantedNotice' : 'team.auditRevokedNotice', { name }));
    },
  });

  return (
    <li className="data-row" data-testid="member-row">
      <div className="data-main">
        <strong>
          {name} {member.isSelf && <span className="muted">{t('team.you')}</span>}
        </strong>
        <span className="muted" dir="ltr">
          {member.user?.email}
        </span>
      </div>
      <div className="data-meta">
        <span className="badge" data-testid="member-role">{t(`roles.${member.role}`)}</span>
        <span className={`badge badge--${member.status}`} data-testid="member-status">
          {t(`team.status.${member.status}`)}
        </span>
        <span className="muted small">{describeScope(member.branchScope)}</span>
        {hasAudit && <span className="badge badge--capability">{t('team.capabilities.clinical_audit')}</span>}
      </div>
      {setStatus.isError && <Notice kind="error">{errorMessage(t, setStatus.error)}</Notice>}
      {setAudit.isError && <Notice kind="error">{errorMessage(t, setAudit.error)}</Notice>}
      {manageable && (
        <div className="row-actions">
          {roleEditable && (
            <button type="button" className="button button--secondary" onClick={onEdit} aria-label={t('team.editLabel', { name })}>
              {t('common.edit')}
            </button>
          )}
          <button
            type="button"
            className="button button--secondary"
            disabled={setStatus.isPending}
            onClick={() => setStatus.mutate(member.status === 'active' ? 'suspended' : 'active')}
            aria-label={t(member.status === 'active' ? 'team.suspendLabel' : 'team.reactivateLabel', { name })}
          >
            {member.status === 'active' ? t('team.suspend') : t('team.reactivate')}
          </button>
          {actorIsOwner && auditEligible && (
            <button
              type="button"
              className="button button--secondary"
              disabled={setAudit.isPending}
              aria-pressed={hasAudit}
              onClick={() => setAudit.mutate(!hasAudit)}
              aria-label={t(hasAudit ? 'team.auditRevokeLabel' : 'team.auditGrantLabel', { name })}
            >
              {hasAudit ? t('team.auditRevoke') : t('team.auditGrant')}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function RoleSelect({ id, value, onChange }: { id: string; value: Role; onChange: (role: Role) => void }) {
  const { t } = useTranslation();
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value as Role)}>
      {ASSIGNABLE_ROLES.map((role) => (
        <option key={role} value={role}>
          {t(`roles.${role}`)}
        </option>
      ))}
    </select>
  );
}

function AddMemberForm({ onAdded }: { onAdded: (name: string) => void }) {
  const { t } = useTranslation();
  const { orgId, branches } = useOrg();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('doctor');
  const [scope, setScope] = useState<BranchScope>(ALL);
  const orgWide = ORG_WIDE_ROLES.includes(role);

  const add = useMutation({
    mutationFn: () =>
      api<{ member: Member }>(`/orgs/${orgId}/members`, {
        method: 'POST',
        body: { email, role, branchScope: orgWide ? ALL : scope },
      }),
    onSuccess: async ({ member }) => {
      setEmail('');
      setScope(ALL);
      await queryClient.invalidateQueries({ queryKey: orgKeys.all(orgId) });
      onAdded(member.user?.displayName ?? email);
    },
  });
  const fields = fieldErrors(add.error);
  const emailError = fieldMessage(t, 'email', fields.email);
  const scopeError = fieldMessage(t, 'branchScope.branchIds', fields['branchScope.branchIds']);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate();
  };

  return (
    <section className="card" aria-labelledby="add-member-title">
      <h2 id="add-member-title">{t('team.addTitle')}</h2>
      <p className="muted">{t('team.addHint')}</p>
      {add.isError && !emailError && !scopeError && <Notice kind="error">{errorMessage(t, add.error)}</Notice>}
      <form onSubmit={onSubmit} noValidate>
        <div className="inline-form">
          <Field id="member-email" label={t('team.email')} error={emailError}>
            <input
              id="member-email"
              type="email"
              dir="ltr"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              {...describedBy('member-email', emailError)}
            />
          </Field>
          <Field id="member-role" label={t('team.role')}>
            <RoleSelect id="member-role" value={role} onChange={setRole} />
          </Field>
        </div>
        {orgWide ? (
          <p className="muted small">{t('team.orgWideNote')}</p>
        ) : (
          <BranchScopeFields idPrefix="new-member" scope={scope} branches={branches} onChange={setScope} error={scopeError} />
        )}
        <button type="submit" className="button button--primary" disabled={add.isPending}>
          {add.isPending ? t('common.saving') : t('team.add')}
        </button>
      </form>
    </section>
  );
}

function EditMemberRow({ member, onDone }: { member: Member; onDone: (message?: string) => void }) {
  const { t } = useTranslation();
  const { orgId, branches } = useOrg();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<Role>(member.role);
  const [scope, setScope] = useState<BranchScope>(member.branchScope);
  const orgWide = ORG_WIDE_ROLES.includes(role);
  const name = member.user?.displayName ?? '—';

  const save = useMutation({
    mutationFn: () =>
      api<{ member: Member }>(`/orgs/${orgId}/members/${member.id}`, {
        method: 'PATCH',
        body: { role, branchScope: orgWide ? ALL : scope },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orgKeys.all(orgId) });
      onDone(t('team.updated', { name }));
    },
  });
  const scopeError = fieldMessage(t, 'branchScope.branchIds', fieldErrors(save.error)['branchScope.branchIds']);
  const id = `edit-member-${member.id}`;

  return (
    <li className="data-row data-row--editing">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        noValidate
        aria-label={t('team.editLabel', { name })}
      >
        <p>
          <strong>{name}</strong>
        </p>
        {save.isError && !scopeError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
        <Field id={`${id}-role`} label={t('team.role')}>
          <RoleSelect id={`${id}-role`} value={role} onChange={setRole} />
        </Field>
        {orgWide ? (
          <p className="muted small">{t('team.orgWideNote')}</p>
        ) : (
          <BranchScopeFields idPrefix={id} scope={scope} branches={branches} onChange={setScope} error={scopeError} />
        )}
        <div className="form-actions">
          <button type="submit" className="button button--primary" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </button>
          <button type="button" className="button button--secondary" onClick={() => onDone()}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </li>
  );
}
