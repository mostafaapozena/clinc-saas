# Load testing (scalability checkpoint, 2026-10-25)

The numbers below are **measured capacity for this environment and this workload only**. They are
not a production guarantee and not a "number of users" claim. Findings and fixes are in
[SCALABILITY_REVIEW.md](../architecture/SCALABILITY_REVIEW.md).

## Harness (repeatable)

```bash
# inside the Codespace; never against the preview database, production or any provider
node scripts/load/run.mjs --stages 20,40,80,120,160,200 --stage-seconds 60 --warmup-seconds 15 --replicas 1 [--profile-ms 50]
node scripts/load/explain.mjs          # explain plans of representative queries
node scripts/load/explain-search.mjs   # name-search plans for common / rare terms
node scripts/ops/two-process-check.mjs # two real API processes sharing one database
```

**What `scripts/load/run.mjs` does:**

1. **Fresh database.** It drops and rebuilds an isolated database. The name must contain
   `_load_test` (`clinc_load_test`).
2. **Dedicated API.** It starts its own API process(es) on private ports 4300+.
3. **Synthetic dataset.** It builds the organizations through the real API, then bulk-inserts
   patients and past or today's appointments.
4. **Open-model load.** It drives load at a fixed arrival rate per stage; this is not a closed
   loop.
5. **Sampling.** It samples the API (`/api/health/metrics`: event-loop delay, CPU, memory; enabled
   by `OPS_METRICS`, refused in production) and MongoDB (`serverStatus`) every 2 s.
6. **Stop thresholds.** It stops escalating at the first stage that breaches one:
   - p95 above 1.5 s;
   - failures above 1%;
   - event-loop p99 above 500 ms;
   - API resident memory above 1.5 GB;
   - host free memory below 700 MB;
   - any request not sent because 400 were already in flight.

**How outcomes are classed.** Expected business outcomes (409 conflicts, `SLOT_UNAVAILABLE`,
`INVALID_TRANSITION` on an already checked-in appointment) are counted separately from failures.
Failures are 5xx, timeouts (10 s) and network errors.

## Environment

| Item | Value |
| ---- | ----- |
| Host | GitHub Codespace, 2 vCPU (Intel Xeon Platinum 8370C), 7.9 GB RAM, Linux 6.8 (Azure) |
| Runtime | Node v24.21.0, MongoDB 8.2.12, single-node replica set in a container on the same host |
| API | 1 replica (one run with 2), `NODE_ENV=test`, `LOG_LEVEL=warn`, shared rate limits |
| Sharing | The load generator, MongoDB and the idle dev servers share the same 2 vCPUs |

## Dataset and workload

| Item | Value |
| ---- | ----- |
| Organizations | 20: one large (3 branches, 6 doctors, 4 receptionists, 1 accountant) and 19 small (1 branch, 1 doctor, 1 receptionist, 1 accountant) |
| Patients | 69,000 (50,000 in the large organization, 1,000 in each small one) |
| Appointments | 59,500 (past: 120 days; today: 20 per doctor) |
| Other data | 125 draft visit records; 88 registered users |
| Sessions | 88 users, each with **one** signed-in session used by the generator: about 52 tenant sessions in use plus 1 operator |
| Traffic split | 50% to the large organization, 50% spread over the small ones |
| Think time | None: an open arrival process at the stated rate. "Requests per second" is the measure, **not** concurrent users. |

**Workload mix (weights, in %):**

| Area | Scenario | Weight |
| ---- | -------- | ------ |
| Patients | name search | 14 |
| | phone search | 5 |
| | list page | 5 |
| | patient details | 8 |
| Appointments | today's appointments | 9 |
| | availability (next 30 days) | 6 |
| | booking (future, idempotent) | 5 |
| | check-in | 3 |
| Front desk | queue | 9 |
| | dashboard | 9 |
| Clinical | visit record read (treating doctor) | 5 |
| | draft save (versioned) | 4 |
| Finance | patient account | 5 |
| | manual charge (idempotent) | 3 |
| Support and operator | support list | 2 |
| | operator organization list | 2 |
| | operator support queue | 2 |

Each stage runs 60 s, after a 15 s warm-up at the first rate.

## Results

### Before the fixes (baseline, 1 replica)

| Target | Achieved | p50 | p95 | p99 | Failures | Notes |
| ------ | -------- | --- | --- | --- | -------- | ----- |
| 20 rps | 20 | 10.0 s | 10.0 s | 10.0 s | **52.7%** timeouts | API CPU 14%, but MongoDB read latency averaged 458 ms. The database was saturated by full-tenant counts and scans. Stopped. |

### After S1 and S2 (1 replica)

| Target | Achieved | p50 | p95 | p99 | Failures |
| ------ | -------- | --- | --- | --- | -------- |
| 20 rps | 20 | 29 ms | 976 ms | 2.7 s | 0% |
| 40 rps | 39.9 | 10 s | 10 s | 10 s | 65.4%. Stopped. |

