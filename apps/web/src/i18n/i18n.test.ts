import { describe, expect, it } from 'vitest';
import i18n, { directionFor } from '.';

describe('i18n', () => {
  it('defaults to Arabic with an RTL document', () => {
    expect(i18n.language).toBe('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('switches the document to LTR for English and back', async () => {
    await i18n.changeLanguage('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');

    await i18n.changeLanguage('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('has the same translation keys in every language', () => {
    const keys = (lng: string) =>
      Object.keys(flatten(i18n.getResourceBundle(lng, 'translation') as Record<string, unknown>));
    expect(keys('en').sort()).toEqual(keys('ar').sort());
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
