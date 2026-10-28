import { useMutation } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { Field, Notice } from '../components/ui';
import { describedBy, useFocusOnError } from '../lib/a11y';
import { api } from '../lib/api';
import { errorMessage, fieldErrors, fieldMessage } from '../lib/errors';
import { usePageMeta } from '../lib/pageMeta';
import { PHONE_COUNTRIES, type PhoneCountry } from '../lib/types';
import { Breadcrumb, CardGrid, CtaBlock, Faq, FeatureList, IconTile, SaasOwnershipComparison, SectionHeader, Steps } from './shared';
import { useList, useObjects, type QuestionItem, type TitledItem } from './useList';
import { INQUIRY_INTERESTS, inquiryPath } from './solutions';

export function CustomSolutionsPage() {
  const { t } = useTranslation();
  usePageMeta({ title: t('site.custom.metaTitle'), description: t('site.custom.metaDescription'), path: '/custom-solutions' });
  const uses = useObjects<TitledItem>('site.custom.uses', ['title', 'body']);
  const steps = useObjects<TitledItem>('site.custom.steps', ['title', 'body']);
  const faq = useObjects<QuestionItem>('site.custom.faq', ['q', 'a']);
  const forPoints = useList('site.custom.forPoints');
  return (
    <div className="tone-custom">
      <Breadcrumb items={[{ label: t('site.custom.title') }]} />
      <section className="site-hero site-hero--page" aria-labelledby="custom-title">
        <div className="site-container site-hero-grid">
          <div className="site-hero-text">
            <p className="site-pill site-pill--tone">{t('site.solutions.customCard.badge')}</p>
            <h1 id="custom-title">{t('site.custom.title')}</h1>
            <p className="site-lead">{t('site.custom.lead')}</p>
            <div className="site-cta-row">
              <Link className="button button--primary button--large" to={inquiryPath('custom')} data-testid="custom-request">
                {t('site.cta.custom')}
              </Link>
              <Link className="button button--secondary button--large" to="/solutions">
                {t('site.custom.seeSaas')}
              </Link>
            </div>
          </div>
          <div className="site-card site-card--custom">
            <IconTile name="scan" tone="custom" size="lg" />
            <h2 className="site-card-title">{t('site.custom.forTitle')}</h2>
            <FeatureList items={forPoints} />
          </div>
        </div>
      </section>
      <section className="site-section" aria-labelledby="uses-title">
        <div className="site-container">
          <SectionHeader id="uses-title" eyebrow={t('site.custom.usesEyebrow')} title={t('site.custom.usesTitle')} />
          <CardGrid items={uses} columns={3} icon="scan" tone="custom" />
        </div>
      </section>
      <section className="site-section site-section--light" aria-labelledby="process-title">
        <div className="site-container">
          <SectionHeader id="process-title" center eyebrow={t('site.custom.processEyebrow')} title={t('site.custom.processTitle')} />
          <Steps items={steps} tone="custom" />
          <p className="site-center-link">{t('site.custom.noPromise')}</p>
        </div>
      </section>
      <section className="site-section" aria-labelledby="difference-title">
        <div className="site-container">
          <SectionHeader id="difference-title" center eyebrow={t('site.compare.eyebrow')} title={t('site.custom.differenceTitle')} />
          <SaasOwnershipComparison interest="custom" />
        </div>
      </section>
      <section className="site-section site-section--mint" aria-labelledby="custom-faq-title">
        <div className="site-container site-narrow">
          <SectionHeader id="custom-faq-title" center eyebrow={t('site.home.faqEyebrow')} title={t('site.custom.faqTitle')} />
          <Faq items={faq} />
        </div>
      </section>
      <CtaBlock title={t('site.custom.closingTitle')} body={t('site.custom.closingBody')}>
        <Link className="button button--accent button--large" to={inquiryPath('custom')}>
          {t('site.cta.custom')}
        </Link>
        <Link className="button button--on-navy button--large" to="/contact">
          {t('site.nav.contact')}
        </Link>
      </CtaBlock>
    </div>
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
  const processSteps = useObjects<TitledItem>('site.custom.steps', ['title', 'body']).map((s) => s.title);
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
  const formRef = useRef<HTMLDivElement>(null);
  useFocusOnError(formRef, send.error);
  const message = (field: string, key = field, value?: string) => fieldMessage(t, `inquiry.${key}`, fields[field], value);
  const errors = {
    contactName: message('contactName', 'contactName', form.contactName),
    organizationName: message('organizationName', 'organizationName', form.organizationName),
    country: message('country', 'country', form.country),
    phone: message('phone.number', 'phone') ?? message('phone.country', 'phone'),
    email: message('email'),
    contact: message('contact'),
    organizationType: message('organizationType', 'organizationType', form.organizationType),
    interest: message('interest', 'interest', form.interest),
    description: message('description', 'description', form.description),
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
    <>
    <Breadcrumb items={[{ to: '/custom-solutions', label: t('site.custom.title') }, { label: t('site.inquiry.title') }]} />
    <section className="site-section site-section--light tone-custom" aria-labelledby="inquiry-title">
      <div className="site-container site-contact" ref={formRef}>
        <aside className="site-stack">
          <div className="site-stack-sm">
            <p className="site-pill site-pill--tone">{t('site.solutions.customCard.badge')}</p>
            <h1 id="inquiry-title">{t('site.inquiry.title')}</h1>
            <p className="site-lead">{t('site.inquiry.lead')}</p>
          </div>
          <div className="site-card">
            <h2 className="site-card-title">{t('site.custom.processTitle')}</h2>
            <FeatureList items={processSteps} compact />
            <p>{t('site.custom.noPromise')}</p>
          </div>
        </aside>
        <div className="site-contact-form site-stack">
        <Notice kind="info">{t('site.inquiry.privacy')}</Notice>
        {send.isError && <Notice kind="error">{hasFieldErrors ? t('errors.VALIDATION_ERROR') : errorMessage(t, send.error)}</Notice>}
        <form className="site-form card" onSubmit={onSubmit} noValidate aria-labelledby="inquiry-title">
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
      </div>
    </section>
    </>
  );
}