The profiler then showed S3 (plan cache: 13 s list queries) and S5 (idempotency lookups of 6–7 s).

### After all fixes (S1–S5, P1; 1 replica)

| Target | Achieved | p50 | p95 | p99 | Failures | API CPU (avg) | Event-loop p99 | MongoDB read latency (avg) | Aborted / committed transactions |
| ------ | -------- | --- | --- | --- | -------- | ------------- | -------------- | -------------------------- | -------------------------------- |
| 20 rps | 20 | 10 ms | 26 ms | 49 ms | 0% | 14% | 15 ms | 0.6 ms | 8 / 152 |
| 40 rps | 40 | 10 ms | 31 ms | 52 ms | 0% | 24% | 17 ms | 0.6 ms | 34 / 271 |
| 80 rps | 80 | 12 ms | 77 ms | 235 ms | 0% | 44% | 62 ms | 0.8 ms | 76 / 481 |
| 120 rps | 120 | 60 ms | 448 ms | 888 ms | 0% | 67% | 108 ms | 1.6 ms | 186 / 682 |
| 160 rps | 137.5 | 1.4 s | 10 s | 10 s | 11.7% timeouts | 74% | 259 ms | 3.6 ms | 922 / 633 — **stopped** |

**At 120 rps, by scenario (p95):**

| Area | p95 |
| ---- | --- |
| Name search | 416 ms |
| Booking | 1.0 s |
| Clinical save | 700 ms |
| Queue | 541 ms |
| Finance account | 392 ms |

**Business conflicts**, which are not failures: 177 at 120 rps, mainly check-ins of appointments
already checked in.

At 160 rps the host is CPU-bound (load average 14.8 on 2 vCPU). Bookings started answering
`CONCURRENT_UPDATE` (52) quickly, which is the S4 behavior, instead of hanging.

### Final code (retry budget of 8 attempts / about 3 s; 1 replica) — the numbers to quote

The table above was measured with the first retry budget (4 attempts). After widening it (S4),
the run was repeated on the final commit:

| Target | Achieved | p50 | p95 | p99 | Failures | API CPU (avg) | Event-loop p99 | MongoDB read latency (avg) | Aborted / committed transactions |
| ------ | -------- | --- | --- | --- | -------- | ------------- | -------------- | -------------------------- | -------------------------------- |
| 20 rps | 20 | 12 ms | 30 ms | 48 ms | 0% | 16% | 20 ms | 0.6 ms | 6 / 155 |
| 40 rps | 40 | 10 ms | 34 ms | 91 ms | 0% | 24% | 30 ms | 0.7 ms | 43 / 250 |
| 80 rps | 80 | 12 ms | 58 ms | 103 ms | 0% | 44% | 25 ms | 0.8 ms | 89 / 513 |
| 120 rps | 120 | 85 ms | 391 ms | 552 ms | 0% | 67% | 73 ms | 2.0 ms | 209 / 655 |
| 160 rps | 140 | 1.4 s | 10 s | 10 s | 11.7% timeouts | 74% | 307 ms | 4.0 ms | 978 / 650 — **stopped** |

The two-process check on the same commit passed 8 of 8 checks.

**Measured capacity in this environment and workload:** about **120 requests per second with p95
under 0.5 s and no failures**, on one API process sharing 2 vCPU with MongoDB and the load
generator.

### Two API replicas (same host)

| Target | Achieved | p50 | p95 | p99 | Failures | CPU per API process (avg) | Event-loop p99 |
| ------ | -------- | --- | --- | --- | -------- | ------------------------- | -------------- |
| 80 rps | 80 | 14 ms | 97 ms | 203 ms | 0% | 29% | 68 ms |
| 120 rps | 120 | 73 ms | 886 ms | 1.9 s | 0% | 40% | 225 ms |
| 160 rps | 143.2 | 1.7 s | 10 s | 10 s | 6.0% — **stopped** | 45% | 504 ms |

**A second replica on the same 2 vCPU does not add capacity**: it was slightly worse at 120 rps.
The limit is the shared host CPU (MongoDB, the generator and both API processes), not the single
Node event loop.

This run shows that the system is **correct** with two replicas (no failures up to 120 rps, and
the shared state works; see also the two-process check). It does **not** measure horizontal scaling,
which needs separate hosts.

## Interpreting the numbers (do not extrapolate)

- **Users vs requests.** Registered users, active sessions and concurrent users are different
  things from requests per second. A receptionist working steadily generates perhaps one request
  every few seconds. **No user count is derived here**: think time, behavior and tenant sizes in
  real clinics are unknown.
- **What changes in production.** MongoDB on its own hardware, multiple API hosts and network
  latency all change the result. Repeat this harness on the chosen hosting before any capacity
  statement (production gate).
