import { Types, type ClientSession } from 'mongoose';
import { conflict, validationError } from '../../http/errors.js';
import { mapped, postEntry, settingsOf, type Lean } from '../accounting/accounting.posting.js';
import type { MappingKey } from '../accounting/accounting.model.js';
import { nextNumber } from '../finance/finance.model.js';
import {
  StockBalanceModel,
  StockDocumentModel,
  StockItemModel,
  StockMoveModel,
  type StockDocument,
  type StockDocumentType,
  type StockItem,
  type StockMove,
  type Warehouse,
} from './inventory.model.js';

// The stock engine (docs/architecture/INVENTORY.md). Every function runs inside the caller's
// transaction. An item is write-locked first (its lockSeq is bumped), so two transactions touching
// the same item conflict and one retries: valuation and quantities can never interleave.

export type Ctx = { organizationId: Types.ObjectId; userId: Types.ObjectId };
type ItemState = Lean<StockItem>;

export async function lockItem(ctx: Ctx, itemId: Types.ObjectId, session: ClientSession): Promise<ItemState> {
  const item = await StockItemModel.findOneAndUpdate(
    { organizationId: ctx.organizationId, _id: itemId, status: 'active' },
    { $inc: { lockSeq: 1 } },
    { session, returnDocument: 'after' },
  ).lean<ItemState>();
  if (!item) throw validationError({ itemId: 'not_available' });
  return item;
}

type MoveDraft = Omit<StockMove, 'organizationId' | 'documentId' | 'createdAt' | 'date' | 'type'>;

/** Stock in: a lot (with expiry) for lot-tracked items, valued at `value` minor units in total. */
export async function stockIn(
  ctx: Ctx,
  item: ItemState,
  warehouse: Lean<Warehouse>,
  line: { qty: number; lot?: string | null; expiry?: string | null; value: number },
  session: ClientSession,
): Promise<MoveDraft> {
  if (!Number.isSafeInteger(line.qty) || line.qty <= 0) throw validationError({ qty: 'out_of_range' });
  if (!Number.isSafeInteger(line.value) || line.value < 0) throw validationError({ unitCost: 'out_of_range' });
  const lot = item.tracking === 'lot' ? (line.lot ?? '').trim() : '';
  const expiry = item.tracking === 'lot' ? (line.expiry ?? null) : null;
  if (item.tracking === 'lot' && (!lot || !expiry)) throw validationError({ lot: 'lot_and_expiry_required' });
  const existing = await StockBalanceModel.findOne({ organizationId: ctx.organizationId, itemId: item._id, warehouseId: warehouse._id, lot })
    .session(session)
    .lean();
  if (existing && existing.expiry !== expiry) throw conflict('LOT_EXPIRY_MISMATCH', 'This lot already has another expiry date');
  await StockBalanceModel.updateOne(
    { organizationId: ctx.organizationId, itemId: item._id, warehouseId: warehouse._id, lot },
    { $inc: { qty: line.qty }, $setOnInsert: { branchId: warehouse.branchId, expiry } },
    { session, upsert: true },
  );
  await StockItemModel.updateOne(
    { organizationId: ctx.organizationId, _id: item._id },
    { $inc: { onHand: line.qty, stockValue: line.value } },
    { session },
  );
  item.onHand += line.qty;
  item.stockValue += line.value;
  return {
    itemId: item._id,
    warehouseId: warehouse._id,
    branchId: warehouse.branchId,
    lot,
    expiry,
    qty: line.qty,
    value: line.value,
    onHandAfter: item.onHand,
    valueAfter: item.stockValue,
  };
}

/**
 * Stock out at moving-average cost. Without a lot, lots are picked first-expiring-first (FEFO);
 * expired lots are skipped unless `allowExpired` (write-offs). Refuses more than is on hand.
 */
