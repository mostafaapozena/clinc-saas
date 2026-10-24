import { usePrivatePageMeta } from './pageMeta';

/** Title for sign-in, onboarding and workspace pages, which are never indexed. */
export function useDocumentTitle(title: string) {
  usePrivatePageMeta(title);
}
