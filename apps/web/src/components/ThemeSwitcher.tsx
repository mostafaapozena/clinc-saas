import { useTranslation } from 'react-i18next';
import { useTheme, type ThemePreference } from '../lib/theme';
import { Icon } from './Icon';

/**
 * Light/dark switch shown next to the language button on every layout. The icon shows the theme
 * the button switches to; the choice is kept in this browser (src/lib/theme.ts).
 */
export function ThemeSwitcher() {
  const { t } = useTranslation();
  const { theme, setPreference } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? t('theme.toDark') : t('theme.toLight');
  return (
    <button type="button" className="icon-button theme-switcher" aria-label={label} title={label} onClick={() => setPreference(next)}>
      <Icon name={next === 'dark' ? 'moon' : 'sun'} />
    </button>
  );
}

/** The full choice, including "same as the device" (profile page). */
export function ThemeSelect({ id }: { id: string }) {
  const { t } = useTranslation();
  const { preference, setPreference } = useTheme();
  return (
    <div className="field">
      <label htmlFor={id}>{t('theme.label')}</label>
      <select id={id} value={preference} aria-describedby={`${id}-hint`} onChange={(e) => setPreference(e.target.value as ThemePreference)}>
        <option value="system">{t('theme.options.system')}</option>
        <option value="light">{t('theme.options.light')}</option>
        <option value="dark">{t('theme.options.dark')}</option>
      </select>
      <p className="field-hint" id={`${id}-hint`}>
        {t('theme.hint')}
      </p>
    </div>
  );
}
