import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

/** Countries offered for phone numbers. A local number is only accepted with one of these. */
export const PHONE_COUNTRIES = ['EG', 'SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'JO'] as const;
export type PhoneCountry = (typeof PHONE_COUNTRIES)[number];

/** Arabic-Indic (٠–٩) and Eastern Arabic-Indic (۰–۹) digits → ASCII digits. */
export function toAsciiDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

export type NormalizedPhone = { country: PhoneCountry; e164: string };

/**
 * Validates and normalizes a phone number to E.164 for exact matching. International input
 * ("+…" or "00…") carries its own country; a local number needs an explicit country — the
 * country is never guessed. Returns null when invalid or from an unsupported country.
 */
export function normalizePhone(raw: string, country?: PhoneCountry): NormalizedPhone | null {
  const cleaned = toAsciiDigits(raw).replace(/[\s\-().‎‏]/g, '');
  if (!/^(\+|00)?\d{4,17}$/.test(cleaned)) return null;
  const international = cleaned.startsWith('+') || cleaned.startsWith('00');
  if (!international && !country) return null;
  const input = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
  const parsed = parsePhoneNumberFromString(input, international ? undefined : (country as CountryCode));
  if (!parsed?.isValid() || !parsed.country) return null;
  if (!(PHONE_COUNTRIES as readonly string[]).includes(parsed.country)) return null;
  return { country: parsed.country as PhoneCountry, e164: parsed.number };
}

/** E.164 numbers a search term could mean (one per supported country for local input). */
export function phoneSearchCandidates(term: string): string[] {
  const digits = toAsciiDigits(term).replace(/[\s\-().]/g, '');
  if (!/^(\+|00)?\d{6,17}$/.test(digits)) return [];
  if (digits.startsWith('+') || digits.startsWith('00')) {
    const one = normalizePhone(digits);
    return one ? [one.e164] : [];
  }
  const found = new Set<string>();
  for (const country of PHONE_COUNTRIES) {
    const one = normalizePhone(digits, country);
    if (one) found.add(one.e164);
  }
  return [...found];
}

/**
 * Search key for names: Arabic diacritics and tatweel removed, alef/yaa/taa-marbuta variants
 * unified, Latin lowercased, whitespace collapsed. The original spelling is stored separately.
 */
export function nameKey(name: string): string {
  return toAsciiDigits(name)
    .normalize('NFKC')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Distinct words of a normalized name (nameKey), for indexed word-prefix search: "محمد احمد" → ["محمد", "احمد"].
 * Stored with every patient (scalability review): a substring regex over nameKey cannot use an index.
 */
export function nameTokens(key: string): string[] {
  return [...new Set(key.split(' ').filter(Boolean))].slice(0, 12);
}
