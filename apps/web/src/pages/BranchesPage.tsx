import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/PageHeader';
import { SpecialtyCheckboxes } from '../components/SpecialtyCheckboxes';
import { EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import { describedBy } from '../lib/a11y';
import { api } from '../lib/api';
import { errorMessage, fieldErrors, fieldMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { useSpecialtyNames } from '../lib/specialties';
import type { Branch } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { orgKeys, useOrg } from '../org/context';

export function BranchesPage() {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim());
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  useDocumentTitle(t('nav.branches'));

  const list = useQuery({
    queryKey: orgKeys.branches(orgId, query),
    queryFn: ({ signal }) =>
      api<{ data: Branch[] }>(`/orgs/${orgId}/branches${query ? `?q=${encodeURIComponent(query)}` : ''}`, {
        signal,
      }).then((r) => r.data),
  });

  return (
    <>
      <PageHeader title={t('branches.title')} subtitle={can('branch.update') ? undefined : t('branches.readOnlyNote')} />
      {notice && <Notice kind="success">{notice}</Notice>}
      {can('branch.create') && <CreateBranchForm onCreated={(name) => setNotice(t('branches.created', { name }))} />}

      <section className="card" aria-labelledby="branch-list-title">
        <div className="section-header">
          <h2 id="branch-list-title">{t('branches.listTitle')}</h2>
          <div className="search">
            <label htmlFor="branch-search" className="visually-hidden">
              {t('branches.search')}
            </label>
            <input
              id="branch-search"
              type="search"
              placeholder={t('branches.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {list.isPending && <Loading />}
        {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} />}
        {list.isSuccess && list.data.length === 0 && (
          <EmptyState>{query ? t('branches.noMatches') : t('branches.empty')}</EmptyState>
        )}
        {list.isSuccess && list.data.length > 0 && (
          <ul className="data-list" aria-label={t('branches.listTitle')}>
            {list.data.map((branch) =>
              editingId === branch.id ? (
                <EditBranchRow
                  key={branch.id}
                  branch={branch}
                  onDone={(saved) => {
                    setEditingId(null);
                    if (saved) setNotice(t('branches.updated', { name: saved }));
                  }}
                />
              ) : (
                <BranchRow
                  key={branch.id}
                  branch={branch}
                  onEdit={can('branch.update') ? () => setEditingId(branch.id) : undefined}
                />
              ),
            )}
          </ul>
        )}
      </section>
    </>
  );
}

function BranchRow({ branch, onEdit }: { branch: Branch; onEdit?: () => void }) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const names = useSpecialtyNames();
  const { specialties } = useOrg();
  return (
    <li className="data-row" data-testid="branch-row">
      <div className="data-main">
        <strong>{branch.name}</strong>
        <span className="muted">{branch.city || t('common.notSet')}</span>
        {specialties.length > 0 && (
          <span className="muted small" data-testid="branch-specialties">
            {t('branches.specialties')}: {branch.specialtyCodes.length > 0 ? fmt.list(branch.specialtyCodes.map(names.name)) : t('common.notSet')}
          </span>
        )}
      </div>
      <div className="data-meta">
        <span className={`badge badge--${branch.status}`}>{t(`branches.status.${branch.status}`)}</span>
        <span className="muted small">{t('branches.createdOn', { date: fmt.date(branch.createdAt) })}</span>
      </div>
      {onEdit && (
        <button type="button" className="button button--secondary" onClick={onEdit} aria-label={t('branches.editLabel', { name: branch.name })}>
          {t('common.edit')}
        </button>
      )}
    </li>
  );
}

function useInvalidateOrg() {
  const queryClient = useQueryClient();
  const { orgId } = useOrg();
  return () => queryClient.invalidateQueries({ queryKey: orgKeys.all(orgId) });
}

function CreateBranchForm({ onCreated }: { onCreated: (name: string) => void }) {
  const { t } = useTranslation();
  const { orgId, specialties } = useOrg();
  const invalidate = useInvalidateOrg();
  const [form, setForm] = useState({ name: '', city: '' });
  // Once the organization has specialties, each new branch says which of them it offers.
  const [codes, setCodes] = useState<string[]>(specialties);
  const create = useMutation({
    mutationFn: () =>
      api<{ branch: Branch }>(`/orgs/${orgId}/branches`, {
        method: 'POST',
        body: { name: form.name, city: form.city || undefined, specialtyCodes: specialties.length > 0 ? codes : undefined },
      }),
    onSuccess: async ({ branch }) => {
      setForm({ name: '', city: '' });
      setCodes(specialties);
      await invalidate();
      onCreated(branch.name);
    },
  });
  const fields = fieldErrors(create.error);
  const nameError = fieldMessage(t, 'branch.name', fields.name);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <section className="card" aria-labelledby="add-branch-title">
      <h2 id="add-branch-title">{t('branches.addTitle')}</h2>
      {create.isError && !nameError && <Notice kind="error">{errorMessage(t, create.error)}</Notice>}
      <form className="inline-form" onSubmit={onSubmit} noValidate>
        <Field id="new-branch-name" label={t('branches.name')} error={nameError}>
          <input
            id="new-branch-name"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            {...describedBy('new-branch-name', nameError)}
          />
        </Field>
        <Field id="new-branch-city" label={`${t('branches.city')} ${t('common.optional')}`}>
          <input id="new-branch-city" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
        </Field>
        {specialties.length > 0 && (
          <SpecialtyCheckboxes
            id="new-branch-specialties"
            legend={t('branches.offeredSpecialties')}
            error={fieldMessage(t, 'specialtyCodes', fields.specialtyCodes)}
            value={codes}
            options={specialties}
            onChange={setCodes}
          />
        )}
        <button type="submit" className="button button--primary" disabled={create.isPending}>
          {create.isPending ? t('common.saving') : t('branches.add')}
        </button>
      </form>
    </section>
  );
}

