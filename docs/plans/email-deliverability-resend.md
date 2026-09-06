# Email Deliverability — Resend Split-Domains → Suppressions → Metrics → Verify

Phased rollout of sender-reputation isolation, ground-truth suppression tracking, and per-message deliverability metrics for apps/platform and apps/huckleberry-drive. Drives off six Resend product announcements (`MCP`, `Agent Plugins`, `Suppression List`, `Email Verification`, `3 free domains`, `Email Metrics API`).

## Status legend

- ✅ shipped (merged to `main`)
- 🟡 in review (PR open, checks pending)
- 🔵 queued (not started)
- ⏸ blocked / deferred

## Open decisions

Confirmed with defaults (2026-09-06):

| # | Decision | Choice |
|---|---|---|
| D1 | Suppression source-of-truth | Webhook events = audit log; periodic `GET /v1/suppressions` poll = reconciliation |
| D2 | Metrics granularity | Daily for trends, hourly for last 24h tile |
| D3 | Agent plugin for triage | In-house Inngest action; defer official `@resend/agent-plugin` |
| D4 | Dashboard surface | Dedicated `/admin/email-health` route + summary card on `/admin` |
| D5 | Suppression backfill on first deploy | Yes — one-shot action that pulls `/v1/suppressions` and seeds `suppressionEvents` |

## Cross-cutting rules (apply to every PR)

- **Naming**: `instructor` / `student` only — no `mentor` / `mentee`
- **Clerk**: do not touch Clerk config/code/env anywhere (see `AGENTS.md` "Clerk Changes Policy")
- **Comments**: do not add any code comments unless explicitly asked
- **Secrets**: placeholders only (`<VALUE>`, `<COPY_FROM_APPS_PLATFORM>`) in PR bodies, commit messages, docs — never copy real values
- **Schema changes**: widen → migrate → narrow; backfill before narrowing
- **Generated artifacts**: refresh Convex types after any schema change (`npx convex codegen`)
- **Convex code** (any PR touching `convex/`): read `convex/_generated/ai/guidelines.md` first; declare typed env vars in `convex/convex.config.ts` via `defineApp({ env: { ... } })` and read with `env` from `./_generated/server` (guidelines:261)

## Merge policy (from `AGENTS.md`)

- Pre-PR gate: run `npx greptile@latest review --diff` locally before pushing
- Each PR must show **Greptile Review** + **CodeRabbit** GitHub status checks green before merge
- If either check is missing, pending, or failed, wait for it to complete and pass before merging
- Do not rely on local-only verification; the PR must show the bot reviews in GitHub

---

## Phase 0 — Sender split (in progress)

### ✅ PR Split-domains 1a — `EmailKind` envelope (merged as PR #822)

Squash-merged into `main` as commit `238db198`. PR: https://github.com/dlitorja/mentorships-infra/pull/822

**Shipped scope**

- New `packages/emails/src/envelope.ts` exporting `EmailKind = "transactional" | "marketing" | "staging"` and `resolveFrom(kind)` with `EMAIL_FROM` fallback
- Widened `packages/emails/src/send.ts` and `apps/web/lib/email.ts` to accept optional `kind` and `idempotencyKey`; thread `X-Email-Kind` header
- Wrapper-caller sweep with `kind: "transactional"`: 5 Trigger.dev tasks, 5 apps/platform routes/functions, 5 apps/web routes/functions
- Direct `resend.emails.send` callers swap `EMAIL_FROM` constant for `resolveFrom(kind) || fallback`
- `apps/marketing/lib/email/client.ts` `getFromAddress()` and `apps/marketing/inngest/functions/waitlist-notifications.ts` resolve `EMAIL_FROM_MARKETING`
- `trigger.config.ts` syncs `EMAIL_FROM_TRANSACTIONAL`, `EMAIL_FROM_MARKETING`, `EMAIL_FROM_STAGING` to Trigger.dev env (NOT `RESEND_WEBHOOK_SECRET` — lands with Suppressions 2b)
- Convex env wiring folded in (was originally 1b): `convex/convex.config.ts` declares the four new optional env vars; `convex/notifications.ts` and `convex/instructorUploads.ts:1212` read `env.EMAIL_FROM_TRANSACTIONAL ?? process.env.EMAIL_FROM` and inject `X-Email-Kind: transactional`
- `apps/web/lib/email.ts` restored production-throws semantics for missing sender via `requireFromAddress(kind)` (Greptile P1 fix)
- MCP servers moved to `package.json` `devDependencies` (`resend-mcp@2.19.0`, `firecrawl-mcp@3.24.0`); MCP configs invoke `node ./node_modules/<pkg>/dist/index.js` instead of `npx -y` (lockfile-integrity fix)

