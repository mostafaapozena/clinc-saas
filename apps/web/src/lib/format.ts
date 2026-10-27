import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

/**
 * Intl locale for a UI language. Arabic always uses Latin digits: amounts, dates, phone numbers and
 * file numbers then match each other and the input hints ("مثال: 750.50"), whatever the browser's
 * default numbering for "ar" is.
 */
export const intlLocale = (language: string) => (language === 'en' ? 'en' : 'ar-u-nu-latn');

/** Readable name of an IANA time zone ("Africa/Cairo" → "القاهرة (مصر)"); the raw name if unknown. */
export const zoneLabel = (t: TFunction, zone: string) => t(`timeZones.${zone}`, { defaultValue: zone });

/** Locale-aware formatting that follows the current UI language. */
export function useFormatters() {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === 'en' ? 'en' : 'ar';
  const intl = intlLocale(locale);
  return {
    locale,
    date: (iso: string) => new Intl.DateTimeFormat(intl, { dateStyle: 'medium' }).format(new Date(iso)),
    number: (value: number) => new Intl.NumberFormat(intl).format(value),
    list: (items: string[]) => new Intl.ListFormat(intl, { style: 'long', type: 'conjunction' }).format(items),
    /** Time of an instant in the organization's zone, e.g. "09:30". */
    time: (iso: string, timeZone: string) =>
      new Intl.DateTimeFormat(intl, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)),
    /** Date and time of an instant in the organization's zone, on the same 24-hour clock as `time`. */
    dateTime: (iso: string, timeZone: string) =>
      new Intl.DateTimeFormat(intl, { timeZone, dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(iso)),
    /** A local calendar date ("YYYY-MM-DD") with its weekday, independent of any zone. */
    localDate: (date: string, style: 'long' | 'short' = 'long') =>
      new Intl.DateTimeFormat(intl, {
        timeZone: 'UTC',
        weekday: style === 'long' ? 'long' : 'short',
        day: 'numeric',
        month: style === 'long' ? 'long' : 'short',
        ...(style === 'long' ? { year: 'numeric' } : {}),
      }).format(new Date(`${date}T00:00:00Z`)),
    weekday: (weekday: number) =>
      // 2026-11-08 is a Sunday; weekday 0 = Sunday.
      new Intl.DateTimeFormat(intl, { timeZone: 'UTC', weekday: 'long' }).format(new Date(Date.UTC(2026, 10, 8 + weekday))),
    /** "UTC+3" style label, used to tell repeated wall-clock times apart. */
    offset: (minutes: number) => {
      const abs = Math.abs(minutes);
      const rest = abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : '';
      return `UTC${minutes >= 0 ? '+' : '-'}${Math.floor(abs / 60)}${rest}`;
    },
  };
}
