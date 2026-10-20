import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fetchSpecialties, type Specialty } from '../api/client';

/** The platform specialty catalog with names in the current UI language. */
export function useSpecialtyNames() {
  const { i18n } = useTranslation();
  const specialties = useQuery({ queryKey: ['specialties'], queryFn: ({ signal }) => fetchSpecialties(signal), staleTime: 3_600_000 });
  const lang: 'ar' | 'en' = i18n.resolvedLanguage === 'en' ? 'en' : 'ar';
  const names = new Map((specialties.data ?? []).map((s: Specialty) => [s.code, s.name[lang]]));
  return { list: specialties.data ?? [], name: (code: string) => names.get(code) ?? code, lang };
}
