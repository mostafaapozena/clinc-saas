import type { TFunction } from 'i18next';
import { displayName } from './defaultNames';

// General ledger, cash and banks (docs/architecture/ACCOUNTING.md). Amounts are integer minor units;
// every total comes from the API.

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export const ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense'];

export type LedgerAccount = {
  id: string;
  code: string;
  name: string;
  templateKey: string | null;
  type: AccountType;
  isGroup: boolean;
  parentId: string | null;
  role: 'cash' | 'bank' | null;
  status: 'active' | 'archived';
  version: number;
  balance?: number;
};

export type AccountingSettings = {
  currency: string;
  cutoverDate: string;
  lockedThrough: string | null;
  template: string;
  mappings: Record<string, string>;
  requireCashSession: boolean;
  version: number;
};
export type SettingsResponse = {
  configured: boolean;
  settings: AccountingSettings | null;
  prerequisites: { currency: string | null; timeZone: string | null };
  template: string;
  today: string | null;
};

export type EntryLine = {
  accountId: string;
  accountCode: string | null;
  accountName: string | null;
  accountTemplateKey: string | null;
  debit: number;
  credit: number;
  branchId: string | null;
  partner: { type: string; id: string } | null;
  memo: string;
};
export type JournalEntry = {
  id: string;
  number: string;
  date: string;
  journal: string;
  memo: string;
  total: number;
  currency: string;
  source: { type: string; id: string | null; event: string };
  cashSessionId: string | null;
  reversalOf: string | null;
  reversedBy: string | null;
  createdAt: string;
  lines: EntryLine[];
};

export type CashAccount = {
  id: string;
  name: string;
  kind: 'cash' | 'bank';
  branchId: string | null;
  accountId: string;
  status: 'active' | 'archived';
  balance?: number;
};
export type CashSession = {
  id: string;
  number: string;
  branchId: string;
  cashAccountId: string;
  status: 'open' | 'closed';
  openedBy: string;
  openedAt: string;
  openingExpected: number;
  openingCounted: number;
  closedAt: string | null;
  closingExpected: number | null;
  closingCounted: number | null;
  difference: number | null;
  note: string;
};
export type CashVoucher = {
  id: string;
  number: string;
  type: 'in' | 'out' | 'transfer';
  date: string;
  cashAccountId: string;
  toCashAccountId: string | null;
  counterAccountId: string | null;
  amount: number;
  reference: string;
  memo: string;
  entryId: string;
  createdAt: string;
};

/** The account's name in the interface language: template accounts are translated by key. */
export function accountName(t: TFunction, a: { name: string | null; templateKey: string | null }): string {
  return a.templateKey ? t(`accounting.chart.${a.templateKey}`, { defaultValue: a.name ?? '' }) : displayName(t, a.name);
}

/** The kind of business event behind an entry, for display. */
export function sourceLabel(t: TFunction, source: { type: string; event: string }): string {
  const event = /^(allocation|payment|depreciation|return|expense|write_off)-/.test(source.event) ? source.event.replace(/-.*$/, '') : source.event;
  return t(`accounting.sources.${source.type}.${event}`, {
    defaultValue: t(`accounting.sources.${source.type}.default`, {
      defaultValue: t('accounting.sources.other'),
    }),
  });
}

export const accountingKeys = {
  all: (orgId: string) => ['org', orgId, 'accounting'] as const,
  settings: (orgId: string) => ['org', orgId, 'accounting', 'settings'] as const,
  accounts: (orgId: string) => ['org', orgId, 'accounting', 'accounts'] as const,
  entries: (orgId: string, params: object) => ['org', orgId, 'accounting', 'entries', params] as const,
  entry: (orgId: string, id: string) => ['org', orgId, 'accounting', 'entry', id] as const,
  periods: (orgId: string) => ['org', orgId, 'accounting', 'periods'] as const,
  report: (orgId: string, name: string, params: object) => ['org', orgId, 'accounting', 'report', name, params] as const,
  cash: (orgId: string) => ['org', orgId, 'accounting', 'cash'] as const,
  cashSession: (orgId: string, id: string) => ['org', orgId, 'accounting', 'cash', 'session', id] as const,
  statement: (orgId: string, id: string) => ['org', orgId, 'accounting', 'cash', 'statement', id] as const,
};
