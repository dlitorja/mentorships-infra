# Apps/Platform × Kajabi Integration Landscape

A catalog of integration opportunities between `apps/platform` and Kajabi's recent platform developments (Seaside cycle Jan–Feb 2026, Timberline cycle Mar–May 2026, and the Q3 2025 Kajabi API launch). Tiered by fit, risk, and existing-code overlap.

## State of the union (current Kajabi footprint in this repo)

Before listing opportunities, here's what already bridges to Kajabi — most items below build on these:

| Touchpoint | Location |
|---|---|
| Purchase webhook (decrements inventory) | `apps/marketing/app/api/webhooks/kajabi/route.ts` |
| Offer ID ↔ instructor slug map | `packages/db/KAJABI_OFFER_MAPPINGS.sql` |
| Schema: `kajabi_offers` + indexes | `packages/db/src/schema/kajabi-offers.ts` |
| Schema: `inventory_change_log` w/ `kajabi_purchase` rows | `packages/db/drizzle/0016_inventory_change_log.sql` |
| Admin onboarding source tag | `source: "kajabi" \| "manual" \| "import" \| "api"` in `apps/platform/lib/queries/convex/use-admin-onboardings.ts:50` and `apps/platform/app/api/admin/students/onboard/route.ts:30,230` |
| Kajabi-only students get hand-built workspaces (no payment) | Admin onboarding flow (PR history) |

Key gap: the Kajabi webhook handler lives in `apps/marketing`, but inventory + admin onboarding live in `apps/platform`. They rely on the same Supabase tables, so the boundary is porous. Several items below would tighten or formalize that boundary.

Kajabi recent developments referenced:
- Changelog Apr–Jun 2026: Multiple Order Bumps, Payment Processing Fee Invoices, Instant Payouts, Community Improvements (Timberline), Media Library, Redesigned Upsells, Checkout Label Overrides, Improved Abandoned Checkout emails
- Timberline + Seaside cycle posts
- Blog announcements: Cofounder, Expert Agents (Sales Agent + Teaching Assistant + Universal Inbox), Backstage voice memos & session summaries, Kajabi MCP
- Public REST API / OpenAPI spec at `github.com/Kajabi/public_api_docs`

## Tier A — Deepen the existing Kajabi bridge (highest fit)

These items extend or formalize what already exists. All keep Kajabi as a peer sales surface for instructors while we keep the path to local checkout.

### A1. Promote the Kajabi webhook from `apps/marketing` to `apps/platform`

- What: Move `apps/marketing/app/api/webhooks/kajabi/route.ts` to `apps/platform/app/api/webhooks/kajabi/` and reuse the same Supabase RPC `decrement_inventory`.
- Why: Inventory + admin onboarding already live in `apps/platform`. The webhook in `apps/marketing` is a historical artifact from before the consolidation.
- Benefits:
  - Single deployment surface: webhook + inventory + admin onboarding all live on `apps/platform`. Eliminates the cross-app coupling where a Kajabi purchase fires into `apps/marketing` while the inventory row lives in Supabase accessed from `apps/platform`.
  - One fewer Vercel project to manage. `apps/marketing` is already an isolated deployment (see `VERCEL_MARKETING_DEPLOYMENT.md`); consolidating removes a deploy target, a build pipeline, and an env file.
  - Better observability. Axiom / Better Stack (wired in `apps/platform`) cover this webhook automatically — same trace tree as admin inventory edits, same alert routing.
  - Foundation for A2 and A3: webhook enrichment becomes a single PR instead of two cross-app changes.
  - Fewer secrets to rotate, fewer env-mismatch footguns.
  - Faster rollback: one project to redeploy vs. two coordinated redeploys.
- Risk: Low. Pure code relocation; behavior identical.
- Needs: Update Vercel rewrites / Inngest event subscribers; update env (`KAJABI_WEBHOOK_SECRET`) on `apps/platform`.

### A2. Wire Kajabi's new REST API for two-way offer sync

