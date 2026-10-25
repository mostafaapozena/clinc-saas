// Clinic finances (docs/architecture/FINANCE.md). Money is an integer number of minor units with
// an explicit currency. Parsing never goes through floating point; formatting is display only.

export type Currency = 'EGP' | 'SAR';
export const MINOR_UNITS: Record<Currency, number> = { EGP: 100, SAR: 100 };

/** Arabic-Indic and Persian digits → ASCII digits. */
const toLatin = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/** "750.5" / "٧٥٠٫٥٠" → 75050; null for anything that is not a non-negative amount with ≤ 2 decimals. */
export function parseMoney(text: string): number | null {
  const s = toLatin(text.trim()).replace('٫', '.').replace(/,/g, '');
  const m = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number((m[2] ?? '').padEnd(2, '0'));
  return major * 100 + minor;
}

/** Minor units → plain decimal text for inputs ("75050" → "750.50"), exact. */
export function moneyInput(minor: number): string {
  return `${Math.trunc(minor / 100)}.${String(Math.abs(minor % 100)).padStart(2, '0')}`;
}

/** Localized currency text for display. */
export function formatMoney(minor: number, currency: string, language: string): string {
  // Division by 100 is exact enough for display of integers up to 10^9 at two decimals.
  return new Intl.NumberFormat(language === 'ar' ? 'ar-EG' : 'en', { style: 'currency', currency, minimumFractionDigits: 2 }).format(minor / 100);
}

export type FinanceService = {
  id: string;
  code: string;
  name: string;
  specialtyCode: string | null;
  status: 'active' | 'inactive';
  price: number;
  branchPrices: { branchId: string; price: number }[];
  effectivePrice?: number;
  currency: Currency;
  version: number;
};
export type Charge = {
  id: string;
  branchId: string;
  patientId: string;
  appointmentId: string | null;
  serviceId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  currency: Currency;
  status: 'pending' | 'invoiced' | 'voided';
  invoiceId: string | null;
  source: { type: 'manual' | 'clinical_procedure' | 'plan_item'; encounterId: string | null; itemId: string | null };
  voidReason: string | null;
  createdAt: string;
};
export type Invoice = {
  id: string;
  branchId: string;
  patientId: string;
  number: string | null;
  status: 'draft' | 'issued' | 'discarded';
  lines: { chargeId: string; description: string; quantity: number; unitPrice: number; amount: number }[];
  subtotal: number;
  discount: { amount: number; reason: string } | null;
  total: number;
  paid: number;
  credited: number;
  balance: number;
  currency: Currency;
  issuedAt: string | null;
  version: number;
  createdAt: string;
};
export type Payment = {
  id: string;
  branchId: string;
  patientId: string;
  number: string;
  amount: number;
  currency: Currency;
  method: 'cash' | 'card' | 'bank_transfer' | 'other';
  reference: string;
  receivedAt: string;
  allocations: { invoiceId: string; amount: number; invoiceNumber?: string | null }[];
  allocated: number;
  refunded: number;
  unallocated: number;
  status: 'active' | 'reversed';
  reversal: { reason: string; at: string } | null;
};
export type Adjustment = {
  id: string;
  type: 'credit_note' | 'refund';
  number: string;
  invoiceId: string | null;
  paymentId: string | null;
  amount: number;
  currency: Currency;
  reason: string;
  createdAt: string;
};
export type PatientRef = { id: string; fullName: string; patientNumber: number };
export type Account = {
  patient: PatientRef;
  currency: Currency | null;
  charges: Charge[];
  invoices: Invoice[];
  payments: Payment[];
  adjustments: Adjustment[];
  balance: { outstanding: number; unallocatedCredit: number; net: number };
};
export type Statement = {
  patient: PatientRef;
  entries: { at: string; type: string; number: string | null; debit: number; credit: number; currency: Currency; balance: number }[];
  balances: { currency: Currency; balance: number }[];
};
export type DocumentContext = { patient: PatientRef | null; branch: { id: string; name: string; city: string } | null; organization: { name: string } };
export type FinanceReport = {
  from: string;
  to: string;
  invoiced: { currency: Currency; count: number; subtotal: number; discounts: number; total: number }[];
  collected: { currency: Currency; method: Payment['method']; count: number; amount: number }[];
  adjustments: { currency: Currency; type: Adjustment['type']; count: number; amount: number }[];
  outstanding: { currency: Currency; amount: number }[];
  byService: { currency: Currency; service: string; quantity: number; amount: number }[];
};
export const PAYMENT_METHODS: Payment['method'][] = ['cash', 'card', 'bank_transfer', 'other'];
