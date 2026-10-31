import type { TFunction } from 'i18next';

// Records the system creates (ledger setup: the main cashbox and bank account; the demo seed:
// branch cashboxes and stores) are stored with English names. They are shown in the interface
// language. Names people type are shown exactly as saved — only these exact default names map.
const FIXED: Record<string, string> = {
  'Main cashbox': 'defaults.mainCashbox',
  'Bank account': 'defaults.bankAccount',
};
const NUMBERED: [RegExp, string][] = [
  [/^Branch cashbox (\d+)$/, 'defaults.branchCashbox'],
  [/^Main store (\d+)$/, 'defaults.mainStore'],
];

export function displayName(t: TFunction, name: string | null | undefined): string {
  if (!name) return '';
  const fixed = FIXED[name];
  if (fixed) return t(fixed);
  for (const [pattern, key] of NUMBERED) {
    const m = pattern.exec(name);
    if (m) return t(key, { n: m[1] });
  }
  return name;
}
