# Greptile review-cost policy

This doc captures the cost-control levers the project applies to
Greptile, why each one is on, and the dashboard-side checks worth
re-running on a quarterly basis. The companion config lives in
[`.greptile/config.json`](../.greptile/config.json).

## Why this exists

Greptile is the project's primary AI reviewer. We pay $30/seat/month
plus $1 per overage credit beyond 50 included standard reviews per
seat. The Sep 19 – Oct 19 invoice (one seat, $654 retail, ~$327
after the Startup 50% discount) breaks down as:

```
  Greptile Code Review   624  ×  $1.00  =  $624.00   (overage)
  Greptile Code Review     1  × $30.00  =   $30.00   (1 seat)
  ─────────────────────────────────────────────────────
  Total                                       $654.00
```

And in that same window there were **30 PRs** (per
`gh pr list --state all --search "created:2026-09-19..2026-10-19" --json number | jq length`).

So:
- **674 reviews / 30 PRs ≈ 22 reviews per PR** on average.
- That's a per-push re-review multiplier problem, not a tier-mix
  problem. The invoice contains no Plus/Apex line items and no
  TREX / execution-layer credits — every overage unit is a flat
  `$1.00` Base-tier review.
- The startup 50% discount is one-year (`Startup 50% for a year`),
  so the real list price **$654/mo** becomes the bill at the end
  of year one. Cutting volume now is the right hedge against
  that.

The two genuine P1 catches from last month — "archived workspaces
still accept bookings" on #929 (4/5 confidence, real architectural
missed-code-path) and the reminder-window / recording-warning lies
on #918 (4/5 confidence, real error-handling bugs) — are exactly
the class of finding we want to keep. They both caught real bugs
that ESLint, Vitest, and tsc did not. The fix below preserves
them and removes the volume waste.

## What `.greptile/config.json` sets

