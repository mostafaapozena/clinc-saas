import { useTranslation } from 'react-i18next';
import { ApiStatusPanel } from '../components/ApiStatusPanel';
import { SpecialtiesList } from '../components/SpecialtiesList';
import { PublicLayout } from '../layouts/PublicLayout';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/** Public system check: API + database connectivity and the platform specialty catalog. */
export function StatusPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('status.title'));
  return (
    <PublicLayout>
      <div className="stack">
        <section className="card intro">
          <h1>{t('phase.title')}</h1>
          <p>{t('phase.description')}</p>
        </section>
        <ApiStatusPanel />
        <SpecialtiesList />
      </div>
    </PublicLayout>
  );
}
