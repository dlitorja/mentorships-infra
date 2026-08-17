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
| 5 | [PR-5] Move platform PayPal webhook to Cloudflare Worker | 3 | platform | Small-Medium | Pending |  |
| 6 | [PR-6] Move Daily.co recording webhook to Cloudflare Worker | 3 | platform | Small-Medium | Pending |  |
| 7 | [PR-7] Move huckleberry-drive share-link download to Cloudflare Worker | 3 | huckleberry-drive | Small-Medium | Pending |  |
| 8 | [PR-8] Add KV share-link metadata caching | 4 | huckleberry-drive | Small-Medium | Pending |  |
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

### Branch

`feat/paypal-webhook-worker`

### Scope

- Move `POST /api/webhooks/paypal` to the Worker.
- Validate PayPal webhook signature and forward to Inngest.

### Depends On

- PR-3.

### Files to Add

```text
apps/edge-functions/src/routes/webhooks/paypal.ts
```

### Files to Modify

```text
apps/edge-functions/src/index.ts
apps/edge-functions/wrangler.jsonc
```

### Verification Steps

1. Valid PayPal webhook payload is accepted and forwarded to Inngest.
2. Invalid signature is rejected.

---

## PR-6 — Move Daily.co recording webhook to Cloudflare Worker

### Branch

`feat/daily-recording-webhook-worker`

### Scope

- Move `POST /api/webhooks/daily/recordings` to the Worker.
- Validate Daily callback and forward to Inngest.

### Depends On

- PR-3.

### Files to Add

```text
apps/edge-functions/src/routes/webhooks/daily.ts
```

### Files to Modify

```text
apps/edge-functions/src/index.ts
apps/edge-functions/wrangler.jsonc
```

### Verification Steps

1. Valid Daily recording callback is accepted and forwarded.
2. Invalid token is rejected.

---

## PR-7 — Move huckleberry-drive share-link download to Cloudflare Worker

### Branch

`feat/hd-share-link-worker`

### Scope

- Move `POST /api/shared/[token]` to the Worker.
- Verify Turnstile token (from PR-1).
    - Resolve share via Convex action, log access, generate signed B2 URL, return JSON `{ downloadUrl: string }`.

### Depends On

- PR-1, PR-3.

### Files to Add

```text
apps/edge-functions/src/routes/hd-share-link.ts
apps/edge-functions/src/lib/convex.ts
```

### Files to Modify

```text
apps/edge-functions/src/index.ts
apps/edge-functions/wrangler.jsonc
```

### Verification Steps

1. Worker route with valid Turnstile token and valid share returns JSON `{ downloadUrl: string }`.
2. Worker route with invalid token returns `401`.
3. Worker route with invalid/expired share returns `404`/`410`.

---

## PR-8 — Add KV share-link metadata caching

### Branch

`feat/kv-share-link-cache`

### Scope

- Add KV namespace binding to the Worker.
- Cache share-link metadata in KV.
- Use KV in the share-link Worker route.

### Depends On

- PR-3, PR-7.

### Files to Add

```text
apps/edge-functions/src/lib/kv.ts
```

### Files to Modify

```text
apps/edge-functions/wrangler.jsonc
apps/edge-functions/src/routes/hd-share-link.ts
apps/huckleberry-drive/src/lib/shares.ts
```

### Implementation Steps

1. Create KV namespace via `wrangler kv namespace create`.
2. Add `MENTORSHIPS_METADATA` binding.
3. Add `getCached`, `setCached`, `deleteCached` helpers.
4. On share access, read from KV first; fallback to Convex; populate on miss.
5. On share creation/revoke/extend, update/delete KV entry.

### Verification Steps

1. First request to a share resolves via Convex and populates KV.
2. Subsequent request reads from KV.
3. After TTL, request falls back to Convex.
4. Revoke/delete removes KV entry.

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
