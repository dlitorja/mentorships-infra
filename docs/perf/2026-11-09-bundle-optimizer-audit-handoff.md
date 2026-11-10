# Mentorships-infra — next-bundle-optimizer audit (report only)

Handoff for OpenCode. Audit only — no fixes in this pass. Source: Next.js
blog, Oct 28 2026, <https://nextjs.org/blog/ship-less-javascript-with-ai>.

**Baseline commit:** `8d3bb686` (previous handoff cited `4a85b11`; the
claims below were re-verified at `8d3bb686` on 2026-11-09).

## Why this fits (verified)

- All five apps are on Next.js **16.4.5**, React 19.2. The skill needs
  Next 16.4+, and Turbopack is the default bundler since Next 16.
- `next analyze` exists in 16.4.5 and is Turbopack-only. It supports
  `--snapshot <name>`, `-o/--output` (write to disk, no server) and an
  `export` subcommand that streams the saved graph as **JSON Lines**
  (not JSON — budget a JSONL reader if a later pass diffs snapshots).
- No `next-bundle-optimizer` skill is installed in the repo yet, and
  nothing in the repo uses `next analyze`.
- Lazy-loading discipline is almost absent: only **1 file** in
  platform/web uses `next/dynamic`
  (`apps/platform/app/admin/email-health/email-metrics-trend-card.tsx`).
  That file is also the **only** Recharts consumer — so Recharts is
  already handled and is not a target. (Earlier drafts listed it as
  one; drop that.)
- Heavy client libraries are present in platform: Tiptap editor
  (`components/workspace/notes/`), Daily.co video
  (`components/video/`), framer-motion (`components/video/call-overlay.tsx`),
  embla-carousel (`components/ui/carousel.tsx`).
- The post's core trap: a `lazy()` import is defeated if any other
  module in the same bundle statically imports the same heavy
  component. **No instance of this trap has been found by grep** — treat
  that section of the report as speculative rather than expected.

## What the audit will actually find

`grep` on the import graph already predicts most of the report. The
audit's marginal value is exact sizes, ordering, and catching what grep
cannot see (duplicate dependency copies, tree-shaking misses).

1. **`/workspace` — the headline.** `components/workspace/workspace-client-page.tsx`
   statically imports, on one `"use client"` boundary: `WorkspaceNotes`
   (Tiptap + 3 extensions), `VideoCallProvider` (`@daily-co/daily-react`
   + `daily-js`), `CallOverlay` (framer-motion), `WorkspaceImages`
   (react-dropzone + react-image-crop), `react-resizable-panels`, plus
   the calls/links/resources tabs — although these are **tab panels**
   and only one is visible at a time. Rough expectation: 150–250 KB gz
   of avoidable initial payload.
2. **`/` (home landing).** A server component that eagerly mounts
   `InstructorCarousel` and `TestimonialsCarousel` (both embla; the
   latter also runs a Convex query), both below the fold. Cheapest
   structured win: two client islands behind `dynamic()` with the
   skeleton already present in `Suspense`.
3. **`framer-motion` is held alive by one file.** Its other importer,
   `components/landing/instructor-carousel.tsx`, has **zero consumers**
   (dead code — and therefore no bundle cost). Only
   `components/video/call-overlay.tsx` keeps framer-motion in the
   workspace bundle. Deferring that overlay drops framer-motion entirely
   from the initial payload.
4. **RSC opportunities** will be thin. `/workspace` is a live-query app
   with heavy client state; most of the "move to RSC" advice will be
   advisory, not actionable.

## What it will NOT fix

- The platform home → `/instructors` nav delay is **data**, not JS.
  `/instructors` is `force-dynamic`, and `instructor-grid.tsx` is a
  client component resolving data with `useSuspenseQuery` — browser
  receives HTML, then JS, then fires the Convex query. Do not expect
  the bundle audit to explain that delay, and do not let this pass
  expand into reworking that route. Fix it separately, with a real
  network trace.
- Perceived speed on the auth-gated `/workspace`. That route's LCP is
  dominated by loading spinners and Convex hydration latency, not KB.
