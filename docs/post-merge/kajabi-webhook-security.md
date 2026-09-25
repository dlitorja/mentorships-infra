# Kajabi webhook security

This document records the threat model and operational mitigations for the
`POST /api/webhooks/kajabi` endpoint (in `apps/marketing/`).

## Threat model

The Kajabi webhook endpoint accepts purchase-event notifications from
Kajabi and applies the corresponding inventory decrement to Convex (the
authoritative source of inventory since PR #873, merged 2026-09-24 at
`1ab74e58`).

### What the attacker can do

* Anyone who knows the Vercel endpoint URL (publicly discoverable) and
  any Kajabi offer ID can send a forged `POST` to `/api/webhooks/kajabi`
  with a crafted JSON body that matches the schema in
  `apps/marketing/app/api/webhooks/kajabi/route.ts`.
* Each forged request that passes the User-Agent check will trigger
  an inventory decrement of `quantity` units (default 1; the schema
  accepts any positive integer up to the available stock, so a single
  forged request can exhaust an offer). The request volume is bounded
  by the rate limit below, but the per-request damage is bounded only
  by the offer's remaining inventory.
* Forged requests can therefore:
  * Prematurely sell out a specific offer (denial-of-service to
    legitimate buyers).
  * Trigger false-positive waitlist notifications.
  * Make the public offer page render "sold out" when it isn't.

### What the attacker cannot do

* Mint real transactions or steal money — Convex does not store payment
  data, and the inventory decrement does not depend on any verified
  payment information.
* Exfiltrate customer data via the webhook response — the webhook
  does not return PII in its response body, and the
  `inventory.changed` observability event emitted by the handler
  intentionally omits `purchaseId` (which embeds the buyer email
  when Kajabi sends a transaction id) so buyer PII does not flow to
  BetterStack / Axiom. **Note**: Convex itself stores the buyer
  email via the `inventoryChangeLog` table's `purchaseId` field
  (which is `kajabi:<event>:<offerId>:<transactionId>:<email>`).
  Kajabi remains the authoritative customer-record store; the
  Convex-side `purchaseId` is for replay-deduplication only and is
  not used for marketing or outreach. Operators planning data
  retention / deletion must consider both stores.
* Bypass Convex authorization on writes — all writes go through the
  existing `internalApplyInventoryChange` mutation, which is unchanged.

## Why HMAC verification was not adopted (HUC-44 canceled)

HUC-44 originally proposed adding HMAC signature verification to the
webhook. A premise check (2026-09-24) showed that **Kajabi's public
documentation makes no mention of HMAC signing for outbound webhooks**:

* `help.kajabi.com/articles/api-integrations/webhooks/webhooks-explained`
  — configuration steps for the webhook dashboard, no secret/header.
* `help.kajabi.com/articles/api-integrations/webhooks/what-information-is-sent-with-outbound-webhooks`
  — full payload schema, no signature header.
* `kajabi.stoplight.io/api-reference/webhooks/create-hook` (OpenAPI spec
  for the `POST /v1/hooks` endpoint) — `hooks_attributes` schema has no
  `secret` field.

Implementing HMAC naively would reject every legitimate Kajabi
delivery (401), breaking the purchase flow. Reopen HUC-44 if Kajabi
support confirms HMAC signing is available on a Growth/Pro plan.

## Compensating controls (HUC-50)

### 1. Per-IP rate limit (applied in `apps/marketing/proxy.ts`)

The rate-limit middleware runs in `apps/marketing/proxy.ts` before
this route handler is invoked. The policy is defined in
`apps/marketing/lib/ratelimit.ts`:

```ts
webhook: {
  short: { limit: 10, window: "60s" },
  long:  { limit: 100, window: "1h" },
  identifyBy: "ip",
}
```

This is a sliding-window limit of **10 requests per 60 seconds per
source IP**. Sustained forgery bursts (more than 10 attempts in 60
seconds from one IP) are rejected with HTTP 429 *before* the route
handler runs — `protectWithRateLimit` is called once per request in
the proxy, not duplicated in the handler.

**Why 10/60s is appropriate for legitimate Kajabi traffic:**

* Legitimate Kajabi events are bursty but rare — a single purchase
  generates 1–5 webhook events (purchase.created + payment.succeeded
  for some processors; cart purchases can include multiple order items).
* 10 events in 60 seconds comfortably absorbs a busy minute.
* The 1-hour ceiling of 100/h also exists in the policy for sustained
  bursts (though it is currently not wired — see "Known limitations").

When a 429 is returned, `protectWithRateLimit` emits a
`reportError({ source: "ratelimit.middleware", level: "warn" })` event
with `context.ip`, `context.policy`, `context.pathname`, and
`context.identifier`, so rejected requests are observable in
BetterStack / Axiom.

### 2. User-Agent anomaly alerting (emitted in the route handler)

The handler emits a `reportError({ source: "webhooks/kajabi", level:
"warn", message: "Suspicious request - User-Agent: …" })` event for
every request rejected at the User-Agent check. The event includes
the source IP in `context.ip` (extracted by `getIp` from
`lib/ratelimit.ts`, which is shared between the rate-limiter and
this handler so the IP used for alerting is the same IP the
rate-limiter buckets by).

**Trusted-header priority in `getIp`** (first non-empty wins):

