import { useMutation, useQuery } from '@tanstack/react-query';
import { useDeferredValue, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { PatientFields } from '../components/PatientForm';
import { revealAndFocus, useFocusOnError } from '../lib/a11y';
import { emptyPatientForm, patientBody, type PatientFormValue } from '../lib/patient-form';
import { useInvalidateOrg } from '../lib/scheduling';
import { EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui';
import { api, query, type ApiError } from '../lib/api';
import { errorMessage, fieldErrors, isApiError } from '../lib/errors';
import { useFormatters } from '../lib/format';
import type { Page, Patient, PatientSummary } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { orgKeys, useBranchFilter, useOrg } from '../org/context';
import { ActionBar } from '../components/layout';
import { DataTable, FilterBar, Pagination } from '../components/data';

const PAGE_SIZE = 20;

export function PatientsPage() {
  const { t } = useTranslation();
  const { orgId, can, branches, detail } = useOrg();
  const branchFilter = useBranchFilter();
  const fmt = useFormatters();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active');
  const [sort, setSort] = useState<'recent' | 'name' | 'number'>('recent');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const newButton = useRef<HTMLButtonElement>(null);
  const closeCreate = () => {
    setCreating(false);
    // Focus returns to the button that opened the form (UX-043).
    requestAnimationFrame(() => newButton.current?.focus());
  };
  useDocumentTitle(t('nav.patients'));

  const params = { q, branchId: branchFilter, status, sort, page, pageSize: PAGE_SIZE };
  const list = useQuery({
    queryKey: orgKeys.patients(orgId, params),
    queryFn: ({ signal }) => api<Page<PatientSummary>>(`/orgs/${orgId}/patients${query(params)}`, { signal }),
    placeholderData: (previous, previousQuery) =>
      // Keep the previous page visible while paging, but never across a branch switch.
      previousQuery?.queryKey[3] && (previousQuery.queryKey[3] as { branchId?: string }).branchId === branchFilter ? previous : undefined,
  });
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  return (
    <>
      <PageHeader title={t('patients.title')} subtitle={t('patients.subtitle')}>
        {can('patient.create') && !creating && (
          <button type="button" className="button button--primary" ref={newButton} onClick={() => setCreating(true)}>
            {t('patients.new')}
          </button>
        )}
      </PageHeader>
      {creating && <CreatePatient onCancel={closeCreate} />}

      <section className="card" aria-labelledby="patients-list-title">
        <div className="section-header">
          <h2 id="patients-list-title">{t('patients.listTitle')}</h2>
        </div>
        <FilterBar>
          <Field id="patient-search" label={t('patients.search')}>
            <input
              id="patient-search"
              type="search"
              placeholder={t('patients.searchPlaceholder')}
              value={search}
              maxLength={80}
              onChange={(e) => resetPage(setSearch)(e.target.value)}
            />
          </Field>
          <Field id="patient-status" label={t('patients.registrationStatus')}>
            <select id="patient-status" value={status} onChange={(e) => resetPage(setStatus)(e.target.value as typeof status)}>
              <option value="active">{t('patients.statusFilter.active')}</option>
              <option value="archived">{t('patients.statusFilter.archived')}</option>
              <option value="all">{t('patients.statusFilter.all')}</option>
            </select>
          </Field>
          <Field id="patient-sort" label={t('patients.sort')}>
            <select id="patient-sort" value={sort} onChange={(e) => resetPage(setSort)(e.target.value as typeof sort)}>
              <option value="recent">{t('patients.sortBy.recent')}</option>
              <option value="name">{t('patients.sortBy.name')}</option>
              <option value="number">{t('patients.sortBy.number')}</option>
            </select>
          </Field>
        </FilterBar>
        {/* Only when "all branches" is really a choice for this user (UX-027). */}
        {branchFilter && detail.membership.branchScope.type === 'all' && (
          <p className="muted small">{t('patients.branchFilterNote', { branch: branchName.get(branchFilter) ?? '' })}</p>
        )}

        {list.isPending && <Loading />}
        {list.isError && <ErrorState message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} />}
        {list.isSuccess && list.data.data.length === 0 && <EmptyState icon="search">{q ? t('patients.noMatches') : t('patients.empty')}</EmptyState>}
        {list.isSuccess && list.data.data.length > 0 && (
          <>
            <DataTable
              caption={t('patients.listTitle')}
              rows={list.data.data}
              rowKey={(p) => p.id}
              rowTestId={() => 'patient-row'}
              columns={[
                { key: 'number', label: t('patients.number'), cell: (p) => fmt.number(p.patientNumber) },
                { key: 'name', label: t('patients.fullName'), cell: (p) => <Link to={`/app/${orgId}/patients/${p.id}`}>{p.fullName}</Link> },
                { key: 'phone', label: t('patients.phone'), cell: (p) => <span dir="ltr">{p.phone.e164}</span> },
                {
                  key: 'branches',
                  label: t('patients.branches'),
                  cell: (p) => (
                    <span className="chip-row">
                      {p.registrations.map((r) => (
                        <span key={r.branchId} className={`badge badge--branch${r.status === 'active' ? '' : ' badge--branch-archived'}`}>
                          {branchName.get(r.branchId) ?? '—'}
                          {r.status === 'archived' && ` (${t('patients.archived')})`}
                        </span>
                      ))}
                    </span>
                  ),
                },
              ]}
            />
            {/* Sorting and paging are server-side; the search stays out of the address (it may be a name or a phone). */}
            <Pagination
              always
              page={page}
              pageSize={PAGE_SIZE}
              total={list.data.total}
              onPage={setPage}
              summary={list.data.totalCapped ? (position) => t('patients.pageOfCapped', position) : undefined}
            />
          </>
        )}
      </section>
    </>
  );
}

type DuplicateMatch = { id: string; patientNumber: number; fullName: string };

function CreatePatient({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { orgId, branches, selectedBranchId } = useOrg();
  const invalidate = useInvalidateOrg();
  const activeBranches = branches.filter((b) => b.status === 'active');
  const [form, setForm] = useState<PatientFormValue>(() => emptyPatientForm());
  // Derived on every render: the branch list may still be loading when the form opens.
  const [branchChoice, setBranchId] = useState('');
  const defaultBranch = activeBranches.some((b) => b.id === selectedBranchId) ? selectedBranchId : (activeBranches[0]?.id ?? '');
  const branchId = activeBranches.some((b) => b.id === branchChoice) ? branchChoice : defaultBranch;
  const create = useMutation({
    mutationFn: (confirmDuplicate: boolean) =>
      api<{ patient: Patient }>(`/orgs/${orgId}/patients`, {
        method: 'POST',
        body: { ...patientBody(form), branchId, confirmDuplicate },
      }),
    onSuccess: async ({ patient }) => {
      await invalidate();
      navigate(`/app/${orgId}/patients/${patient.id}`, { state: { created: true } });
    },
  });
  const duplicates = isApiError(create.error, 'POSSIBLE_DUPLICATE')
    ? ((create.error as ApiError).details.matches as DuplicateMatch[] | undefined) ?? []
    : [];
  const fields = fieldErrors(create.error);
  const sectionRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useFocusOnError(sectionRef, create.error);
  // The form replaces the list: take keyboard and screen-reader users to it (UX-043).
  useEffect(() => revealAndFocus(titleRef.current), []);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(false);
  };

  return (
    <section className="card" aria-labelledby="new-patient-title" ref={sectionRef}>
      <h2 id="new-patient-title" ref={titleRef} tabIndex={-1}>
        {t('patients.newTitle')}
      </h2>
      <p className="muted small">{t('patients.newHint')}</p>
      {create.isError && duplicates.length === 0 && (
        <Notice kind="error">{Object.keys(fields).length > 0 ? t('errors.VALIDATION_ERROR') : errorMessage(t, create.error)}</Notice>
      )}
      {duplicates.length > 0 && (
        <div className="notice notice--warning" role="alert" data-testid="duplicate-warning">
          <p>{t('patients.duplicateWarning')}</p>
          <ul>
            {duplicates.map((d) => (
              <li key={d.id}>
                <Link to={`/app/${orgId}/patients/${d.id}`}>
                  <bdi dir="ltr">#{d.patientNumber}</bdi> — {d.fullName}
                </Link>
              </li>
            ))}
          </ul>
          <button type="button" className="button button--secondary" disabled={create.isPending} onClick={() => create.mutate(true)}>
            {t('patients.createAnyway')}
          </button>
        </div>
      )}
      <form onSubmit={onSubmit} noValidate>
        <PatientFields idPrefix="new-patient" value={form} onChange={setForm} fields={fields} />
        <Field id="new-patient-branch" label={t('patients.registerAt')}>
          <select id="new-patient-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {activeBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <ActionBar>
          <button type="submit" className="button button--primary" disabled={create.isPending}>
            {create.isPending ? t('common.saving') : t('patients.create')}
          </button>
          <button type="button" className="button button--secondary" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        </ActionBar>
      </form>
    </section>
  );
}
