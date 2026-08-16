# Cloudflare Integration Options for `apps/platform` and `apps/huckleberry-drive`

> Generated from the Cloudflare agent setup discussion.
> This doc captures candidate integrations. Pick one (or none) to scope before implementation.

## Current State

| App | Stack | Cloudflare Today | Hosting |
|-----|-------|-------------------|---------|
| `apps/platform` | Next.js 16 App Router, Convex, Supabase/Postgres, Inngest, Trigger.dev, Backblaze B2, Clerk, Stripe/PayPal, Daily.co, Resend, Upstash Redis | Turnstile only | Vercel |
| `apps/huckleberry-drive` | Next.js 16 App Router, Convex, Backblaze B2, Clerk | None | Vercel |

Shared object storage lives in `packages/storage` and is S3-compatible (AWS SDK v3).

---

## Option 1 — Migrate Shared Storage from Backblaze B2 to Cloudflare R2

> **Status: Unlikely for now.** B2 is preferred from a cost standpoint because storage volume currently exceeds egress volume, so R2's higher storage cost would not be offset by free egress.

### Why
- **Zero egress fees** when downloads are served through Cloudflare (Vercel currently sits in front of the app, so users are already close to Cloudflare's edge).
- **Simpler architecture**: one vendor instead of B2 + Cloudflare Workers for transfer.
- **S3-compatible**: the change is mostly endpoint + credentials in `packages/storage/src/client.ts`.
- Cost crossover happens when downloads approach or exceed storage volume.

### Current Cost Logic
See `STORAGE_COMPARISON_B2_VS_R2.md` for the full model. The summary is:
- **MVP/low download rate**: B2 is cheaper (storage is $0.005/GB vs R2 $0.015/GB).
- **High download/re-download rate**: R2 wins because egress is free.
- Rule of thumb: R2 becomes cheaper when **downloads ≥ storage volume**.

### What Would Change
- Env vars: `B2_ENDPOINT`, `B2_DOWNLOAD_HOST`, `B2_KEY_ID`, `B2_APPLICATION_KEY` → `R2_ENDPOINT`, `R2_PUBLIC_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
- Shared storage client: swap endpoint and public URL generation.
- Backfill existing `s3Url` / `s3Key` references in Convex for legacy recordings.
- Potential migration: copy B2 objects to R2 with `rclone` or AWS CLI.

### Which Apps Benefit
- `apps/platform` — recordings, other uploads.
- `apps/huckleberry-drive` — instructor files, bulk downloads, share links.

### Open Questions
- What are current monthly B2 storage and download volumes?
- Are downloads recurring (e.g., students re-download recordings)?
- Do we want to keep B2 as a cold archive and use R2 as hot storage, or full cutover?

---

## Option 2 — Add Turnstile to `apps/huckleberry-drive` (Priority Implementation)

### Why
`apps/platform` already has Turnstile. `apps/huckleberry-drive` has public, unprotected surfaces:
- Public share links (`/shared/[token]`).
- File upload endpoints.
- Sign-in page.

These are good targets for bot abuse and scraping.

### What Would Change
- Add `TURNSTILE_SECRET_KEY` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to huckleberry-drive env.
- Re-use the existing verification helper pattern from `apps/platform/lib/turnstile.ts`.
- Protect:
  - Share-link access route (`src/app/api/shared/[token]/route.ts` or the page itself).
  - Upload initiation endpoints.
  - Sign-in flow.

### Which Apps Benefit
- `apps/huckleberry-drive` only.

### Open Questions
- Should Turnstile protect the share-link page render, the share-link API, or both?
- Do upload endpoints already have rate limiting?
- Should we use the invisible Turnstile mode to keep UX clean?

---

## Option 3 — Move Edge/High-Frequency Routes to Cloudflare Workers (Priority Implementation)

### Why
- Lower latency for paths that should run close to the user.
- Reduce Vercel cold-start surface for webhooks and small read-heavy APIs.
- More durable webhook handling than inside a Next.js route.

### What Would Change
- Create a new package or `workers/` root folder (e.g., `packages/cloudflare-workers` or `apps/edge-functions`).
- Candidate routes for Workers:
  - `apps/platform` — Stripe/PayPal webhook normalization, Daily.co recording-ready callbacks.
  - `apps/huckleberry-drive` — share-link token resolution, bulk-download chunk orchestration.
- Workers forward sanitized events to Inngest/Convex/Trigger.dev as needed.

### Which Apps Benefit
- `apps/platform` — webhook reliability.
- `apps/huckleberry-drive` — faster share-link and bulk-download APIs.

### Open Questions
- Which webhook/route is currently the most painful on Vercel?
- Should Workers act as a thin proxy, or do real validation and routing?
- Do we want to keep Vercel as the main host and only offload specific paths?

---

## Option 4 — Cloudflare KV for Public Metadata Caching (Priority Implementation)

### Why
- Reduce repeated Convex reads for hot, cacheable data.
- Cheaper and lower-latency than hitting the database for every request.
- Works well with Workers or as a standalone cache from Next.js.

### What Would Change
- Add a KV namespace binding.
- Cache targets:
  - `apps/huckleberry-drive` — share-link metadata, storage-usage stats.
  - `apps/platform` — public instructor listings, pricing metadata, static page props.
- Implement cache invalidation when the underlying Convex data changes.

### Which Apps Benefit
- Both, but impact is lower than R2 or Turnstile unless the app is read-heavy.

### Open Questions
- What is the current Convex read volume and cost?
- How do we invalidate KV when Convex data changes (event-based, TTL, or manual)?
- Is Upstash Redis already doing enough caching for platform?

---

## Option 5 — Put Vercel Deployments Behind Cloudflare DNS/CDN/WAF (Priority Implementation)

### Why
- Cloudflare's CDN + WAF rules in front of Vercel domains.
- Can enforce security rules, rate limiting, and geographic blocks at the edge.

### What Would Change
- Move DNS for the platform and huckleberry-drive domains to Cloudflare.
- Configure CNAME flattening/proxy to Vercel.
- Add WAF rules (e.g., block bad bots, country-level challenges).

### Which Apps Benefit
- Both.

### Open Questions
- Are domains currently managed in Vercel or elsewhere?
- Does the app rely on Vercel-specific edge features that would break behind Cloudflare?
- Is this worth the DNS cutover complexity?

---

## Option 6 — Do Nothing / Stay on Current Stack

### Why
- Current stack is functional.
- B2 + Cloudflare Workers is cost-optimal at low scale (per `STORAGE_COMPARISON_B2_VS_R2.md`).
- Adding more Cloudflare services increases vendor surface and operational complexity.

### When This Makes Sense
- Monthly B2 costs are low.
- No bot abuse or scraping issues.
- Team wants to focus on product features rather than infrastructure.

---

## Recommended First Look

**Priority implementations** (Options 2, 3, 4, 5):

1. **Shortest security win**: Option 2 — Turnstile on `apps/huckleberry-drive`.
2. **Best reliability win**: Option 3 — Move one webhook or edge route to Workers.
3. **Performance win for hot data**: Option 4 — KV for public metadata caching.
4. **Security/performance win at the DNS layer**: Option 5 — Cloudflare DNS/CDN/WAF in front of Vercel.

**Deferred**:
- Option 1 — R2 storage migration. Revisit only if egress volume begins to exceed storage volume.

---

## Next Steps

- For Option 2, identify the exact routes/pages to protect.
- For Option 3, pick the most latency-sensitive webhook or API.
- For Option 4, profile current Convex reads to identify hot data.
- For Option 5, confirm domain registrar and whether Vercel-specific edge features would conflict.
- Option 1 remains deferred unless download/egress patterns change.
