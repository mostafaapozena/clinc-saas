# Custom-ownership inquiries

Implemented in `apps/api/src/modules/inquiries/` and `apps/web/src/public/CustomSolutionsPages.tsx`.
Tested in `apps/api/test/inquiries.test.ts`, `apps/web/src/public/Public.test.tsx`,
`e2e/public.spec.ts`.

## What it is

A public form (`/custom-solutions/request`) for organizations that want a separately scoped
custom project (e.g. a radiology center) instead of the hosted workspace. Submissions are stored
as **platform records** (`ownership_inquiries`): no organization id, unrelated to patient records,
invisible to every tenant role. No message is sent and no response time is promised.

## Endpoint

`POST /api/v1/public/ownership-inquiries` — anonymous, write-only. There is **no** endpoint that
lists or reads inquiries (tested: anonymous and signed-in owners get `404`/`401` everywhere).

- Fields: contact name, organization name, country (`EG` | `SA` | `other`), phone
  (`{ country, number }`, Arabic-Indic digits accepted, normalized to E.164 with the same rules
  as patient phones) and/or email — **at least one** contact method — organization type,
  interest (a catalog specialty, `multi_specialty` or `custom`), description (10–1,500
  characters), language. Unknown fields are dropped; objects where strings are expected are
  rejected (no operator injection).
- `Idempotency-Key` header required: the same key and content returns the same reference
  (`200`, `replayed: true`) and stores one inquiry, also for simultaneous double submits; the same
  key with different content is `409 IDEMPOTENCY_KEY_REUSED`.
- Rate limited per IP (`INQUIRY_RATE_LIMIT_MAX` per hour, default 5); the origin check refuses
  cross-site posts. No CSRF token is involved because no session is used.
- Response: a reference such as `R-7KQ2M9XP` only.
- Logging: the request log has method and path only (never bodies or query strings), so contact
  details do not reach logs.
- The form tells visitors not to include patient names, medical records or patient information.
  Attachments are not accepted.

## Review script (operators only)

Runs with server-side database access (`MONGODB_URI` from `.env` or the environment) — the
authorization is access to the server, not an HTTP endpoint. No credentials are embedded.

```bash
npm run inquiries -w @clinc/api -- list [--status new|reviewed|closed] [--country EG|SA|other] [--since YYYY-MM-DD] [--limit 1-100]
npm run inquiries -w @clinc/api -- show R-XXXXXXXX              # contact details masked
npm run inquiries -w @clinc/api -- show R-XXXXXXXX --show-contact
npm run inquiries -w @clinc/api -- set-status R-XXXXXXXX reviewed
# built deployment: node apps/api/dist/scripts/inquiries.js list
```

Lists are bounded (default 20, at most 100) and show reference, date, status, country, type,
interest, organization and the contact's initial. Phone and email are masked unless
`--show-contact` is given for a single inquiry. Arguments are validated (statuses, countries,
reference format) before any query.

## Retention (proposal — needs owner and legal confirmation)

Keep an inquiry for 12 months after its last status change, then delete it; delete earlier on
request of the person who sent it. Not implemented automatically yet: retention must be approved
together with the privacy notice for the form before any public launch (DECISIONS.md, E4).