**Verification at merge**

- `pnpm run typecheck` clean (root + apps/platform + apps/web)
- `pnpm exec vitest run` 406/406 pass; `packages/emails/src/send.skip.test.ts` 12/12 pass
- All 15 CI checks green (Greptile 5/5, CodeRabbit pass, build, E2E, Vercel previews for 4 apps)
- `npx convex codegen` regenerates `convex/_generated/server.d.ts` with the four env vars typed optional

**Behavior**

Zero behavior change until operators set the new env vars. With only `EMAIL_FROM` set (today's state), every code path falls back to it exactly as before. Once `EMAIL_FROM_TRANSACTIONAL` / `_MARKETING` are configured in Resend + env, transactional vs marketing mail will route to separate subdomains without code changes.

### ✅ Folded into #822 — `RESEND_WEBHOOK_SECRET` env declaration

The secret is declared in `convex/convex.config.ts` and `.env.example`, but **not** pushed to Trigger.dev (no Trigger task consumes it yet). The actual consumer is the Convex HTTP webhook in Suppressions 2b.

---

## Phase 1 — Suppressions webhook (ground truth for Phase 2)

### 🔵 PR Suppressions 2a — `suppressionEvents` table + types

**Why**: ground-truth per-message suppression events; Resend's batched `/metrics` API can disagree with webhook events for suppression-induced drops.

**Scope**

- `convex/schema.ts`: new `suppressionEvents` table with fields:
  - `kind: v.union(v.literal("bounce"), v.literal("complaint"), v.literal("unsubscribe"))`
  - `email: v.string()` — recipient address
  - `domain: v.string()` — recipient domain (for grouping; not user-input)
  - `resendId: v.string()` — Resend message id
  - `bounceType: v.optional(v.string())` (e.g. `hard`, `soft`)
  - `reason: v.optional(v.string())`
  - `receivedAt: v.number()` — webhook arrival timestamp (epoch ms)
  - `occurredAt: v.number()` — event timestamp from payload
  - `audienceId: v.optional(v.string())`
  - `raw: v.any()` — full Svix-verified payload (forensic lookup)
- Indexes: `["receivedAt"]`, `["domain", "receivedAt"]`, `["kind", "receivedAt"]`, `["resendId", "kind"]` (idempotency)
- Discriminated-union validator using `v.union(v.object(...))` per `convex/_generated/ai/guidelines.md:51`
- One-shot backfill action `seedSuppressionEventsFromList` (D5) that pulls `GET /v1/suppressions` and seeds the table

**Out of scope**: webhook handler, UI, periodic list-poll cron

**Acceptance criteria**

- `npx convex codegen` regenerates types cleanly
- Schema compiles (`pnpm run typecheck`)
- Empty table created in Convex deployment
- Backfill action callable, idempotent on `["resendId", "kind"]` index

**Verification**

- `pnpm run typecheck`
- `npx convex codegen && git diff convex/_generated/` → only generated types changed
- Pre-flight: declare `["domain", "receivedAt"]` as `staged: true` so deploy isn't blocked; remove `staged` in a follow-up once populated

**Risks**: large backfilled tables block deploy; keep `staged: true` for the multi-column index and remove in a follow-up.

---

### 🔵 PR Suppressions 2b — Svix-verified webhook handler

**Why**: write Resend per-message events to `suppressionEvents` with cryptographic integrity so the dashboard never trusts unsigned data.

**Scope**

- `convex/http.ts`: add `httpPostResendWebhook` `httpAction` that **bypasses `verifyAuth`** (Svix replaces Bearer auth). Reads raw body via `await request.text()`, parses Svix headers (`svix-id`, `svix-timestamp`, `svix-signature`), verifies signature using `RESEND_WEBHOOK_SECRET`
- New `convex/resendWebhook.ts`: exports `verifySvixSignature(rawBody, headers, secret)` and `parseResendEvent(rawBody)` returning typed event shapes
- `verifySvixSignature` adapts the HMAC pattern at `convex/dailyRecordingActions.ts:15` to Svix's `${svix-id}.${svix-timestamp}.${rawBody}` formula and `v1,base64hmac` prefix parsing
- Route registered via `http.route({ path: "/resend/webhook", method: "POST", handler: httpPostResendWebhook })` at the bottom of `convex/http.ts`
- Internal mutation `convex/mutations/suppressionEvents.ts` with `upsertSuppressionEvent({ resendId, kind, ... })` using the `["resendId", "kind"]` index for idempotency (returns existing on replay)
- Response: `200 { ok: true }` on success or replay; `401` on bad sig; `400` on unparseable body; never echo the raw payload
- Periodic reconciliation cron `reconcileSuppressionList` (every 6 h) polls `GET /v1/suppressions` and upserts (D1)
- Add `RESEND_WEBHOOK_SECRET` to `trigger.config.ts` `syncEnvVars` (no — only the Convex handler needs it; **leave Trigger sync untouched**)

**Out of scope**: dashboard, Resend `Suppression List` GET API polling for real-time (we use it only for reconciliation)

**Acceptance criteria**

- Valid Svix-signed payload from Resend test webhook → row in `suppressionEvents`, response 200
- Replay of same `svix-id` → no duplicate row, response 200
- Tampered body (sig mismatch) → 401, no write
- Missing `RESEND_WEBHOOK_SECRET` env → 500 with safe error message (no secret leakage)
- All four event types (`bounce`, `complaint`, `delivered` for sanity, `unsubscribe`) parse cleanly
- Reconciliation cron upserts without duplicates

**Verification**

- `pnpm run typecheck`
- `pnpm exec vitest run` — see PR Verify 4a for unit tests
- Live: `curl` against deployed Convex endpoint with payload signed via the same `RESEND_WEBHOOK_SECRET`; verify via `npx convex data suppressionEvents`
- Re-deliver the same Svix event → assert single row

**Rollout**

1. Deploy preview with `RESEND_WEBHOOK_SECRET` set
2. In Resend dashboard → Webhooks → create endpoint pointing at `https://<preview-convex>.convex.site/resend/webhook`
3. Send a test event; verify row
4. Promote to prod; flip prod webhook URL

**Risks**

- Svix secret rotation: handle `whsecret_v1` and `whsec_…` prefix variants; trim `v1,` prefix on signature
- Raw body must be read once and passed to both signature verification and JSON parsing — don't re-read the request
- Time skew: reject `svix-timestamp` older than 5 minutes (Svix replay window)

---

### 🔵 PR Suppressions 2c — `/admin/email-health` dashboard tile

**Why**: surface per-domain rates vs. Gmail/Yahoo thresholds (bounce > 0.05, complaint > 0.003) so on-call sees a spike before the inbox provider does.

**Scope**

- `convex/queries/emailHealth.ts`: `getEmailHealthSummary({ windowDays: 7 })` returning per-domain aggregates: `{ domain, bounces, complaints, unsubscribes, deliveredTotal, bounceRate, complaintRate }`
- `convex/schema.ts`: add `deniedDomains` table (when domain hits threshold, surface here). Fields: `domain`, `firstDeniedAt`, `lastDeniedAt`, `kind: v.union(v.literal("bounce"), v.literal("complaint"))`, `note: v.optional(v.string())`
- New route `apps/platform/app/admin/email-health/page.tsx` (Server Component) that calls the query and renders: per-domain rate cards, threshold badges, recent suppression events list (last 100), link to Resend dashboard
- New summary card on `apps/platform/app/admin/page.tsx` linking to the route — only shown when at least one `deniedDomains` row exists OR 7-day bounce rate > 0.02 (early-warning)
- Reuse `Card` + `CardContent`/`CardHeader`/`CardTitle` from `@/components/ui/card` matching existing admin page pattern

**Out of scope**: alerting (Phase 2 agent plugin), auto-suppression, hourly granularity

**Acceptance criteria**

- Page renders within 500 ms with synthetic seed data (no email send required)
- Threshold badges turn red when `bounceRate > 0.05` or `complaintRate > 0.003`
- Summary card on `/admin` appears when threshold breached
- All Convex queries type-check against `_generated/server.d.ts`
- Page is read-only (no mutations exposed)

**Verification**

- `pnpm run typecheck` clean
- `pnpm exec vitest run` clean
- Manual: navigate to `/admin/email-health` in preview, confirm renders with no errors
- Insert test rows via `npx convex data` and confirm thresholds flip

**Risks**: queries over `suppressionEvents` can grow unbounded; use indexed window scan with `withIndex("by_receivedAt", q => q.gt("receivedAt", cutoff))` and `.take(1000)` cap; aggregate counts in-memory for the bounded window.

---

## Phase 2 — Email Metrics API (depends on Phase 1)

### 🔵 PR Metrics 3a — `dailyEmailMetrics` table + ingestion cron

**Why**: Resend's `/v1/emails/metrics` API gives batched daily counts; combine with webhook events to confirm ground truth.

**Scope**

- `convex/schema.ts`: new `dailyEmailMetrics` table:
  - `date: v.string()` — `YYYY-MM-DD`
  - `audienceId: v.optional(v.string())`
  - `kind: v.union(v.literal("bounce"), v.literal("complaint"), v.literal("delivery"), v.literal("open"), v.literal("click"))`
  - `count: v.number()`
  - `source: v.union(v.literal("api"), v.literal("webhook_reconcile"))`
- Composite index `["date", "kind"]` + `["date", "audienceId", "kind"]`
- `convex/actions/resendMetrics.ts`: internal action `fetchDailyMetrics({ startDate, endDate })` that calls Resend `/v1/emails/metrics?start=…&end=…` (loop if window > 1 day), parses response, returns rows to upsert. Uses `RESEND_API_KEY` from env. Retry-with-backoff on 429 (`retry.fetch` with `condition: r => r?.status === 429`, exponential, max 4 retries)
- `convex/mutations/dailyEmailMetrics.ts`: `upsertDailyMetrics(rows)` keyed by `(date, audienceId, kind)`
- `convex/crons.ts`: new `crons.interval("fetch-resend-metrics", { hours: 6 }, internal.resendMetrics.fetchAndStore, {})` — fetches yesterday + today window each run, idempotent upsert

**Out of scope**: dashboard changes (3b), agent plugin (3c)

**Acceptance criteria**

- Cron registered in `convex/crons.ts` and appears in Convex dashboard schedule view
- Manual trigger of `internal.resendMetrics.fetchAndStore` writes expected rows
- Re-running same window does not duplicate (upsert by composite key)
- 429 backoff observed in a test stub

**Verification**

- `pnpm run typecheck` clean
- `pnpm exec vitest run` clean
- Deploy to preview; manually invoke via `npx convex run resendMetrics:fetchAndStore '{}'`
- Inspect `npx convex data dailyEmailMetrics`

**Risks**: Convex action runtime limit (~10 min) for long historical backfills; for backfill use `ctx.scheduler.runAfter(0, …)` chain (per `guidelines.md:335`); daily cron only handles 2-day window which fits comfortably.

---

### 🔵 PR Metrics 3b — overlay metrics on dashboard tile

**Why**: combine the daily batched counts with the per-message webhook counts so admins see both.

**Scope**

- Extend `convex/queries/emailHealth.ts`: add `getEmailMetricsOverlay({ windowDays: 7 })` returning `{ byDate: [{ date, delivery, bounce, complaint, open, click }] }` from `dailyEmailMetrics`
- Extend `apps/platform/app/admin/email-health/page.tsx`: add a per-day trend chart (Recharts is already used in repo). Use Recharts `<LineChart>` matching the existing chart style
- Threshold calculation now uses BOTH webhook counts (ground truth) AND API counts (volume baseline); flag any day where the two diverge by >10%
- Color-coded badges: green/yellow/red for each day's rate

**Out of scope**: hourly granularity (covered by D2 default), alerting

**Acceptance criteria**

- Trend chart renders with synthetic seed data
- Divergence flag appears when seeded counts intentionally diverge
- Lighthouse score for `/admin/email-health` ≥ 90 (existing admin pages match this)

**Verification**

- `pnpm run typecheck`
- `pnpm exec vitest run`
- Manual: seed both tables, navigate to page, confirm chart and badges

**Risks**: Recharts bundle size; verify it's already imported elsewhere to avoid duplicate bundle entry.

---

### 🔵 PR Metrics 3c — agent triage action (optional, D3 default)

**Why**: when a domain crosses threshold, summarize root cause and propose remediation; humans stay in loop.

**Scope**

- New `apps/platform/inngest/functions/email-triage.ts`: Inngest function subscribed to a Convex-pushed event `email/threshold-breach` (emitted by 3b when divergence detected). Reads recent `suppressionEvents` for the affected domain, summarizes (no LLM required for v1 — heuristic grouping), posts a Slack message to `#platform-alerts` and a row in `apps/platform/app/admin/email-health` page
- No third-party agent plugin; uses existing Inngest `step.run` for retry/idempotency

**Out of scope**: Resend's official `@resend/agent-plugin` (deferred to a separate PR if requested)

**Acceptance criteria**

- Threshold breach event triggers exactly one Inngest run (idempotency via `deduplicationKey`)
- Slack message posts with the affected domain, recent event sample, and proposed remediation
- Function is no-op when no Slack webhook is configured (env-gated)

**Verification**

- `pnpm run typecheck`
- Manual: trigger breach event, confirm Slack message
- Idempotency: re-fire event, confirm only one Slack message

**Rollout**: gate behind `EMAIL_TRIAGE_ENABLED=false` by default; enable per env via env var.

**Risks**: false positives from misconfigured Resend audience IDs; include a "snooze" toggle in the admin UI to suppress alerts for 24h.

---

## Phase 3 — Verification (alongside implementation PRs)

### 🔵 PR Verify 4a — Suppressions webhook tests

**Why**: lock in the Svix verification contract before more code depends on it.

**Scope**

- New `convex/suppressionEvents.test.ts` using `convex-test` + `vitest` per `convex/_generated/ai/guidelines.md:404`. Module map via `import.meta.glob("./**/*.ts")`
- Cases:
  1. Valid Svix signature → row written
  2. Invalid signature → 401, no row
  3. Missing `RESEND_WEBHOOK_SECRET` env → 500
  4. Replay (same `svix-id`) → no duplicate row
  5. Malformed body → 400, no row
  6. Future-timestamp `svix-timestamp` → rejected
  7. Stale `svix-timestamp` (>5 min old) → rejected

**Acceptance criteria**

- All 7 cases pass
- `pnpm exec vitest run` clean
- Tests do not require network (mock Svix signing helper)

**Verification**: `pnpm exec vitest run convex/suppressionEvents.test.ts`

---

### 🔵 PR Verify 4b — Metrics cron end-to-end test

**Why**: confirm the upsert path is idempotent and 429 backoff works.

**Scope**

- Stub Resend `/v1/emails/metrics` with `vi.fn` returning canned responses
- Cases:
  1. Single-day window → upsert writes one row per kind
  2. Re-running same window → no duplicates
  3. 429 first call, 200 second call → retry succeeds, single row
  4. Empty response → no rows, no error
- All inside `convex/dailyEmailMetrics.test.ts`

**Acceptance criteria**

- All cases pass
- Mocked time (`vi.useFakeTimers`) for cron interval test

**Verification**: `pnpm exec vitest run convex/dailyEmailMetrics.test.ts`

---

## Sequencing gates

```
PR 1a ✅ (squash-merged as #822)
   ↓
PR 2a (table) → PR 2b (handler) → PR 2c (UI tile) ── [gate: 4a tests pass]
   ↓
PR 3a (cron) → PR 3b (chart overlay) → PR 3c (agent, optional) ── [gate: 4b tests pass]
   ↓
PR 4a + 4b run alongside their respective phase PRs (not deferred)
```

Each PR must clear: `pnpm run typecheck` + `pnpm exec vitest run` + `pnpm run lint` (apps/platform + apps/web) + Greptile local review + CodeRabbit GitHub check.

## Env-var inventory

| Var | Declared in | Consumed by | Status |
|---|---|---|---|
| `EMAIL_FROM` | `.env.example`, Trigger sync, all apps | All wrappers (fallback) | shipped in #822 |
| `EMAIL_FROM_TRANSACTIONAL` | `.env.example`, Trigger sync, Convex env | `resolveFrom("transactional")`, `env.EMAIL_FROM_TRANSACTIONAL` | shipped in #822 |
| `EMAIL_FROM_MARKETING` | `.env.example`, Trigger sync, Convex env | `resolveFrom("marketing")` in apps/platform, apps/web, apps/marketing | shipped in #822 |
| `EMAIL_FROM_STAGING` | `.env.example`, Trigger sync, Convex env | `resolveFrom("staging")` (not yet called by any wrapper; reserved for Trigger dev/CI smoke tests) | shipped in #822 |
| `RESEND_WEBHOOK_SECRET` | `.env.example`, Convex env | Convex `/resend/webhook` handler | declared; **consumed in PR Suppressions 2b** |

## Related docs

- `AGENTS.md` — merge policy (Greptile + CodeRabbit), naming, Clerk policy, secret protection
- `convex/_generated/ai/guidelines.md` — Convex function/schema/auth/pagination/action conventions; **`env` declaration rules (line 261)**
- `docs/plans/cloudflare-integrations-platform-huckleberry-drive.md` — adjacent deliverability/infra initiative
- `docs/plans/video-calling.md` — adjacent WebRTC initiative (Daily.co webhook HMAC pattern reference at `convex/dailyRecordingActions.ts:15`)
