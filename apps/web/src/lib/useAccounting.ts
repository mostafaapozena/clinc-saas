import { useQuery } from '@tanstack/react-query';
import { useOrg } from '../org/context';
import { accountingKeys, type SettingsResponse } from './accounting';
import { api } from './api';

export function useAccountingSettings() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: accountingKeys.settings(orgId),
    queryFn: ({ signal }) => api<SettingsResponse>(`/orgs/${orgId}/accounting/settings`, { signal }),
  });
}
