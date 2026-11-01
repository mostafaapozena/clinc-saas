import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useSession } from '../auth/session';
import { Icon, type IconName } from '../components/Icon';
import { Field, Notice } from '../components/ui';
import { describedBy, useFocusOnError } from '../lib/a11y';
import { api } from '../lib/api';
import { errorMessage, fieldErrors, fieldMessage } from '../lib/errors';
import { usePageMeta } from '../lib/pageMeta';
import { PHONE_COUNTRIES, type PhoneCountry } from '../lib/types';
import { Breadcrumb, IconTile } from './shared';
import { SPECIALTY_SOLUTION_CODES, inquiryPath } from './solutions';
import { ActionBar } from '../components/layout';

const INTENTS = ['demo', 'question', 'other'] as const;
type Intent = (typeof INTENTS)[number];
type ContactForm = {
  intent: Intent;
  contactName: string;
  email: string;
  phoneCountry: PhoneCountry;
  phone: string;
  organizationName: string;
  specialty: string;
  message: string;
};
const EMPTY: ContactForm = { intent: 'demo', contactName: '', email: '', phoneCountry: 'EG', phone: '', organizationName: '', specialty: '', message: '' };
/** Fields of the first step: server errors on these send the visitor back to it. */
const STEP_ONE = ['intent', 'contactName', 'email', 'phone.number', 'phone.country', 'contact'];

type SupportContact = { email: string | null; phone: string | null; hours: string | null };

/**
 * The public contact page: general questions and demo requests, stored with a reference and
 * reviewed in the operator console. Custom projects have their own request form; customers use
 * support inside their workspace. Nothing here sends an email.
 */
