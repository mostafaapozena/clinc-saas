# Architecture and scalability review (2026-10-25)

This review is based on the code, query plans, a MongoDB profiler and a load test. It is not
inferred from the folder layout or the test count. Load numbers, the environment and the method
are in [LOAD_TESTING.md](../operations/LOAD_TESTING.md). Branch: `phase-12/scalability-subscriptions`.

**Summary.**
- **The overall shape holds up:** a modular monolith with tenant-scoped data enforced in the data
  layer, server-side state in MongoDB, and no in-process business state. No microservice or extra
  infrastructure is needed for the scale evidenced so far.
- **The load test found five concrete defects (S1 to S5)** that would have failed a single large
  clinic at about 20 requests per second. All are fixed and re-measured.
- **One process-local assumption, in-memory rate limits (M1), is now shared**, and was tested with
  two real API processes.
- **Remaining limits are listed at the end.** Nothing here is a production capacity guarantee.

## What was checked and found sound

### Module boundaries and data access

**Module boundaries.** `apps/api/src/modules/*` group routes, models and services by domain.
- Dependencies point from features to shared tenancy, authentication, HTTP and time helpers.
- The platform module reads organization metadata but no clinical or finance collections.
- There are no circular runtime dependencies that cause problems; TypeScript and ESLint pass.

**Tenant isolation.**
- **Data layer.** Every tenant model carries a `tenantGuardPlugin` that throws when a query lacks
  `organizationId`. This review hit it once, in a test, which shows it working.
- **Route layer.**
  - `requireMembership` and `requirePermission` guard access, and branch scope comes from
    `orgScope`.
  - Clinical access additionally requires the treating relationship or explicit coverage.
- **Tests.** Cross-tenant tests exist for every module. The new acceptance journey J10 covers the
  boundaries in the browser.

**Specialty templates.** Templates are versioned (`template` and `version` are stored with each
record), and derived views are computed from finalized records. Old records stay readable when a
template changes.

### Queries and request patterns

**Bounded queries.**
- Appointment lists stop at a maximum result count.
- The queue reads at most 500 items, today only.
- Lists of support requests, inquiries, operators and the audit are capped (100 or 50) or use
  cursors.
- The appointment, queue, dashboard, availability, finance and support queries use compound
  indexes led by `organizationId`. Explain plans show 0–4 ms and only matching documents
  examined, on a 50,000-patient tenant.

**N+1 queries.**
- The DTO builders batch their lookups (`$in` on ids).
- The operator organization list makes one query for the subscriptions of all listed
  organizations.
- No per-row query loops were found on the measured paths.

**Polling.** The front-end polls the queue every 30 s and the home dashboard every 60 s. Both
requests are measured scenarios: they take single-digit milliseconds at 40 rps.

**Front-end requests.** TanStack Query keys include the organization (and branch), so a scope
change never shows another scope's data (tested in `workspace.spec.ts`). Requests are cancelled
through `AbortSignal`.

### State, background work and logging

**State that must survive multiple replicas** is in MongoDB:
- sessions and operator sessions;
- CSRF tokens (stored in the session);
- idempotency keys (in the documents themselves, behind unique indexes);
- the slot reservations that prevent double booking (unique index);
- counters and financial numbering (atomic `$inc`);
- webhook dedupe;
- account tokens;
- and now rate-limit counters.

The two-process check proves sessions, idempotency, webhook dedupe and concurrent booking across
processes.

**Background jobs.** Nothing runs on an in-process timer.
- Expiry of sessions, tokens and the development mail sink uses MongoDB TTL indexes.
- Subscription expiry is derived when read.
- The new lifecycle pass runs on demand (operator or CLI) and is idempotent under concurrent runs
  (tested). It therefore needs an external scheduler once hosting is chosen, and is safe if two
  run at once.

**Logging and audit.**
- Logs are structured JSON with sensitive fields redacted.
- Audit collections are insert-only with indexes for their read paths.
- They grow without limit until retention periods are decided ([RETENTION.md](../operations/RETENTION.md)).
- There are no unbounded in-memory structures: the in-memory rate limiter was removed, and the
  event-loop histogram is reset at every read.

**Local files.** There are no uploads. Only the operator backup tool writes a file.

## Findings and corrections

