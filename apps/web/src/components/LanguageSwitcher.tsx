import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SESSION_KEY } from '../auth/session';
import { setLanguage } from '../i18n';
import { api } from '../lib/api';
import type { SessionData, User } from '../lib/types';
import { Icon } from './Icon';

/** Visible on every page. Remembers the choice in the browser and, when signed in, the profile. */
export function LanguageSwitcher({ onSwitched }: { onSwitched?: (language: 'ar' | 'en') => void }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const next = i18n.resolvedLanguage === 'en' ? 'ar' : 'en';

  const switchLanguage = async () => {
    await setLanguage(next);
    onSwitched?.(next);
    const session = queryClient.getQueryData<SessionData | null>(SESSION_KEY);
    if (!session) return;
    try {
      const { user } = await api<{ user: User }>('/me', { method: 'PATCH', body: { preferredLanguage: next } });
      queryClient.setQueryData<SessionData | null>(SESSION_KEY, (current) => (current ? { ...current, user } : current));
    } catch {
      // The UI language already changed; saving the preference can be retried next time.
    }
  };

  return (
    <button
      type="button"
      className="button button--ghost language-switcher"
      lang={next}
      title={t('language.switchLabel')}
      onClick={() => void switchLanguage()}
    >
      <Icon name="globe" />
      <span>{t('language.switchTo')}</span>
    </button>
  );
}
