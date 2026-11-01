import { createContext, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { opApi, setOperatorCsrf, type OperatorSession } from '../lib/operator';

// The platform operator console (/operator). Separate sign-in, separate session; shows
// organizations' metadata, plans, subscriptions, inquiries, operators and the platform audit —
// never patients, appointments, clinical records or clinic finances, and no impersonation.

export const OperatorContext = createContext<OperatorSession | null>(null);

export const useOperator = () => {
  const value = useContext(OperatorContext);
  if (!value) throw new Error('OperatorContext missing');
  return { ...value, can: (permission: string) => value.permissions.includes(permission) };
};

/** "from → to" pointing the reading direction: ← in Arabic (right to left), → in English. */
export function useArrow() {
  const { i18n } = useTranslation();
  return i18n.dir(i18n.resolvedLanguage) === 'rtl' ? '←' : '→';
}

export async function fetchOperatorSession(): Promise<OperatorSession | null> {
  const res = await opApi<{ operator: OperatorSession | null; csrfToken?: string }>('/auth/session');
  setOperatorCsrf(res.operator ? (res.csrfToken ?? null) : null);
  return res.operator;
}

/** A list filter read from the URL: one of `allowed`, "" for "all", or the default. */
export function statusFilter(raw: string | null, allowed: string[], fallback: string) {
  if (raw === 'all') return '';
  return raw && allowed.includes(raw) ? raw : fallback;
}
