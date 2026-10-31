import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { showToast } from '../lib/toast';
import { orgKeys, useOrg } from '../org/context';
import { BrandLogo } from './BrandLogo';
import { Field, Notice } from './ui';

// Organization identity and legal profile — «ملف وهوية المنشأة»
// (docs/architecture/ORGANIZATION_PROFILE.md): edited in settings, shown on printed documents.

type Profile = {
  legalNameAr: string;
  legalNameEn: string;
  commercialRegistration: string;
  taxRegistration: string;
  address: string;
  phone: string;
  email: string;
  documentFooter: string;
  logoUrl: string | null;
  version: number;
};
type Editable = Omit<Profile, 'logoUrl' | 'version'>;
const FIELDS: { key: keyof Editable; max: number; dir?: 'ltr' }[] = [
  { key: 'legalNameAr', max: 160 },
  { key: 'legalNameEn', max: 160, dir: 'ltr' },
  { key: 'commercialRegistration', max: 40, dir: 'ltr' },
  { key: 'taxRegistration', max: 40, dir: 'ltr' },
  { key: 'address', max: 300 },
  { key: 'phone', max: 40, dir: 'ltr' },
  { key: 'email', max: 120, dir: 'ltr' },
  { key: 'documentFooter', max: 300 },
];
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const LOGO_MAX = 512 * 1024;
const profileKey = (orgId: string) => [...orgKeys.all(orgId), 'profile'] as const;

function useProfile() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: profileKey(orgId),
    queryFn: ({ signal }) => api<{ profile: Profile }>(`/orgs/${orgId}/profile`, { signal }).then((r) => r.profile),
  });
}

/** Letterhead of printed documents: the organization's logo and legal details, else the raclinic mark. */
export function OrganizationLetterhead() {
  const { t, i18n } = useTranslation();
  const { detail } = useOrg();
  const profile = useProfile().data;
  const name =
    (i18n.language.startsWith('ar') ? profile?.legalNameAr || profile?.legalNameEn : profile?.legalNameEn || profile?.legalNameAr) ||
    detail.organization.name;
  const ids = [
    profile?.commercialRegistration && t('orgProfile.printCr', { value: profile.commercialRegistration }),
    profile?.taxRegistration && t('orgProfile.printTax', { value: profile.taxRegistration }),
  ].filter(Boolean);
  return (
    <div className="letterhead" data-testid="letterhead">
      {profile?.logoUrl ? (
        <img className="letterhead-logo" src={profile.logoUrl} alt={t('orgProfile.logoAlt', { name })} />
      ) : (
        <BrandLogo variant="wordmark" />
      )}
      <div>
        <strong>{name}</strong>
        {ids.length > 0 && (
          <p className="small">
            <bdi dir="auto">{ids.join(' · ')}</bdi>
          </p>
        )}
        {(profile?.address || profile?.phone) && <p className="small muted">{[profile.address, profile.phone].filter(Boolean).join(' · ')}</p>}
        {profile?.documentFooter && <p className="small muted">{profile.documentFooter}</p>}
      </div>
    </div>
  );
}

function ProfileForm({ profile }: { profile: Profile }) {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const queryClient = useQueryClient();
  const editable = can('organization.update');
  const [values, setValues] = useState<Editable>(() => Object.fromEntries(FIELDS.map((f) => [f.key, profile[f.key]])) as Editable);
  const [logoError, setLogoError] = useState<string | null>(null);
  const done = (message: string) => (showToast(message), queryClient.invalidateQueries({ queryKey: profileKey(orgId) }));
  const save = useMutation({
    mutationFn: () => api(`/orgs/${orgId}/profile`, { method: 'PUT', body: { ...values, version: profile.version } }),
    onSuccess: () => done(t('orgProfile.saved')),
  });
  const upload = useMutation({
    mutationFn: (file: File) => api(`/orgs/${orgId}/profile/logo`, { method: 'PUT', raw: file }),
    onSuccess: () => done(t('orgProfile.logoSaved')),
  });
  const removeLogo = useMutation({
    mutationFn: () => api(`/orgs/${orgId}/profile/logo`, { method: 'DELETE' }),
    onSuccess: () => done(t('orgProfile.logoRemoved')),
  });
  return (
    <section className="card" aria-labelledby="profile-title" data-testid="organization-profile">
      <h2 id="profile-title">{t('orgProfile.title')}</h2>
      <p className="muted">{t('orgProfile.intro')}</p>
      <div className="letterhead-preview">
        <OrganizationLetterhead />
      </div>
      {editable && (
        <div className="inline-form">
          <Field id="profile-logo" label={t('orgProfile.logo')} hint={t('orgProfile.logoHint')}>
            <input
              id="profile-logo"
              type="file"
              accept={LOGO_TYPES.join(',')}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                if (!LOGO_TYPES.includes(file.type)) return setLogoError(t('orgProfile.logoType'));
                if (file.size > LOGO_MAX) return setLogoError(t('orgProfile.logoSize'));
                setLogoError(null);
                upload.mutate(file);
              }}
            />
          </Field>
          {profile.logoUrl && (
            <button type="button" className="button button--ghost" disabled={removeLogo.isPending} onClick={() => removeLogo.mutate()}>
              {t('orgProfile.removeLogo')}
            </button>
          )}
        </div>
      )}
      {logoError && <Notice kind="error">{logoError}</Notice>}
      {upload.isError && <Notice kind="error">{errorMessage(t, upload.error)}</Notice>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!save.isPending) save.mutate();
        }}
      >
        <div className="form-grid">
          {FIELDS.map((f) => (
            <Field key={f.key} id={`profile-${f.key}`} label={t(`orgProfile.fields.${f.key}`)}>
              <input
                id={`profile-${f.key}`}
                dir={f.dir}
                type={f.key === 'email' ? 'email' : 'text'}
                maxLength={f.max}
                readOnly={!editable}
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
        <p className="muted small">{t('orgProfile.numbersHint')}</p>
        {save.isError && <Notice kind="error">{errorMessage(t, save.error)}</Notice>}
        {editable && (
          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={save.isPending}>
              {t('common.save')}
            </button>
          </div>
        )}
      </form>
    </section>
  );
}

export function OrganizationProfileSettings() {
  const profile = useProfile();
  if (!profile.data) return null;
  return <ProfileForm key={profile.data.version} profile={profile.data} />;
}