| Field | Value | Effect |
|---|---|---|
| `autoReview` | `["open"]` | Fires on PR open / reopen / ready_for_review / trigger label. **No re-review on push.** For a fresh review after fixes, comment `@greptileai review` on the PR — this re-triggers Greptile on demand with the current diff. |
| `effort` | `"base"` | Forces the cheapest review tier (1 credit). Defense-in-depth against the dashboard being flipped to `Auto`. The Sep 19 invoice is already all `$1.00` per-unit so this is mostly decorative here, but worth keeping as a guard. |
| `commentTypes` | `["logic", "syntax"]` | Drops `style`. ESLint + the new `lint-staged` pre-commit hook cover style at local time for free. |
| `strictness` | `2` | Default. P1 / P2 / P3 severity mix unchanged. |
| `ignorePatterns` | (see file) | Excludes lockfiles, all markdown, build outputs, generated files, and pure-post-merge recaps. Gating the corpus stops lockfile-heavy dep bumps (#917 alone: 23k+ lines of `pnpm-lock.yaml`) from consuming a full review credit when CI already typechecks the resulting tree. |
| `disabledLabels` | `["no-greptile", "skip-greptile"]` | Opt-out labels. Apply to PRs with no new semantic code (CI-only, secret rotation, experiment reverts). |

## Why these particular choices

- **`autoReview: ["open"]` is the single biggest lever.** The
  invoice data shows a ~22× reviews/PR multiplier. Reviews that
  aren't valuable — re-reviews of intermediate pushes the developer
  already iterated on — are the bulk of the burn. Triggering only
  on `open` collapses that multiplier to ~1× per PR plus the
  occasional `@greptileai` re-trigger on the final pre-merge diff.
- **Lockfile + post-merge exclusion removes the second-biggest
  class.** Dep bumps and pure-recap docs produce large diff counts
  that Greptile has to read. OpenAI token cost scales with diff
  size; the lockfile exclusion moves those tokens off Greptile's
  meter and onto CI's existing typecheck.
- **Apex/Plus/TREX are NOT the lever they appeared to be.** A
  prior analysis assumed the dashboard tier was `Auto` (or Apex on
  large PRs); the actual invoice shows all overage at flat $1.00.
  If Apex/Plus rates ever become a factor, re-evaluate this doc.

## Savings model (Base-tier volume only)

Going forward, expected per-PR review count after the policy lands.
Note: this is a **forecast**, not a hard cap. The actual bill is
`$30 (seat) + max(0, reviews - 50) × $1`.

| Cost element | Before (Sep 19 – Oct 19) | After policy (forecast) |
|---|---|---|
| Reviews/PR (push multiplier) | ~22 | ~1.5–2 (1× on open + ~0.5–1× `@greptileai review` re-trigger before merge) |
| Lockfile-only-change PRs (`lockFileMaintenance`) | Same as below: ~3 lockfile-maintenance PRs × ~22 reviews/PR | **0 review credits** — Renovate `lockFileMaintenance.automerge: true` auto-merges on green CI and skips Greptile's queue entirely |
| Version-bump PRs that change `package.json` + lockfile (e.g. grouped minor/patch Renovate runs) | 23k-line lockfile PRs counted | **Still 1 review each** — `ignorePatterns` excludes `pnpm-lock.yaml` but the diff still contains `package.json` and code changes Greptile needs to read. These count toward the 50/month allotment. |
| Manual dep bumps (e.g. `next`/`react` major) | Heavy PR with both code changes and lockfile churn | **1 review on open + re-trigger before merge** — same as any code PR |
| Style-comment noise | Every PR | Filtered by `commentTypes` + lint-staged locally (cosmetic, no credit change) |
| Reviews/month (30 PRs, all forms) | ~674 | ~45–60 (1.5–2 × 30) |
| Overage credits (50 included) | 624 | **0–10** (depending on re-trigger frequency) |
| Monthly retail (forecast central estimate) | ~$654 ($30 seat + 624 × $1) | **~$30–$40** (seat + 0–10 overage × $1) |
| Monthly with 50% Startup discount (year 1) | ~$330 | ~$15–$20 |
| Monthly after discount lapses | ~$654 | ~$30–$40 |

**What the policy does NOT do:**

- The `$30/month × number of seat-months` line is a **lower
  bound**, not the actual bill. A developer who fires
  `@greptileai review` on every PR will burn through the 50
  included allotment and start paying overage. The discipline
  rule "re-trigger only on the final pre-merge diff" is what
  keeps the bill near the floor.
- Lockfile exclusion does not exempt version bumps that also
  touch `package.json`. Greptile still reads the new
  `package.json` and the matching code changes; only the
  23k-line lockfile churn gets filtered. That filtering is
  real cost relief on a per-PR basis, but the package.json
  review itself still counts toward the 50-PR-credits allotment.
- Auto-merged `lockFileMaintenance` PRs do NOT count toward
  Greptile reviews at all. They are the only class of PR that
  is fully outside the queue.

## Dashboard-side checks worth re-running quarterly

These are the things the config file cannot do alone. Open the
Greptile dashboard at
<https://app.greptile.com/-/settings/review> and confirm:

1. **Tier pinning.** Confirm `effort` (called "Review tier" in the
   dashboard) is set to `Base`. The Sep 19 invoice is already all
   Base-tier (`$1.00` flat unit price) so no change is needed, but
   if Plus/Apex line items ever appear, this is why.
2. **TREX is off.** TREX is Greptile's execution-layer beta; it
   adds 3 credits per run on top of the review credit. Default-off
   is the right posture; turn it on selectively for security /
   auth PRs only. Confirmed off on Sep 19 invoice (no
   "execution-layer" line item).
3. **Status check required on `main`.** In GitHub branch-protection
   rules for `main`, require the `greptile` status check. Without
   this, the `autoReview: ["open"]` policy is a soft convention
   rather than a hard rule — a developer could push a fix after a
   Greptile review without re-triggering, and the merge would go
   through on a stale review of stale code.

## Usage-page sanity check

Open the Greptile usage/billing page monthly and look at:

- Total reviews run vs included allotment (50/seat/month)
- Reviews-per-PR ratio. If it's much above 1.2, the
  `autoReview: ["open"]` policy isn't taking effect or the
  developer workflow is relying on push-based re-reviews.
- Any Plus/Apex reviews (should be zero — current configuration
  pins Base).
- Any TREX credits (should be zero).
- Any `Greptile API (per call)` line items (currently zero on the
  Sep 19 invoice; if it starts showing API-driven reviews against
  CLI invocations or scripts, that's another volume class worth
  tracing).

Recompute the table above with the next month's billing numbers
and check that the actual bill tracks the model. If it doesn't,
the policy config may not be reaching Greptile (read the source
branch — config is read from the PR's source, not the base).

## Operator workflow with this policy

- Open a PR. Greptile reviews once.
- Push fixes locally — **no re-review**. Lint / typecheck / convex
  codegen all run via the pre-push hook, so iteration is cheap.
- Mark ready for review. **Before merge**, comment
  `@greptileai review` on the PR — this re-baselines Greptile's
  review against the latest commits and posts a fresh status
  check. That status is what the `main` branch-protection rule
  (follow-up #3 above) gates on.
- **Re-trigger discipline is what keeps the bill forecast
  accurate.** Each `@greptileai review` costs 1 credit. The
  workflow reserves the re-trigger for the final pre-merge diff;
  firing it on every intermediate push or every "I bumped a
  dep" PR quickly burns through the 50 included credits and
  starts landing $1/credit charges. Treat it as a "re-baseline
  once, just before merge" action, not a free movement.
- Merge only after the fresh `greptile` status check is green.
- For PRs that don't need deep review (CI infra, secret rotation,
  post-merge recap edits), apply `no-greptile` or `skip-greptile`
  and skip the bot entirely.

## Dep-bump PR classes

Dep bumps are not all created equal. The policy treats them
differently because their review cost is different.

| Dep-bump class | Files changed | Greptile review cost | How it's routed |
|---|---|---|---|
| **Lockfile-only via Renovate** (`lockFileMaintenance` task) | `pnpm-lock.yaml` only | **0 credits** | Renovate `lockFileMaintenance.automerge: true` + `.greptile/config.json.ignorePatterns` — auto-merges on green CI without entering Greptile's queue. |
| **Lockfile-only via manual** (developer runs `pnpm install` and commits the resulting `pnpm-lock.yaml` change) | `pnpm-lock.yaml` only | **1 credit on open + 1 credit on `@greptileai review` before merge (~2 credits)** | Standard PR workflow. `ignorePatterns` keeps the lockfile out of the indexed corpus (so the AI-side reads are cheap), but the PR still goes through Greptile's queue and the standard merge gate. **No auto-merge** — the renovate `lockFileMaintenance` rule is scoped to Renovate's scheduled task, not to manual PRs that happen to touch the same files. |
| **Version bumps** (Renovate's grouped `all non-major dependencies` PR, or grouped `Next.js and React major updates`) | `package.json` + `pnpm-lock.yaml` (sometimes `+` some peer-dep code) | 1 credit per PR | `ignorePatterns` filters out `pnpm-lock.yaml` lines but `package.json` and any code changes stay in scope. The 23k-line lockfile noise goes away; the rest of the diff is still reviewed. |
| **Manual major upgrade** (e.g. hand-rolled Next.js 16 → 17 refactor) | `package.json` + `pnpm-lock.yaml` + significant code changes | 1 credit on open + 1 credit on `@greptileai review` before merge (~2 credits) | Standard PR workflow, no Greptile-side shortcut available. |

## Relation to other policies

- AGENTS.md "Greptile Code Review" — defines the operating policy
  ("Prefer both Greptile and CodeRabbit to approve before merge")
  and posts the local-CLI one-liner; this doc explains the
  cost rationale.
- AGENTS.md "Pull Request Merge Policy" — same merge gate, this
  doc just describes the cost levers behind it.
- `.coderabbit.yaml` — CodeRabbit continues to fire on every PR as
  before; no changes here. (CodeRabbit skips due to the
  fewer-than-10-stars threshold; that's documented in AGENTS.md
  and we rely on Greptile alone for review coverage.)
