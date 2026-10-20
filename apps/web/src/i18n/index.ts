import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { readStored, writeStored } from '../lib/storage';
import ar from './locales/ar.json';
import en from './locales/en.json';

export const SUPPORTED_LANGUAGES = ['ar', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'ar';
export const LANGUAGE_STORAGE_KEY = 'clinc.language';

export function directionFor(language: string): 'rtl' | 'ltr' {
  return language.startsWith('ar') ? 'rtl' : 'ltr';
}

function storedLanguage(): Language | null {
  const value = readStored(LANGUAGE_STORAGE_KEY);
  return value === 'ar' || value === 'en' ? value : null;
}

/**
 * Keeps <html lang/dir> in sync, which flips the layout (RTL/LTR) and selects the font:
 * the stylesheet uses Alexandria for :lang(ar) and Inter for :lang(en).
 */
function applyDocumentLanguage(language: string) {
  document.documentElement.lang = language;
  document.documentElement.dir = directionFor(language);
}

i18n.on('languageChanged', applyDocumentLanguage);

void i18n.use(initReactI18next).init({
  resources: { ar: { translation: ar }, en: { translation: en } },
  lng: storedLanguage() ?? DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  initAsync: false,
  interpolation: { escapeValue: false },
});

applyDocumentLanguage(i18n.language);

/** Switches the UI language and remembers the choice in this browser. */
export async function setLanguage(language: Language) {
  writeStored(LANGUAGE_STORAGE_KEY, language);
  await i18n.changeLanguage(language);
}

export default i18n;
