import { INQUIRY_COUNTRIES, INQUIRY_STATUSES, OwnershipInquiryModel, type InquiryStatus, type OwnershipInquiry } from './inquiry.model.js';

// Operator review of custom-ownership inquiries (used by src/scripts/inquiries.ts). Runs with
// server-side database access only; there is deliberately no HTTP endpoint for any of this.

export type ReviewCommand =
  | { kind: 'list'; status?: InquiryStatus; country?: (typeof INQUIRY_COUNTRIES)[number]; since?: Date; limit: number }
  | { kind: 'show'; reference: string; showContact: boolean }
  | { kind: 'set-status'; reference: string; status: InquiryStatus }
  | { kind: 'help'; error?: string };

export const REVIEW_USAGE = `Usage:
  npm run inquiries -w @clinc/api -- list [--status new|reviewed|closed] [--country EG|SA|other] [--since YYYY-MM-DD] [--limit 1-100]
  npm run inquiries -w @clinc/api -- show <reference> [--show-contact]
  npm run inquiries -w @clinc/api -- set-status <reference> new|reviewed|closed

Contact details are masked unless --show-contact is given for a single inquiry.`;

const REFERENCE = /^R-[A-Z0-9]{8}$/;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

/** Parses and validates command-line arguments; anything unexpected becomes a help result. */
export function parseReviewArgs(argv: string[]): ReviewCommand {
  const [command, ...rest] = argv;
  if (command === 'list') {
    const status = option(rest, '--status');
    const country = option(rest, '--country');
    const since = option(rest, '--since');
    const limitText = option(rest, '--limit') ?? '20';
    const limit = Number(limitText);
    if (status !== undefined && !(INQUIRY_STATUSES as readonly string[]).includes(status)) return { kind: 'help', error: 'Unknown status' };
    if (country !== undefined && !(INQUIRY_COUNTRIES as readonly string[]).includes(country)) return { kind: 'help', error: 'Unknown country' };
    if (since !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(since) || Number.isNaN(Date.parse(since)))) return { kind: 'help', error: 'Invalid --since date' };
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { kind: 'help', error: '--limit must be 1–100' };
    return {
      kind: 'list',
      status: status as InquiryStatus | undefined,
      country: country as (typeof INQUIRY_COUNTRIES)[number] | undefined,
      since: since ? new Date(`${since}T00:00:00Z`) : undefined,
      limit,
    };
  }
  if (command === 'show') {
    const reference = rest[0] ?? '';
    if (!REFERENCE.test(reference)) return { kind: 'help', error: 'Invalid reference' };
    return { kind: 'show', reference, showContact: rest.includes('--show-contact') };
  }
  if (command === 'set-status') {
    const [reference = '', status = ''] = rest;
    if (!REFERENCE.test(reference)) return { kind: 'help', error: 'Invalid reference' };
    if (!(INQUIRY_STATUSES as readonly string[]).includes(status)) return { kind: 'help', error: 'Unknown status' };
    return { kind: 'set-status', reference, status: status as InquiryStatus };
  }
  return { kind: 'help', error: command ? `Unknown command "${command}"` : undefined };
}

export const maskName = (name: string) => `${[...name.trim()][0] ?? ''}…`;
export const maskPhone = (e164: string) => `${e164.slice(0, 4)}${'•'.repeat(Math.max(0, e164.length - 6))}${e164.slice(-2)}`;
export function maskEmail(email: string) {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}

type InquiryLean = OwnershipInquiry & { _id: unknown };

function summary(i: InquiryLean) {
  return [
    i.reference,
    i.createdAt.toISOString().slice(0, 16).replace('T', ' '),
    i.status,
    i.country,
    i.organizationType,
    i.interest,
    i.organizationName,
    maskName(i.contactName),
  ].join(' | ');
}

function details(i: InquiryLean, showContact: boolean) {
  const contact = showContact
    ? [`Contact: ${i.contactName}`, `Phone: ${i.phone?.e164 ?? '—'}`, `Email: ${i.email ?? '—'}`]
    : [
        `Contact: ${maskName(i.contactName)}`,
        `Phone: ${i.phone ? maskPhone(i.phone.e164) : '—'}`,
        `Email: ${i.email ? maskEmail(i.email) : '—'}`,
        '(contact details masked; add --show-contact to reveal)',
      ];
  return [
    `Reference: ${i.reference}`,
    `Received: ${i.createdAt.toISOString()}`,
    `Status: ${i.status}${i.reviewedAt ? ` (reviewed ${i.reviewedAt.toISOString()})` : ''}`,
    `Organization: ${i.organizationName} (${i.organizationType}, ${i.country})`,
    `Interest: ${i.interest}`,
    `Language: ${i.language}`,
    ...contact,
    'Requirements:',
    i.description,
  ];
}

/** Executes a command and returns the lines to print. */
export async function runReview(command: ReviewCommand): Promise<string[]> {
  if (command.kind === 'help') return [...(command.error ? [`Error: ${command.error}`, ''] : []), REVIEW_USAGE];
  if (command.kind === 'list') {
    const filter: Record<string, unknown> = {};
    if (command.status) filter.status = command.status;
    if (command.country) filter.country = command.country;
    if (command.since) filter.createdAt = { $gte: command.since };
    const rows = await OwnershipInquiryModel.find(filter).sort({ createdAt: -1 }).limit(command.limit).lean();
    if (rows.length === 0) return ['No inquiries match.'];
    return ['reference | received (UTC) | status | country | type | interest | organization | contact', ...rows.map(summary)];
  }
  const inquiry = await OwnershipInquiryModel.findOne({ reference: command.reference }).lean();
  if (!inquiry) return [`No inquiry ${command.reference}.`];
  if (command.kind === 'show') return details(inquiry, command.showContact);
  await OwnershipInquiryModel.updateOne(
    { reference: command.reference },
    { $set: { status: command.status, reviewedAt: command.status === 'new' ? null : new Date() } },
  );
  return [`${command.reference}: status set to ${command.status}.`];
}
