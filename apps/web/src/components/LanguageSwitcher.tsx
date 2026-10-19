import { useTranslation } from 'react-i18next';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const next = i18n.resolvedLanguage === 'en' ? 'ar' : 'en';

  return (
    <button
      type="button"
      className="language-switcher"
      lang={next}
      onClick={() => void i18n.changeLanguage(next)}
    >
      {t('language.switchTo')}
    </button>
  );
}
