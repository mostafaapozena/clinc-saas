import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { orgKeys, useOrg } from '../org/context';
import { api } from './api';
import { formatMoney } from './finance';

// The one way to show an amount (docs/DESIGN_SYSTEM.md, "Money"): minor units in the UI language with
// the currency, and a dash when there is no currency (not configured yet) or no amount. Never the raw
// minor units, never animated. `components/data.tsx` `Money` renders the same thing as an element.

/** Formats any amount with its own currency. */
export function useMoney() {
  const { i18n } = useTranslation();
  return (minor: number | null | undefined, currency: string | null | undefined) =>
    currency && minor !== null && minor !== undefined ? formatMoney(minor, currency, i18n.language) : '—';
}

/** Formats amounts in one known currency (a document's or a report's). */
export function useCurrencyMoney(currency: string | null | undefined) {
  const money = useMoney();
  return (minor: number) => money(minor, currency);
}

/** The organization's currency from its finance settings (null until it is chosen). */
export function useOrgCurrency(): string | null {
  const { orgId } = useOrg();
  return (
    useQuery({
      queryKey: orgKeys.financeSettings(orgId),
      queryFn: ({ signal }) => api<{ currency: string | null }>(`/orgs/${orgId}/finance/settings`, { signal }),
    }).data?.currency ?? null
  );
}

/** The organization's currency and a formatter bound to it. */
export function useOrgMoney() {
  const currency = useOrgCurrency();
  const money = useCurrencyMoney(currency);
  return { currency, money };
}