- What: Use the OAuth REST API from `github.com/Kajabi/public_api_docs` (still beta but covers offers/contacts/courses/purchases). Replace `KAJABI_OFFER_MAPPINGS.sql` rows with a sync job that pulls live offer URLs from Kajabi.
- Why: The current mappings table is hand-maintained SQL. Every new instructor needs a manual SQL edit.
- Benefits:
  - Self-serve new-instructor onboarding. Today, adding a Kajabi offer for a new instructor requires editing `packages/db/KAJABI_OFFER_MAPPINGS.sql` and applying a Supabase migration. API sync turns this into an admin UI action.
  - Reduces manual drift. Hand-edited SQL is the only current "source of truth" for the Kajabi offer URL; once a sync job exists, drift is bounded.
  - Pays back when combined with A3: Kajabi becomes the source of truth for offer + sale metadata, while Convex / Supabase remains the source of truth for inventory state. Clean separation of concerns.
  - Foundation for richer admin views — an admin page can show "last Kajabi sync at 14:02, last error: none," and which instructor has which offer live, with inventory linked to the live offer.
  - Aligns with Kajabi's Q3 2025 API launch. We're picking it up early enough to design for stability while the API is still labeled beta.
  - Reduces operator toil: every new instructor saves roughly 15 minutes of SQL + Supabase migration work, plus eliminates the "did we forget to add the mapping?" footgun.
  - Schema change is small and additive; widen-migrate-narrow means existing manual rows keep working through the transition.
- Risk: Medium. API is beta — pin a schema version, allow manual override.
- Touches: New `packages/db/src/schema/kajabi-offer-sync.ts`, an Inngest/Trigger.dev scheduled task, admin UI to view last-sync status.
- Follows AGENTS.md: widen-migrate-narrow (add new table → backfill from Kajabi → drop hand-edited rows).

### A3. Upgrade the payment webhook payload to Kajabi's improved shape

- What: Kajabi's improved `payment_succeeded` webhook now exposes settlement amount, currency, fees, payout schedule. Our handler in `apps/marketing/app/api/webhooks/kajabi/route.ts` only consumes quantity + offer ID.
- Why: Inventory events in the admin UI would benefit from "net revenue" + "buyer" display. Pairs naturally with the existing `inventory_change_log`.
- Benefits:
  - Better instructor payout UX. Show net revenue after Kajabi processing fees instead of gross — instructors ask "what did I actually make?" and the data needs to be there.
  - Pairs with the existing `inventory_change_log` (per `packages/db/drizzle/0016_inventory_change_log.sql`). Additive optional fields means no migration pain; existing rows stay valid.
  - Sets up cross-checks with Stripe payouts once an instructor also sells through the platform's local checkout — both legs land in the same shape.
  - Future-proofs payout reports. When the eventual instructor payout dashboard ships (referenced in `PROJECT_STATUS.md`), the data is already in the log.
  - Supports multi-currency inventory. Kajabi Payments is global and groups invoices by currency (`packages/db/KAJABI_OFFER_MAPPINGS.sql` is currently single-currency); the new payload carries `currency` natively.
  - Minimal code change — zod schema widens, optional fields default to null, existing handlers keep working.
  - Highest benefit-per-line-of-code of the three items being considered. Best "quick win" framing.
- Risk: Low. Additive parsing with zod.
- Touches: New optional fields in `inventory_change_log` (gross amount, fees, currency, settlement date).

### A4. Subscriptions / Multiple Order Bumps payload support

> **Status:** Marked not important as of 2026-07-17. We are not actively selling bundle / multi-bump offers through Kajabi and don't have an immediate need to model them.

- What: Kajabi's June 2026 changelog groups one-time primary offers + order bumps into a single transaction. Our handler keys on a single offer → single inventory decrement.
- Why: Once we start handling bundles, an order with two order bumps could miss the secondary decrement.
- Risk: Medium. New event shape; need a backfill plan.
- Touches: Webhook handler, `kajabi_offer_mappings` to allow multi-offer rows, Convex `instructor_inventory` to support multi-decrement in one request.

### A5. Build an MCP server exposing apps/platform data to Kajabi (reverse direction)

> **Status:** Marked irrelevant as of 2026-07-17. We are not currently integrating with Kajabi's AI agents (Cofounder, Sales Agent) and the cost of standing up a new authenticated service surface outweighs the upside at our current scale.

- What: Kajabi now ships its own MCP server (`kajabi.com/mcp`). apps/platform can build a reciprocal one — exposing instructor roster, available session slots, workspace unread counts — so a Kajabi AI agent (Cofounder / Sales Agent) can deep-link out.
- Why: Closes the loop on `use-products.ts` and `use-sessions.ts` data — Kajabi doesn't have to know our schema, MCP standardizes it.
- Risk: Medium-High. New service surface. Needs auth (per-instructor OAuth or scoped API keys).
- Touches: New `apps/platform/app/api/mcp/...` or standalone route; reuse Convex `api.products.*` + `api.sessions.*` via HTTP actions.

### A6. Mirror Kajabi's `kajabi_offer_mappings` to Convex

> **Status:** Marked not important as of 2026-07-17. With A2 in scope, Kajabi offer URLs become an admin-UI-managed sync rather than an instructor-level Convex concern. The Convex mirror is a separate, larger migration that doesn't pull weight on its own.

