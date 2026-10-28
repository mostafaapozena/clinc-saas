# Platform subscriptions (milestone 4)

This document covers what an organization has with raclinic. It is **separate from clinic
finances** ([FINANCE.md](FINANCE.md)), which are the clinic's own invoices to patients.

Development uses synthetic data only. **No real payment provider is integrated.** Payments run
through a clearly labelled **simulator**, and the simulator is refused in production.

**Code**
- API: `apps/api/src/modules/platform/`
  - `billing.model.ts`
  - `subscription.service.ts`
  - `billing.service.ts`
  - `payment-provider.ts`
  - `subscription.routes.ts`
  - `platform.seed.ts`
- Web: `pages/SubscriptionPage.tsx`, `components/subscription.tsx`
- Tests: `apps/api/test/platform.test.ts`, `apps/web/src/pages/Subscription.test.tsx`,
  `e2e/subscription.spec.ts`

## No invented commercial terms

The owner has not decided prices, trial length, grace periods or limits (Q10, blocker B4).
Plans are therefore **configuration**, edited by platform operators:

- A plan may have **no prices**. Such a plan can only back a development grant.
- A limit of `null` means the plan does not limit that resource. The resources that can be
  limited are active branches, active practitioners and active memberships.
- Plans are **versioned**:
  - A **draft** can be edited, with an optimistic revision check.
  - An **active** plan is frozen. To change it, create a **new version**, which starts as a draft.
    Each plan code has at most one draft.
  - A **retired** plan is no longer offered. Subscriptions already on it keep it.
- **Trials and grace** are configurable but unset: `trialDays` on a plan, `graceDays` in the platform billing policy (see Lifecycle).

The development seed creates three plans:

| Plan | Status | Prices | Purpose |
| ---- | ------ | ------ | ------- |
| `development` | active | none | Development grants |
| `simulator-test` | active | 1.00 EGP and 1.00 SAR per month, **labelled as a synthetic price** | Exercises the simulator |
| `clinic` | draft | none | Waits for real terms |

## Subscription kinds and states

Each organization has one current subscription. It is never deleted, and its history survives
cancellation. There are two kinds:

- **Development grant.** Free access that an operator grants for development, pilots or demos,
  optionally with an end date. It is shown as "Development grant — not a commercial
  subscription" everywhere. It has no price and no provider.
- **Commercial subscription.** It is created **only** by a verified provider event
  (`checkout.completed`). The browser never creates one and never sets a price.

| From → To | active | past_due | restricted | canceled |
| --------- | ------ | -------- | ---------- | -------- |
| active | — | provider: payment failed | operator | operator or provider |
| past_due | provider: renewed | — | operator | operator or provider |
| restricted | operator: reinstate | — | — | operator or provider |
| canceled | — (replaced by a new grant or checkout) | — | — | — |

- `expired` is **derived** on read: an active or past_due subscription whose period end has
  passed. It is never stored, so no scheduled job is needed.
- `none` means the organization has no subscription.
- Every change:
  - uses optimistic concurrency (`version`);
  - appends a history entry (actor, reason, plan version);
  - writes a platform audit event.
- A restriction is an operator decision. Provider events update the period, but never lift a
  restriction.

## Entitlement enforcement — off until the owner decides (B4)

`SUBSCRIPTION_ENFORCEMENT` controls enforcement:

| Value | Behavior |
| ----- | -------- |
| `off` (default) | Nothing is checked. |
| `log` | A would-be refusal is written to the platform audit (`entitlement.would_block`) and the request proceeds. |
| `on` | Growth is refused with `403 SUBSCRIPTION_INACTIVE` or `403 PLAN_LIMIT_REACHED`. |

With `on`, only three things are blocked: adding a branch, adding a practitioner and adding a
member. They are blocked when the effective status is restricted, canceled, expired or none, or
when the plan's limit is reached.

**Nothing else is ever blocked.** Reading, clinical documentation, appointments and clinic
finances continue, and no data is removed.

`past_due` is deliberately not blocking. Any grace policy is a commercial decision.

The proposal for the owner (P10) is that historical records stay readable in every state.
Whether `on` should block more than growth is still open.

## Payment-provider boundary

The rest of the platform only sees the `PaymentProvider` interface (`payment-provider.ts`):

- `verifyWebhook(rawBody, signatureHeader)` returns a verified event, or answers 400.
- `fetchSubscription(id)` returns the provider's own view of a subscription, for reconciliation.

**Never trust the client.** The browser chooses a plan, a currency and an interval. The server
takes the amount from the active plan; an `amountMinor` sent by the browser is ignored (tested).

**No card data** is ever requested, stored or logged.

### Webhooks (`POST /api/v1/billing/webhooks/<provider>`)

- The route is mounted **before** the JSON parser, because the signature covers the exact raw
  bytes. It sits outside cookies, sessions and CSRF; the signature alone authenticates it.
