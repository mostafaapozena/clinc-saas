import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/PageHeader';
import { ErrorState, Field, Loading, Notice } from '../components/ui';
import { useFocusOnError } from '../lib/a11y';
import { errorMessage } from '../lib/errors';
import { moneyInput, parseMoney, toLatinDigits } from '../lib/finance';
import { opApi, opKeys, planName, type Plan, type PlanLimits, type PlanPrice } from '../lib/operator';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { PriceText } from '../components/subscription';
import { ActionBar } from '../components/layout';
import { useOperator } from './shared';

// --- Plans -----------------------------------------------------------------------------------

type PlanDraft = {
  code: string;
  nameAr: string;
  nameEn: string;
  prices: { currency: 'EGP' | 'SAR'; interval: 'month' | 'year'; amount: string }[];
  limits: Record<keyof PlanLimits, string>;
  note: string;
  trialDays: string;
};

const emptyDraft: PlanDraft = {
  code: '',
  nameAr: '',
  nameEn: '',
  prices: [],
  limits: { branches: '', practitioners: '', members: '' },
  note: '',
  trialDays: '',
};

const toDraft = (p: Plan): PlanDraft => ({
  code: p.code,
  nameAr: p.name.ar,
  nameEn: p.name.en,
  prices: p.prices.map((x) => ({ currency: x.currency, interval: x.interval, amount: moneyInput(x.amountMinor) })),
  limits: {
    branches: p.limits.branches?.toString() ?? '',
    practitioners: p.limits.practitioners?.toString() ?? '',
    members: p.limits.members?.toString() ?? '',
  },
  note: p.note ?? '',
  trialDays: p.trialDays?.toString() ?? '',
});

