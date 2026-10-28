import { useTranslation } from 'react-i18next';
import { BrandLogo } from './BrandLogo';

/**
 * Shown while the real setup request runs (and while the app opens the new workspace). It reflects
 * the actual configuration — the chosen specialty — with an honest indeterminate indicator: no
 * percentages, no invented steps and no artificial delay.
 */
export function PreparingWorkspace({ specialtyName, resuming = false }: { specialtyName?: string | null; resuming?: boolean }) {
  const { t } = useTranslation();
  const title = resuming
    ? t('onboarding.preparing.ready')
    : specialtyName
      ? t('onboarding.preparing.titleFor', { specialty: specialtyName })
      : t('onboarding.preparing.title');
  return (
    <section className="preparing" role="status" aria-live="polite" data-testid="preparing-workspace">
      <BrandLogo variant="symbol" className="preparing-mark" />
      <h2>{title}</h2>
      <p className="muted">{resuming ? t('onboarding.preparing.opening') : t('onboarding.preparing.body')}</p>
      <div className="preparing-bar" aria-hidden="true">
        <span />
      </div>
    </section>
  );
}