1. `x-vercel-forwarded-for` — Vercel-trusted (set by Vercel's edge;
   client-supplied portions of upstream forwarded headers are
   stripped). **This is the only header that should be used to
   identify an attacker** in Vercel deployments.
2. `cf-connecting-ip` — Cloudflare-trusted when Vercel sits behind
   Cloudflare.
3. `x-forwarded-for[0]` — Spoofable. Used only as a fallback when
   no trusted edge is in front of the deployment.
4. `x-real-ip` — Spoofable. Fallback only.
5. `"unknown"` — Final fallback.

Spoofable headers are intentionally LAST so a forged value cannot
mask the real IP for rate-limit identification or per-IP alerting.

Events flow to BetterStack and Axiom when their respective tokens are
configured (`BETTERSTACK_SOURCE_TOKEN` / `AXIOM_TOKEN` + `AXIOM_DATASET`).

**How to alert on forgery attempts:**

In BetterStack or Axiom, configure two monitors and OR them together:

1. **Invalid-UA monitor** (per-IP attempt volume):
   * `source = "webhooks/kajabi"`
   * `level = "warn"`
   * `message CONTAINS "Suspicious request"`
   * `context.ip` count > N per minute (e.g. N = 5)
   * Action: page on-call / Slack alert.

2. **Rate-limit monitor** (sustained burst):
   * `source = "ratelimit.middleware"`
   * `level = "warn"`
   * `context.policy = "webhook"`
   * `context.ip` count > M per minute (e.g. M = 50).
   * Action: page on-call / Slack alert.

The `source` and `context` fields are structured and queryable in both
backends, so no additional tagging infrastructure is needed.

### 3. Defensive error responses

* `400 Bad Request` on invalid JSON, schema mismatch, missing offer ID,
  or invalid User-Agent. None of these paths touch Convex.
* `404 Not Found` when the offer ID is not mapped (per-offer mapping
  table maintained via `scripts/migrate-kajabi-offer-mappings.ts`).
* `500 Internal Server Error` on transient Convex errors so Kajabi
  retries (canonical behavior).
* `429 Too Many Requests` when the per-IP rate limit is exceeded.

## Known limitations

* **Rate-limit `long` policy not wired.** `createRatelimit` in
  `lib/ratelimit.ts` only constructs the `short` sliding-window limiter;
  the `long: { limit: 100, window: "1h" }` policy is declared but not
  enforced. A forger could theoretically spread 100 attempts over an
  hour (1 every ~36 seconds) and stay under the `short` ceiling. In
  practice this is bounded by the alerting layer above and by the cost
  of the forger (every attempt requires a valid offer ID). Wire the
  `long` window if the operator observes sustained low-rate forgery.

* **No IP allowlist.** Kajabi's API servers sit on AWS, and pinning
  the published AWS IP ranges is brittle (they shift without notice).
  Rate-limit + alerting is a more durable mitigation.

* **User-Agent is forgeable.** Anyone can set `User-Agent: Kajabi/...`
  in `curl`. The rate limit bounds the damage; HMAC verification (if
  ever supported by Kajabi) would close this gap.

## Acceptance criteria (HUC-50)

* [ ] A burst of 100 forged POSTs from a single IP within 60s returns
      **10×400 + 90×429** in staging (the first 10 pass through the
      rate-limit and are rejected at the User-Agent check with 400;
      the next 90 are rejected by the rate-limiter with 429 before
      the handler runs). (Operator verification — not in unit tests.)
* [ ] Legitimate Kajabi deliveries still pass through cleanly. (Smoke
      test against `dev.mentorships.huckleberry.art`.)
* [ ] BetterStack / Axiom shows a `webhooks/kajabi` warning event for
      every invalid-UA request that reaches the handler (i.e. the
      first 10 of a 100-request burst, which the proxy lets through;
      the next 90 are blocked at the proxy and never produce this
      event). The event payload has `context.ip`, `context.userAgent`,
      and `context.offerId`.
* [ ] BetterStack / Axiom alerts on sudden inventory drops per
      instructor per hour exceeding N units (default N = 20) for
      **Kajabi-sourced** writes. This catches single-request
      exhausts (a forged POST with `quantity` > 1) that bypass
      the request-volume rate limit. Filter on the
      `inventory.changed` observability event emitted by the
      Kajabi webhook handler (level = `info`, source =
      `inventory.changed`, with `context.previousInventory`,
      `context.newInventory`, `context.quantity`, and
      `context.instructorSlug`). Stripe / PayPal / admin
      inventory edits use different write paths and are out of
      scope for this runbook.
* [ ] BetterStack / Axiom shows a `ratelimit.middleware` warning
      event for every 429 with `context.ip`, `context.policy`,
      `context.pathname`.
* [ ] Vitest unit tests pass: `pnpm test:unit
      apps/marketing/app/api/webhooks/kajabi/route.test.ts`.

## Related issues

* HUC-44 — HMAC signature verification (Canceled 2026-09-24, premise
  unverified). Reopen if Kajabi support confirms HMAC support.
* HUC-50 — This mitigation: rate-limit + alerting (current).
* PR #873 — Kajabi webhook migrated to Convex (merged 2026-09-24 at
  `1ab74e58`). Greptile P1 flagged the User-Agent forgery; this doc
  + HUC-50 are the proportionate fix.
