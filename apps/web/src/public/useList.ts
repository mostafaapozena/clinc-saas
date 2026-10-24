import { useTranslation } from 'react-i18next';

/** A translated list (an array in the locale files). */
export function useList(key: string): string[] {
  const { t } = useTranslation();
  const value: unknown = t(key, { returnObjects: true });
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
