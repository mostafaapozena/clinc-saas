import { Types, type ClientSession } from 'mongoose';
import { HttpError, conflict } from '../../http/errors.js';
import { clock } from '../../time/clock.js';
import { addDays, localDateOf } from '../../time/local-time.js';
import { ensureCounter, nextNumber } from '../finance/finance.model.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import {
  AccountingSettingsModel,
  BankStatementLineModel,
  JournalEntryModel,
  LedgerAccountModel,
  type AccountingSettings,
  type EntryLine,
  type Journal,
  type JournalEntry,
  type MappingKey,
  type PartnerType,
} from './accounting.model.js';

// The posting engine (docs/architecture/ACCOUNTING.md). Every journal entry of the platform goes
// through postEntry: balanced, into active non-group accounts of the organization, in its
// currency, on an open date, once per source key.

export type Lean<T> = T & { _id: Types.ObjectId };
export type LineInput = {
  accountId: Types.ObjectId;
  debit?: number;
  credit?: number;
  branchId?: Types.ObjectId | null;
  partner?: { type: PartnerType; id: Types.ObjectId } | null;
  memo?: string;
};
export type PostInput = {
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  date: string;
  journal: Journal;
  memo?: string;
  lines: LineInput[];
  source: { type: string; id: Types.ObjectId | null; event: string };
  /** Defaults to `${type}:${id}:${event}`; manual entries pass a key built from the request. */
  sourceKey?: string;
  cashSessionId?: Types.ObjectId | null;
  reversalOf?: Types.ObjectId | null;
};

const MONTH = /^(\d{4})-(\d{2})$/;
export const monthOf = (date: string) => date.slice(0, 7);
/** Last calendar day of a YYYY-MM month. */
export function monthEnd(month: string): string {
  const m = MONTH.exec(month);
  if (!m) throw new Error('Invalid month');
  const next = Number(m[2]) === 12 ? `${Number(m[1]) + 1}-01-01` : `${m[1]}-${String(Number(m[2]) + 1).padStart(2, '0')}-01`;
  return addDays(next, -1);
}

export async function settingsOf(organizationId: Types.ObjectId, session?: ClientSession | null) {
  return AccountingSettingsModel.findOne({ organizationId })
    .session(session ?? null)
    .lean<Lean<AccountingSettings>>();
}

export async function organizationZone(organizationId: Types.ObjectId, session?: ClientSession | null): Promise<string> {
  const org = await OrganizationModel.findById(organizationId)
    .select('timeZone')
    .session(session ?? null)
    .lean();
  if (!org?.timeZone) throw conflict('TIME_ZONE_REQUIRED', 'An owner must choose the organization’s time zone first');
  return org.timeZone;
}

/** Today's date in the organization's time zone — the date business events are posted on. */
export async function ledgerToday(organizationId: Types.ObjectId, session?: ClientSession | null): Promise<string> {
  return localDateOf(clock.now(), await organizationZone(organizationId, session));
}

/** Entry-number counters must exist before a transaction uses them (see ensureCounter). */
export async function prepareLedger(organizationId: Types.ObjectId, dates: string[] = []): Promise<void> {
  const now = clock.now();
  const years = new Set([
    new Date(now.getTime() - 86_400_000).getUTCFullYear(),
    new Date(now.getTime() + 86_400_000).getUTCFullYear(),
    ...dates.map((d) => Number(d.slice(0, 4))),
  ]);
  await Promise.all([...years].map((y) => ensureCounter(organizationId, `JE:${y}`)));
}

/** Refuses dates before the ledger starts or inside a closed month. */
export function assertOpenDate(settings: Pick<AccountingSettings, 'cutoverDate' | 'lockedThrough'>, date: string) {
  if (date < settings.cutoverDate) throw conflict('BEFORE_CUTOVER', 'This date is before the ledger starts');
  if (settings.lockedThrough && date <= settings.lockedThrough)
    throw conflict('PERIOD_CLOSED', 'This date is in a closed month', {
      lockedThrough: settings.lockedThrough,
    });
}

export const mapped = (settings: Pick<AccountingSettings, 'mappings'>, key: MappingKey) => settings.mappings[key] as Types.ObjectId;

