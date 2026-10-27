# Retention configuration (milestone 5)

**Nothing is deleted automatically, except technical records that hold no business data.**

How long to keep inquiries, support requests, audit logs and billing events is a legal decision
(E4; proposal P11 for inquiries). Until it is made, these records are kept.

## Configuration (all unset)

| Data class | Variable | Date used |
| ---------- | -------- | --------- |
| Ownership inquiries | `RETENTION_INQUIRIES_DAYS` | last update |
| Contact messages (public contact page) | `RETENTION_CONTACT_DAYS` | last update |
| Support requests | `RETENTION_SUPPORT_DAYS` | last activity |
| Administrative audit | `RETENTION_AUDIT_DAYS` | creation |
| Platform audit | `RETENTION_PLATFORM_AUDIT_DAYS` | creation |
| Billing (webhook) events | `RETENTION_BILLING_EVENTS_DAYS` | creation |

Setting a variable **does not delete anything**. It only lets the read-only report count the
records older than the period:

```bash
npm run ops:retention-report -w @clinc/api
```

Clinical records, clinical audit and clinic finances are deliberately **not** in this list. Their
retention follows medical-record and tax law, which needs authoritative validation (Q9, E4).

## Automatic expiry already in place

| Collection | Rule |
| ---------- | ---- |
| `sessions`, `platform_operator_sessions` | removed at session expiry (TTL) |
| `account_tokens` | removed 7 days after token expiry |
| `dev_mail_sink` | removed after 24 hours (development only) |

## To decide before real data

- A period per class.
- Whether expiry means deletion or anonymization.
- Legal holds.
- Data-subject requests.

A deletion job would only be built after these decisions. It would run in dry-run mode first and
be audited.
