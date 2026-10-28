import { useMutation } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { Field, Notice } from '../components/ui';
import { describedBy } from '../lib/a11y';
import { api } from '../lib/api';
import { errorMessage, fieldErrors, fieldMessage } from '../lib/errors';
import { usePageMeta } from '../lib/pageMeta';
import { PHONE_COUNTRIES, type PhoneCountry } from '../lib/types';
import { FeatureList } from './shared';
import { useList } from './useList';
import { INQUIRY_INTERESTS, inquiryPath } from './solutions';

export function CustomSolutionsPage() {
  const { t } = useTranslation();
  usePageMeta({ title: t('site.custom.metaTitle'), description: t('site.custom.metaDescription'), path: '/custom-solutions' });
  const saas = useList('site.compare.saas.points');
  const ownership = useList('site.compare.ownership.points');
  const process = useList('site.custom.process');
  return (
    <>
      <section className="site-hero site-hero--compact" aria-labelledby="custom-title">
        <div className="site-container site-hero-inner">
          <h1 id="custom-title">{t('site.custom.title')}</h1>
          <p className="site-lead">{t('site.custom.lead')}</p>
          <div className="site-cta-row">
            <Link className="button button--primary button--large" to={inquiryPath('custom')} data-testid="custom-request">
              {t('site.cta.custom')}
            </Link>
          </div>
        </div>
      </section>
      <section className="site-section" aria-labelledby="difference-title">
        <div className="site-container">
          <h2 id="difference-title">{t('site.custom.differenceTitle')}</h2>
          <div className="site-compare">
            <section className="site-card site-card--saas" aria-labelledby="diff-saas">
              <h3 id="diff-saas">{t('site.compare.saas.title')}</h3>
              <FeatureList items={saas} />
            </section>
            <section className="site-card site-card--ownership" aria-labelledby="diff-ownership">
              <h3 id="diff-ownership">{t('site.compare.ownership.title')}</h3>
              <FeatureList items={ownership} />
            </section>
          </div>
        </div>
      </section>
      <section className="site-section site-section--muted" aria-labelledby="process-title">
        <div className="site-container site-narrow">
          <h2 id="process-title">{t('site.custom.processTitle')}</h2>
          <ol className="site-steps site-steps--compact">
            {process.map((item) => (
              <li key={item}>
                <p>{item}</p>
              </li>
            ))}
          </ol>
          <p className="site-planned-note">{t('site.custom.noPromise')}</p>
          <Link className="button button--primary" to={inquiryPath('custom')}>
            {t('site.cta.custom')}
          </Link>
        </div>
      </section>
    </>
  );
}

const COUNTRIES = ['EG', 'SA', 'other'] as const;
const ORGANIZATION_TYPES = ['clinic', 'medical_center', 'multi_branch', 'other'] as const;

type InquiryForm = {
  contactName: string;
  organizationName: string;
  country: (typeof COUNTRIES)[number] | '';
  phoneCountry: PhoneCountry;
  phone: string;
  email: string;
  organizationType: (typeof ORGANIZATION_TYPES)[number] | '';
  interest: string;
  description: string;
};

