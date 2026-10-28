// Suppliers, purchasing and payables (docs/architecture/PURCHASING.md). Prices are integer minor units
// per the line's unit; the API computes every total and balance.

export type PurchaseLine = {
  itemId: string | null;
  description: string;
  unit: string;
  factor: number;
  qty: number;
  unitPrice: number;
  amount: number;
  expenseAccountId: string | null;
  received?: number;
  billed?: number;
  returned?: number;
};
export type Supplier = {
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string;
  paymentTermsDays: number;
  status: 'active' | 'archived';
  notes: string;
  version: number;
};
export type PurchaseSettings = { approvalThreshold: number; separation: { approve: boolean; receive: boolean; pay: boolean }; version: number };
export type PurchaseRequest = {
  id: string;
  number: string;
  branchId: string;
  requestedBy: string;
  reason: string;
  lines: PurchaseLine[];
  estimatedTotal: number;
  status: 'submitted' | 'approved' | 'rejected' | 'ordered' | 'cancelled';
  decision: { by: string | null; at: string; reason: string; automatic: boolean } | null;
  version: number;
  createdAt: string;
};
export type Rfq = {
  id: string;
  number: string;
  requestId: string | null;
  branchId: string;
  supplierIds: string[];
  lines: PurchaseLine[];
  dueDate: string | null;
  status: 'open' | 'awarded' | 'closed';
  createdAt: string;
};
export type Quotation = {
  id: string;
  rfqId: string;
  supplierId: string;
  reference: string;
  lines: { lineIndex: number; unitPrice: number; qty: number; leadTimeDays: number }[];
  validUntil: string | null;
  terms: string;
};
export type RfqDetail = {
  rfq: Rfq;
  quotations: Quotation[];
  comparison: {
    lineIndex: number;
    description: string;
    qty: number;
    unit: string;
    offers: { supplierId: string; quotationId: string; unitPrice: number; qty: number; leadTimeDays: number; covers: boolean }[];
    bestPrice: string | null;
    fastest: string | null;
  }[];
  totals: { supplierId: string; quotationId: string; total: number; linesCovered: number; maxLeadTimeDays: number }[];
};
export type PurchaseOrder = {
  id: string;
  number: string;
  supplierId: string;
  branchId: string;
  warehouseId: string | null;
  source: { requestId: string | null; rfqId: string | null; quotationId: string | null };
  lines: PurchaseLine[];
  total: number;
  expectedDate: string | null;
  status: 'draft' | 'confirmed' | 'received' | 'closed' | 'cancelled';
  closeReason: string;
  version: number;
  createdAt: string;
};
export type GoodsReceipt = {
  id: string;
  number: string;
  orderId: string;
  kind: 'receipt' | 'return';
  lines: { lineIndex: number; qty: number; lot: string }[];
  note: string;
  createdAt: string;
};
export type SupplierBill = {
  id: string;
  number: string;
  supplierId: string;
  supplierReference: string;
  orderId: string | null;
  branchId: string;
  billDate: string;
  dueDate: string;
  lines: { orderLineIndex: number | null; description: string; qty: number; unitPrice: number; amount: number; credited: number }[];
  total: number;
  paid: number;
  credited: number;
  balance: number;
  status: 'awaiting_approval' | 'posted' | 'rejected';
  createdAt: string;
};
export type SupplierPayment = {
  id: string;
  number: string;
  supplierId: string;
  cashAccountId: string;
  date: string;
  amount: number;
  allocations: { billId: string; amount: number }[];
  reference: string;
};
export type SupplierCredit = {
  id: string;
  number: string;
  billId: string;
  supplierReference: string;
  amount: number;
  reason: string;
  createdAt: string;
};

export const purchasingKeys = {
  all: (orgId: string) => ['org', orgId, 'purchasing'] as const,
  settings: (orgId: string) => ['org', orgId, 'purchasing', 'settings'] as const,
  suppliers: (orgId: string) => ['org', orgId, 'purchasing', 'suppliers'] as const,
  requests: (orgId: string) => ['org', orgId, 'purchasing', 'requests'] as const,
  rfq: (orgId: string, id: string) => ['org', orgId, 'purchasing', 'rfq', id] as const,
  rfqs: (orgId: string) => ['org', orgId, 'purchasing', 'rfqs'] as const,
  orders: (orgId: string) => ['org', orgId, 'purchasing', 'orders'] as const,
  order: (orgId: string, id: string) => ['org', orgId, 'purchasing', 'order', id] as const,
  bills: (orgId: string) => ['org', orgId, 'purchasing', 'bills'] as const,
  bill: (orgId: string, id: string) => ['org', orgId, 'purchasing', 'bill', id] as const,
  aging: (orgId: string) => ['org', orgId, 'purchasing', 'aging'] as const,
};
