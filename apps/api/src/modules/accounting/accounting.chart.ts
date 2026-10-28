import type { AccountType, MappingKey } from './accounting.model.js';

/**
 * Implementation template of a clinic chart of accounts — NOT an approved statutory chart.
 * It must be reviewed by the clinic's accountant before real use (docs/ERP_DECISIONS.md, E-3).
 * Names are translated in the web app by `templateKey` (accounting.chart.<key>).
 */
export const CHART_TEMPLATE_ID = 'raclinic.clinic@1';

type TemplateAccount = {
  code: string;
  key: string;
  type: AccountType;
  parent?: string;
  group?: boolean;
  role?: 'cash' | 'bank';
  /** English fallback name (stored; the UI translates by key). */
  name: string;
};

export const CHART_TEMPLATE: readonly TemplateAccount[] = [
  { code: '1000', key: 'assets', type: 'asset', group: true, name: 'Assets' },
  {
    code: '1100',
    key: 'cashAndBanks',
    type: 'asset',
    parent: '1000',
    group: true,
    name: 'Cash and banks',
  },
  {
    code: '1110',
    key: 'mainCashbox',
    type: 'asset',
    parent: '1100',
    role: 'cash',
    name: 'Main cashbox',
  },
  {
    code: '1120',
    key: 'mainBank',
    type: 'asset',
    parent: '1100',
    role: 'bank',
    name: 'Bank account',
  },
  {
    code: '1200',
    key: 'patientReceivables',
    type: 'asset',
    parent: '1000',
    name: 'Patient receivables',
  },
  {
    code: '1300',
    key: 'medicalSupplies',
    type: 'asset',
    parent: '1000',
    name: 'Inventory — medical supplies',
  },
  {
    code: '1400',
    key: 'supplierAdvances',
    type: 'asset',
    parent: '1000',
    name: 'Advances to suppliers',
  },
  // Staff funds (ERP milestone H3): changed only through advance and custody documents.
  { code: '1250', key: 'staffAdvances', type: 'asset', parent: '1000', name: 'Employee advances' },
  { code: '1260', key: 'staffCustody', type: 'asset', parent: '1000', name: 'Petty cash custody' },
  {
    code: '1500',
    key: 'fixedAssets',
    type: 'asset',
    parent: '1000',
    group: true,
    name: 'Fixed assets',
  },
  {
    code: '1510',
    key: 'medicalEquipment',
    type: 'asset',
    parent: '1500',
    name: 'Medical equipment',
  },
  {
    code: '1520',
    key: 'furniture',
    type: 'asset',
    parent: '1500',
    name: 'Furniture and fit-out',
  },
  // Depreciation (ERP milestone H4): a contra-asset changed only by the monthly depreciation run.
  { code: '1590', key: 'accumulatedDepreciation', type: 'asset', parent: '1500', name: 'Accumulated depreciation' },
  {
    code: '2000',
    key: 'liabilities',
    type: 'liability',
    group: true,
    name: 'Liabilities',
  },
  {
    code: '2100',
    key: 'supplierPayables',
    type: 'liability',
    parent: '2000',
    name: 'Supplier payables',
  },
  {
    code: '2150',
    key: 'grni',
    type: 'liability',
    parent: '2000',
    name: 'Goods received, not yet billed',
  },
  {
    code: '2200',
    key: 'patientAdvances',
    type: 'liability',
    parent: '2000',
    name: 'Patient advances and credits',
  },
  {
    code: '2300',
    key: 'practitionerPayable',
    type: 'liability',
    parent: '2000',
    name: 'Practitioner fees payable',
  },
  {
    code: '2400',
    key: 'otherPayables',
    type: 'liability',
    parent: '2000',
    name: 'Other payables',
  },
  { code: '3000', key: 'equity', type: 'equity', group: true, name: 'Equity' },
  {
    code: '3100',
    key: 'ownerCapital',
    type: 'equity',
    parent: '3000',
    name: 'Owner capital',
  },
  {
    code: '3200',
    key: 'ownerDrawings',
    type: 'equity',
    parent: '3000',
    name: 'Owner drawings',
  },
  {
    code: '3900',
    key: 'openingEquity',
    type: 'equity',
    parent: '3000',
    name: 'Opening balances',
  },
  { code: '4000', key: 'income', type: 'income', group: true, name: 'Income' },
  {
    code: '4100',
    key: 'serviceRevenue',
    type: 'income',
    parent: '4000',
    name: 'Service revenue',
  },
  {
    code: '4800',
    key: 'otherIncome',
    type: 'income',
    parent: '4000',
    name: 'Other income',
  },
  {
    code: '4900',
    key: 'salesDiscounts',
    type: 'income',
    parent: '4000',
    name: 'Discounts given',
  },
  {
    code: '4910',
    key: 'salesReturns',
    type: 'income',
    parent: '4000',
    name: 'Credit notes to patients',
  },
  {
    code: '5000',
    key: 'costOfServices',
    type: 'expense',
    group: true,
    name: 'Cost of services',
  },
  {
    code: '5100',
    key: 'consumablesUsed',
    type: 'expense',
    parent: '5000',
    name: 'Medical consumables used',
  },
  {
    code: '5200',
    key: 'practitionerFees',
    type: 'expense',
    parent: '5000',
    name: 'Practitioner fees',
  },
  {
    code: '5300',
    key: 'inventoryAdjustments',
    type: 'expense',
    parent: '5000',
    name: 'Stock adjustments, damage and expiry',
  },
  {
    code: '5400',
    key: 'purchaseVariance',
    type: 'expense',
    parent: '5000',
    name: 'Purchase price differences',
  },
  {
    code: '6000',
    key: 'operatingExpenses',
    type: 'expense',
    group: true,
    name: 'Operating expenses',
  },
  { code: '6100', key: 'rent', type: 'expense', parent: '6000', name: 'Rent' },
  {
    code: '6200',
    key: 'salaries',
    type: 'expense',
    parent: '6000',
    name: 'Salaries and wages',
  },
  {
    code: '6300',
    key: 'utilities',
    type: 'expense',
    parent: '6000',
    name: 'Utilities',
  },
  {
    code: '6400',
    key: 'maintenance',
    type: 'expense',
    parent: '6000',
    name: 'Maintenance and repairs',
  },
  {
    code: '6500',
    key: 'officeSupplies',
    type: 'expense',
    parent: '6000',
    name: 'Office supplies',
  },
  {
    code: '6600',
    key: 'marketing',
    type: 'expense',
    parent: '6000',
    name: 'Marketing',
  },
  { code: '6700', key: 'depreciationExpense', type: 'expense', parent: '6000', name: 'Depreciation' },
  // Patient invoices written off by the owner (ERP milestone H6).
  { code: '6950', key: 'badDebts', type: 'expense', parent: '6000', name: 'Bad debts' },
  {
    code: '6800',
    key: 'bankCharges',
    type: 'expense',
    parent: '6000',
    name: 'Bank charges',
  },
  {
    code: '6900',
    key: 'cashOverShort',
    type: 'expense',
    parent: '6000',
    name: 'Cash over and short',
  },
  {
    code: '6990',
    key: 'otherExpenses',
    type: 'expense',
    parent: '6000',
    name: 'Other expenses',
  },
];

