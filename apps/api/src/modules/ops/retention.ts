import mongoose from 'mongoose';

// Retention CONFIGURATION and a read-only report (docs/operations/RETENTION.md). Retention periods
// are a legal decision (E4, P11) and are not set: nothing here deletes anything. The report shows,
// per data class, how many records are older than a configured period so a human can decide.
// Automatic expiry that already exists is listed for completeness (sessions, spent tokens,
// development mail) — those hold no business records.

export const RETENTION_CLASSES = {
  ownership_inquiries: { collection: 'ownership_inquiries', dateField: 'updatedAt', env: 'RETENTION_INQUIRIES_DAYS' },
  contact_messages: { collection: 'contact_messages', dateField: 'updatedAt', env: 'RETENTION_CONTACT_DAYS' },
  support_requests: { collection: 'support_requests', dateField: 'lastActivityAt', env: 'RETENTION_SUPPORT_DAYS' },
  audit_events: { collection: 'audit_events', dateField: 'createdAt', env: 'RETENTION_AUDIT_DAYS' },
  platform_audit_events: { collection: 'platform_audit_events', dateField: 'createdAt', env: 'RETENTION_PLATFORM_AUDIT_DAYS' },
  billing_events: { collection: 'billing_events', dateField: 'createdAt', env: 'RETENTION_BILLING_EVENTS_DAYS' },
} as const;

export const AUTOMATIC_EXPIRY = [
  { collection: 'sessions', rule: 'at session expiry (MongoDB TTL)' },
  { collection: 'platform_operator_sessions', rule: 'at session expiry (MongoDB TTL)' },
  { collection: 'account_tokens', rule: '7 days after token expiry (MongoDB TTL)' },
  { collection: 'dev_mail_sink', rule: '24 hours (development only, MongoDB TTL)' },
];

export type RetentionRow = { dataClass: string; configuredDays: number | null; olderThanPeriod: number | null; total: number };

export function retentionConfig(env: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(RETENTION_CLASSES).map(([k, v]) => {
      const raw = env[v.env];
      const days = raw && /^\d{1,5}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
      return [k, days];
    }),
  ) as Record<keyof typeof RETENTION_CLASSES, number | null>;
}

/** Counts only. Never deletes. */
export async function retentionReport(env: Record<string, string | undefined>, now = new Date()): Promise<RetentionRow[]> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database connection');
  const config = retentionConfig(env);
  const rows: RetentionRow[] = [];
  for (const [dataClass, spec] of Object.entries(RETENTION_CLASSES) as [
    keyof typeof RETENTION_CLASSES,
    (typeof RETENTION_CLASSES)[keyof typeof RETENTION_CLASSES],
  ][]) {
    const days = config[dataClass];
    const coll = db.collection(spec.collection);
    const total = await coll.estimatedDocumentCount();
    const olderThanPeriod =
      days === null ? null : await coll.countDocuments({ [spec.dateField]: { $lt: new Date(now.getTime() - days * 86_400_000) } });
    rows.push({ dataClass, configuredDays: days, olderThanPeriod, total });
  }
  return rows;
}
