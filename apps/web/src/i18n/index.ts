import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './locales/ar.json';
import en from './locales/en.json';

export const SUPPORTED_LANGUAGES = ['ar', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'ar';

export function directionFor(language: string): 'rtl' | 'ltr' {
  return language.startsWith('ar') ? 'rtl' : 'ltr';
}

/** Keeps <html lang/dir> in sync so the whole layout flips between RTL and LTR. */
function applyDocumentLanguage(language: string) {
  document.documentElement.lang = language;
  document.documentElement.dir = directionFor(language);
}

i18n.on('languageChanged', applyDocumentLanguage);

void i18n.use(initReactI18next).init({
  resources: { ar: { translation: ar }, en: { translation: en } },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  initAsync: false,
  interpolation: { escapeValue: false },
});

applyDocumentLanguage(i18n.language);

export default i18n;
