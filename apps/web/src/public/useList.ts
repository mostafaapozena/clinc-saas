import { useTranslation } from 'react-i18next';

/** A translated list (an array in the locale files). */
export function useList(key: string): string[] {
  const { t } = useTranslation();
  const value: unknown = t(key, { returnObjects: true });
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export type TitledItem = { title: string; body: string };
export type QuestionItem = { q: string; a: string };

/** A translated list of objects (e.g. cards with a title and a body); malformed entries are dropped. */
export function useObjects<T extends Record<string, string>>(key: string, fields: (keyof T)[]): T[] {
  const { t } = useTranslation();
  const value: unknown = t(key, { returnObjects: true });
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is T => typeof item === 'object' && item !== null && fields.every((f) => typeof (item as Record<string, unknown>)[f as string] === 'string'),
  );
}