export function ContactPage() {
  const { t, i18n } = useTranslation();
  usePageMeta({ title: t('site.contact.metaTitle'), description: t('site.contact.metaDescription'), path: '/contact' });
  const signedIn = Boolean(useSession().data);
  const [form, setForm] = useState<ContactForm>(EMPTY);
  const [step, setStep] = useState<1 | 2>(1);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  // One key per submission attempt: a retry or double click stores the message once.
  const submissionKey = useRef(crypto.randomUUID());
  const formRef = useRef<HTMLDivElement>(null);
  const contact = useQuery({
    queryKey: ['public', 'support-contact'],
    queryFn: ({ signal }) => api<{ contact: SupportContact }>('/public/support-contact', { signal }).then((r) => r.contact),
    staleTime: 600_000,
  });

  const send = useMutation({
    mutationFn: () =>
      api<{ reference: string }>('/public/contact-messages', {
        method: 'POST',
        headers: { 'Idempotency-Key': submissionKey.current },
        body: {
          intent: form.intent,
          contactName: form.contactName,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() ? { country: form.phoneCountry, number: form.phone } : undefined,
          organizationName: form.organizationName.trim() || undefined,
          specialty: form.specialty || undefined,
          message: form.message,
          language: i18n.resolvedLanguage === 'en' ? 'en' : 'ar',
        },
      }),
    onError: (error) => {
      if (Object.keys(fieldErrors(error)).some((field) => STEP_ONE.includes(field))) setStep(1);
    },
  });
  const fields = { ...fieldErrors(send.error), ...localErrors };
  useFocusOnError(formRef, Object.keys(localErrors).length ? localErrors : send.error);
  const message = (field: string, key = field, value?: string) => fieldMessage(t, `contact.${key}`, fields[field], value);
  const errors = {
    contactName: message('contactName', 'contactName', form.contactName),
    email: message('email'),
    phone: message('phone.number', 'phone') ?? message('phone.country', 'phone'),
    contact: message('contact'),
    organizationName: message('organizationName'),
    specialty: message('specialty'),
    message: message('message', 'message', form.message),
  };
  const update = (key: keyof ContactForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const next = (event: FormEvent) => {
    event.preventDefault();
    const missing: Record<string, string> = {};
    if (form.contactName.trim().length < 2) missing.contactName = 'too_short';
    if (!form.email.trim() && !form.phone.trim()) missing.contact = 'contact_required';
    setLocalErrors(missing);
    if (Object.keys(missing).length === 0) setStep(2);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (form.message.trim().length < 10) {
      setLocalErrors({ message: 'too_short' });
      return;
    }
    setLocalErrors({});
    send.mutate();
  };

  if (send.isSuccess) {
    return (
      <>
        <Breadcrumb items={[{ label: t('site.nav.contact') }]} />
        <section className="site-section site-section--light" aria-labelledby="contact-done">
          <div className="site-container site-narrow">
            <div className="site-card site-card--success" role="status" data-testid="contact-success">
              <h1 id="contact-done">{t('site.contact.successTitle')}</h1>
              <p>{t('site.contact.successBody')}</p>
              <p className="site-reference" dir="ltr" data-testid="contact-reference">
                {send.data.reference}
              </p>
              <p>{t('site.contact.successNoEmail')}</p>
              <div className="site-cta-row">
                <Link className="button button--secondary" to="/">
                  {t('site.inquiry.backHome')}
                </Link>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => {
                    submissionKey.current = crypto.randomUUID();
                    setForm(EMPTY);
                    setStep(1);
                    send.reset();
                  }}
                >
                  {t('site.contact.another')}
                </button>
              </div>
            </div>
          </div>
        </section>
      </>
    );
  }

  const channels: { icon: IconName; label: string; value: string; href?: string }[] = [];
  if (contact.data?.email) channels.push({ icon: 'mail', label: t('site.contact.channels.email'), value: contact.data.email, href: `mailto:${contact.data.email}` });
  if (contact.data?.phone) channels.push({ icon: 'phone', label: t('site.contact.channels.phone'), value: contact.data.phone, href: `tel:${contact.data.phone.replace(/[^\d+]/g, '')}` });
  if (contact.data?.hours) channels.push({ icon: 'clock', label: t('site.contact.channels.hours'), value: contact.data.hours });

  return (
    <>
      <Breadcrumb items={[{ label: t('site.nav.contact') }]} />
      <section className="site-hero site-hero--page" aria-labelledby="contact-title">
        <div className="site-container site-hero-center">
          <p className="site-eyebrow">{t('site.contact.eyebrow')}</p>
          <h1 id="contact-title">{t('site.contact.title')}</h1>
          <p className="site-lead">{t('site.contact.lead')}</p>
        </div>
      </section>
      <section className="site-section site-section--light" aria-label={t('site.contact.formLabel')}>
        <div className="site-container site-contact">
          <aside className="site-stack" aria-label={t('site.contact.infoLabel')}>
            <div className="site-card">
              <ul className="site-info-list">
                {channels.map((c) => (
                  <li key={c.label}>
                    <IconTile name={c.icon} size="sm" />
                    <div>
                      <strong>{c.label}</strong>
                      {c.href ? (
                        <a href={c.href} dir="ltr">
                          {c.value}
                        </a>
                      ) : (
                        <span>{c.value}</span>
                      )}
                    </div>
                  </li>
                ))}
                {contact.isSuccess && channels.length === 0 && (
                  <li data-testid="contact-no-channels">
                    <IconTile name="message" size="sm" />
                    <div>
                      <strong>{t('site.contact.noChannelsTitle')}</strong>
                      <p>{t('site.contact.noChannelsBody')}</p>
                    </div>
                  </li>
                )}
                <li>
                  <IconTile name="clock" size="sm" />
                  <div>
                    <strong>{t('site.contact.nextTitle')}</strong>
                    <p>{t('site.contact.nextBody')}</p>
                  </div>
                </li>
              </ul>
            </div>
            <div className="site-card">
              <IconTile name="help" />
              <h2 className="site-card-title">{t('site.contact.customersTitle')}</h2>
              <p>{t('site.contact.customersBody')}</p>
              <Link className="site-link-arrow" to={signedIn ? '/app' : '/login'}>
                {signedIn ? t('site.nav.goToWorkspace') : t('site.contact.customersLink')} <Icon name="arrowForward" />
              </Link>
            </div>
            <div className="site-card site-card--custom tone-custom">
              <IconTile name="scan" tone="custom" />
              <h2 className="site-card-title">{t('site.contact.customTitle')}</h2>
              <p>{t('site.contact.customBody')}</p>
              <Link className="site-link-arrow" to={inquiryPath('custom')}>
                {t('site.cta.custom')} <Icon name="arrowForward" />
              </Link>
            </div>
          </aside>

          <div className="site-contact-form site-stack" ref={formRef}>
            <Notice kind="info">{t('site.inquiry.privacy')}</Notice>
            {send.isError && <Notice kind="error">{Object.keys(fieldErrors(send.error)).length ? t('errors.VALIDATION_ERROR') : errorMessage(t, send.error)}</Notice>}
            <form className="site-form card site-stepper" onSubmit={step === 1 ? next : submit} noValidate aria-labelledby="contact-title" data-testid="contact-form">
              <div className="site-progress" aria-hidden="true">
                <span data-step={step} />
              </div>
              <div className="site-step-tabs">
                <span aria-current={step === 1 ? 'step' : undefined}>{t('site.contact.steps.contact')}</span>
                <span aria-current={step === 2 ? 'step' : undefined}>{t('site.contact.steps.message')}</span>
              </div>
              <p className="muted small" aria-live="polite">
                {t('site.contact.stepOf', { step, total: 2 })}
              </p>

              {step === 1 ? (
                <>
                  <fieldset className="site-intents">
                    <legend>{t('site.contact.intentLegend')}</legend>
                    {INTENTS.map((intent) => (
                      <label key={intent} className="site-intent">
                        <input type="radio" name="intent" value={intent} checked={form.intent === intent} onChange={() => setForm((f) => ({ ...f, intent }))} />
                        {t(`site.contact.intents.${intent}`)}
                      </label>
                    ))}
                  </fieldset>
                  <Field id="contact-name" label={t('site.inquiry.contactName')} error={errors.contactName} required>
                    <input id="contact-name" autoComplete="name" required maxLength={80} value={form.contactName} onChange={update('contactName')} {...describedBy('contact-name', errors.contactName)} />
                  </Field>
                  <fieldset className="site-fieldset" aria-describedby="contact-hint">
                    <legend>{t('site.inquiry.contactTitle')}</legend>
                    <p className="field-hint" id="contact-hint">
                      {t('site.inquiry.contactHint')}
                    </p>
                    {errors.contact && (
                      <p className="field-error" role="alert">
                        {errors.contact}
                      </p>
                    )}
                    <Field id="contact-email" label={`${t('site.inquiry.email')} ${t('common.optional')}`} error={errors.email}>
                      <input id="contact-email" type="email" dir="ltr" autoComplete="email" maxLength={254} value={form.email} onChange={update('email')} {...describedBy('contact-email', errors.email)} />
                    </Field>
                    <div className="form-row">
                      <Field id="contact-phone-country" label={t('site.inquiry.phoneCountry')}>
                        <select id="contact-phone-country" value={form.phoneCountry} onChange={update('phoneCountry')}>
                          {PHONE_COUNTRIES.map((c) => (
                            <option key={c} value={c}>
                              {t(`countries.${c}`)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field id="contact-phone" label={`${t('site.inquiry.phone')} ${t('common.optional')}`} error={errors.phone}>
                        <input id="contact-phone" type="tel" inputMode="tel" dir="ltr" autoComplete="tel" maxLength={30} value={form.phone} onChange={update('phone')} {...describedBy('contact-phone', errors.phone)} />
                      </Field>
                    </div>
                  </fieldset>
                  <ActionBar>
                    <span />
                    <button type="submit" className="button button--primary button--large">
                      {t('site.contact.next')} <Icon name="arrowForward" />
                    </button>
                  </ActionBar>
                </>
              ) : (
                <>
                  <div className="form-row">
                    <Field id="contact-org" label={`${t('site.inquiry.organizationName')} ${t('common.optional')}`} error={errors.organizationName}>
                      <input id="contact-org" autoComplete="organization" maxLength={120} value={form.organizationName} onChange={update('organizationName')} {...describedBy('contact-org', errors.organizationName)} />
                    </Field>
                    <Field id="contact-specialty" label={`${t('site.contact.specialty')} ${t('common.optional')}`} error={errors.specialty}>
                      <select id="contact-specialty" value={form.specialty} onChange={update('specialty')} {...describedBy('contact-specialty', errors.specialty)}>
                        <option value="">{t('common.choose')}</option>
                        {[...SPECIALTY_SOLUTION_CODES, 'multi_specialty'].map((code) => (
                          <option key={code} value={code}>
                            {t(`site.inquiry.interests.${code}`)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field id="contact-message" label={t('site.contact.message')} error={errors.message} hint={t('site.contact.messageHint')} required>
                    <textarea
                      id="contact-message"
                      required
                      rows={6}
                      maxLength={1500}
                      value={form.message}
                      onChange={update('message')}
                      {...describedBy('contact-message', errors.message, t('site.contact.messageHint'))}
                    />
                  </Field>
                  <ActionBar>
                    <button type="button" className="button button--ghost" onClick={() => setStep(1)}>
                      <Icon name="arrowBack" /> {t('site.contact.back')}
                    </button>
                    <button type="submit" className="button button--primary button--large" disabled={send.isPending}>
                      {send.isPending ? t('site.inquiry.submitting') : t('site.contact.submit')}
                    </button>
                  </ActionBar>
                </>
              )}
            </form>
          </div>
        </div>
      </section>
    </>
  );
}
