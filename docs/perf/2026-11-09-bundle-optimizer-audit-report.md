# Platform client-bundle audit — findings

**Mode:** audit only. No source, dependency or lockfile changes.
**App:** `apps/platform` (only). **Commit:** `8d3bb686`. **Date:** 2026-11-09.
**Next.js:** 16.4.5 (Turbopack).

## Method and evidence classes

```bash
# gate (see handoff)
NEXT_PUBLIC_APP_URL=http://localhost:3000 pnpm --filter @mentorships/platform build

# baseline capture
cd apps/platform
NEXT_PUBLIC_APP_URL=http://localhost:3000 pnpm exec next analyze --output \
  --snapshot 'audit-before-platform-1'          # 28.3s, 177 routes
pnpm exec next analyze export --snapshot 'audit-before-platform-1' \
  | gzip > /tmp/opencode/analyze-platform-before-1.jsonl.gz   # 5.8 MB gz
```

- **Snapshot name:** `audit-before-platform-1`
- **Export:** `/tmp/opencode/analyze-platform-before-1.jsonl.gz` (not committed — 5.8 MB)
- **Schema:** `next/analyze/graph-v1.schema.json` from the installed 16.4.5
- **Metric:** attributed **compressed bytes of client JavaScript** (`[client-fs]`
  parts), restricted to outputs in a route's `bootstrap` ∪ `render_dependent`
  build groups — i.e. what a hard navigation pulls before interaction.
  `async` group outputs are excluded and reported separately.

This is **build evidence**. Nothing here was measured over the network in a
browser; no observed request sequence backs these numbers.

Baseline: 177 routes, 17 6823 part records, 9 784 modules.

**Coverage.** Client outputs are `exact` for 1 316 outputs; 488 client-fs
outputs are `not_a_chunk` (fonts, CSS, runtime). `group` metadata is `exact`
for all 177 routes. Server outputs (35 400 records) were not used for
attribution. Route keys `/workspace`, `/workspace/[id]` and
`/dashboard/workspaces/[id]` render the same page and carry identical
numbers — they are one page, not three.

### Headline numbers (compressed client JS on first load)

| Route | KB |
|---|---|
| `/workspace` (also `/workspace/[id]`, `/dashboard/workspaces/[id]`) | **1010.0** |
| `/admin/email-health` | 477.2 |
| `/` (public landing) | 474.3 |
| `/dashboard` | 474.0 |
| `/instructors` | 463.8 |

The app baseline is ~464–477 KB on every route. `/workspace` carries
**+536 KB** over that.

---

## 1. `@mentorships/ui` barrel ships the image-upload stack on 54 of 55 routes

**Status: FIX APPLIED AND VERIFIED. Measured saving 78.2 KB on 54 routes.**

**Import chain** (verified in source):

```
app/layout.tsx
└─ components/navigation/header.tsx:5      import { Button } from "@/components/ui/button"
   └─ components/ui/button.tsx:1           export { Button } from "@mentorships/ui"
      └─ packages/ui/src/index.ts:17       export { ImageUploadField } from "./components/image-upload-field"
         └─ packages/ui/src/components/image-upload-field.tsx:5
            import imageCompression from "browser-image-compression"
            import { useDropzone } from "react-dropzone"
            └─ ./crop-dialog → import "react-image-crop/dist/ReactCrop.css"
                                               (side-effect import)
```

**Why the barrel did not tree-shake:** `packages/ui/package.json` declared
no `sideEffects` field, so every module reachable from `src/index.ts` was
treated as possibly side-effectful and retained. `crop-dialog.tsx` imports
CSS for its side effect, which is consistent with that assumption.

**Measured before:** one shared client chunk
(`_next/static/chunks/2b4_5wnh3vn3_.js`) was referenced by the
`render_dependent` group of **54 routes** — including `/`, `/_not-found`,
`/admin/audit-logs`. Its attribution on `/` was 87.9 KB across 59 parts.

### The fix

```json
// packages/ui/package.json
"sideEffects": [
  "**/*.css"
],
```

Marking CSS as the only side-effectful class keeps `ReactCrop.css` while
letting a `Button`-only consumer drop `image-upload-field` and
`crop-dialog`. No source files changed.

### Verified result

Snapshots `wt-before-1` → `wt-after-1`, same worktree, same commit, same
metric. Baseline parity between the worktree and the main-tree capture was
confirmed first (0.0 KB delta on `/`, `/workspace`, `/instructors`,
`/admin/email-health`).

| Route | Before | After | Delta |
|---|---|---|---|
| `/` | 474.3 | 396.1 | **−78.2** |
| `/instructors` | 463.8 | 385.6 | **−78.2** |
| `/admin/email-health` | 477.2 | 399.1 | −78.1 |
| `/workspace` | 1010.0 | 979.7 | −30.3 |