export async function postEntry(input: PostInput, session: ClientSession, settingsIn?: Lean<AccountingSettings> | null) {
  const settings = settingsIn ?? (await settingsOf(input.organizationId, session));
  if (!settings) throw conflict('ACCOUNTING_NOT_SET_UP', 'Accounting is not set up for this organization');
  const sourceKey = input.sourceKey ?? `${input.source.type}:${String(input.source.id)}:${input.source.event}`;
  const existing = await JournalEntryModel.findOne({
    organizationId: input.organizationId,
    sourceKey,
  })
    .session(session)
    .lean<Lean<JournalEntry>>();
  if (existing) return existing;
  assertOpenDate(settings, input.date);

  const lines: EntryLine[] = input.lines
    .map((l) => ({
      accountId: l.accountId,
      debit: l.debit ?? 0,
      credit: l.credit ?? 0,
      branchId: l.branchId ?? null,
      partner: l.partner ?? null,
      memo: l.memo ?? '',
    }))
    .filter((l) => l.debit !== 0 || l.credit !== 0);
  for (const l of lines) {
    const ok =
      Number.isSafeInteger(l.debit) && Number.isSafeInteger(l.credit) && l.debit >= 0 && l.credit >= 0 && (l.debit === 0) !== (l.credit === 0);
    if (!ok) throw new HttpError(400, 'INVALID_ENTRY_LINE', 'Each line has either a debit or a credit');
  }
  const debit = lines.reduce((s, l) => s + l.debit, 0);
  const credit = lines.reduce((s, l) => s + l.credit, 0);
  if (lines.length < 2 || debit !== credit || debit <= 0 || !Number.isSafeInteger(debit))
    throw new HttpError(400, 'UNBALANCED_ENTRY', 'Debits and credits must be equal and above zero');

  const ids = [...new Set(lines.map((l) => String(l.accountId)))].map((id) => new Types.ObjectId(id));
  const accounts = await LedgerAccountModel.find({
    organizationId: input.organizationId,
    _id: { $in: ids },
    status: 'active',
    isGroup: false,
  })
    .session(session)
    .lean();
  if (accounts.length !== ids.length) throw conflict('ACCOUNT_NOT_POSTABLE', 'An account is archived, a group, or not in this chart');

  const year = Number(input.date.slice(0, 4));
  const seq = await nextNumber(input.organizationId, `JE:${year}`, session);
  const [created] = await JournalEntryModel.create(
    [
      {
        organizationId: input.organizationId,
        number: `JE-${year}-${String(seq).padStart(6, '0')}`,
        date: input.date,
        journal: input.journal,
        memo: input.memo ?? '',
        lines,
        total: debit,
        currency: settings.currency,
        source: input.source,
        sourceKey,
        cashSessionId: input.cashSessionId ?? null,
        reversalOf: input.reversalOf ?? null,
        reversedBy: null,
        createdBy: input.userId,
      },
    ],
    { session },
  );
  if (!created) throw new Error('Expected a journal entry');
  return created.toObject() as Lean<JournalEntry>;
}

/** A linked reversal: same lines with debit and credit swapped, on an open date. */
export async function reverseEntry(
  organizationId: Types.ObjectId,
  userId: Types.ObjectId,
  entryId: Types.ObjectId,
  date: string,
  memo: string,
  session: ClientSession,
) {
  const original = await JournalEntryModel.findOne({
    organizationId,
    _id: entryId,
  })
    .session(session)
    .lean<Lean<JournalEntry>>();
  if (!original) return null;
  if (original.reversedBy) throw conflict('ENTRY_ALREADY_REVERSED', 'This entry was already reversed');
  if (original.reversalOf) throw conflict('ENTRY_IS_REVERSAL', 'A reversal cannot be reversed; post a new entry instead');
  if (
    await BankStatementLineModel.exists({
      organizationId,
      'match.entryId': entryId,
    }).session(session)
  )
    throw conflict('ENTRY_RECONCILED', 'Unmatch the bank statement line before reversing this entry');
  if (date < original.date) throw conflict('REVERSAL_BEFORE_ORIGINAL', 'A reversal cannot be dated before the entry');
  const reversal = await postEntry(
    {
      organizationId,
      userId,
      date,
      journal: original.journal,
      memo,
      lines: original.lines.map((l) => ({
        ...l,
        debit: l.credit,
        credit: l.debit,
      })),
      source: { type: 'reversal', id: original._id, event: 'reverse' },
      cashSessionId: original.cashSessionId,
      reversalOf: original._id,
    },
    session,
  );
  const linked = await JournalEntryModel.updateOne(
    { organizationId, _id: original._id, reversedBy: null },
    { $set: { reversedBy: reversal._id } },
    { session },
  );
  if (linked.modifiedCount !== 1) throw conflict('ENTRY_ALREADY_REVERSED', 'This entry was already reversed');
  return { original, reversal };
}

/** Signed balance (debit − credit) of one account up to and including a date. */
export async function accountBalance(organizationId: Types.ObjectId, accountId: Types.ObjectId, upTo?: string, session?: ClientSession) {
  const rows = await JournalEntryModel.aggregate<{ net: number }>([
    {
      $match: {
        organizationId,
        'lines.accountId': accountId,
        ...(upTo ? { date: { $lte: upTo } } : {}),
      },
    },
    { $unwind: '$lines' },
    { $match: { 'lines.accountId': accountId } },
    {
      $group: {
        _id: null,
        net: { $sum: { $subtract: ['$lines.debit', '$lines.credit'] } },
      },
    },
  ]).session(session ?? null);
  return rows[0]?.net ?? 0;
}