- Vercel's "nearly 2 MB" saving is across v0 and vercel.com, not a
  promise for this repo. Judge this audit on what it actually finds.

## Prerequisite gate — do this FIRST

`next analyze` "does not produce an application build", but it **does
compile the app**, so it needs the same env surface as `next build`.
Confirm the build works locally before installing anything:

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000 pnpm --filter @mentorships/platform build
```

- If it passes: proceed.
- If it fails on missing env: do **not** run `clerk env pull` or invent
  values. `apps/platform/.env.local` holds the real values; the root
  `.env.local` is a redacted template with 41 `[SENSITIVE]`
  placeholders and must not be used to fill gaps. Report the failure
  and stop.

**Result on 2026-11-09 (`8d3bb686`):** passes, with the inline
`NEXT_PUBLIC_APP_URL` shown above. Without it the build fails while
collecting page data for `/api/admin/instructors/[id]/invite`.

## Install (repo root)

```bash
npx skills add vercel/next.js --skill next-bundle-optimizer
```

Verify the skill lands under `apps/platform/.agents/skills/` to match
the repo convention (that directory already holds five convex skills).
Do not leave a stray root-level `skills/` or `.claude/skills/`
directory behind; if the installer only offers those, install there,
then move the directory into `apps/platform/.agents/skills/` and
confirm nothing at the root was created.

## Audit prompt — scope

```
Run next-bundle-optimizer as a REPORT ONLY, no fixes, no code
changes. Scope: apps/platform only (the production app and the
performance reference). Do not touch apps/web, apps/marketing,
apps/home, or apps/huckleberry-drive in this pass.

Use `next analyze --snapshot <name>` plus `next analyze export` (JSON
Lines) and Turbopack's module graph. Report, per route, starting with
the largest client routes:
- the largest contributors and their sizes
- any heavy module loaded earlier than it should be (the lazy-import
  trap: a lazy/dynamic import defeated by another static import of
  the same module)
- opportunities to move logic to React Server Components
- duplicate versions of large dependencies
- cases where tree-shaking could not apply

