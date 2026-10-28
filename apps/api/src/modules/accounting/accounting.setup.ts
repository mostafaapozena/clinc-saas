import { Types, type ClientSession } from 'mongoose';
import type { Currency } from '../finance/finance.model.js';
import { CHART_TEMPLATE, CHART_TEMPLATE_ID, TEMPLATE_MAPPINGS } from './accounting.chart.js';
import { AccountingSettingsModel, CashAccountModel, LedgerAccountModel, MAPPING_KEYS, type AccountingSettings } from './accounting.model.js';
import type { Lean } from './accounting.posting.js';

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
