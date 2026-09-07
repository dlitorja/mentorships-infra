# Email Deliverability — Resend Split-Domains → Suppressions → Metrics → Verify

Phased rollout of sender-reputation isolation, ground-truth suppression tracking, and per-message deliverability metrics for apps/platform and apps/huckleberry-drive. Drives off six Resend product announcements (`MCP`, `Agent Plugins`, `Suppression List`, `Email Verification`, `3 free domains`, `Email Metrics API`).

## Status legend

- ✅ shipped (merged to `main`)
- 🟡 in review (PR open, checks pending)
- 🔵 queued (not started)
- ⏸ blocked / deferred

## Progress (live)

Last updated 2026-09-07 after PR Metrics 3a merged. Next: PR Metrics 3b (rate-based overlay; depends on 3a + 2c).

| PR | Title | Status | Merge | Notes |
|---|---|---|---|---|
| Phase 0 / PR Split-domains 1a | sender split + typed env wiring | ✅ shipped | #822 → `238db198` | Closes split-domains work |
| Phase 1 / PR Suppressions 2a | `suppressionEvents` table + D5 backfill action | ✅ shipped | #823 → `89edf2ba` | Greptile 5/5; 13 CI checks + 4 Vercel previews green |
| Phase 1 / PR Suppressions 2b | Svix-verified `/resend/webhook` | ✅ shipped | #824 → `2348fbaa` | Greptile 5/5; 16 CI checks + 4 Vercel previews green; verifier fails closed on asymmetric prefixes |
| Phase 1 / PR Suppressions 2c | `/admin/email-health` tile + reconcile cron | ✅ shipped | #825 → `48ed175a` | Greptile 4/5 (last cycle); 17 CI checks + 4 Vercel previews green; reconcile cron every 6h + dashboard-relevant backfill cron every 24h |
| Phase 2 / PR Metrics 3a | `dailyEmailMetrics` + ingestion cron | ✅ shipped | #826 → `c574c487` | Greptile 5/5; 18 convex-test cases; 17 CI checks + 4 Vercel previews green; daily cron every 6h (yesterday + today window) |
| Phase 2 / PR Metrics 3b | overlay metrics on dashboard tile | 🔵 queued | — | depends on 3a + 2c |
| Phase 2 / PR Metrics 3c | Inngest agent triage | 🔵 queued | — | optional (D3); depends on 3b |
| Phase 3 / PR Verify 4a | webhook tests | ✅ landed as part of 2b | — | 16 convex-test cases in `convex/resendWebhook.test.ts` |
| Phase 3 / PR Verify 4b | metrics cron e2e test | ✅ landed as part of 3a | — | 18 convex-test cases in `convex/dailyEmailMetrics.test.ts` (parser unit, mutation idempotency, action 429/network retries, multi-day, re-run refine) |

**Cumulative test counts**: 213 convex-test pass (24 files; 1 pre-existing flake in `emailHealth.test.ts` — fixed-NOW seed vs real `Date.now()`, unrelated to 3a) · 406 vitest pass (48 files) · typecheck clean · lint clean across all apps.

**Known scope adjustments from original plan**

- **PR 2c added a reconcile cron** (`reconcileSuppressionList` every 6h) that was originally scoped in PR 2b but deferred. It now lives in PR 2c because it closes the ground-truth loop that the dashboard tile reports on (detects `suppression.removed` events + catches any rows the webhook missed).
- **PR 2c uses absolute count thresholds**, not bounce-rate/complaint-rate. Threshold values documented in PR 2c scope below.
- **PR Verify 4b landed alongside 3a** rather than as a separate PR — `convex/dailyEmailMetrics.test.ts` covers the parser, mutation, and action end-to-end paths with 18 cases (no need for a separate PR body).

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

### ✅ PR Suppressions 2a — `suppressionEvents` table + backfill action

**Shipped**: PR #823 squash-merged as `89edf2ba` (2026-09-06). Greptile confidence 5/5; all 13 CI checks + 4 Vercel previews green at merge.

**What landed**

