import { useTranslation } from 'react-i18next';

/** Locale-aware formatting that follows the current UI language. */
export function useFormatters() {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === 'en' ? 'en' : 'ar';
  return {
    date: (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso)),
    number: (value: number) => new Intl.NumberFormat(locale).format(value),
    list: (items: string[]) => new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items),
  };
}