- What: Today the mapping table lives in Supabase. AGENTS.md says Convex is the source of truth for instructor data. The mapping is, in essence, instructor metadata.
- Why: Aligns with the in-progress Inngest→Convex migration; lets Convex-backed UI (admin onboarding form) reference offer URLs without round-tripping Supabase.
- Risk: Low-Medium. Widen-migrate-narrow required.
- Touches: New `convex/instructors.ts` table/field; keep Supabase mirror during transition.

## Tier B — Adopt Kajabi patterns that pair well with the bridge

These items take Kajabi's recent UX/feature patterns and reimplement them natively on Convex — but each is also an integration point if we later want Kajabi-purchased students to participate.

### B1. Backstage-style voice memos + AI session summaries in workspaces

> **Status:** Marked irrelevant as of 2026-07-17. Out of scope for the current Kajabi-integration focus. The current platform already records sessions via Daily.co and has notes / chat; voice memos and AI summaries are a product-feature project, not a Kajabi-integration item.

- What: Kajabi's Backstage just shipped voice memo recording with auto-transcription + AI-generated session summaries. apps/platform already has workspaces (`apps/platform/app/workspace/[id]/page.tsx`), session recordings via Daily.co (`apps/platform/app/api/webhooks/daily/recordings/`), and chat (`apps/platform/components/workspace/chat.tsx`).
- Why: Direct pattern reuse. The platform already records sessions, has notes, and has instructor→student chat.
- Risk: Medium. New audio upload pipeline (Backblaze B2 / Convex storage) + transcription provider (OpenAI Whisper or similar).
- Touches: New `voice_memos` table in Convex, recording → transcript pipeline via Inngest/Trigger.dev, summary prompt template.
- Kajabi bridge benefit: Kajabi-purchased students (who never hit Stripe/PayPal) get the same post-session experience.

### B2. Expert Agent–style Teaching Assistant for workspaces

> **Status:** Marked irrelevant as of 2026-07-17. Coupled to B1 (which is also off the table) and depends on a vendor decision (Anthropic vs. OpenAI vs. local) that's better made once we have a concrete instructor who wants it.

- What: Kajabi's Teaching Assistant reads the instructor's existing course content and answers "what lesson covers X" with a timestamp. apps/platform can build an equivalent over instructor notes + session transcripts + workspace resources.
- Why: Same "AI trained on your content" pattern. Natural extension of B1.
- Risk: Medium. Embeddings + retrieval + an LLM call. Vendor choice (Anthropic / OpenAI / local) needs an explicit decision.
- Touches: Embedding index over `notes`, `messages`, `resources`, `session recordings`. New Convex query/mutation.

### B3. Cohort Courses as a new product shape

> **Status:** Marked not important as of 2026-07-17. Group mentorship via `sessionPacks` already serves this need. Introducing a cohort-shaped product type is a separate, larger project with no Kajabi-integration dependency.

- What: Kajabi's Cohort Courses model: time-bound, shared experience, group chat, recurring sessions. apps/platform has group mentorship (`sessionPacks`) but not the cohort framing.
- Why: Group inventory currently sits separately from one-on-one; a cohort shape lets a single instructor run a 6-week program with N seats and a calendar.
- Risk: Medium-High. New `cohorts` Convex table; new product type; Stripe prices need new variants.
- Touches: `convex/products.ts`, `convex/sessions.ts`, new admin/instructor cohort UI.
- Kajabi bridge benefit: Cohort inventory could also be sold through a Kajabi offer if we ever open that channel.

### B4. Instructor Media Library

> **Status:** Marked irrelevant as of 2026-07-17. Not a Kajabi-integration item. It is a UX/storage feature that could be built independently if/when instructors complain about asset reuse; deferred until there's a concrete instructor request.

- What: Kajabi's April 2026 Media Library centralizes video/audio/image/document assets with tags, custom views, and per-placement analytics. apps/platform's instructor assets are scattered across Cloudflare/Backblaze upload paths (`apps/platform/lib/workspace-image-upload.ts`, instructor profile photos, video thumbnails).
- Why: Instructors upload the same intro video 3–4 times for different placements. We saw the same problem.
- Risk: Medium. New `media_assets` Convex table; backfill from existing instructor profile photos and session thumbnails.
- Touches: New `apps/platform/components/instructor/media-library/`, Convex file storage, deduplication by hash.

### B5. Contact Lifecycle Tracking

> **Status:** Marked not important as of 2026-07-17. Useful but not a Kajabi-integration item. Defer until the admin students page needs it for a concrete operator task.

