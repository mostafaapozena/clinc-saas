import { describe, expect, it } from 'vitest';
import i18n, { LANGUAGE_STORAGE_KEY, directionFor, setLanguage } from '.';

describe('i18n', () => {
  it('defaults to Arabic with an RTL document', () => {
    expect(i18n.language).toBe('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('switches the document to LTR for English, remembers the choice, and switches back', async () => {
    await setLanguage('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');

    await setLanguage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ar');
  });

  it('has the same translation keys in every language', () => {
    const keys = (lng: string) =>
      Object.keys(flatten(i18n.getResourceBundle(lng, 'translation') as Record<string, unknown>));
    expect(keys('en').sort()).toEqual(keys('ar').sort());
  });

  it('has no empty translations', () => {
    for (const lng of ['ar', 'en']) {
      const values = Object.values(flatten(i18n.getResourceBundle(lng, 'translation') as Record<string, unknown>));
      expect(values.every((v) => typeof v === 'string' && v.trim().length > 0)).toBe(true);
    }
  });

  it('maps languages to text direction', () => {
    expect(directionFor('ar-EG')).toBe('rtl');
    expect(directionFor('en')).toBe('ltr');
  });
});

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  return Object.entries(obj).reduce<Record<string, unknown>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') Object.assign(acc, flatten(value as Record<string, unknown>, path));
    else acc[path] = value;
    return acc;
  }, {});
}
