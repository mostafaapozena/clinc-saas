import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchSpecialties, type Specialty } from '../api/client';

type LoadState =
  | { state: 'loading' }
  | { state: 'ready'; items: Specialty[] }
  | { state: 'error' };

export function SpecialtiesList() {
  const { t, i18n } = useTranslation();
  const [load, setLoad] = useState<LoadState>({ state: 'loading' });
  const language = i18n.resolvedLanguage === 'en' ? 'en' : 'ar';

  useEffect(() => {
    const controller = new AbortController();
    fetchSpecialties(controller.signal)
      .then((items) => setLoad({ state: 'ready', items }))
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ state: 'error' });
      });
    return () => controller.abort();
  }, []);

  return (
    <section className="card" aria-labelledby="specialties-title">
      <h2 id="specialties-title">{t('specialties.title')}</h2>
      <p className="muted">{t('specialties.note')}</p>
      {load.state === 'loading' && <p>{t('specialties.loading')}</p>}
      {load.state === 'error' && <p className="error">{t('specialties.error')}</p>}
      {load.state === 'ready' && load.items.length === 0 && <p>{t('specialties.empty')}</p>}
      {load.state === 'ready' && load.items.length > 0 && (
        <ul className="chips">
          {load.items.map((specialty) => (
            <li key={specialty.code} data-testid="specialty-item">
              {specialty.name[language]}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
