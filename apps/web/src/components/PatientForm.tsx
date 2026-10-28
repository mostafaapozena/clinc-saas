import { useTranslation } from 'react-i18next';
import { describedBy } from '../lib/a11y';
import { fieldMessage } from '../lib/errors';
import type { PatientFormValue } from '../lib/patient-form';
import { PHONE_COUNTRIES, type PhoneCountry, type Sex } from '../lib/types';
import { Field } from './ui';

function CountrySelect({ id, value, onChange, label }: { id: string; value: PhoneCountry; onChange: (c: PhoneCountry) => void; label: string }) {
  const { t } = useTranslation();
  return (
    <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value as PhoneCountry)}>
      {PHONE_COUNTRIES.map((c) => (
        <option key={c} value={c}>
          {t(`countries.${c}`)}
        </option>
      ))}
    </select>
  );
}

/** Administrative fields only — no clinical information and no national identity numbers. */
export function PatientFields({
  idPrefix,
  value,
  onChange,
  fields,
}: {
  idPrefix: string;
  value: PatientFormValue;
  onChange: (next: PatientFormValue) => void;
  fields: Record<string, string>;
}) {
  const { t } = useTranslation();
  const set = <K extends keyof PatientFormValue>(key: K) => (v: PatientFormValue[K]) => onChange({ ...value, [key]: v });
  const id = (name: string) => `${idPrefix}-${name}`;
  const errors = {
    fullName: fieldMessage(t, 'fullName', fields.fullName, value.fullName),
    phone: fieldMessage(t, 'phone', fields['phone.number'] ?? fields['phone.country'], fields['phone.number'] ? value.phoneNumber : undefined),
    secondaryPhone: fieldMessage(t, 'phone', fields['secondaryPhone.number'] ?? fields['secondaryPhone.country']),
    email: fieldMessage(t, 'email', fields.email),
    dateOfBirth: fieldMessage(t, 'dateOfBirth', fields.dateOfBirth),
  };

  return (
    <>
      <Field id={id('name')} label={t('patients.fullName')} error={errors.fullName} hint={t('patients.fullNameHint')} required>
        <input
          id={id('name')}
          required
          maxLength={120}
          value={value.fullName}
          onChange={(e) => set('fullName')(e.target.value)}
          {...describedBy(id('name'), errors.fullName, t('patients.fullNameHint'))}
        />
      </Field>
      <div className="field">
        <label htmlFor={id('phone')} className="label--required">
          {t('patients.phone')}
        </label>
        <div className="phone-input">
          <CountrySelect id={id('phone-country')} label={t('patients.phoneCountry')} value={value.phoneCountry} onChange={set('phoneCountry')} />
          <input
            id={id('phone')}
            type="tel"
            dir="ltr"
            inputMode="tel"
            required
            maxLength={32}
            value={value.phoneNumber}
            onChange={(e) => set('phoneNumber')(e.target.value)}
            {...describedBy(id('phone'), errors.phone, t('patients.phoneHint'))}
          />
        </div>
        {errors.phone ? <p className="field-error" id={`${id('phone')}-error`}>{errors.phone}</p> : <p className="field-hint" id={`${id('phone')}-hint`}>{t('patients.phoneHint')}</p>}
      </div>
      <details className="optional-fields">
        <summary>{t('patients.moreDetails')}</summary>
        <div className="form-grid">
          <div className="field">
            <label htmlFor={id('phone2')}>{`${t('patients.secondaryPhone')} ${t('common.optional')}`}</label>
            <div className="phone-input">
              <CountrySelect id={id('phone2-country')} label={t('patients.phoneCountry')} value={value.secondaryCountry} onChange={set('secondaryCountry')} />
              <input
                id={id('phone2')}
                type="tel"
                dir="ltr"
                inputMode="tel"
                maxLength={32}
                value={value.secondaryNumber}
                onChange={(e) => set('secondaryNumber')(e.target.value)}
                {...describedBy(id('phone2'), errors.secondaryPhone)}
              />
            </div>
            {errors.secondaryPhone && <p className="field-error" id={`${id('phone2')}-error`}>{errors.secondaryPhone}</p>}
          </div>
          <Field id={id('email')} label={`${t('auth.email')} ${t('common.optional')}`} error={errors.email}>
            <input id={id('email')} type="email" dir="ltr" maxLength={254} value={value.email} onChange={(e) => set('email')(e.target.value)} {...describedBy(id('email'), errors.email)} />
          </Field>
          <Field id={id('dob')} label={`${t('patients.dateOfBirth')} ${t('common.optional')}`} error={errors.dateOfBirth}>
            <input id={id('dob')} type="date" value={value.dateOfBirth} onChange={(e) => set('dateOfBirth')(e.target.value)} {...describedBy(id('dob'), errors.dateOfBirth)} />
          </Field>
          <Field id={id('sex')} label={`${t('patients.sex')} ${t('common.optional')}`}>
            <select id={id('sex')} value={value.sex} onChange={(e) => set('sex')(e.target.value as Sex)}>
              {(['unspecified', 'female', 'male'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`patients.sexes.${s}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id={id('address')} label={`${t('patients.address')} ${t('common.optional')}`}>
            <input id={id('address')} maxLength={200} value={value.addressLine} onChange={(e) => set('addressLine')(e.target.value)} />
          </Field>
          <Field id={id('city')} label={`${t('branches.city')} ${t('common.optional')}`}>
            <input id={id('city')} maxLength={80} value={value.addressCity} onChange={(e) => set('addressCity')(e.target.value)} />
          </Field>
        </div>
      </details>
    </>
  );
}