- What: Kajabi's Timberline introduced explicit lifecycle states (lead → buyer → repeat). apps/platform has waitlist → student → alumni implicitly via tables but no unified view.
- Why: The admin "students" page (`apps/platform/app/admin/students/`) and `apps/platform/lib/queries/convex/use-waitlist.ts` data could be unified.
- Risk: Low-Medium. Derive state from existing tables first; only add a new field if needed.
- Touches: New `convex/contacts.ts` query that derives state from `waitlist`, `sessionPacks`, `users`.

### B6. Improved abandoned-checkout recovery

> **Status:** Marked irrelevant as of 2026-07-17. Not a Kajabi-integration item. Belongs to the platform's own checkout conversion workstream — track separately if pursued.

- What: Kajabi's April 2026 abandoned-checkout flow follows up with anyone who entered an email, not just existing customers, and reports recovered revenue. apps/platform's `apps/platform/app/checkout/page.tsx` flow has no follow-up.
- Why: Direct revenue lift.
- Risk: Low. New `inngest/functions/abandoned-checkout.ts` + Resend template.
- Touches: New `checkout_sessions` Convex table to track "started, didn't finish," cron in Trigger.dev, new email template.

## Tier C — Strategic / defer

### C1. Kajabi Amplify-style audience growth

> **Status:** Marked irrelevant as of 2026-07-17. Growth-marketing feature with no Kajabi-integration dependency. Already covered conceptually by the existing waitlist / landing pages.

- What: Find new customers from inside the platform. apps/platform has waitlist + landing pages, but no cross-instructor discovery.
- Why: Could expose "other students also bought" on instructor profiles.
- Risk: Low priority until organic growth is steady.
- Touches: Future. Would need an "audience graph" data model.

### C2. Kajabi MCP consumer: drive our admin UI from Cofounder

> **Status:** Marked irrelevant as of 2026-07-17. A2 (direct REST sync) already covers the same need without taking on MCP reliability risk. Defer until A2 proves insufficient.

- What: Use Kajabi's MCP server to read offers into the admin onboarding form so admins don't paste URLs.
- Why: Could remove the `kajabi_offer_mappings` table entirely.
- Risk: Dependent on Kajabi MCP reliability (new).
- Touches: Replaces parts of A2.

### C3. Per-instructor branded checkout pages

> **Status:** Marked not important as of 2026-07-17. Out of scope for the Kajabi-integration focus. This is a multi-tenant checkout project that affects every payment path; defer to a dedicated checkout redesign.

- What: Kajabi's Sep 2025 Checkout overhaul gave fully customizable, branded checkout pages. apps/platform's `apps/platform/app/checkout/page.tsx` is currently single-tenant.
- Why: Instructors selling through their own URL would benefit.
- Risk: High. Multi-tenant checkout is a large project.
- Touches: Major rework of `app/checkout/` and the Stripe redirect flow.

### C4. Recommended Pricing Option

> **Status:** Marked irrelevant as of 2026-07-17. Premature — no multi-tier pricing exists on `app/pricing/` yet to highlight.

- What: Highlight one tier at checkout. apps/platform's pricing page (`app/pricing/`) doesn't have multi-tier yet.
- Risk: Premature — no multi-tier pricing to highlight.

## Cross-cutting observations

- Naming consistency: All "mentor"/"mentee" leakage already eliminated per AGENTS.md. None of the proposed Kajabi integration items re-introduce the legacy words.
- Convex as truth: A2 touches Convex only via a new sync-state table — the broader Convex AI skill work is not on the A1–A3 path. The Inngest→Convex migration is mid-flight but A1–A3 don't depend on it; webhook handling can stay in Inngest for now.
- widen-migrate-narrow: A2 requires a schema change. The Kajabi offer mapping is the obvious widen target — additive column / new table, sync in from Kajabi, only drop the hand-edited SQL after the admin UI confirms parity.
- Greptile review: Per AGENTS.md, run `npx greptile@latest review` before opening any PR for these changes.
- Excluded per scope: no visual/branding/dark-mode work; no Branded Mobile App (Kajabi's per-business iOS/Android).

## Recommended sequencing (A1–A3 only)

Of the 16 catalog items, only A1, A2, A3 are under active consideration. Sequencing:

1. **A1 — relocate the webhook.** Safest first PR. Pure code move. Establishes a single deploy target and unlocks the next two.
2. **A2 — Kajabi REST offer sync.** After A1 lands, the webhook is in `apps/platform` and can stay there while we add a scheduled sync job. Self-serve new-instructor onboarding is the headline payoff.
3. **A3 — improved webhook payload.** Independent of A2 in terms of code, but ideally done after A1 (so the schema change lives in `apps/platform` from the start). Highest benefit-per-line-of-code; safe additive zod widening.

After A1–A3 land, revisit the deferred items if a concrete instructor / operator request pulls them forward.