For each finding give the import chain, the estimated saving in gzip
KB, and the proposed fix — but DO NOT apply any fix. Do not run
/next-bundle-optimizer fix.
```

## Guardrails

- No code changes, no PR, no deploys in this pass.
- Do not modify Clerk config or code, touch any schema, change
  `next.config.ts`, or use "mentor"/"mentee" in code.
- Do not disable typecheck/lint or add `eslint.ignoreDuringBuilds` to
  get a comparison build.
- Do not rework the `/instructors` data path — this audit is about
  JavaScript bundles only.
- Save the analyze snapshot for a later diff, but **do not commit the
  JSONL graph** (it is large and this repo is public). Keep snapshots
  in `/tmp/opencode/`; commit only the markdown report and a summary
  table.

## Deliverables

1. `docs/perf/2026-11-09-bundle-optimizer-audit-report.md` — findings
   ranked by saving, largest first, each with import chain, estimated
   gzip saving, and proposed fix.
2. **A committed baseline snapshot name + export path** in the report.
   The number of record comes from `next analyze export` (JSON Lines),
   *not* from `next build` — see the correction below.
3. A `pnpm why` duplicate-dependency check for framer-motion, embla,
   `@tiptap/*`, `@daily-co/*`, and `lucide-react`.

### Correction: there is no `next build` route table to capture

The original amendment asked for a `next build` table of **First Load
JS** per route. **Next 16 no longer prints it** — `next build` on
16.4.5 emits only the route list (`ƒ` / `○`) and no size columns at
all. Verified by running the build on `8d3bb686` and grepping the full
output for `First Load JS` / `kB`: zero matches.

So the only source of route-attributed sizes is the analyzer export
itself. Record, per route, the compressed bytes from
`next analyze export`, and re-export after a fix to compare the same
scope, output class and metric.

Two facts from that build worth carrying into the report:

- **Every route is `ƒ` (dynamic).** There is not a single static route
  in `apps/platform`, including `/`. Nothing has a static shell, so
  bundle savings land on a per-request server render everywhere.
  Recording this is in scope; fixing it is not — it belongs to
  `next-cache-components-optimizer`.
- **The build needs an inline `NEXT_PUBLIC_APP_URL`.** It is absent
  from `apps/platform/.env.local` and
  `lib/clerk-invitations.ts` throws at module scope without it. The
  repo's own precedent (four times in
  `apps/platform/REFACTORING_AND_IMPROVEMENT_PLAN.md`) is:

  ```bash
  NEXT_PUBLIC_APP_URL=http://localhost:3000 pnpm --filter @mentorships/platform build
  ```

  That is a build-time override of a non-secret public URL. It does
  **not** authorize writing to any `.env` file.

## Decision gate (before any fix PR)

Act only on findings that clear **both**:

- **> ~30 KB gz** on a route with real traffic, and
- **contained blast radius** — no load-bearing lifecycle semantics
  changed.

Realistically that is **two** changes:

1. `/workspace` per-tab lazy loading (Tiptap, images/crop, calls tab).
2. `/` home carousels behind `dynamic()`.

Everything else is advisory. Do not open a PR for advisory findings.

### Known-risky spots for the fix pass

- `VideoCallProvider`'s `key={selectedWorkspaceId}` remount is
  load-bearing (the comment at its call site explains the reset
  semantics). A naive `dynamic()` can silently break call reset when
  switching workspaces.
- `use-note-autosave-backup` is what recovers unsaved notes. Lazy-
  loading the notes panel must not drop note recovery.

Any `/workspace` fix needs manual verification on a preview of:
*start call → switch workspace → end call*, and
*type a note → kill the tab → reopen → recovered*.

That verification cost — not the bundle work — is the real price of
finding 1.

## After the audit

**Executed 2026-11-09.** Result: `docs/perf/2026-11-09-bundle-optimizer-audit-report.md`.

The report is **not thin** — three candidates clear the decision gate:

1. `@mentorships/ui` barrel ships the image-upload stack on 54/55 routes.
   **Applied and verified: −78.2 KB on 54 routes**, 0 routes larger
   (snapshots `wt-before-1` → `wt-after-1`). **Do first** — lowest risk.
2. Tiptap notes editor statically imported on `/workspace`, a page that
   opens on Chat (~137 KB). Medium risk.
3. Daily.co + call overlay shipped before any call exists (~134 KB).
   **Do last** — high risk, core product surface.

Rejected: home carousels (~8 KB, below the gate), Recharts (already
correct), duplicate dependencies (none reach the client).

Then:

- If the report shows savings that clear the decision gate: one PR per
  change, each verified on a preview deployment, normal gates
  (Greptile + CodeRabbit, at least one approval). Fold them into
  normal PRs; do not run a sweeping `/next-bundle-optimizer fix` pass.
- If the report is thin: stop. Leave the skill installed for future
  use.
- Only then consider web/marketing, and only if the audit shows shared
  culprits (shared UI package, shared imports).

## Things the run learned that this handoff got wrong

Recorded so a future pass does not repeat them:

- **`next build` prints no sizes on Next 16.** No First Load JS column,
  no `kB`. The analyzer export is the only source of numbers.
- **Every route is `ƒ` (dynamic).** There is not one static route in
  `apps/platform`, `/` included. Nothing has a static shell.
- **The build needs an inline `NEXT_PUBLIC_APP_URL`.**
- **`output.modules` does not cover every chunk.** Tiptap, Daily and
  framer-motion appear only as `part` attribution. Chunk membership alone
  will report them as "not in client output" — a false negative. Use
  `part` records for per-package reachability.
- **`render_dependent`, not `bootstrap`, carries the app.** The
  `bootstrap` group holds ~161 KB of framework only; `render_dependent`
  holds everything that matters (461 outputs on `/`, 487 on `/workspace`).
- **Do not commit the export.** The baseline is 5.8 MB gzipped.


## Other projects

- Personal-tools monorepo (Fly.io): BANKED. Next.js is the assumed
  default but M0 is not scaffolded yet — no code to audit. Apply the
  skill when the app exists.
- Clef-omni (Cloudflare Workers), route-audit, Godot: NO. Not
  Next.js, the skill does not apply.
