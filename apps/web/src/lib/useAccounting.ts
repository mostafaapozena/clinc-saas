import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useOrg } from '../org/context';
import { accountingKeys, type SettingsResponse } from './accounting';
import { api } from './api';
import { formatMoney } from './finance';

export function useMoney() {
  const { i18n } = useTranslation();
  return (minor: number | null | undefined, currency: string | null | undefined) =>
    currency && minor !== null && minor !== undefined ? formatMoney(minor, currency, i18n.language) : '—';
}

export function useAccountingSettings() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: accountingKeys.settings(orgId),
    queryFn: ({ signal }) => api<SettingsResponse>(`/orgs/${orgId}/accounting/settings`, { signal }),
  });
}