| # | Finding (evidence) | Failure scenario | Severity | Correction | Verification |
| - | ------------------ | ---------------- | -------- | ---------- | ------------ |
| S1 | Patient list and search returned an exact `total`. `countDocuments` read **every** matching patient: 50,000 documents and 130–160 ms per page view in the large tenant (explain). | Each receptionist page view costs a full-tenant scan. At 20 rps, MongoDB read latency averaged 458 ms and 52.7% of requests timed out (baseline run). | High | The count stops at 1,000 (`totalCapped`). The UI says "more than 1,000, refine the search". | `patient-search-scale.test.ts`; load re-run |
| S2 | Name search was an unanchored `$regex` on `nameKey`, which cannot use an index. A rare term scanned the whole tenant. | Search cost grows with tenant size, not with the number of results. | High | `nameTokens` (the words of the normalized name), index `{organizationId, nameTokens}`, and word-prefix matching of every typed word in any order. Backfill: `npm run ops:backfill-patient-search` (idempotent). **Behavior change:** the middle of a word no longer matches ("حمد" does not find "محمد"). | Tests (prefix, order, Arabic normalization, mid-word non-match, backfill idempotency, index use) |
| S3 | **Cross-tenant plan cache.** The recent-first list examined all 50,000 patients (13 s; profiler). MongoDB cached a plan that won on a small tenant (1,000 patients) and reused it for the 50,000-patient tenant. The `{createdAt:-1}` index also lacked the `_id` tie-breaker of the real sort. | Large tenants become arbitrarily slow, depending on which tenant first warmed the cache. | High | Index `{organizationId, createdAt:-1, _id:-1}` and an explicit `hint` per sort (and the token index for name-only searches). | `query-plans.test.ts` (no blocking sort); load re-run |
| S4 | Mongoose's `connection.transaction` retried conflicting transactions for up to **2 minutes**. At 40 rps, 114 of 226 transactions were aborted. The retries kept running after clients timed out, amplifying overload. | Cascading overload: retry storms on bookings and status changes. | Medium-high | `runTransaction`: at most 8 attempts and about 3 s with capped, jittered backoff, then 409 `CONCURRENT_UPDATE`. All 14 call sites use it. Mongoose still resets document state between attempts. A first version with 4 attempts (about 0.3 s) made deliberately raced tests lose their precise business error (e.g. `SCHEDULE_CONFLICT`), so the budget was widened. | `query-plans.test.ts`; at 160 rps the system now answers `CONCURRENT_UPDATE` quickly instead of hanging |
| S5 | The booking idempotency lookup `{organizationId, createdBy, idempotencyKey}` examined about 40,000 appointments (6–7 s; profiler). Its unique index is partial (`$type: 'string'`), and a plain equality does not let MongoDB use a partial index. The same issue affected the provider-subscription lookup. | Every booking scans the tenant's appointments. | High | The queries add the explicit `$type: 'string'`, which makes the partial index eligible. | `query-plans.test.ts` (index in the winning plan); load re-run (booking p95 29 ms at 20 rps) |
| M1 | Rate limits lived in process memory (`MemoryStore`). | With N replicas an attacker gets N× the attempts, and limits reset on every deploy. | High (security) | Counters are stored in MongoDB: fixed windows, an atomic upsert, hashed keys, TTL. Sign-in, password reset and operator sign-in also have per-account limits. If the store fails, limited routes answer 503 (fail closed). `RATE_LIMIT_STORE=memory` is refused in production. | `multi-replica.test.ts` (7 tests); `scripts/ops/two-process-check.mjs` (8/8 with two real processes) |
| M2 | The payment simulator's webhook secret was random per process. | With two replicas, a webhook signed by one replica fails verification on the other. | Low (simulator only; refused in production) | Documented: set `BILLING_SIMULATOR_SECRET` whenever more than one process runs. The two-process check does. | Two-process check (webhook verified on B, duplicate detected) |
| P1 | No time limit on expensive reads. A query kept running after the client gave up. | Runaway queries occupy the database under overload. | Medium | `maxTimeMS` of 5 s on patient list and search (the measured hotspot), mapped to 503 `QUERY_TIMEOUT`. | Load re-run (no unexpected 500s) |

## Remaining limits (not fixed, stated plainly)

### Data and query behavior

- **Common-name searches.** In the largest tenant (50,000 patients), searching a very common first
  name fetches about 5,000 matching documents to sort the first page (100–140 ms each). Search
  becomes the main database cost at saturation (profile at 160 rps). Options if real data shows
  this matters:
  - sort search results by name over a dedicated index;
  - an equality index for full words;
  - a search engine.
  None of these is needed yet.
- **Query time limits.** `maxTimeMS` is set only on the patient queries. Other bounded queries rely
  on their indexes. A global per-request deadline is not implemented.
- **Booking contention.** Bookings for the same practitioner serialize on the practitioner's
  `scheduleSeq`. This is a correctness feature: it serializes against schedule changes. Under heavy
  concurrent booking for one doctor, some requests now get a fast 409 to retry.

### Single-host measurements

- **Test environment.** Capacity was measured on one 2-CPU Codespace. MongoDB, the API, the load
  generator and the idle dev servers all shared those CPUs, and MongoDB was a single node.
- **Replicas.** A second API replica on the same 2 CPUs gave no extra capacity (measured: p95 886 ms
  vs 448 ms at 120 rps). It shows only that the system stays correct with two replicas, and says
  nothing about separate hosts.
- **Unmeasured.** Real horizontal scaling, network latency, larger tenants, a replica-set failover,
  and MongoDB on its own hardware.

### Operations

- **Audit growth and retention** await the legal decision (E4).
- **Index builds on large existing collections** happen at startup (`ensureIndexes`). With real
  data, build them ahead of a deploy, then run the token backfill (see [RUNBOOK.md](../operations/RUNBOOK.md#database-migrations)).
- **The connection pool** uses the driver default (100 per process). The peak observed was 128
  MongoDB connections with one replica at 160 rps. Size the pool and MongoDB together when hosting
  is chosen.
