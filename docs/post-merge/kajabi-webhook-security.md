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
  exactly one inventory decrement (subject to the rate limit below).
* Forged requests can therefore:
  * Prematurely sell out a specific offer (denial-of-service to
    legitimate buyers).
  * Trigger false-positive waitlist notifications.
  * Make the public offer page render "sold out" when it isn't.

### What the attacker cannot do

* Mint real transactions or steal money — Convex does not store payment
  data, and the inventory decrement does not depend on any verified
  payment information.
* Exfiltrate customer data — the webhook does not return PII in its
  response, and Kajabi is the only system that holds customer records.
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

### 1. Per-IP rate limit

The route calls `protectWithRateLimit(request, "webhook")` as its first
action — before any JSON parsing, schema validation, or Convex call. The
policy is defined in `apps/marketing/lib/ratelimit.ts`:

```ts
webhook: {
  short: { limit: 10, window: "60s" },
  long:  { limit: 100, window: "1h" },
  identifyBy: "ip",
}
```

This is a sliding-window limit of **10 requests per 60 seconds per
source IP**. Sustained forgery bursts (more than 10 attempts in 60
seconds from one IP) are rejected with HTTP 429 before any other work
is done.

**Why 10/60s is appropriate for legitimate Kajabi traffic:**

* Legitimate Kajabi events are bursty but rare — a single purchase
  generates 1–5 webhook events (purchase.created + payment.succeeded
  for some processors; cart purchases can include multiple order items).
* 10 events in 60 seconds comfortably absorbs a busy minute.
* The 1-hour ceiling of 100/h also exists in the policy for sustained
  bursts (though it is currently not wired — see "Known limitations").

### 2. User-Agent anomaly alerting

The route emits a `reportError({ source: "webhooks/kajabi", level: "warn", message: "Suspicious request - User-Agent: …" })` event for every
rejected request. Events flow to BetterStack and Axiom when their
respective tokens are configured (`BETTERSTACK_SOURCE_TOKEN` /
`AXIOM_TOKEN` + `AXIOM_DATASET`).

**How to alert on forgery attempts:**

In BetterStack or Axiom, configure a monitor with:

* **Source filter:** `source = "webhooks/kajabi"`
* **Level filter:** `level = "warn"`
* **Message filter:** `message CONTAINS "Suspicious request"`
* **Threshold:** count per source IP > N per minute (e.g. N = 5)
* **Action:** page on-call / open Slack channel alert

The `source` field is structured and queryable in both backends, so no
additional tagging infrastructure is needed.

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
      60×401 + 40×429 in staging. (Operator verification — not in
      unit tests.)
* [ ] Legitimate Kajabi deliveries still pass through cleanly. (Smoke
      test against `dev.mentorships.huckleberry.art`.)
* [ ] BetterStack / Axiom shows a `webhooks/kajabi` warning event for
      every invalid-UA attempt with the source IP in the `context`
      field.
* [ ] Vitest unit tests pass: `pnpm test:unit
      apps/marketing/app/api/webhooks/kajabi/route.test.ts`.

## Related issues

* HUC-44 — HMAC signature verification (Canceled 2026-09-24, premise
  unverified). Reopen if Kajabi support confirms HMAC support.
* HUC-50 — This mitigation: rate-limit + alerting (current).
* PR #873 — Kajabi webhook migrated to Convex (merged 2026-09-24 at
  `1ab74e58`). Greptile P1 flagged the User-Agent forgery; this doc
  + HUC-50 are the proportionate fix.
