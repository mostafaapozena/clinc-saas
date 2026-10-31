import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { newRequestKey, type Coverage, type CoverageAccess, type Encounter } from '../lib/clinical';
import { errorMessage, fieldErrors, fieldMessage } from '../lib/errors';
import { useFormatters } from '../lib/format';
import { orgKeys, useOrg } from '../org/context';
import { Field, Notice } from './ui';

/** Durations offered for a grant (the API caps a grant at 90 days). */
const DURATIONS = [1, 3, 7, 14, 30, 90] as const;

export function CoverageStatusBadge({ status }: { status: Coverage['status'] }) {
  const { t } = useTranslation();
  return (
    <span className={`badge badge--coverage-${status}`} data-testid="coverage-status">
      {t(`coverage.status.${status}`)}
    </span>
  );
}

/**
 * Lets the treating doctor share this record — or all of their records for this patient — with
 * a colleague, read-only or with addenda, for a limited time and with a reason.
 */
export function ShareRecord({ encounter }: { encounter: Encounter }) {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [grantee, setGrantee] = useState('');
  const [scope, setScope] = useState<'encounter' | 'patient'>('encounter');
  const [access, setAccess] = useState<CoverageAccess>('read');
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(false);
  const key = useRef(newRequestKey());
  const candidates = useQuery({
    queryKey: orgKeys.coverageCandidates(orgId),
    queryFn: ({ signal }) =>
      api<{ data: { id: string; displayName: string; specialtyCode: string }[] }>(`/orgs/${orgId}/clinical/coverage/candidates`, { signal }).then(
        (r) => r.data,
      ),
    enabled: open,
    gcTime: 0,
  });
  const share = useMutation({
    mutationFn: () =>
      api<{ coverage: Coverage }>(`/orgs/${orgId}/clinical/coverage`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key.current },
        body: {
          granteePractitionerId: grantee,
          scope: scope === 'encounter' ? { type: 'encounter', encounterId: encounter.id } : { type: 'patient', patientId: encounter.patientId },
          access,
          expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
          reason,
        },
      }),
    onSuccess: async () => {
      setDone(true);
      setReason('');
      key.current = newRequestKey();
      await queryClient.invalidateQueries({ queryKey: orgKeys.coverage(orgId) });
    },
  });
  if (!can('clinical.coverage.grant')) return null;
  const fields = fieldErrors(share.error);
  // Any change is a new request (a retry of the same request keeps its key).
  const change =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setDone(false);
      key.current = newRequestKey();
    };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    share.mutate();
  };

  return (
    <section className="card" aria-labelledby="share-record-title">
      <div className="section-header">
        <h2 id="share-record-title">{t('coverage.shareTitle')}</h2>
        {!open && (
          <button type="button" className="button button--secondary" onClick={() => setOpen(true)}>
            {t('coverage.share')}
          </button>
        )}
      </div>
      <p className="muted small">{t('coverage.shareHint')}</p>
      {done && (
        <Notice kind="success">
          {t('coverage.shared')} <Link to={`/app/${orgId}/coverage`}>{t('coverage.manage')}</Link>
        </Notice>
      )}
      {open && (
        <form onSubmit={onSubmit} noValidate aria-labelledby="share-record-title">
          {share.isError && !fields.expiresAt && <Notice kind="error">{errorMessage(t, share.error)}</Notice>}
          <Field id="share-grantee" label={t('coverage.colleague')} error={fieldMessage(t, 'granteePractitionerId', fields.granteePractitionerId)}>
            <select id="share-grantee" value={grantee} onChange={(e) => change(setGrantee)(e.target.value)} required>
              <option value="">{t('common.choose')}</option>
              {candidates.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className="fieldset">
            <legend>{t('coverage.scopeLabel')}</legend>
            {(['encounter', 'patient'] as const).map((value) => (
              <label key={value} className="choice">
                <input type="radio" name="share-scope" value={value} checked={scope === value} onChange={() => change(setScope)(value)} />
                {t(`coverage.scope.${value}`)}
              </label>
            ))}
          </fieldset>
          <fieldset className="fieldset">
            <legend>{t('coverage.accessLabel')}</legend>
            {(['read', 'author'] as const).map((value) => (
              <label key={value} className="choice">
                <input type="radio" name="share-access" value={value} checked={access === value} onChange={() => change(setAccess)(value)} />
                {t(`coverage.access.${value}`)}
              </label>
            ))}
          </fieldset>
          <Field id="share-duration" label={t('coverage.duration')} error={fieldMessage(t, 'expiresAt', fields.expiresAt)}>
            <select id="share-duration" value={days} onChange={(e) => change(setDays)(Number(e.target.value))}>
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {t('coverage.days', { n: d })}
                </option>
              ))}
            </select>
          </Field>
          <Field id="share-reason" label={t('coverage.reason')} error={fieldMessage(t, 'coverageReason', fields.reason)}>
            <textarea id="share-reason" rows={2} maxLength={300} value={reason} onChange={(e) => change(setReason)(e.target.value)} required />
          </Field>
          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={share.isPending || !grantee}>
              {share.isPending ? t('common.saving') : t('coverage.grant')}
            </button>
            <button type="button" className="button button--secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** One grant, given or received. */
export function CoverageItem({ coverage, direction }: { coverage: Coverage; direction: 'granted' | 'received' }) {
  const { t } = useTranslation();
  const { orgId, timeZone } = useOrg();
  const fmt = useFormatters();
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState('');
  const zone = timeZone ?? 'UTC';
  const revoke = useMutation({
    mutationFn: () => api<{ coverage: Coverage }>(`/orgs/${orgId}/clinical/coverage/${coverage.id}/revoke`, { method: 'POST', body: { reason } }),
    onSuccess: async () => {
      setRevoking(false);
      await queryClient.invalidateQueries({ queryKey: orgKeys.coverage(orgId) });
    },
  });
  const live = coverage.status === 'active' || coverage.status === 'scheduled';
  const patient = coverage.scope.patient;
  const fields = fieldErrors(revoke.error);
  return (
    <li className="data-row" data-testid={`coverage-${direction}`}>
      <div className="data-main">
        <strong>{direction === 'granted' ? coverage.grantee.displayName : coverage.source.displayName}</strong>
        <span className="muted small">
          {patient ? `⁨${patient.fullName}⁩ (#${fmt.number(patient.patientNumber)})` : '—'} · {t(`coverage.scope.${coverage.scope.type}`)} ·{' '}
          {t(`coverage.access.${coverage.access}`)}
        </span>
        <span className="muted small">
          {t('coverage.until', { time: fmt.dateTime(coverage.expiresAt, zone) })} · {coverage.reason}
          {coverage.grantedVia === 'clinical_lead' && <> · {t('coverage.viaLead')}</>}
        </span>
      </div>
      <div className="data-meta">
        <CoverageStatusBadge status={coverage.status} />
      </div>
      <div className="row-actions">
        {direction === 'received' && coverage.status === 'active' && (
          <Link className="button button--secondary" to={`/app/${orgId}/coverage/${coverage.id}`}>
            {t('coverage.openRecords')}
          </Link>
        )}
        {direction === 'granted' && live && !revoking && (
          <button type="button" className="button button--danger-outline" onClick={() => setRevoking(true)}>
            {t('coverage.revoke')}
          </button>
        )}
      </div>
      {revoking && (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            revoke.mutate();
          }}
        >
          {revoke.isError && Object.keys(fields).length === 0 && <Notice kind="error">{errorMessage(t, revoke.error)}</Notice>}
          <Field id={`revoke-${coverage.id}`} label={t('coverage.revokeReason')} error={fieldMessage(t, 'revokeReason', fields.reason)}>
            <input id={`revoke-${coverage.id}`} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <button type="submit" className="button button--danger" disabled={revoke.isPending}>
            {t('coverage.confirmRevoke')}
          </button>
          <button type="button" className="button button--secondary" onClick={() => setRevoking(false)}>
            {t('common.cancel')}
          </button>
        </form>
      )}
    </li>
  );
}
