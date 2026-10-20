import { useTranslation } from 'react-i18next';
import { ApiStatusPanel } from './components/ApiStatusPanel';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { SpecialtiesList } from './components/SpecialtiesList';

export function App() {
  const { t } = useTranslation();

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>
            {t('app.name')} <span className="temp-name">({t('app.tempName')})</span>
          </h1>
          <p className="tagline">{t('app.tagline')}</p>
        </div>
        <LanguageSwitcher />
      </header>

      <main className="app-main">
        <section className="card intro">
          <h2>{t('phase.title')}</h2>
          <p>{t('phase.description')}</p>
        </section>
        <ApiStatusPanel />
        <SpecialtiesList />
      </main>

      <footer className="app-footer">{t('footer.devOnly')}</footer>
    </div>
  );
}