export function InquiryPage() {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  usePageMeta({ title: t('site.inquiry.metaTitle'), description: t('site.inquiry.metaDescription'), path: '/custom-solutions/request' });
  const preset = params.get('interest');
  const initial: InquiryForm = {
    contactName: '',
    organizationName: '',
    country: '',
    phoneCountry: 'EG',
    phone: '',
    email: '',
    organizationType: '',
    interest: preset && (INQUIRY_INTERESTS as readonly string[]).includes(preset) ? preset : '',
    description: '',
  };
  const [form, setForm] = useState<InquiryForm>(initial);
  // One key per submission attempt: a retry or double click stores the request once.
  const submissionKey = useRef(crypto.randomUUID());

  const send = useMutation({
    mutationFn: () =>
      api<{ reference: string }>('/public/ownership-inquiries', {
        method: 'POST',
        headers: { 'Idempotency-Key': submissionKey.current },
        body: {
          contactName: form.contactName,
          organizationName: form.organizationName,
          country: form.country,
          phone: form.phone.trim() ? { country: form.phoneCountry, number: form.phone } : undefined,
          email: form.email.trim() || undefined,
          organizationType: form.organizationType,
          interest: form.interest,
          description: form.description,
          language: i18n.resolvedLanguage === 'en' ? 'en' : 'ar',
        },
      }),
  });

  const fields = fieldErrors(send.error);
  const message = (field: string, key = field) => fieldMessage(t, `inquiry.${key}`, fields[field]);
  const errors = {
    contactName: message('contactName'),
    organizationName: message('organizationName'),
    country: message('country'),
    phone: message('phone.number', 'phone') ?? message('phone.country', 'phone'),
    email: message('email'),
    contact: message('contact'),
    organizationType: message('organizationType'),
    interest: message('interest'),
    description: message('description'),
  };
  const hasFieldErrors = Object.keys(fields).length > 0;
  const update = (key: keyof InquiryForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send.mutate();
  };

  if (send.isSuccess) {
    return (
      <section className="site-section" aria-labelledby="inquiry-done">
        <div className="site-container site-narrow">
          <div className="site-card site-card--success" role="status" data-testid="inquiry-success">
            <h1 id="inquiry-done">{t('site.inquiry.successTitle')}</h1>
            <p>{t('site.inquiry.successBody', { reference: send.data.reference })}</p>
            <p className="site-reference" dir="ltr" data-testid="inquiry-reference">
              {send.data.reference}
            </p>
            <div className="site-cta-row">
              <Link className="button button--secondary" to="/">
                {t('site.inquiry.backHome')}
              </Link>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  submissionKey.current = crypto.randomUUID();
                  setForm(initial);
                  send.reset();
                }}
              >
                {t('site.inquiry.another')}
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="site-section" aria-labelledby="inquiry-title">
      <div className="site-container site-narrow">
        <h1 id="inquiry-title">{t('site.inquiry.title')}</h1>
        <p className="site-section-lead">{t('site.inquiry.lead')}</p>
        <Notice kind="info">{t('site.inquiry.privacy')}</Notice>
        {send.isError && <Notice kind="error">{hasFieldErrors ? t('errors.VALIDATION_ERROR') : errorMessage(t, send.error)}</Notice>}
        <form className="site-form card" onSubmit={onSubmit} noValidate>
          <Field id="inquiry-name" label={t('site.inquiry.contactName')} error={errors.contactName}>
            <input id="inquiry-name" autoComplete="name" required maxLength={80} value={form.contactName} onChange={update('contactName')} {...describedBy('inquiry-name', errors.contactName)} />
          </Field>
          <Field id="inquiry-org" label={t('site.inquiry.organizationName')} error={errors.organizationName}>
            <input id="inquiry-org" autoComplete="organization" required maxLength={120} value={form.organizationName} onChange={update('organizationName')} {...describedBy('inquiry-org', errors.organizationName)} />
          </Field>
          <div className="form-row">
            <Field id="inquiry-country" label={t('site.inquiry.country')} error={errors.country}>
              <select id="inquiry-country" required value={form.country} onChange={update('country')} {...describedBy('inquiry-country', errors.country)}>
                <option value="">{t('common.choose')}</option>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`site.inquiry.countries.${c}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="inquiry-type" label={t('site.inquiry.organizationType')} error={errors.organizationType}>
              <select id="inquiry-type" required value={form.organizationType} onChange={update('organizationType')} {...describedBy('inquiry-type', errors.organizationType)}>
                <option value="">{t('common.choose')}</option>
                {ORGANIZATION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`site.inquiry.types.${type}`)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <fieldset className="site-fieldset" aria-describedby="inquiry-contact-hint">
            <legend>{t('site.inquiry.contactTitle')}</legend>
            <p className="field-hint" id="inquiry-contact-hint">
              {t('site.inquiry.contactHint')}
            </p>
            {errors.contact && (
              <p className="field-error" role="alert">
                {errors.contact}
              </p>
            )}
            <div className="form-row">
              <Field id="inquiry-phone-country" label={t('site.inquiry.phoneCountry')}>
                <select id="inquiry-phone-country" value={form.phoneCountry} onChange={update('phoneCountry')}>
                  {PHONE_COUNTRIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`countries.${c}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="inquiry-phone" label={`${t('site.inquiry.phone')} ${t('common.optional')}`} error={errors.phone}>
                <input id="inquiry-phone" type="tel" inputMode="tel" dir="ltr" autoComplete="tel" maxLength={30} value={form.phone} onChange={update('phone')} {...describedBy('inquiry-phone', errors.phone)} />
              </Field>
            </div>
            <Field id="inquiry-email" label={`${t('site.inquiry.email')} ${t('common.optional')}`} error={errors.email}>
              <input id="inquiry-email" type="email" dir="ltr" autoComplete="email" maxLength={254} value={form.email} onChange={update('email')} {...describedBy('inquiry-email', errors.email)} />
            </Field>
          </fieldset>
          <Field id="inquiry-interest" label={t('site.inquiry.interest')} error={errors.interest}>
            <select id="inquiry-interest" required value={form.interest} onChange={update('interest')} {...describedBy('inquiry-interest', errors.interest)}>
              <option value="">{t('common.choose')}</option>
              {INQUIRY_INTERESTS.map((interest) => (
                <option key={interest} value={interest}>
                  {t(`site.inquiry.interests.${interest}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="inquiry-description" label={t('site.inquiry.description')} error={errors.description} hint={t('site.inquiry.descriptionHint')}>
            <textarea
              id="inquiry-description"
              required
              rows={6}
              maxLength={1500}
              value={form.description}
              onChange={update('description')}
              {...describedBy('inquiry-description', errors.description, t('site.inquiry.descriptionHint'))}
            />
          </Field>
          <button type="submit" className="button button--primary button--block" disabled={send.isPending}>
            {send.isPending ? t('site.inquiry.submitting') : t('site.inquiry.submit')}
          </button>
        </form>
      </div>
    </section>
  );
}