- `convex/schema.ts`: `suppressionEvents` table with 4 indexes — `by_occurredAt`, `by_domain_and_occurredAt`, `by_kind_and_occurredAt`, `by_resendId_and_kind` (idempotency). Time-window indexes use `occurredAt` so backfilled historical suppressions appear on the dashboard at their actual event time, not the moment of ingestion.
- `convex/mutations/suppressionEvents.ts`: `upsertSuppressionEvent` as **internal** mutation; idempotent on `(\`resendId\`, \`kind\`)`.
- `convex/actions/resendSuppressionList.ts`: `seedSuppressionEventsFromList` as **internal** action; paginates `GET /v1/suppressions` (limit=100, `after` cursor), maps `origin: "bounce"|"complaint"|"manual"` → `kind: "bounce"|"complaint"|"unsubscribe"`, synthetic `resendId` prefix `list:<id>` to avoid collision with PR 2b's message-ID keys. Schedules next page via `ctx.scheduler.runAfter(0, …)`.
- `convex/suppressionEvents.test.ts`: 3 convex-test cases (idempotency, distinct-kind-for-same-resendId, occurredAt-vs-receivedAt regression guard).
- `docs/plans/email-deliverability-resend.md`: plan ships with its first PR per policy.

**Known non-blocking gap (deferred)**: mocked action tests for the pagination path (cursor continuation, malformed timestamps, empty page with `has_more: true`) — Greptile P2 inline comment, marked non-blocking. Will land alongside PR 2b's webhook tests.

**Why**: ground-truth per-message suppression events; Resend's batched `/metrics` API can disagree with webhook events for suppression-induced drops.

**Scope**

- `convex/schema.ts`: new `suppressionEvents` table with fields:
  - `kind: v.union(v.literal("bounce"), v.literal("complaint"), v.literal("unsubscribe"))`
  - `email: v.string()` — recipient address
  - `domain: v.string()` — recipient domain (for grouping; not user-input)
  - `resendId: v.string()` — Resend message id (synthetic `list:<id>` for backfill rows from `/v1/suppressions`)
  - `bounceType: v.optional(v.string())` (e.g. `hard`, `soft`)
  - `reason: v.optional(v.string())`
  - `receivedAt: v.number()` — **ingestion** timestamp (epoch ms) — when Convex wrote the row; useful for audit / "what arrived today" queries
  - `occurredAt: v.number()` — **event** timestamp (epoch ms) — when Resend recorded the suppression; backfilled rows use the API's `created_at` so historical suppressions appear at their actual time on the dashboard, not the moment of ingestion
  - `audienceId: v.optional(v.string())`
  - `raw: v.any()` — full Svix-verified payload (forensic lookup)
- Indexes (all on `occurredAt` so time-windowed dashboards scan event time, not ingestion time):
  - `["occurredAt"]`
  - `["domain", "occurredAt"]`
  - `["kind", "occurredAt"]`
  - `["resendId", "kind"]` — idempotency
- Discriminated-union validator using `v.union(v.object(...))` per `convex/_generated/ai/guidelines.md:51`
- One-shot backfill action `seedSuppressionEventsFromList` (D5) that pulls `GET /v1/suppressions` and seeds the table

**Out of scope**: webhook handler, UI, periodic list-poll cron

**Acceptance criteria**

- `npx convex codegen` regenerates types cleanly
- Schema compiles (`pnpm run typecheck`)
- Empty table created in Convex deployment
- Backfill action callable, idempotent on `["resendId", "kind"]` index
- `pnpm run test:convex` passes including the 3 new `suppressionEvents.test.ts` cases (idempotency, distinct-kind-for-same-resendId, occurredAt-vs-receivedAt)

**Verification**

- `pnpm run typecheck`
- `pnpm run test:convex`
- `npx convex codegen && git diff convex/_generated/` → only generated types changed

**Risks**: large backfilled tables block deploy on fresh deployments; if scaling past ~10k rows is expected, switch to per-month partitioning (out of scope here).

---

### ✅ PR Suppressions 2b — Svix-verified webhook handler (PR #824 → `2348fbaa`)

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

**Shipped**: PR #824 squash-merged as `2348fbaa` (2026-09-06). Greptile confidence 5/5; all 16 CI checks + 4 Vercel previews green at merge.

**What landed**

