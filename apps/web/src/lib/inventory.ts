// Inventory and medical consumables (docs/architecture/INVENTORY.md). Quantities are integers in
// the item's base unit; values (minor units) are present only for roles that may see costs.

export type StockItem = {
  id: string;
  code: string;
  name: string;
  category: string;
  baseUnit: string;
  purchaseUnits: { unit: string; factor: number }[];
  tracking: 'none' | 'lot';
  reorderLevel: number;
  status: 'active' | 'archived';
  onHand: number;
  belowReorder: boolean;
  version: number;
  stockValue?: number;
  averageCost?: number | null;
};
export type Warehouse = { id: string; name: string; branchId: string; status: 'active' | 'archived' };
export type StockBalance = { itemId: string; warehouseId: string; lot: string; expiry: string | null; qty: number; expired: boolean };
export type StockMove = {
  id: string;
  documentId: string;
  documentNumber?: string | null;
  type: string;
  date: string;
  itemId: string;
  warehouseId: string;
  lot: string;
  expiry: string | null;
  qty: number;
  onHandAfter: number;
  value?: number;
  valueAfter?: number;
};
export type StockDocument = {
  id: string;
  number: string;
  type: string;
  date: string;
  warehouseId: string;
  toWarehouseId: string | null;
  reason: string;
  source: { encounterId: string | null; recordItemId: string | null; documentId: string | null };
  reversalOf: string | null;
  reversedBy: string | null;
  createdAt: string;
  totalValue?: number;
};

export const inventoryKeys = {
  all: (orgId: string) => ['org', orgId, 'inventory'] as const,
  items: (orgId: string) => ['org', orgId, 'inventory', 'items'] as const,
  warehouses: (orgId: string) => ['org', orgId, 'inventory', 'warehouses'] as const,
  balances: (orgId: string, params: object) => ['org', orgId, 'inventory', 'balances', params] as const,
  moves: (orgId: string, params: object) => ['org', orgId, 'inventory', 'moves', params] as const,
  alerts: (orgId: string) => ['org', orgId, 'inventory', 'alerts'] as const,
  consumptions: (orgId: string, encounterId: string) => ['org', orgId, 'inventory', 'consumptions', encounterId] as const,
};