export async function stockOut(
  ctx: Ctx,
  item: ItemState,
  warehouse: Lean<Warehouse>,
  line: { qty: number; lot?: string | null },
  today: string,
  options: { allowExpired: boolean },
  session: ClientSession,
): Promise<MoveDraft[]> {
  if (!Number.isSafeInteger(line.qty) || line.qty <= 0) throw validationError({ qty: 'out_of_range' });
  const lotGiven = item.tracking === 'lot' ? (line.lot ?? '').trim() : '';
  const picks: { lot: string; expiry: string | null; qty: number }[] = [];
  if (item.tracking === 'none' || lotGiven) {
    const b = await StockBalanceModel.findOne({ organizationId: ctx.organizationId, itemId: item._id, warehouseId: warehouse._id, lot: lotGiven })
      .session(session)
      .lean();
    if (b?.expiry && b.expiry < today && !options.allowExpired) throw conflict('LOT_EXPIRED', 'This lot has expired; write it off instead');
    picks.push({ lot: lotGiven, expiry: b?.expiry ?? null, qty: line.qty });
  } else {
    const lots = (
      await StockBalanceModel.find({ organizationId: ctx.organizationId, itemId: item._id, warehouseId: warehouse._id, qty: { $gt: 0 } })
        .session(session)
        .lean()
    )
      .filter((b) => options.allowExpired || !b.expiry || b.expiry >= today)
      .sort((a, b) => (a.expiry ?? '9999-12-31').localeCompare(b.expiry ?? '9999-12-31') || a.lot.localeCompare(b.lot));
    let left = line.qty;
    for (const b of lots) {
      if (left === 0) break;
      const take = Math.min(left, b.qty);
      picks.push({ lot: b.lot, expiry: b.expiry, qty: take });
      left -= take;
    }
    if (left > 0) throw conflict('INSUFFICIENT_STOCK', 'Not enough usable stock in this warehouse', { itemId: String(item._id) });
  }
  const moves: MoveDraft[] = [];
  for (const p of picks) {
    const taken = await StockBalanceModel.updateOne(
      { organizationId: ctx.organizationId, itemId: item._id, warehouseId: warehouse._id, lot: p.lot, qty: { $gte: p.qty } },
      { $inc: { qty: -p.qty } },
      { session },
    );
    if (taken.modifiedCount !== 1) throw conflict('INSUFFICIENT_STOCK', 'Not enough stock in this warehouse', { itemId: String(item._id) });
    // Moving average; the last units take the remaining value exactly (no rounding drift).
    const value = p.qty === item.onHand ? item.stockValue : Math.round((item.stockValue * p.qty) / item.onHand);
    await StockItemModel.updateOne(
      { organizationId: ctx.organizationId, _id: item._id },
      { $inc: { onHand: -p.qty, stockValue: -value } },
      { session },
    );
    item.onHand -= p.qty;
    item.stockValue -= value;
    moves.push({
      itemId: item._id,
      warehouseId: warehouse._id,
      branchId: warehouse.branchId,
      lot: p.lot,
      expiry: p.expiry,
      qty: -p.qty,
      value: -value,
      onHandAfter: item.onHand,
      valueAfter: item.stockValue,
    });
  }
  return moves;
}

/** Saves the document and its moves, and posts its value when the ledger is active for `date`. */
export async function saveDocument(
  ctx: Ctx,
  doc: Omit<StockDocument, 'organizationId' | 'number' | 'createdAt' | 'entryId' | 'totalValue' | 'reversedBy' | 'createdBy'> & {
    _id: Types.ObjectId;
  },
  moves: MoveDraft[],
  posting: { debit: MappingKey; credit: MappingKey } | null,
  session: ClientSession,
): Promise<Lean<StockDocument>> {
  const year = Number(doc.date.slice(0, 4));
  const seq = await nextNumber(ctx.organizationId, `SD:${year}`, session);
  const number = `SD-${year}-${String(seq).padStart(6, '0')}`;
  // Transfers move value between warehouses of the same entity: their total is what left.
  const totalValue = Math.abs(moves.filter((m) => (doc.type === 'transfer' ? m.qty < 0 : true)).reduce((s, m) => s + m.value, 0));
  let entryId: Types.ObjectId | null = null;
  const settings = await settingsOf(ctx.organizationId, session);
  if (posting && totalValue > 0 && settings && doc.date >= settings.cutoverDate) {
    const entry = await postEntry(
      {
        ...ctx,
        date: doc.date,
        journal: 'inventory',
        memo: number,
        lines: [
          { accountId: mapped(settings, posting.debit), debit: totalValue, branchId: doc.branchId },
          { accountId: mapped(settings, posting.credit), credit: totalValue, branchId: doc.branchId },
        ],
        source: { type: 'stock', id: doc._id, event: doc.type },
      },
      session,
      settings,
    );
    entryId = entry._id;
  }
  await StockMoveModel.insertMany(
    moves.map((m) => ({ ...m, organizationId: ctx.organizationId, documentId: doc._id, type: doc.type, date: doc.date })),
    { session },
  );
  const [created] = await StockDocumentModel.create(
    [{ ...doc, organizationId: ctx.organizationId, number, totalValue, entryId, reversedBy: null, createdBy: ctx.userId }],
    { session },
  );
  return created!.toObject() as Lean<StockDocument>;
}

/** Ledger accounts of each stock document type (debit, credit); transfers do not post. */
export const STOCK_POSTINGS: Partial<Record<StockDocumentType, { debit: MappingKey; credit: MappingKey }>> = {
  opening: { debit: 'inventory', credit: 'openingEquity' },
  write_off: { debit: 'inventoryAdjustments', credit: 'inventory' },
  issue: { debit: 'consumablesExpense', credit: 'inventory' },
  consumption: { debit: 'consumablesExpense', credit: 'inventory' },
  consumption_return: { debit: 'inventory', credit: 'consumablesExpense' },
  receipt: { debit: 'inventory', credit: 'grni' },
  purchase_return: { debit: 'grni', credit: 'inventory' },
};

export const newId = () => new Types.ObjectId();