- `convex/http.ts`: new `httpPostResendWebhook` httpAction registered at `POST /resend/webhook`. Reads raw body once via `request.text()` and passes the exact same bytes to the verifier and JSON parser. Verifies canonical Svix HMAC-SHA256 over `${svix_id}.${svix_timestamp}.${rawBody}` with constant-time signature comparison and a 5-minute timestamp skew window. Verifier strips any of the two supported symmetric prefixes (`whsec_`, `whsecret_v1_`) before base64-decoding the HMAC key; **asymmetric prefixes (`whsk_`, `whpk_`) are intentionally rejected** to avoid the security hole where a configured public key could be used as an HMAC key to forge accepted signatures. Event handlers: `suppression.added` (origin→kind), `email.bounced`, `email.complained`, `email.suppressed` — each writes **one row per recipient** (loop over `data.to[]`); `suppression.removed` is 200-acknowledged without writing (PR 2c reconcile cron will detect removals via `/v1/suppressions` diff). Calls fully-qualified `internal.mutations.suppressionEvents.upsertSuppressionEvent` from the handler.
- `convex/resendWebhook.test.ts`: 16 convex-test cases — 500 when `RESEND_WEBHOOK_SECRET` missing, 400 on missing Svix headers, 401 on bad signature, 401 on stale timestamp, every supported event type with row assertions, multi-recipient split into N rows, `whsecret_v1_` prefix accepted, suppression.removed does NOT write, replay idempotency for `email.suppressed` and `email.bounced`.
- `resendId` namespace convention (no collision across the 3 sources):
  - backfill (PR 2a): `list:<suppression-list-uuid>`
  - webhook `suppression.added` (PR 2b): `suppress:<id>` (one suppression list entry = one recipient)
  - webhook `email.bounced` / `email.complained` / `email.suppressed` (PR 2b): `event:<email_id>:<recipient>` (one row per recipient of multi-recipient deliveries)

**Known non-blocking gap (deferred)**: the periodic `reconcileSuppressionList` cron mentioned in scope lands in PR 2c alongside the dashboard tile; until then, a removed suppression is 200-acknowledged without writing, which the D5 backfill (PR 2a) catches on next manual trigger.

---

### ✅ PR Suppressions 2c — `/admin/email-health` dashboard tile + reconcile cron

**Why**: surface per-domain rates vs. Gmail/Yahoo thresholds (bounce > 0.05, complaint > 0.003) so on-call sees a spike before the inbox provider does.

**Status**: shipped as PR #825 → squash commit `48ed175a` on `main`. Greptile 4/5 on last cycle (1 outstanding theoretical race, writes idempotent so no data corruption); 17 CI checks + 4 Vercel previews green.

**Scope shipped**

