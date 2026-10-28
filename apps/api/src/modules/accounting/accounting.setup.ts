import { Types, type ClientSession } from 'mongoose';
import type { Currency } from '../finance/finance.model.js';
import { CHART_TEMPLATE, CHART_TEMPLATE_ID, TEMPLATE_MAPPINGS } from './accounting.chart.js';
import { AccountingSettingsModel, CashAccountModel, LedgerAccountModel, MAPPING_KEYS, type AccountingSettings } from './accounting.model.js';
import type { Lean } from './accounting.posting.js';
import { AdjustmentModel, InvoiceModel, PaymentModel } from '../finance/finance.model.js';
import { StockDocumentModel } from '../inventory/inventory.model.js';

/**
 * Whether business documents already exist on or after the cutover instant. They were recorded
 * before the ledger existed, so they were never posted: a cutover before them would leave the
 * ledger short of them (opening entries only cover what came before the cutover).
 */
export async function documentsSince(organizationId: Types.ObjectId, since: Date): Promise<boolean> {
  const found = await Promise.all([
    InvoiceModel.exists({ organizationId, status: 'issued', issuedAt: { $gte: since } }),
    PaymentModel.exists({ organizationId, receivedAt: { $gte: since } }),
    AdjustmentModel.exists({ organizationId, createdAt: { $gte: since } }),
    StockDocumentModel.exists({ organizationId, createdAt: { $gte: since } }),
  ]);
  return found.some(Boolean);
}

/**
 * A template account added after a ledger was created (for example staff advances): created on
 * first use with the template's code (or the next free one) under the template's parent.
 */
export async function ensureTemplateAccount(organizationId: Types.ObjectId, key: string, session: ClientSession) {
  const existing = await LedgerAccountModel.findOne({ organizationId, templateKey: key }).session(session).lean();
  if (existing) return existing;
  const t = CHART_TEMPLATE.find((a) => a.key === key);
  if (!t) throw new Error(`Unknown template account ${key}`);
  const parentKey = t.parent ? CHART_TEMPLATE.find((a) => a.code === t.parent)?.key : undefined;
  const parent = parentKey ? await LedgerAccountModel.findOne({ organizationId, templateKey: parentKey }).session(session).lean() : null;
  let code = t.code;
  while (await LedgerAccountModel.exists({ organizationId, code }).session(session)) code = String(Number(code) + 1);
  const [created] = await LedgerAccountModel.create(
    [{ organizationId, code, name: t.name, templateKey: key, type: t.type, isGroup: false, parentId: parent?._id ?? null, role: null }],
    { session },
  );
  return created!.toObject();
}

/**
 * Creates the template chart, the posting map and the organization-level cashbox and bank account,
 * inside the caller's transaction (the setup route and the demo seed).
 */
export async function createLedger(
  input: { organizationId: Types.ObjectId; userId: Types.ObjectId; currency: Currency; cutoverDate: string; requireCashSession: boolean },
  session: ClientSession,
): Promise<Lean<AccountingSettings>> {
  const { organizationId } = input;
  const ids = new Map<string, Types.ObjectId>();
  for (const a of CHART_TEMPLATE) ids.set(a.code, new Types.ObjectId());
  await LedgerAccountModel.insertMany(
    CHART_TEMPLATE.map((a) => ({
      _id: ids.get(a.code),
      organizationId,
      code: a.code,
      name: a.name,
      templateKey: a.key,
      type: a.type,
      isGroup: a.group ?? false,
      parentId: a.parent ? ids.get(a.parent) : null,
      role: a.role ?? null,
    })),
    { session },
  );
  const mappings = Object.fromEntries(MAPPING_KEYS.map((k) => [k, ids.get(TEMPLATE_MAPPINGS[k])]));
  const [created] = await AccountingSettingsModel.create(
    [
      {
        organizationId,
        currency: input.currency,
        cutoverDate: input.cutoverDate,
        template: CHART_TEMPLATE_ID,
        mappings,
        requireCashSession: input.requireCashSession,
        createdBy: input.userId,
      },
    ],
    { session },
  );
  if (!created) throw new Error('Expected settings');
  // The template's cashbox and bank account become the organization-level cash accounts.
  await CashAccountModel.insertMany(
    [
      { organizationId, name: 'Main cashbox', kind: 'cash', branchId: null, accountId: ids.get('1110') },
      { organizationId, name: 'Bank account', kind: 'bank', branchId: null, accountId: ids.get('1120') },
    ],
    { session },
  );
  return created.toObject() as Lean<AccountingSettings>;
}