function EditBranchRow({ branch, onDone }: { branch: Branch; onDone: (savedName?: string) => void }) {
  const { t } = useTranslation();
  const { orgId, specialties } = useOrg();
  const invalidate = useInvalidateOrg();
  const [form, setForm] = useState({ name: branch.name, city: branch.city, status: branch.status });
  const [codes, setCodes] = useState<string[]>(branch.specialtyCodes);
  const save = useMutation({
    mutationFn: () =>
      api<{ branch: Branch }>(`/orgs/${orgId}/branches/${branch.id}`, {
        method: 'PATCH',
        body: { ...form, specialtyCodes: specialties.length > 0 ? codes : undefined },
      }),
    onSuccess: async ({ branch: saved }) => {
      await invalidate();
      onDone(saved.name);
    },
  });
  const fields = fieldErrors(save.error);
  const nameError = fieldMessage(t, 'branch.name', fields.name);
  const id = `edit-${branch.id}`;

  return (
    <li className="data-row data-row--editing">
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        noValidate
      >
        {save.isError && !nameError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
        <Field id={`${id}-name`} label={t('branches.name')} error={nameError}>
          <input
            id={`${id}-name`}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            {...describedBy(`${id}-name`, nameError)}
          />
        </Field>
        <Field id={`${id}-city`} label={t('branches.city')}>
          <input id={`${id}-city`} value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
        </Field>
        <Field id={`${id}-status`} label={t('branches.statusLabel')}>
          <select
            id={`${id}-status`}
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Branch['status'] }))}
          >
            <option value="active">{t('branches.status.active')}</option>
            <option value="inactive">{t('branches.status.inactive')}</option>
          </select>
        </Field>
        {specialties.length > 0 && (
          <SpecialtyCheckboxes
            id={`${id}-specialties`}
            legend={t('branches.offeredSpecialties')}
            error={fieldMessage(t, 'specialtyCodes', fields.specialtyCodes)}
            value={codes}
            options={specialties}
            onChange={setCodes}
          />
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
