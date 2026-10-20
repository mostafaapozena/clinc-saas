import { useTranslation } from 'react-i18next';

/** Locale-aware formatting that follows the current UI language. */
export function useFormatters() {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === 'en' ? 'en' : 'ar';
  return {
    locale,
    date: (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso)),
    number: (value: number) => new Intl.NumberFormat(locale).format(value),
    list: (items: string[]) => new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items),
    /** Time of an instant in the organization's zone, e.g. "09:30". */
    time: (iso: string, timeZone: string) =>
      new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)),
    /** Date and time of an instant in the organization's zone. */
    dateTime: (iso: string, timeZone: string) =>
      new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)),
    /** A local calendar date ("YYYY-MM-DD") with its weekday, independent of any zone. */
    localDate: (date: string, style: 'long' | 'short' = 'long') =>
      new Intl.DateTimeFormat(locale, {
        timeZone: 'UTC',
        weekday: style === 'long' ? 'long' : 'short',
        day: 'numeric',
        month: style === 'long' ? 'long' : 'short',
        ...(style === 'long' ? { year: 'numeric' } : {}),
      }).format(new Date(`${date}T00:00:00Z`)),
    weekday: (weekday: number) =>
      // 2026-11-08 is a Sunday; weekday 0 = Sunday.
      new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long' }).format(new Date(Date.UTC(2026, 10, 8 + weekday))),
    /** "UTC+3" style label, used to tell repeated wall-clock times apart. */
    offset: (minutes: number) => {
      const abs = Math.abs(minutes);
      const rest = abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : '';
      return `UTC${minutes >= 0 ? '+' : '-'}${Math.floor(abs / 60)}${rest}`;
    },
  };
}