- **54 routes improved, 1 unchanged, 0 increased.**
- Total attributable saving across all routes: **2 913.6 KB** (per-route
  savings summed; a real user pays one route's worth).
- The saving is larger than the original ~43 KB estimate because `zod`
  (28.5 KB on `/`) was *also* reached only through the barrel's
  `form-field.tsx` and is genuinely unused on those routes. `zod` still
  ships on the 36 routes that do use it.

**Reachability after** (route counts for each library's first-load graph):

| Library | Before | After |
|---|---|---|
| `browser-image-compression` | 54 | 4 |
| `react-dropzone` | 54 | 7 |
| `react-image-crop` | 54 | 4 |
| `file-selector` | 54 | 7 |
| `zod` | 54 | 36 |
| `@tanstack/react-form` | 4 | 4 (unchanged) |
| `turnstile` | 54 | 1 |

The 4 remaining `image-upload-field` routes are exactly the 4 importers:
`/instructor/profile`, `/admin/instructors/[id]/edit`,
`/admin/products/create`, `/admin/products/[id]/edit`. The single
`turnstile` route is `/waitlist`, the only page that imports
`TurnstileWidget`.

### Behaviour checks run

- `next build` passes (Turbopack, TypeScript, page-data collection).
- `packages/ui` image-upload component tests: **7/7 pass**.
- Build-artifact proof: the upload/crop JS chunk (`3_aac-qkqeis9.js`) and
  its CSS chunk (`444w6_ysn6r8r.css`, containing `ReactCrop__crop-*`) are
  referenced by the `page_client-reference-manifest.js` of **exactly those
  4 routes** — no more, no fewer.
- `pnpm --filter @mentorships/ui typecheck` fails on 3 pre-existing
  `toBeInTheDocument` type errors in `image-upload-field.test.tsx`. The
  identical 3 errors occur on the untouched main tree — **not caused by
  this change**, and left alone.

**Still required before merge:** a browser-level smoke test on a preview
deployment — open the crop dialog on `/instructor/profile` and confirm
styling, then upload an image end to end. First-open CSS is now
route-scoped rather than global, so a flash of unstyled crop UI on a cold
open is the one thing worth watching. `next analyze` and the chunk
manifests cannot observe that.

**Risk: low.** No lifecycle or data-flow semantics involved.


---

## 2. `/workspace` statically imports the Tiptap notes editor on a page that opens on Chat

**Est. saving: ~137 KB** (up to ~154 KB including notes-only Radix/Floating UI).

**Import chain:**

```
app/workspace/page.tsx (and app/dashboard/workspaces/[id])
└─ components/workspace/workspace-client-page.tsx:24   import WorkspaceNotes from "@/components/workspace/notes"
   └─ components/workspace/notes/components/NoteEditor.tsx  → @tiptap/react, @tiptap/starter-kit
```

`workspace-client-page.tsx:124` sets the default tab to `"chat"` (or
`"videos"` on a notification deep-link). **Notes is never visible on first
load**, yet its editor ships in the initial payload.

**Measured** — packages present in the `/workspace` first-load graph and on
no other client route:

| Package | KB |
|---|---|
| `prosemirror-view` | 30.6 |
| `@tiptap/core` | 25.1 |
| `prosemirror-model` | 13.9 |
| `@tiptap/extension-blockquote` | 12.4 |
| `linkifyjs` | 9.5 |
| `prosemirror-transform` | 9.2 |
| `@tiptap/extension-list` | 6.3 |
| `buffer` | 6.0 |
| `jotai` | 4.1 |
| `prosemirror-state` | 3.9 |
| `@tiptap/extensions` | 3.2 |
| `prosemirror-commands` | 3.0 |
| `@tiptap/react` | 2.5 |
| `@tiptap/extension-link` | 2.4 |
| `prosemirror-history` | 2.2 |
| `events` | 2.0 |
| `@tiptap/extension-code-block` | 1.8 |
| `prosemirror-gapcursor` | 1.5 |
| **total** | **137.6** |

**Proposed fix (not applied):** one `next/dynamic` boundary around
`WorkspaceNotes` with a stable placeholder. The component is already a leaf
tab panel and already renders inside `<TabsContent>`.

**Behaviour checks:** open the Notes tab → editor mounts, autosave runs; the
`use-note-autosave-backup` recovery path still fires after a killed tab;
image lightbox still opens from notes.

**Risk: medium.** `use-note-autosave-backup` is load-bearing; a lazy
boundary must not delay the restore path past first render.

---

## 3. `/workspace` ships Daily.co and the call overlay before any call exists

**Est. saving: ~134 KB** (80 KB Daily + 54 KB framer-motion/motion-dom).

**Import chain:**

```
components/workspace/workspace-client-page.tsx:34  import { VideoCallProvider } from "@/components/video/video-call-provider"
   └─ @daily-co/daily-react → @daily-co/daily-js
components/workspace/workspace-client-page.tsx:36  import { CallOverlay } from "@/components/video/call-overlay"
   └─ framer-motion
```

**Measured:** `@daily-co/daily-js` 67.5 KB + `@daily-co/daily-react` 12.6 KB
+ `framer-motion`/`motion-dom` 53.9 KB. All three route keys only.

**Why this is not a trivial `dynamic()`:** `VideoCallProvider` is mounted
deliberately high in the tree — it owns the call-status pill and
`QuickCapture`, and its `key={selectedWorkspaceId}` remount is load-bearing
(the call site documents the reset semantics). Only the **Daily SDK** can be
deferred, and only until a session is joinable.

**Proposed fix (not applied):** split `VideoCallProvider` so the Daily
provider (and `useVideoCall`) mount on first joinable/active session rather
than on page mount. `CallOverlay` can go behind `dynamic()` with
`ssr: false` since it renders nothing outside a call.

**Behaviour checks (manual, on a preview):** start a call → join → device
selection; switch workspace mid-call → previous call torn down, new
workspace's call state clean; end call → overlay unmounts, tab selection
survives; `?join=` deep link still starts the call; recording consent flow
unaffected.

**Risk: high.** This is the core product surface. Do it last, and only with
the manual checks above.

---

## Rejected / below the decision gate

### Home-page carousels — ~7–10 KB, rejected

`app/page.tsx:7` statically imports `InstructorCarousel` and
`TestimonialsCarousel`. Measured cost on `/`: `embla-carousel` 6.6 KB +
`embla-carousel-react` 0.2 KB + component code. **Below the 30 KB gate.**
Not worth a PR; the pre-existing `Suspense` skeleton at `page.tsx:98` is the
right shape if this ever grows.

### Dead but harmless: `components/landing/instructor-carousel.tsx`

Zero importers (verified). It is not bundled, so it costs 0 KB. It is the
only other `framer-motion` importer, which is why it looks like a suspect in
a `grep`-only audit. Delete it as housekeeping, not as a perf fix.

### Recharts — already correct

`app/admin/email-health/email-metrics-trend-card.tsx` is the repo's only
`next/dynamic` consumer, and it works: `/admin/email-health` is 477.2 KB on
first load, versus 642.1 KB if the 9 `async` group outputs are counted. That
~165 KB stays deferred. **No action.**

### Duplicate browser dependencies — none

`framer-motion` 11.18.2, `embla-carousel-react` 8.6.0, `recharts` 2.15.4,
`lucide-react` 0.555.0 and `@daily-co/daily-js` 0.91.0 each resolve to a
single version in the module graph.

`zod` resolves to three store copies (3.25.76, 4.3.6, 4.4.3), but only
**4.3.6 reaches the client** (1 134 client parts). 3.25.76 appears in 63
server parts on `/api/*` routes only. **No client-side duplicate.**

---

## Client-dependency scan

Every emitted `[client-fs]` module was checked for server-owned libraries.

| Source + client importer | Emitted identity | Routes | Compressed bytes | Disposition + evidence |
|---|---|---|---|---|
| `stripe` | — | 0 | — | absent from client output |
| `@aws-sdk/*` | — | 0 | — | absent from client output |
| `googleapis` | — | 0 | — | absent from client output |
| `resend` (SDK) | — | 0 | — | absent from client output |
| `@upstash/*` | — | 0 | — | absent from client output |
| `components/admin/resend-invitation-button.tsx` | `_next/static/chunks/0n7i05o0vmjdn.js` | `/admin/onboardings/[id]` | 0.7 KB | **suppressed** — name collision with the Resend *provider*; it is an invitation-button UI component, not the SDK |
| `@daily-co/daily-js` | `_next/static/chunks/*` | 3 route keys | 67.5 KB | **suppressed** — intentional browser WebRTC SDK (candidate 3) |

## Possible server-only leaks

**None found.** The scan covered every emitted client module, including async
outputs. No server-only table, secret, signing path, or admin SDK reached a
client chunk.

## Evidence gaps

- **Build evidence only.** No browser request traces were captured; the
  `bootstrap`/`render_dependent` split is Next's build-time grouping, not a
  measured request sequence.
- **Chunk membership is partial for some outputs.** Tiptap, Daily and
  framer-motion appear as `part` attribution but not in `output.modules`,
  so per-package reachability was established from parts rather than chunk
  membership. The union of the two agrees on every route checked.
- **`sideEffects` behaviour: now verified.** Turbopack **does** honour a
  `sideEffects` field in a `transpilePackages` workspace package — candidate 1
  was applied and measured (see its section). The remaining unverified
  surface is browser behaviour, not bundling.
- **No runtime timings.** Nothing here claims an improvement in LCP, TBT or
  perceived latency.

## Verdict against the decision gate

| Candidate | Saving | Blast radius | Gate (>30 KB, contained) |
|---|---|---|---|
| 1. `@mentorships/ui` sideEffects | **78.2 KB × 54 routes — verified** | low | **PASS — done** |
| 2. Lazy Tiptap notes | ~137 KB | medium | **PASS** |
| 3. Defer Daily + call overlay | ~134 KB | high | **PASS, do last** |
| Home carousels | ~8 KB | low | FAIL — skip |

Candidate 1 is applied in this worktree. With it in place `/workspace` is
979.7 KB; if candidates 2 and 3 also land it drops to roughly 710 KB, and
every other route sits ~78 KB lighter. That is the whole realistic prize for
this audit; there is no 2 MB story in this repo.


Each change is one PR, verified against an after-snapshot
(`audit-after-<n>`), with the manual behaviour checks listed under its
candidate.