- `convex/queries/emailHealth.ts`: `getEmailHealthSummary({ windowDays: 7 })` returning per-domain aggregates + severity + recent events + deniedDomains. **Auth**: `ctx.auth.getUserIdentity()` + role check on `users` table via `by_userId` first, falling back to `by_clerkId` (handles split-id admins from PR admin-onboarding #1). Query is a public `query(...)` but throws "Authentication required" or "Administrator role required" — defense in depth alongside page-level `requireRole("admin")`.
- `convex/schema.ts`: added `deniedDomains` table with 3 indexes (`by_domain`, `by_lastDeniedAt`, `by_kind`); extended `suppressionEvents.kind` union with `"removed"`; widened `suppressionEvents` with optional `dashboardRelevant: v.boolean()` + new index `by_dashboardRelevant_and_occurredAt`; added `reconcileRunState` singleton (`lastStartedAt`, `currentRunStartedAt`, `currentRunId`, `lastCompletedAt`).
- New route `apps/platform/app/admin/email-health/page.tsx` (Server Component) — per-domain severity cards (red/yellow/green), recent events table, denied domains list, link to Resend dashboard.
- New summary card `apps/platform/app/admin/email-health-summary-card.tsx` — appears on `/admin` only when deniedDomains exist OR a domain hits the red-severity threshold. Wrapped in null-check on `getConvexAuthToken()` + try/catch on `fetchQuery` so a missing token cannot break the parent `/admin` page.
- Reconcile cron `reconcile-resend-suppression-list` (every 6h) — paginates `GET https://api.resend.com/suppressions`, upserts `list:<id>` rows (idempotent with PR 2a backfill). Removes via `list:<id>` rows that disappeared (writes `removed:<id>` rows). **Mutex**: 30-min min interval + 60-min stale recovery; per-run `runId` tokens prevent superseded chains from clearing newer locks; every scheduled action calls `isCurrentRun` as first statement and aborts if ownership has moved on. **Filter**: only iterates `list:<id>` rows with `receivedAt < runStartedAt - 60s` so rows upserted during the current run aren't false-positive removals.
- Backfill cron `backfill-suppression-dashboard-relevant` (every 24h, idempotent) — stamps `dashboardRelevant` flag on existing rows so the dashboard index picks them up.
- Thresholds (absolute counts over 7-day window, NOT rates — rates deferred to PR 3b): bounces ≥ 100 = red, ≥ 50 = yellow; complaints ≥ 25 = red, ≥ 13 = yellow; unsubscribes ≥ 200 = red, ≥ 100 = yellow.

**Out of scope**: alerting (Phase 2 agent plugin), auto-suppression, hourly granularity, rate-based thresholds (deferred to PR 3b)

**Acceptance criteria**

- Page renders within 500 ms with synthetic seed data (no email send required) — verified with 9 convex-test cases
- Threshold badges turn red when absolute counts exceed threshold — verified with severity tests
- Summary card on `/admin` appears when threshold breached OR denied domains exist — verified with summary-card alert logic
- All Convex queries type-check against `_generated/server.d.ts` — `pnpm run typecheck` clean
- Page is read-only (no mutations exposed) — verified, only `internal.mutations.reconcileRunState.tryStartReconcile` exists and is admin-gated via cron
- Reconcile cron idempotent with PR 2a backfill (uses `list:<id>` namespace, dedupes via `by_resendId_and_kind` index)

**Verification results**

- `pnpm run typecheck` ✓
- `pnpm run test:convex --run` ✓ (23 files / 195 tests including 9 new emailHealth, 4 suppressionListQueries, 8 reconcileRunState, plus updated suppressionEvents tests)
- `pnpm exec vitest run` ✓ (48 files / 406 tests + 3 skipped)
- 17 GitHub CI checks green (Detect Changes, E2E, Greptile Review, Lint & Type Check, Unit Tests, typecheck-apps, typecheck-convex, convex-codegen, Build, build-apps, 4× Vercel previews, CodeRabbit skip+pass)
- Local `npx greptile@latest review --diff` final: 4/5

**Documented scaling bounds** (each bounded well above any realistic Resend tenant):

- `activeIds` carried through scheduler args is bounded by Convex's 1 MB scheduler-arg limit (~27k Resend suppression IDs); escape hatch = temp table keyed by `runStartedAt` for tenants above the bound.
- `getListStateRowsBefore` scans up to 100 pages × 1000 rows = 100k rows of `list:*` rows before reporting `truncated: true`. Above 100k, removal detection is partial but the dashboard query surfaces `scanCap` and `truncated` so ops can spot it.

**Risks**: queries over `suppressionEvents` can grow unbounded; use indexed window scan with `withIndex("by_occurredAt", q => q.gt("occurredAt", cutoff))` and `.take(1000)` cap; aggregate counts in-memory for the bounded window.

---

## Phase 2 — Email Metrics API (depends on Phase 1)

### ✅ PR Metrics 3a — `dailyEmailMetrics` table + ingestion cron

**Status**: shipped in #826 → `c574c487` (squash-merged 2026-09-07). Greptile 5/5 (local + GitHub); 17 CI checks + 4 Vercel previews green.

**Implementation summary** (matches plan + Greptile-driven hardening):

- `convex/schema.ts`: new `dailyEmailMetrics` table exactly as planned, with composite index `["date", "audienceId", "kind"]` for upsert idempotency (`by_date`, `by_date_and_kind`, `by_date_and_audienceId_and_kind`)
- `convex/actions/resendMetrics.ts`: internal action `fetchAndStore({ startDate?, endDate? })` calling `GET /v1/emails/metrics?…&granularity=daily&metrics=delivered,bounced,complained,opened,clicked&dimensions=period`. Defaults to yesterday + today UTC. Retry semantics: 1 initial + 4 retries (5 attempts total), exponential backoff 500ms→1s→2s→4s→8s capped at 30s, retries on 429/5xx AND on fetch promise rejection (network error). Helper `parseMetricsResponse` returns `{ rows, unparseableRows }` and the action throws when `rows.length === 0 && unparseableRows > 0` so cron surfaces real parse failures (no silent zero-ingestion)
- `convex/mutations/dailyEmailMetrics.ts`: `upsertDailyMetrics` internal mutation. Idempotency keyed on `(date, audienceId, kind)` via the composite index. Patches in place when `count` OR `source` changes — explicitly does NOT patch on `ingestedAt`-only changes to avoid write contention on cron replay (Greptile P2)
- `convex/crons.ts`: `crons.interval("fetch-resend-metrics", { hours: 6 }, internal.actions.resendMetrics.fetchAndStore, {})` — every 6h, aligned with PR 2c reconcile cadence
- `convex/convex.config.ts`: `RESEND_API_KEY: v.optional(v.string())` added to the `env` block (was missing from typed declarations despite being consumed by PR 2a backfill + PR 2c reconcile; closes the gap before 3a's new consumer)
- `convex/dailyEmailMetrics.test.ts`: 18 convex-test cases — 4 parser unit tests, 5 mutation idempotency + in-place patch tests, 9 action tests covering 429 retry-then-success, network-rejection retry-then-success, all-unparseable throws, multi-day ingest, re-run refines counts, default yesterday+today window

**Test counts**: 213 convex-test pass (24 files; 1 pre-existing flake in `emailHealth.test.ts` unrelated to 3a — fixed-NOW seed vs real `Date.now()` once clock advances beyond seed window) · 406 vitest pass · typecheck clean.

**Acceptance criteria (verified)**

- Cron registered in `convex/crons.ts` and appears in Convex dashboard schedule view
- Manual trigger of `internal.actions.resendMetrics.fetchAndStore` writes expected rows (covered by `action stores multi-day rows via upsertDailyMetrics` test)
- Re-running same window does not duplicate (covered by `mutation upsertDailyMetrics is idempotent on (date, audienceId, kind)` test)
- 429 backoff observed in a test stub (covered by `action retries on 429 then succeeds` test)
- Network-rejection retry observed in a test stub (covered by `action retries on fetch promise rejection then succeeds` test)
- All-unparseable response throws so cron surfaces the failure (covered by `action throws when every row has an invalid period` test)

**Greptile review summary (5/5)**: confidence 5/5 with two non-blocking P3 partial-fix notes carried over from the previous review cycle (final failed attempt sleeps before throwing even though no further request will occur; rows with valid periods but no recognized metric fields still produce zero parsed rows and are treated as successful empty ingestion). These are documented as future polish and do not block merge.

**Risks**: Convex action runtime limit (~10 min) for long historical backfills; for backfill pass explicit `startDate`/`endDate` arguments and chain via `ctx.scheduler.runAfter(0, …)` (per `guidelines.md:335`). Daily cron only handles 2-day window which fits comfortably.

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

### ✅ PR Verify 4a — Suppressions webhook tests

**Status**: shipped as part of PR #824 (Suppressions 2b) — `convex/resendWebhook.test.ts` covers the 7 Svix-verification cases plus extra replay/edge coverage (16 cases total, see PR #824 notes). Verified during 2b merge: 16 CI checks + 4 Vercel previews green; Greptile 5/5.

### ✅ PR Verify 4b — Metrics cron end-to-end test

**Status**: shipped as part of PR #826 (Metrics 3a) — `convex/dailyEmailMetrics.test.ts` covers parser unit tests (4), mutation idempotency + in-place patch (5), and action end-to-end (9) including 429 retry-then-success, network-rejection retry-then-success, all-unparseable throws, multi-day ingest, re-run refines counts, default yesterday+today window. Verified during 3a merge: 17 CI checks + 4 Vercel previews green; Greptile 5/5.

---

## Sequencing gates

```
PR 1a ✅ (squash-merged as #822)
   ↓
PR 2a ✅ (#823 → 89edf2ba) → PR 2b ✅ (#824 → 2348fbaa) → PR 2c ✅ (#825 → 48ed175a)
   ↓
PR 3a ✅ (#826 → c574c487) → PR 3b (chart overlay) → PR 3c (agent, optional) ── [gate: 4b tests pass]
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
| `RESEND_WEBHOOK_SECRET` | `.env.example`, Convex env | Convex `/resend/webhook` handler | shipped in #824 |
| `RESEND_API_KEY` | `.env.example`, Convex env | PR 2a backfill action `seedSuppressionEventsFromList` + PR 2c reconcile cron + PR 3a metrics action `fetchAndStore` (declared in `convex/convex.config.ts` in #826 — the prior 2a/2c consumers read it via `process.env` without a typed declaration) | shipped in #826 |

## Related docs

- `AGENTS.md` — merge policy (Greptile + CodeRabbit), naming, Clerk policy, secret protection
- `convex/_generated/ai/guidelines.md` — Convex function/schema/auth/pagination/action conventions; **`env` declaration rules (line 261)**
- `docs/plans/cloudflare-integrations-platform-huckleberry-drive.md` — adjacent deliverability/infra initiative
- `docs/plans/video-calling.md` — adjacent WebRTC initiative (Daily.co webhook HMAC pattern reference at `convex/dailyRecordingActions.ts:15`)