function PlanForm({ initial, plan, onDone }: { initial: PlanDraft; plan?: Plan; onDone: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [d, setD] = useState(initial);
  const [localError, setLocalError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const save = useMutation({
    mutationFn: (body: object) =>
      plan
        ? opApi(`/plans/${plan.id}`, { method: 'PATCH', body: { ...body, revision: plan.revision } })
        : opApi('/plans', { method: 'POST', body: { ...body, code: d.code } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: opKeys.plans });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const prices: PlanPrice[] = [];
    for (const p of d.prices) {
      const amountMinor = parseMoney(p.amount);
      if (amountMinor === null) return setLocalError(t('operator.plans.badAmount'));
      prices.push({ currency: p.currency, interval: p.interval, amountMinor });
    }
    // Arabic-Indic digits are accepted ("٣٥" → 35), as in money amounts.
    const limit = (v: string) => (v.trim() === '' ? null : Number(toLatinDigits(v.trim())));
    const limits = { branches: limit(d.limits.branches), practitioners: limit(d.limits.practitioners), members: limit(d.limits.members) };
    if (Object.values(limits).some((v) => v !== null && (!Number.isInteger(v) || v < 0))) return setLocalError(t('operator.plans.badLimit'));
    const trialDays = d.trialDays.trim() === '' ? null : Number(toLatinDigits(d.trialDays.trim()));
    if (trialDays !== null && (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 365)) return setLocalError(t('operator.plans.badTrial'));
    setLocalError(null);
    save.mutate({ name: { ar: d.nameAr, en: d.nameEn }, prices, limits, note: d.note, trialDays });
  };
  useFocusOnError(formRef, localError ?? save.error);
  return (
    <form className="stack-sm" onSubmit={submit} data-testid="plan-form" ref={formRef}>
      {(localError || save.isError) && <Notice kind="error">{localError ?? errorMessage(t, save.error)}</Notice>}
      <div className="form-grid">
        {!plan && (
          <Field id="plan-code" label={t('operator.plans.code')} hint={t('operator.plans.codeHint')} required>
            <input id="plan-code" dir="ltr" value={d.code} onChange={(e) => setD({ ...d, code: e.target.value })} required />
          </Field>
        )}
        <Field id="plan-name-ar" label={t('operator.plans.nameAr')} required>
          <input id="plan-name-ar" value={d.nameAr} onChange={(e) => setD({ ...d, nameAr: e.target.value })} required />
        </Field>
        <Field id="plan-name-en" label={t('operator.plans.nameEn')} required>
          <input id="plan-name-en" dir="ltr" value={d.nameEn} onChange={(e) => setD({ ...d, nameEn: e.target.value })} required />
        </Field>
      </div>
      <fieldset className="fieldset">
        <legend>{t('operator.plans.prices')}</legend>
        <p className="muted small">{t('operator.plans.pricesHint')}</p>
        {d.prices.map((p, i) => (
          <div className="form-row" key={i}>
            <select
              aria-label={t('operator.plans.currency')}
              value={p.currency}
              onChange={(e) => setD({ ...d, prices: d.prices.map((x, j) => (j === i ? { ...x, currency: e.target.value as 'EGP' | 'SAR' } : x)) })}
            >
              <option value="EGP">EGP</option>
              <option value="SAR">SAR</option>
            </select>
            <select
              aria-label={t('operator.plans.interval')}
              value={p.interval}
              onChange={(e) => setD({ ...d, prices: d.prices.map((x, j) => (j === i ? { ...x, interval: e.target.value as 'month' | 'year' } : x)) })}
            >
              <option value="month">{t('subscription.interval.month')}</option>
              <option value="year">{t('subscription.interval.year')}</option>
            </select>
            <input
              aria-label={t('operator.plans.amount')}
              inputMode="decimal"
              dir="ltr"
              value={p.amount}
              onChange={(e) => setD({ ...d, prices: d.prices.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })}
            />
            <button type="button" className="button button--ghost" onClick={() => setD({ ...d, prices: d.prices.filter((_, j) => j !== i) })}>
              {t('operator.plans.removePrice')}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button button--secondary"
          onClick={() => setD({ ...d, prices: [...d.prices, { currency: 'EGP', interval: 'month', amount: '' }] })}
        >
          {t('operator.plans.addPrice')}
        </button>
      </fieldset>
      <fieldset className="fieldset">
        <legend>{t('operator.plans.limits')}</legend>
        <p className="muted small">{t('operator.plans.limitsHint')}</p>
        <div className="form-grid">
          {(['branches', 'practitioners', 'members'] as const).map((r) => (
            <Field key={r} id={`plan-limit-${r}`} label={t(`subscription.resource.${r}`)}>
              <input
                id={`plan-limit-${r}`}
                inputMode="numeric"
                dir="ltr"
                value={d.limits[r]}
                onChange={(e) => setD({ ...d, limits: { ...d.limits, [r]: e.target.value } })}
              />
            </Field>
          ))}
        </div>
      </fieldset>
      <Field id="plan-trial" label={t('operator.plans.trialDays')} hint={t('operator.plans.trialHint')}>
        <input id="plan-trial" inputMode="numeric" dir="ltr" value={d.trialDays} onChange={(e) => setD({ ...d, trialDays: e.target.value })} />
      </Field>
      <Field id="plan-note" label={t('operator.plans.note')}>
        <input id="plan-note" value={d.note} maxLength={500} onChange={(e) => setD({ ...d, note: e.target.value })} />
      </Field>
      <ActionBar>
        <button type="submit" className="button button--primary" disabled={save.isPending}>
          {t('operator.plans.saveDraft')}
        </button>
        <button type="button" className="button button--ghost" onClick={onDone}>
          {t('common.cancel')}
        </button>
      </ActionBar>
    </form>
  );
}

export function OperatorPlansPage() {
  const { t, i18n } = useTranslation();
  const operator = useOperator();
  const queryClient = useQueryClient();
  useDocumentTitle(t('operator.nav.plans'));
  const plans = useQuery({ queryKey: opKeys.plans, queryFn: ({ signal }) => opApi<{ data: Plan[] }>('/plans', { signal }) });
  const [editing, setEditing] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'retire' | 'new-version' }) =>
      opApi(`/plans/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: opKeys.plans }),
  });
  const manage = operator.can('platform.plans.manage');
  return (
    <>
      <PageHeader title={t('operator.nav.plans')} subtitle={t('operator.plans.subtitle')}>
        {manage && editing !== 'new' && (
          <button type="button" className="button button--primary" onClick={() => setEditing('new')}>
            {t('operator.plans.create')}
          </button>
        )}
      </PageHeader>
      <Notice kind="info">{t('operator.plans.noInventedTerms')}</Notice>
      {act.isError && <Notice kind="error">{errorMessage(t, act.error)}</Notice>}
      {editing === 'new' && (
        <section className="card">
          <h2>{t('operator.plans.create')}</h2>
          <PlanForm initial={emptyDraft} onDone={() => setEditing(null)} />
        </section>
      )}
      {plans.isPending && <Loading />}
      {plans.isError && <ErrorState message={errorMessage(t, plans.error)} onRetry={() => void plans.refetch()} />}
      {plans.isSuccess && (
        <ul className="data-list" data-testid="plans">
          {plans.data.data.map((p) => (
            <li key={p.id} className="data-row">
              <div className="data-main">
                <strong>{planName(p, i18n.resolvedLanguage ?? 'ar')}</strong>{' '}
                <span className="muted small" dir="ltr">
                  {p.code} v{p.version}
                </span>{' '}
                <span className={`badge badge--plan-status-${p.status}`}>{t(`operator.plans.status.${p.status}`)}</span>
                {/* One price per line: a "·" between two Arabic amounts read as part of the numbers. */}
                <p className="muted small">
                  {p.prices.length === 0
                    ? t('subscription.noPrice')
                    : p.prices.map((x) => (
                        <span key={`${x.currency}${x.interval}`} className="block">
                          <PriceText price={x} />
                        </span>
                      ))}
                </p>
                {p.note && (
                  <p className="muted small">
                    {t('operator.plans.noteLabel')}: <span dir="auto">{p.note}</span>
                  </p>
                )}
                {editing === p.id && <PlanForm initial={toDraft(p)} plan={p} onDone={() => setEditing(null)} />}
              </div>
              {manage && editing !== p.id && (
                <div className="row-actions">
                  {p.status === 'draft' && (
                    <>
                      <button type="button" className="button button--secondary" onClick={() => setEditing(p.id)}>
                        {t('operator.plans.edit')}
                      </button>
                      <button
                        type="button"
                        className="button button--primary"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ id: p.id, action: 'activate' })}
                      >
                        {t('operator.plans.activate')}
                      </button>
                    </>
                  )}
                  {p.status === 'active' && (
                    <>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ id: p.id, action: 'new-version' })}
                      >
                        {t('operator.plans.newVersion')}
                      </button>
                      <button
                        type="button"
                        className="button button--ghost"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ id: p.id, action: 'retire' })}
                      >
                        {t('operator.plans.retire')}
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