- **Signature.** The simulator header is
  `X-Raclinic-Simulator-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. It
  is compared in constant time.
- **Replay protection.**
  - The timestamp must be within ±300 s.
  - Each event id is recorded once (`billing_events`, unique on provider and event id), in the
    **same transaction** that applies it.
  - A duplicate delivery, including a concurrent one, returns `duplicate: true` and changes
    nothing. The test fires 5 parallel copies and exactly one is applied.
- **Out of order.** The subscription stores `providerEventAt`. An older event is recorded as
  `ignored_stale`, and an unknown subscription or checkout as `ignored_unknown`.
- Rejected deliveries (bad signature, stale timestamp, malformed body) store nothing.

### Simulator (development and tests only)

- `BILLING_PROVIDER=simulator` turns it on. Env validation refuses it when `NODE_ENV=production`.
- `BILLING_SIMULATOR_SECRET` is optional. Without it, the secret is random per process.
- The simulator keeps its own "provider-side" records (`billing_simulator_subscriptions`) to
  stand in for what a real provider would hold.
- **Owner checkout**
  - `POST /orgs/:orgId/subscription/checkouts` takes `{planId, currency, interval}` and is
    owner-only.
  - It opens a simulator checkout page with a large "payment simulator — no real payment" banner.
  - The page offers "simulate success" and "simulate failure".
  - The outcome is delivered as a **signed webhook through the same `handleWebhook` path** an
    HTTP delivery takes.
- **Operator actions** (platform_admin)
  - Renew, fail a payment, or cancel at the provider.
  - Each can run with or without delivering the webhook. "Without" simulates a lost webhook.

### Reconciliation

`POST /api/v1/platform/billing/reconcile {apply}` compares every provider-backed subscription
with `fetchSubscription`:

- A **dry run** lists the differences: status, period, or missing at the provider.
- **Apply** sets the local state to the provider's, with history reason `reconciliation` and an
  audit event.
- A subscription missing at the provider is only reported, never guessed.

The end-to-end test fails a payment without its webhook. Reconciliation then finds the
difference and applies it.

## What a real provider needs (B5 — owner action, no secrets in chat or Git)

Before a real provider replaces the simulator, the owner must:

1. **Choose the provider** for Egypt and/or Saudi Arabia.
2. **Open a sandbox (test) account.**
3. **Put the credentials in the server environment** (never in Git):
   - the API secret key;
   - the webhook signing secret;
   - any merchant or account id.
4. **Decide the remaining commercial and legal terms:**
   - prices and currencies (Q10);
   - VAT or tax treatment (Q9);
   - refund rules.

Engineering then:

1. Implements `PaymentProvider` for that provider.
2. Adds the provider's hosted checkout.
3. Maps its event types onto the transitions above.
4. Runs the same webhook and reconciliation tests against the sandbox.

Nothing has been purchased or configured.

## Not included

- Proration and immediate plan changes for commercial subscriptions (a provider feature).

- Invoices or receipts from raclinic to clinics.
- Tax.
- Dunning emails (there is no email provider yet, B7).
- Automatic expiry jobs. Expiry is derived on read instead.

## Lifecycle (trials, grace, plan changes, cancellation)

Added in the scalability/subscriptions checkpoint (`phase-12/scalability-subscriptions`).
Code: `subscription.lifecycle.ts`; tests: `subscription-lifecycle.test.ts`,
`SubscriptionLifecycle.test.tsx`, `e2e/subscription-lifecycle.spec.ts`.

### Statuses and trials

- **New statuses.** `trialing` and `expired` join the existing ones.
  - `expired` is stored by the lifecycle pass and is also derived on read.
  - Ended (canceled or expired) subscriptions are replaced, never revived.
- **Trials.**
  - A plan may offer one through `trialDays`, which is unset by default.
  - An owner starts it once per organization, and only when there is no live subscription.
  - An operator can also start one with an explicit end date.
  - A trial is free access (kind `development_grant`). It becomes commercial only through a
    verified checkout.

### Billing policy

- **Content.** One document (`platform_billing_policy`), edited by platform administrators,
  versioned and audited, with three settings:
  - `graceDays` (unset);
  - `afterGrace`: `none` or `restricted`;
  - `restrictedAccess`: `growth_only` (default) or `read_only`.
- **Grace.** With a grace period configured, past-due subscriptions are restricted after
  `pastDueSince + graceDays`.
- **Read-only mode.**
  - It applies only with `SUBSCRIPTION_ENFORCEMENT=on`.
  - It refuses most changes with 403 `SUBSCRIPTION_READ_ONLY`.
  - It never blocks reading, support, the subscription page, or clinical documentation and
    coverage: patient safety comes before billing.
  - Activating it commercially remains decision B4.

### Owner requests

- **Plan change** (commercial only): a request effective at the end of the current period. Rules:
  - The price always comes from the plan.
  - Repeating the same request is idempotent.
  - A stale version gets 409.
  - The request can be withdrawn.
- **Cancellation:** requires `confirm: true`, and the UI asks for explicit confirmation.
  - A commercial subscription ends at the period end, through the provider.
  - A trial or grant ends at once.
  - Data is never removed.

### Local intent vs provider state

- **Where requests live.** Requests are stored on the subscription as local intent:
  `pendingChange` and `cancelRequest`, each with `providerAcknowledged`.
- **Acknowledgement.** It is true only once the provider holds the same schedule. Today that is
  the labelled simulator; without a provider it stays false, and the UI says "recorded here only —
  not yet confirmed by a payment provider".
- **What changes the subscription.** It changes plan or ends only through a verified provider
  event:
  - a renewal on the scheduled plan;
  - a cancellation at the period end.
  Out-of-order and duplicate events are handled as before.

### Lifecycle pass

`POST /api/v1/platform/billing/lifecycle {apply}` or `npm run ops:subscriptions -w @clinc/api -- [--apply]`.

- **What it does:**
  - expires ended trials and grants;
  - applies the grace policy;
  - reports commercial subscriptions past their period as `awaiting_provider`. It never ends
    them itself.
- **Safety.** It is a dry run by default. Every change is a conditional update on the version:
  concurrent runs apply once (tested), and a repeat run finds nothing to do.
- **Scheduling.** It needs a scheduler (cron) once hosting is chosen; no in-process timer exists.
