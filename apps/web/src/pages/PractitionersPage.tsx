import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { useInvalidateOrg } from '../lib/scheduling';
import { EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import { api, query } from '../lib/api';
import { errorMessage, fieldErrors, fieldMessage } from '../lib/errors';
import { useSpecialtyNames } from '../lib/specialties';
import { useFormatters } from '../lib/format';
import type { BranchScope, Practitioner } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { orgKeys, useOrg, useSpecialtyFilter } from '../org/context';

export function PractitionersPage() {
  const { t } = useTranslation();
  const { orgId, can, detail, branches } = useOrg();
  const fmt = useFormatters();
  const specialties = useSpecialtyNames();
  const [adding, setAdding] = useState(false);
  useDocumentTitle(t('nav.practitioners'));
  const specialty = useSpecialtyFilter();
  const list = useQuery({
    queryKey: orgKeys.practitioners(orgId, { specialty }),
    queryFn: ({ signal }) => api<{ data: Practitioner[] }>(`/orgs/${orgId}/practitioners${query({ specialty })}`, { signal }).then((r) => r.data),
  });
  const manage = can('practitioner.manage');
  // Doctors go straight to their own schedule.
  const ownId = detail.membership.practitionerId;
  if (!manage && !can('appointment.book') && ownId) return <Navigate to={`/app/${orgId}/practitioners/${ownId}`} replace />;
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  return (
    <>
      <PageHeader title={t('practitioners.title')} subtitle={t('practitioners.subtitle')}>
        {manage && !adding && (
          <button type="button" className="button button--primary" onClick={() => setAdding(true)}>
            {t('practitioners.add')}
          </button>
        )}
      </PageHeader>
      {adding && <AddPractitioner onDone={() => setAdding(false)} />}
      <section className="card" aria-labelledby="practitioners-list-title">
        <h2 id="practitioners-list-title">{t('practitioners.listTitle')}</h2>
        {list.isPending && <Loading />}
        {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} />}
        {list.isSuccess && list.data.length === 0 && <EmptyState icon="stethoscope">{manage ? t('practitioners.emptyManage') : t('practitioners.empty')}</EmptyState>}
        {list.isSuccess && list.data.length > 0 && (
          <ul className="data-list">
            {list.data.map((p) => (
              <li key={p.id} className="data-row" data-testid="practitioner-row">
                <div className="data-main">
                  <Link to={`/app/${orgId}/practitioners/${p.id}`}>
                    <strong>{p.displayName}</strong>
                  </Link>
                  <span className="muted small">{specialties.name(p.specialtyCode)}</span>
                </div>
                <div className="data-meta">
                  <span className={`badge badge--${p.status}`}>{t(`practitioners.status.${p.status}`)}</span>
                  <span className="muted small">{fmt.list(p.branchIds.map((id) => branchName.get(id) ?? '—'))}</span>
                  <span className="muted small">{t('practitioners.defaultDuration', { n: p.defaultDurationMinutes })}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

type Candidate = { membershipId: string; displayName: string; branchScope: BranchScope };

function AddPractitioner({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { orgId, branches, specialties: enabled } = useOrg();
  const specialties = useSpecialtyNames();
  const offered = enabled.length ? specialties.list.filter((s) => enabled.includes(s.code)) : specialties.list;
  const invalidate = useInvalidateOrg();
  const candidates = useQuery({
    queryKey: orgKeys.candidates(orgId),
    queryFn: ({ signal }) => api<{ data: Candidate[] }>(`/orgs/${orgId}/practitioners/candidates`, { signal }).then((r) => r.data),
  });
  const [membershipId, setMembershipId] = useState('');
  const [specialtyCode, setSpecialtyCode] = useState('');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [duration, setDuration] = useState(30);
  const candidate = candidates.data?.find((c) => c.membershipId === membershipId);
  const allowedBranches = branches.filter(
    (b) => b.status === 'active' && (!candidate || candidate.branchScope.type === 'all' || candidate.branchScope.branchIds.includes(b.id)),
  );
  const create = useMutation({
    mutationFn: () =>
      api(`/orgs/${orgId}/practitioners`, {
        method: 'POST',
        body: { membershipId, specialtyCode, branchIds, defaultDurationMinutes: duration },
      }),
    onSuccess: async () => {
      await invalidate();
      onDone();
    },
  });
  const fields = fieldErrors(create.error);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <section className="card" aria-labelledby="add-practitioner-title">
      <h2 id="add-practitioner-title">{t('practitioners.addTitle')}</h2>
      <p className="muted small">{t('practitioners.addHint')}</p>
      {create.isError && <Notice kind="error">{errorMessage(t, create.error)}</Notice>}
      {candidates.isSuccess && candidates.data.length === 0 ? (
        <EmptyState icon="stethoscope">{t('practitioners.noCandidates')}</EmptyState>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <div className="form-grid">
            <Field id="practitioner-member" label={t('practitioners.member')}>
              <select id="practitioner-member" value={membershipId} onChange={(e) => { setMembershipId(e.target.value); setBranchIds([]); }}>
                <option value="">{t('common.choose')}</option>
                {candidates.data?.map((c) => (
                  <option key={c.membershipId} value={c.membershipId}>
                    {c.displayName}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="practitioner-specialty" label={t('practitioners.specialty')}>
              <select id="practitioner-specialty" value={specialtyCode} onChange={(e) => setSpecialtyCode(e.target.value)}>
                <option value="">{t('common.choose')}</option>
                {offered.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name[specialties.lang]}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="practitioner-duration" label={t('practitioners.durationLabel')} error={fieldMessage(t, 'defaultDurationMinutes', fields.defaultDurationMinutes)}>
              <input id="practitioner-duration" type="number" min={5} max={240} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </Field>
          </div>
          <fieldset className="fieldset">
            <legend>{t('practitioners.branches')}</legend>
            <div className="choice-group">
              {allowedBranches.map((b) => (
                <label key={b.id} className="choice">
                  <input
                    type="checkbox"
                    checked={branchIds.includes(b.id)}
                    onChange={(e) => setBranchIds((ids) => (e.target.checked ? [...ids, b.id] : ids.filter((id) => id !== b.id)))}
                  />
                  {b.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={create.isPending || !membershipId || !specialtyCode || branchIds.length === 0}>
              {create.isPending ? t('common.saving') : t('practitioners.create')}
            </button>
            <button type="button" className="button button--secondary" onClick={onDone}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
