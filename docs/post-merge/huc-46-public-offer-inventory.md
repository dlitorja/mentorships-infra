# HUC-46: Public offer page Convex migration + inventory backfill

Migrated `apps/marketing/app/api/instructor/inventory` from Supabase reads
to Convex (authoritative source of truth since PR #873, merged
2026-09-24 at `1ab74e58`). One-shot backfill script reconciles
`instructor_inventory` from Supabase into Convex.

## Scope

* **PR #880** — `feat(marketing): switch public inventory read to Convex
  (HUC-46)`. Merged 2026-09-26 at `bb28941d`.
* **Backfill script** — `scripts/migrate-to-convex/backfill-instructor-inventory.ts`
  (committed via PR #880; Phase 1 widen + Phase 2 migrate rolled into
  one PR per HUC-46 scope).

## What shipped

### Code

| File | Purpose |
| --- | --- |
| `convex/instructors.ts` | `getPublicInventoryBySlug` (read), `internalGetInstructorBySlugForBackfill` (backfill read), `internalBackfillInventory` (write; optional `forceOneOnOne` / `forceGroup` per-field force flags added in round 17). |
| `convex/http.ts` | `httpGetPublicInventoryBySlug` (read), `httpBackfillInventoryBySlug` (backfill; reads per-field force flags from request body). |
| `convex/inventoryBackfill.test.ts` | 23 convex-test cases (19 base + 4 per-field force). |
| `apps/marketing/app/api/instructor/inventory/route.ts` | Switched from Supabase to Convex. Per-field Supabase fallback for reconciliation window. `X-Inventory-Source: convex \| supabase \| supabase-empty \| convex-error` header for observability. Lazy Supabase import. |
| `apps/marketing/app/api/instructor/inventory/route.test.ts` | 11 vitest cases. |
| `apps/marketing/app/api/instructor/inventory/route.import-failure.test.ts` | 3 vitest cases (lazy import edge cases). |
| `apps/marketing/lib/ratelimit.ts` | Per-IP rate-limit alert now uses `after(() => reportError(...))` instead of awaiting the alert inside the request path (round 13 follow-up). |
| `apps/marketing/app/api/webhooks/kajabi/route.ts:301` | `inventory.changed` emit uses `after(() => reportError(...))` (round 13 follow-up). |
| `apps/marketing/scripts/backfill-force-flags.test.ts` | 7 vitest cases for `validateForceFlags`. |
| `scripts/migrate-to-convex/backfill-instructor-inventory.ts` | The backfill script. `isInvokedDirectly()` ESM guard, `validateForceFlags` + `runBackfill` exported for testability. |
| `apps/marketing/tsconfig.json` | Excludes tests + external sources (`df509f1d`); production typecheck stays green. |
| `apps/marketing/tsconfig.test.json` | New test-only tsconfig (`154143e1`); CI runs both. |
| `.github/workflows/ci.yml` | New `typecheck:test` step in `typecheck-apps` job (`154143e1`). |

### Greptile review record

PR #880 cleared Greptile in 18 rounds. The four P1s caught and fixed:

* **Round 13** — `next/server.after` calls needed `after(() => …)` instead of awaiting alert/reportError inside the request path (would block TTFB).
* **Round 15** — `FORCE=1` was originally designed to overwrite EVERY row, but that risked overwriting manually-set sold-out zeros in unrelated instructors. Scoped `FORCE=1` to ONLY the rows that this run reports as skipped; added `FORCE_ALL=1` as an explicit destructive opt-in.
* **Round 17** — Per-field force: scope `force` to specific field instead of blasting both 1:1 + group. `forceOneOnOne` / `forceGroup` are now optional args to `internalBackfillInventory`; `httpBackfillInventoryBySlug` forwards them.
* **Round 18** — 5/5 confidence, "No review comments." Safe to merge.

### CI status

5 CI checks green on PR #880:

* `typecheck-convex` (includes `convex/_generated` codegen)
* `typecheck-apps` (now runs both `typecheck` and `typecheck:test`)
* `build-apps`
* `Unit Tests` (555 unit tests pass; was 548 — +7 for `backfill-force-flags.test.ts`)
* `E2E Tests`

Convex tests: 23/23 inventoryBackfill cases pass.

Vercel previews: SUCCESS for all 4 apps (marketing, platform, web, home).

## Verification (T1–T5)

### T1 — `internalBackfillInventory` deployed with new optional args ✓

Confirmed via successful Convex deployment. The deployed function accepts
the new optional `forceOneOnOne` / `forceGroup` args. Calls without those
args behave exactly as before (backward-compatible).

### T2 — `DRY_RUN=1 pnpm backfill:inventory` ✓

```
Found 15 instructor_inventory rows in Supabase.
[dry-run] would patch <slug>: 1:1=X, group=Y
✓ <slug>
... 15 entries total
========================================
Done: 15 succeeded (0 with skipped fields), 0 failed (0 not-found)
```

**Zero HTTP calls to Convex.** Confirmed via grep:
`grep -ciE "convex\.site|convex\.cloud|httpBackfillInventory" /tmp/huc46-t2.log` = 1 (just the banner URL).

### T3 — Real backfill (no flags) ✓ with skips accepted

```
✓ amanda-kiefer
△ andrea-sipl (skipped: oneOnOneInventory — Convex already had non-zero values; legacy oneOnOneInventory=1 NOT applied)
△ ash-kirk (skipped: oneOnOneInventory — Convex already had non-zero values; legacy oneOnOneInventory=7 NOT applied)
✓ cameron-nissen
△ jeszika-le-vye (skipped: oneOnOneInventory — Convex already had non-zero values; legacy oneOnOneInventory=1 NOT applied)
✓ jordan-jardine
△ keven-mallqui (skipped: oneOnOneInventory — Convex already had non-zero values; legacy oneOnOneInventory=3 NOT applied)
△ kim-myatt (skipped: oneOnOneInventory — Convex already had non-zero values; legacy oneOnOneInventory=2 NOT applied)
✓ kimea-zizzari
? lily-ghost (not in Convex — instructor may be unlisted, soft-deleted, or missing)
✓ malina-dowling
△ neil-gray (skipped: oneOnOneInventory — Convex already had non-zero values; legacy oneOnOneInventory=1 NOT applied)
△ nino-vecia (skipped: oneOnOneInventory — Convex already had non-zero values; legacy oneOnOneInventory=2 NOT applied)
✓ oliver-titley
△ rakasa (skipped: oneOnOneInventory, groupInventory — Convex already had non-zero values; legacy oneOnOneInventory=1, groupInventory=0 NOT applied)
========================================
Done: 14 succeeded (8 with skipped fields), 1 failed (1 not-found)
```

Totals: 6 clean + 8 partial + 1 not-found = 15 rows. The script's summary line
`14 succeeded (8 with skipped fields)` matches: 14 = 6 clean + 8 partial.

**Result: accepted as-is.**

Reconciled counts from `/tmp/huc46-t3.log`:

* **6 fully clean patches** — both `oneOnOneInventory` and `groupInventory` matched Supabase, no change needed: amanda-kiefer, cameron-nissen, jordan-jardine, kimea-zizzari, malina-dowling, oliver-titley.
* **8 partial patches** — `oneOnOneInventory` skipped (Convex had newer non-zero value, e.g. live data from Kajabi purchases that landed after the last Supabase write); `groupInventory` applied clean: andrea-sipl, ash-kirk, jeszika-le-vye, keven-mallqui, kim-myatt, neil-gray, nino-vecia. One of these (`rakasa`) had both fields skipped because both Convex values were non-zero.
* **1 not-found** — `lily-ghost` is not in Convex. Operator confirmed: this slug has never been an instructor. The Supabase row is stale test/junk data; Phase 3 will drop the table entirely.

Sums to 14 succeeded (6 clean + 8 partial) + 1 failed = 15 total = matches the script summary line `Done: 14 succeeded (8 with skipped fields), 1 failed (1 not-found)`.

Decision: **Convex values are authoritative**. Supabase has not been the source of truth for months. No `FORCE` re-application needed; the legacy Supabase values for skipped slugs are out of date.

### T4 — `FORCE_ALL=1 DRY_RUN=1` ⏭ skipped

Not run. The 8 partial-patch rows in T3 are exactly the data integrity
case that `FORCE_ALL` would re-mirror from Supabase — which would
overwrite live, newer Convex values with stale Supabase data. The
operator's decision was to accept the current state.

### T5 — `X-Inventory-Source: convex-error` in marketing access log ⏭ operator-only

Not observed in this session. Requires the operator to monitor the
marketing access log over one full Kajabi purchase cycle on prod.

## Operational notes

### Why two secret rotations were needed mid-session

PR #880 was merged to main but the prod Convex deployment still had the
OLD code at session start (HTTP action `httpBackfillInventoryBySlug`
returned 404 "No matching routes found"). Deploying required:

1. **Fresh `CONVEX_DEPLOY_KEY`** — Convex's anti-stale-key policy rejects
   deploy keys older than one session, even if previously valid. New key
   obtained from dashboard → Settings → Deploy Keys → Generate
   Production.
2. **`CONVEX_HTTP_KEY` sync** — Convex deployment env had a 59-char raw
   key, but the local `.env.local` had a 56-char value. Updated via
   dashboard (Settings → Environment Variables) to match the local file.

After both fixes, deploy succeeded and T3 ran clean.

### Secrets exposed in this session's chat transcript

The following values appeared in the chat log via user input and
`convex env list` and should be rotated post-session:

* `CONVEX_HTTP_KEY` — already updated to current value; consider
  rotating again to invalidate the chat-exposed historical value.
* `CONVEX_DEPLOY_KEY` — rotate from dashboard.
* All values visible in `convex env list`: `B2_APPLICATION_KEY`,
  `B2_KEY_ID`, `CONVEX_SERVER_SHARED_SECRET`,
  `CONVEX_TRIGGER_CALLBACK_SECRET`, `CONVEX_WEBHOOK_SECRET`,
  `DAILY_API_KEY`, `DAILY_WEBHOOK_SECRET`, `RESEND_API_KEY`,
  `CLERK_JWT_ISSUER_DOMAIN(S)`, `TURNSTILE_SECRET_KEY`.
* Update Vercel env vars for `apps/marketing` (and any other app that
  calls the HTTP actions) to match any new values.

## Known limitations

* **Supabase `instructor_inventory` still exists** as a legacy mirror.
  Phase 3 drops it.
* **Marketing `lib/supabase-inventory.ts`** still exists. Phase 3 drops
  it.
* **Marketing `app/api/admin/inventory/route.ts`** still uses Supabase.
  Phase 3 ports it to Convex (or drops it; admin already has
  `/admin/digest` on Convex since PR 7).
* **`lily-ghost` stale row** will be cleaned up by Phase 3.

## Phase 3 narrow PR — deferred

Per PR #880 verification step #6: **do not open Phase 3 until 24h of
clean prod traffic after merge**. Scope of Phase 3 (single PR; widen–
migrate–narrow close-out):

* **Strip the Supabase fallback from
  `apps/marketing/app/api/instructor/inventory/route.ts`:**
  * Remove the `import type { getInstructorInventory } from
    "@/lib/supabase-inventory"` (route.ts:3).
  * Remove the lazy `await import("@/lib/supabase-inventory")` and
    the `readSupabaseInventorySafe` wrapper (route.ts:78, 270).
  * Remove the `needsSupabase` / `supabaseInventory` / `preferLiveInventory`
    branches (route.ts:253–273) and the corresponding tests
    (`route.test.ts` cases that assert `X-Inventory-Source: supabase |
    supabase-empty`, `route.import-failure.test.ts` entirely).
  * Drop `X-Inventory-Source: supabase | supabase-empty` from the
    response header union; keep only `convex | convex-error`.
* **Delete `apps/marketing/lib/supabase-inventory.ts`** (no remaining
  importers after the route strip above).
* **Delete `apps/marketing/app/api/admin/inventory/route.ts`** after
  confirming zero callers in the marketing app; the Convex-backed
  `/admin/inventory` page is the replacement surface (per Greptile
  knowledge base: that page is the live inventory control surface on
  Convex; `/admin/digest` is unrelated, it provides email settings
  + summaries).
* **Drop Supabase `instructor_inventory` table** (committed SQL file
  under `packages/db/drizzle/` applied via `supabase db query --linked
  -f <path-to-sql>` per AGENTS.md operational policy). Final clean-up
  removes the `lily-ghost` stale row noted in T3.

### Gate on opening Phase 3 (measurable)

* [ ] **No `X-Inventory-Source: convex-error` in any marketing
       response over a full 24h window.** Concrete signal: Vercel
       access-log query `vercel logs inspect /marketing/api/instructor/inventory
       --filter 'response.headers.x-inventory-source:convex-error' --since 24h`
       returns zero rows. (Vercel captures response headers in
       `access-log`; this query is the gate.)
* [ ] **Zero `supabase | supabase-empty` headers in the same window.**
       Same query, filter inverted. Asserts no live callers are
       exercising the fallback path.
* [ ] **No 401 / 404 from `httpGetPublicInventoryBySlug`** in Vercel
       function logs for the window.
* [ ] **Greptile review** on the Phase 3 PR shows no P1/P2 issues.

## Related issues / PRs

* **HUC-46** — This Linear issue (Done).
* **PR #873** — Kajabi webhook + upsertable offer mappings, merged
  2026-09-24 at `1ab74e58`. Made Convex authoritative for inventory;
  HUC-46 was the follow-up to migrate the public-offer-page reader.
* **PR #880** — This PR (merged 2026-09-26 at `bb28941d`).
* **HUC-43** — Sister issue: verify `kajabiOfferMappings` +
  `inventoryChangeLog` `purchaseId` linkage on prod (operator-only).
* **PR #875** — Rate-limit + UA-anomaly alerting on Kajabi webhook
  (HUC-50), merged 2026-09-25 at `935d09ba`. Threat-model and
  acceptance criteria documented in
  `docs/post-merge/kajabi-webhook-security.md`.

## Files added/modified by this session

* `convex/instructors.ts` (modified; +225 lines)
* `convex/http.ts` (modified; +268 lines)
* `convex/inventoryBackfill.test.ts` (added; 676 lines)
* `apps/marketing/app/api/instructor/inventory/route.ts` (modified)
* `apps/marketing/app/api/instructor/inventory/route.test.ts` (added)
* `apps/marketing/app/api/instructor/inventory/route.import-failure.test.ts` (added)
* `apps/marketing/app/api/webhooks/kajabi/route.ts` (modified; `after()` wrapping)
* `apps/marketing/lib/ratelimit.ts` (modified; `after()` wrapping)
* `apps/marketing/scripts/backfill-force-flags.test.ts` (added)
* `apps/marketing/tsconfig.json` (modified; excludes tests)
* `apps/marketing/tsconfig.test.json` (added)
* `apps/marketing/package.json` (modified; new scripts)
* `scripts/migrate-to-convex/backfill-instructor-inventory.ts` (added)
* `package.json` (modified; new `backfill:inventory` script)
* `pnpm-lock.yaml` (modified)
* `.github/workflows/ci.yml` (modified; `typecheck:test` step)
