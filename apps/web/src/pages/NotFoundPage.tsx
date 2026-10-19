import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PublicLayout } from '../layouts/PublicLayout';
import { useDocumentTitle } from '../lib/useDocumentTitle';

function NotFoundContent() {
  const { t } = useTranslation();
  useDocumentTitle(t('notFound.title'));
  return (
    <section className="card state-card" aria-labelledby="not-found-title">
      <h1 id="not-found-title">{t('notFound.title')}</h1>
      <p>{t('notFound.body')}</p>
      <Link className="button button--secondary" to="/app">
        {t('notFound.home')}
      </Link>
    </section>
  );
}

export function NotFoundPage() {
  return (
    <PublicLayout>
      <NotFoundContent />
    </PublicLayout>
  );
}

export function NotFoundInShell() {
  return <NotFoundContent />;
}