/** Accounts with their own documents that vouchers and manual entries never post to. */
export const DOCUMENT_ONLY_KEYS: readonly string[] = ['staffAdvances', 'staffCustody', 'accumulatedDepreciation'];

/** Default posting map of the template (accountants can repoint each key to another account). */
export const TEMPLATE_MAPPINGS: Record<MappingKey, string> = {
  receivable: '1200',
  patientAdvances: '2200',
  serviceRevenue: '4100',
  salesDiscounts: '4900',
  salesReturns: '4910',
  cash: '1110',
  bank: '1120',
  cashOverShort: '6900',
  openingEquity: '3900',
  payable: '2100',
  grni: '2150',
  inventory: '1300',
  consumablesExpense: '5100',
  inventoryAdjustments: '5300',
  purchaseVariance: '5400',
  practitionerFees: '5200',
  practitionerPayable: '2300',
};

/** Which account types each mapping may point at (a receivable must be an asset, and so on). */
export const MAPPING_TYPES: Record<MappingKey, readonly AccountType[]> = {
  receivable: ['asset'],
  patientAdvances: ['liability'],
  serviceRevenue: ['income'],
  salesDiscounts: ['income', 'expense'],
  salesReturns: ['income', 'expense'],
  cash: ['asset'],
  bank: ['asset'],
  cashOverShort: ['expense', 'income'],
  openingEquity: ['equity'],
  payable: ['liability'],
  grni: ['liability'],
  inventory: ['asset'],
  consumablesExpense: ['expense'],
  inventoryAdjustments: ['expense'],
  purchaseVariance: ['expense'],
  practitionerFees: ['expense'],
  practitionerPayable: ['liability'],
};
