# PR-Scoped Implementation Plan — Priority Cloudflare Integrations

> Derived from `docs/plans/cloudflare-integrations-platform-huckleberry-drive.md`.
> Each top-level section is a self-contained PR.

## Executive Summary

Priority options from the parent doc: **2, 3, 4, 5**.

| # | PR Title | Option | App(s) | Effort | Status | PR |
|---|----------|--------|--------|--------|--------|----|
| 1 | [PR-1] Add Turnstile challenge to huckleberry-drive share-link downloads | 2 | huckleberry-drive + platform | Small | ✅ Merged | [#744](https://github.com/dlitorja/mentorships-infra/pull/744) |
| 2 | [PR-2] Add Turnstile challenge to huckleberry-drive upload initiation | 2 | huckleberry-drive | Small | ✅ Merged | [#745](https://github.com/dlitorja/mentorships-infra/pull/745) |
| 3 | [PR-3] Bootstrap Cloudflare Worker project | 3 | both | Small | ✅ Merged | [#746](https://github.com/dlitorja/mentorships-infra/pull/746) |
| 4 | [PR-4] Move platform Stripe webhook to Cloudflare Worker | 3 | platform | Small-Medium | ✅ Merged | [#747](https://github.com/dlitorja/mentorships-infra/pull/747) |
| 5 | [PR-5] Move platform PayPal webhook to Cloudflare Worker | 3 | platform | Small-Medium | ✅ Merged | [#749](https://github.com/dlitorja/mentorships-infra/pull/749) |
| 6 | [PR-6] Move Daily.co recording webhook to Cloudflare Worker | 3 | platform | Small-Medium | ✅ Merged | [#750](https://github.com/dlitorja/mentorships-infra/pull/750) |
 | 7 | [PR-7] Move huckleberry-drive share-link download to Cloudflare Worker | 3 | huckleberry-drive | Small-Medium | ✅ Merged | [#751](https://github.com/dlitorja/mentorships-infra/pull/751) |
| 8 | [PR-8] Add KV share-link metadata caching | 4 | huckleberry-drive | Small-Medium | ✅ Merged | [#800](https://github.com/dlitorja/mentorships-infra/pull/800) |
| 9 | [PR-9] Cloudflare DNS/CDN/WAF runbook and staging cutover | 5 | both | Medium | Pending |  |

Option 1 (R2 migration) remains deferred.

**Dependencies:**
- PR-2 depends on PR-1 (shared Turnstile package).
- PR-4, PR-5, PR-6, PR-7 depend on PR-3 (Worker project).
- PR-7 also depends on PR-1 (Turnstile verification in Worker).
- PR-8 depends on PR-3 and PR-7 (Worker + share-link route).
- PR-9 can run in parallel with PR-1 and PR-2.

---

## PR-1 — Add Turnstile challenge to huckleberry-drive share-link downloads

### Branch

`feat/turnstile-share-link-downloads`

### Scope

- Create shared `@mentorships/security` package with Turnstile verification helper.
- Refactor `apps/platform/lib/turnstile.ts` to re-export from the shared package.
- Add Turnstile challenge to the public share-link download flow in `apps/huckleberry-drive`.
- Decision: **API-only challenge for the first iteration** (Approach A). The page render stays server-side; only the download POST requires a Turnstile token.

### Why this PR first

- Smallest, highest-security ROI.
- Establishes the shared Turnstile helper used by all subsequent PRs.
- Protects the most obvious scraping/abuse target: public share-link downloads.

### Files to Add

```text
packages/security/
  package.json
  tsconfig.json
  eslint.config.mjs
  src/turnstile.ts
  src/index.ts
  README.md

apps/huckleberry-drive/src/components/shared-download-button.tsx
apps/huckleberry-drive/src/components/turnstile-provider.tsx
```

### Files to Modify

```text
pnpm-workspace.yaml
apps/huckleberry-drive/package.json
apps/huckleberry-drive/src/app/shared/[token]/page.tsx
apps/huckleberry-drive/src/app/api/shared/[token]/route.ts
apps/huckleberry-drive/src/lib/env.ts (or .env.local)
apps/platform/lib/turnstile.ts
```

### Implementation Steps

1. **Create `packages/security`**
   - Add `package.json` with name `@mentorships/security`, exports `./turnstile`, `src/turnstile.ts`.
   - Copy `apps/platform/lib/turnstile.ts` logic into `packages/security/src/turnstile.ts`.
   - Export `verifyTurnstileToken` and `getClientIp`.

2. **Refactor `apps/platform/lib/turnstile.ts`**
   - Re-export from `@mentorships/security`.
   - Verify all existing platform imports still work.

3. **Add dependency to huckleberry-drive**
   - `pnpm add @marsidev/react-turnstile` in `apps/huckleberry-drive`.
   - `pnpm add @mentorships/security` in `apps/huckleberry-drive`.
   - Add `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` to env.

4. **Create `shared-download-button.tsx`**
   - Client component that renders a Turnstile widget.
   - On success, obtains the token and POSTs to `/api/shared/${token}` with `{ turnstileToken }`.
    - On response, read the `{ downloadUrl }` JSON and navigate to it.

5. **Update `app/shared/[token]/page.tsx`**
   - Replace the static `<form action="...">` with `<SharedDownloadButton token={token} />`.
   - Keep the rest of the page server-rendered.

6. **Update `app/api/shared/[token]/route.ts`**
   - Accept `turnstileToken` in the POST body.
    - Verify the token before any share resolution or download URL generation.
    - Return `401` if missing or invalid.
    - On success, return JSON `{ downloadUrl: string }`.

7. **Add tests**
   - Unit tests for `verifyTurnstileToken` in `packages/security`.
   - Optional: a basic component test for `SharedDownloadButton`.

### Verification Steps

1. `pnpm install` succeeds.
2. `pnpm typecheck` and `pnpm lint` pass in all affected apps/packages.
3. `pnpm test --filter @mentorships/security` passes.
4. `POST /api/shared/:token` without `turnstileToken` returns `401`.
5. `POST /api/shared/:token` with a valid token returns JSON `{ downloadUrl: string }`.
6. Existing platform Turnstile flows still pass (regression test).

### PR Description Template

```markdown
## Summary
Adds Cloudflare Turnstile challenge to the huckleberry-drive public share-link download flow.

## Changes
- Creates `@mentorships/security` package with shared Turnstile verification helper.
- Refactors `apps/platform/lib/turnstile.ts` to use the shared package.
- Adds Turnstile widget to share-link download button.
- Requires Turnstile token on `POST /api/shared/[token]`.

## Testing
- Unit tests for verification helper.
- Manual verification: missing token returns 401; valid token returns JSON with `downloadUrl`.

## Env vars required
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
```

### Open Decisions Resolved in This PR

- **Protect page render or POST only?** → POST only for the first iteration.
- **Shared package or duplicate helper?** → Shared `@mentorships/security` package.

---

## PR-2 — Add Turnstile challenge to huckleberry-drive upload initiation

### Branch

`feat/turnstile-upload-initiate`

### Scope

- Require a Turnstile token on `POST /api/uploads/initiate`.
- Add an invisible Turnstile widget to the upload flow in `upload-zone.tsx`.

### Depends On

- PR-1 (shared `@mentorships/security` package).

### Files to Modify

```text
apps/huckleberry-drive/src/app/api/uploads/initiate/route.ts
apps/huckleberry-drive/src/components/upload-zone.tsx
```

### Implementation Steps

1. Add `turnstileToken` to the `initiateSchema`.
2. Verify token in the route handler before any storage or Convex work.
3. Render `<Turnstile />` in `upload-zone.tsx` in invisible mode.
4. Include the token in the initiate request payload.

### Verification Steps

1. `POST /api/uploads/initiate` without `turnstileToken` returns `401`.
2. `POST /api/uploads/initiate` with a valid token proceeds normally.
3. Invisible widget does not block the drag-and-drop UX.

---

## PR-3 — Bootstrap Cloudflare Worker project

**Status:** ✅ Merged via [#746](https://github.com/dlitorja/mentorships-infra/pull/746)

### Branch

`feat/bootstrap-cloudflare-worker`

### Scope

- Create the `apps/edge-functions` project.
- Add `wrangler`, `@cloudflare/workers-types`, routing skeleton, and dev script.
- Add a health-check route.
- Wire the package typecheck into the `lint-and-typecheck` CI job.

### Files to Add

```text
apps/edge-functions/
  package.json
  tsconfig.json
  wrangler.jsonc
  src/index.ts
  src/lib/env.ts
  src/routes/health.ts
```

### Files to Modify

```text
pnpm-workspace.yaml
```

### Implementation Steps

1. `mkdir apps/edge-functions && cd apps/edge-functions && pnpm init`.
2. Add `wrangler`, `@cloudflare/workers-types`, `typescript`.
3. Create `wrangler.jsonc` with `compatibility_date` and a placeholder route.
4. Create a simple router in `src/index.ts`.
5. Add a `GET /health` route.
6. Add `pnpm dev` script using `wrangler dev`.

### Verification Steps

1. ✅ `pnpm dev` starts the local worker.
2. ✅ `GET http://localhost:8787/health` returns `200 OK`.
3. ✅ `pnpm --filter @mentorships/edge-functions deploy:dry-run` succeeds.
4. ✅ `pnpm --filter @mentorships/edge-functions typecheck` passes.
5. ✅ CI `lint-and-typecheck` job runs the package typecheck.

---

## PR-4 — Move platform Stripe webhook to Cloudflare Worker

**Status:** ✅ Merged via [#747](https://github.com/dlitorja/mentorships-infra/pull/747)

### Branch

`feat/stripe-webhook-worker`

### Scope

- Move `POST /api/webhooks/stripe` to the Worker.
- Validate Stripe signature and forward the event to Inngest.
- Keep the existing Next.js route as fallback during rollout; remove in a follow-up PR.

### Depends On

- PR-3.

### Files Added

```text
apps/edge-functions/src/lib/observability.ts
apps/edge-functions/src/lib/inngest.ts
apps/edge-functions/src/lib/stripe.ts
apps/edge-functions/src/routes/webhooks/stripe.ts
```

### Files Modified

```text
apps/edge-functions/src/index.ts
apps/edge-functions/src/lib/env.ts
apps/edge-functions/wrangler.jsonc
apps/edge-functions/package.json
pnpm-lock.yaml
```

### Implementation Steps

1. ✅ Copied Stripe signature validation logic from `apps/platform/app/api/webhooks/stripe/route.ts`.
2. ✅ Added `inngest` and `stripe` dependencies to `apps/edge-functions`.
3. ✅ Created Worker-safe Inngest and Stripe helpers.
4. ✅ On valid signature, forward `checkout.session.completed` and `charge.refunded` events to Inngest with the same event names and payloads as the existing Next.js route.
5. ✅ Return `200` to Stripe immediately after Inngest send.
6. ✅ Added `STRIPE_WEBHOOK_SECRET`, `INNGEST_EVENT_KEY`, and `INNGEST_APP_ID` to Worker bindings.

### Security Decision

- The Worker does **not** include the test bypass that exists in the Next.js route. Synthetic webhook tests will continue to use the existing Next.js route until a dedicated, isolated test path is added.

### Verification Steps

1. ✅ Worker route returns `200` for valid Stripe signature.
2. ✅ Worker route returns `400` for invalid signature.
3. ✅ `pnpm --filter @mentorships/edge-functions typecheck` passes.
4. ✅ `pnpm --filter @mentorships/edge-functions deploy:dry-run` passes.
5. ✅ Greptile review 5/5, no blocking comments.

---

## PR-5 — Move platform PayPal webhook to Cloudflare Worker

**Status:** ✅ Merged via [#749](https://github.com/dlitorja/mentorships-infra/pull/749)

### Branch

`feat/paypal-webhook-worker`

### Scope

- Move `POST /api/webhooks/paypal` to the Worker.
- Validate PayPal webhook signature and forward to Inngest.

### Depends On

- PR-3.

### Files Added

```text
apps/edge-functions/src/lib/paypal.ts
apps/edge-functions/src/routes/webhooks/paypal.ts
```

### Files Modified

```text
apps/edge-functions/src/index.ts
apps/edge-functions/src/lib/env.ts
apps/edge-functions/package.json
apps/edge-functions/wrangler.jsonc
apps/platform/app/api/checkout/paypal/capture/route.ts
pnpm-lock.yaml
```

### Implementation Steps

1. ✅ Implemented PayPal webhook signature verification using Node.js `crypto.createVerify` (works with `nodejs_compat`).
2. ✅ Restricted PayPal certificate URL fetches to `https://*.paypal.com`.
3. ✅ Implemented PayPal order lookup via REST API to decode `custom_id` and read `payer.email_address`.
4. ✅ Forward `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.CAPTURE.REFUNDED` events to Inngest.
5. ✅ Added capture/refund-derived Inngest `id` fields so the webhook and client capture route deduplicate against each other.
6. ✅ Updated the client capture route to extract the actual PayPal capture ID (not order ID) and use the same Inngest `id`.
7. ✅ Added PayPal environment bindings to the Worker.

### Security Notes

- Certificate URL allowlist prevents SSRF during signature verification.
- The Worker does not include the test bypass that exists in the Next.js route.

### Verification Steps

1. ✅ `pnpm --filter @mentorships/edge-functions typecheck` passes.
2. ✅ `pnpm --filter @mentorships/platform typecheck` passes.
3. ✅ `pnpm --filter @mentorships/edge-functions deploy:dry-run` passes.
4. ✅ Greptile review 5/5, no blocking comments.

---

## PR-6 — Move Daily.co recording webhook to Cloudflare Worker

**Status:** ✅ Merged via [#750](https://github.com/dlitorja/mentorships-infra/pull/750)

### Branch

`feat/daily-recording-webhook-worker`

### Scope

- Move `POST /api/webhooks/daily/recordings` to the Worker.
- Validate Daily callback and forward to the public Convex action.

### Depends On

- PR-3.

### Files Added

```text
apps/edge-functions/src/routes/webhooks/daily.ts
```

### Files Modified

```text
apps/edge-functions/src/index.ts
apps/edge-functions/src/lib/env.ts
apps/edge-functions/wrangler.jsonc
```

### Implementation Steps

1. ✅ Created `handleDailyWebhook` in the Worker.
2. ✅ Validated `X-Webhook-Signature` and `X-Webhook-Timestamp` headers.
3. ✅ Validated `recording.ready-to-download` payload shape.
4. ✅ Forwarded `{ timestamp, signature, rawBody }` to the existing public Convex action `dailyRecordingActions:attachRecordingFromDailyWebhookAction` via the Convex HTTP action API.
5. ✅ Mapped known Convex errors (`No session found...`, `Multiple sessions...`) to 422 responses.
6. ✅ Added `CONVEX_URL` to Worker environment bindings.

### Security Notes

- HMAC verification remains in the Convex action; the Worker does not hold `DAILY_WEBHOOK_SECRET`.
- The Worker does not include the test bypass that exists in the Next.js route.

### Verification Steps

1. ✅ `pnpm --filter @mentorships/edge-functions typecheck` passes.
2. ✅ `pnpm --filter @mentorships/edge-functions deploy:dry-run` passes.
3. ✅ Greptile review 5/5, no blocking comments.

---

## PR-7 — Move huckleberry-drive share-link download to Cloudflare Worker

**Status:** ✅ Merged via [#751](https://github.com/dlitorja/mentorships-infra/pull/751)

### Branch

`feat/hd-share-link-worker`

### Scope

- Move `POST /api/shared/[token]` to the Worker.
- Verify Turnstile token (from PR-1).
- Resolve share via Convex query, log access via Convex mutation, generate signed B2 URL, return JSON `{ downloadUrl: string }`.

### Depends On

- PR-1, PR-3.

### Files Added

```text
apps/edge-functions/src/lib/b2.ts
apps/edge-functions/src/lib/convex.ts
apps/edge-functions/src/lib/cors.ts
apps/edge-functions/src/routes/shared.ts
```

### Files Modified

```text
apps/edge-functions/src/index.ts
apps/edge-functions/src/lib/env.ts
apps/edge-functions/wrangler.jsonc
apps/edge-functions/package.json
apps/huckleberry-drive/src/components/shared-download-button.tsx
apps/huckleberry-drive/src/app/shared/[token]/page.tsx
pnpm-lock.yaml
```

### Implementation Steps

1. ✅ Added `POST /shared/:token` route in the Worker.
2. ✅ Verified Turnstile token using `verifyTurnstileToken` from `@mentorships/security`.
3. ✅ Resolved the share using the Convex query `hdShareLinks:resolveShareByToken` via `/api/query`.
4. ✅ Logged the download using the Convex mutation `hdShareLinks:logShareAccess` via `/api/mutation`.
5. ✅ Generated a presigned B2 download URL using `aws4fetch` with the original filename as `Content-Disposition`.
6. ✅ Added CORS handling for cross-origin requests from the Huckleberry Drive origin using `ALLOWED_ORIGINS`.
7. ✅ Updated `SharedDownloadButton` to fetch a Clerk Convex token and optionally call a Worker URL.
8. ✅ Updated the share page to pass `NEXT_PUBLIC_EDGE_FUNCTIONS_URL` to the button.
9. ✅ Added B2, Turnstile, and CORS environment bindings to the Worker.

### Security Notes

- The Worker requires the user's Clerk Convex token to call the authenticated Convex query/mutation.
- The existing Next.js `/api/shared/[token]` route remains available as a fallback.

### Verification Steps

1. ✅ `pnpm --filter @mentorships/edge-functions typecheck` passes.
2. ✅ `pnpm --filter @mentorships/huckleberry-drive typecheck` passes.
3. ✅ `pnpm --filter @mentorships/edge-functions deploy:dry-run` passes.
4. ✅ Greptile review 5/5, no blocking comments.

---

## PR-8 — Add KV share-link metadata caching

**Status:** ✅ Merged ([#800](https://github.com/dlitorja/mentorships-infra/pull/800))

### Branch

`feat/kv-share-link-cache`

### Scope

- Add KV namespace binding to the Worker.
- Cache share-link metadata in KV.
- Use KV in the share-link Worker route.
- Coordinate cache invalidation with share revocation and extension.

### Depends On

- PR-3, PR-7.

### Files Added

```text
apps/edge-functions/src/lib/kv.ts
apps/edge-functions/src/lib/token.ts
apps/edge-functions/src/routes/internal.ts
apps/edge-functions/src/routes/revoke.ts
apps/huckleberry-drive/src/lib/kv.ts
```

### Files Modified

```text
apps/edge-functions/package.json
apps/edge-functions/wrangler.jsonc
apps/edge-functions/src/lib/env.ts
apps/edge-functions/src/routes/shared.ts
apps/huckleberry-drive/src/app/api/shares/[token]/route.ts
```

### Implementation Summary

1. Created KV namespace `SHARE_CACHE_KV_NAMESPACE` (prod id `7f6ee3150ce54ceaa6ff0e6649b9fa4a`, preview id `1cd964dfcfdd44968232bf79abc14a90`).
2. Added `@clerk/backend` ^3.16.0 to verify the Convex JWT via Clerk's Backend SDK; `verifyConvexToken` returns `{ userId, expirationSeconds }`.
3. Cached `hdShareLinks:resolveShareByToken` results keyed by the verified user ID (`share:${token}:user:${userId}`) so one caller cannot select another user's cached entry.
4. Bounded cache TTL by share expiration, the verifying token's remaining lifetime, and a 5-minute default ceiling (`SHARE_CACHE_TTL_SECONDS`).
5. Added a per-token revocation marker (`revoked:share:${token}`) checked on every cache read; marker reads fail safe (return `true` on error) and markers are sized to outlive every cached entry.
6. Added internal `POST /internal/cache/invalidate` endpoint that lists and deletes every cached entry for a token on extension so stale per-user entries cannot survive the update.
7. Added internal `POST /internal/shares/:token/revoke` endpoint that writes the revocation marker with its full TTL before committing the Convex revoke mutation and never clears it, so concurrent revokes cannot race and a lost mutation response cannot leave a stale cache entry serving a revoked share.
8. Ordered huckleberry-drive share extension to invalidate the cache before committing the Convex mutation so a failed invalidation cannot leave behind cached entries with the old expiry.
9. Routed huckleberry-drive share revocation through the Worker so revocation and marker creation are part of the same request.
10. Threw on missing invalidation configuration or invalidation failure so the API does not report success while the cache remains stale.
11. Added new env bindings: `CLERK_SECRET_KEY`, `SHARE_CACHE_TTL_SECONDS`, `SHARE_CACHE_INVALIDATION_KEY`.

### Cache Trade-offs

The implementation accepts three inherent cache race windows, bounded by the 5-minute TTL ceiling:

- A share revoked in Convex while a cached entry exists is blocked by the per-token revocation marker, which is written before the Convex mutation and outlives every cached entry. The marker is never cleared by the revoke endpoint, so concurrent revokes cannot race.
- A share whose expiry is shortened may have a cached entry from before the change. The token-prefix invalidation in `handleCacheInvalidation` lists and deletes every matching key before the mutation commits, but a cache writer that races the listing can still leave a stale entry. The bounded TTL limits this window.
- A user's role change is not propagated to the cache; the cached entry trusts the role check that was authoritative at resolve time. The bounded TTL limits this window.

These trade-offs are documented in the `apps/edge-functions/src/lib/kv.ts` module header.

### Verification

1. ✅ `pnpm --filter @mentorships/edge-functions typecheck` passes.
2. ✅ `pnpm --filter @mentorships/huckleberry-drive typecheck` passes.
3. ✅ `pnpm --filter @mentorships/edge-functions deploy:dry-run` passes (KV binding visible).

---

## PR-9 — Cloudflare DNS/CDN/WAF runbook and staging cutover

### Branch

`docs/cloudflare-dns-waf-runbook`

### Scope

- Document the DNS/CDN/WAF cutover procedure.
- No application code changes.

### Files to Add

```text
docs/runbooks/cloudflare-dns-waf-cutover.md
```

### Contents

1. Inventory of production/staging domains.
2. Cloudflare zone setup steps.
3. DNS record migration checklist.
4. SSL/TLS mode configuration.
5. WAF rule recommendations.
6. Page Rules / Cache Rules.
7. Staging cutover plan.
8. Rollback plan.

### Verification Steps

1. Runbook is reviewed by another team member.
2. Staging cutover is executed successfully.
3. `curl -I https://staging.example.com` shows `cf-ray` header.

---

## Cross-Cutting Concerns

### Naming Conventions

Per repo policy, use `instructor` and `student` (or existing roles like `video_editor` and `admin`). Do not use `mentor`/`mentee` in any new code.

### Secrets

Never commit real Cloudflare keys, Stripe webhooks, Clerk tokens, or B2 credentials. Use placeholders in documentation and `wrangler secret put` for production.

### Testing

- Add unit tests for the shared Turnstile helper.
- Use `wrangler dev` and Miniflare for Worker integration tests.
- Run staging cutover before any DNS/WAF production changes.

### Monitoring

- Add Cloudflare Workers analytics and logging.
- Set up alerts for worker error rate and KV miss rate.
- Track Vercel function usage after offloading routes.
