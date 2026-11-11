# Greptile review-cost policy

This doc captures the cost-control levers the project applies to
Greptile, why each one is on, and the dashboard-side checks worth
re-running on a quarterly basis. The companion config lives in
[`.greptile/config.json`](../.greptile/config.json).

## Why this exists

Greptile is the project's primary AI reviewer. For most of the period
covered here the plan was $30/seat/month plus $1 per overage credit
beyond 50 included standard reviews per seat. (Greptile moved to $1
per credit with no seat fee in late October 2026; both models are
shown in the tables below because the invoice below predates the
change and the two land within ~$20 of each other at this volume.)
The Sep 19 – Oct 19 invoice (one seat, $654 retail, ~$327
after the Startup 50% discount) breaks down as:

```
  Greptile Code Review   624  ×  $1.00  =  $624.00   (overage)
  Greptile Code Review     1  × $30.00  =   $30.00   (1 seat)
  ─────────────────────────────────────────────────────
  Total                                       $654.00
```

And in that same window there were **95 PRs**, not 30. The original
count of 30 came from `gh pr list --state all --search
"created:2026-09-19..2026-10-19" --json number | jq length`, which
silently caps at 30 rows unless `--limit` is passed. Re-counting with
`--limit 500` gives 95.

So:
- **674 reviews / 95 PRs ≈ 7.1 reviews per PR** on average.
- Those 95 PRs carried **568 commits**. The billed unit was the push:
  674 ≈ 568 pushes + 95 PR opens + a handful of retries. That is the
  mechanism, and it is why `autoReview: ["open"]` is the lever that
  matters.
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
  invoice data shows a ~7× reviews/PR multiplier, tracking the ~6
  commits per PR. Reviews that aren't valuable — re-reviews of
  intermediate pushes the developer already iterated on — are the
  bulk of the burn. Triggering only on `open` collapses that
  multiplier to ~1× per PR plus the occasional `@greptileai`
  re-trigger on the final pre-merge diff.
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
| Reviews/PR (push multiplier) | ~7.1 | ~1.5–2 (1× on open + ~0.5–1× `@greptileai review` re-trigger before merge) |
| Lockfile-only-change PRs (`lockFileMaintenance`) | Same as below: ~3 lockfile-maintenance PRs × ~7 reviews/PR | **0 review credits** — Renovate `lockFileMaintenance.automerge: true` auto-merges on green CI and skips Greptile's queue entirely |
| Version-bump PRs that change `package.json` + lockfile (e.g. grouped minor/patch Renovate runs) | 23k-line lockfile PRs counted | **Still 1 review each** — `ignorePatterns` excludes `pnpm-lock.yaml` but the diff still contains `package.json` and code changes Greptile needs to read. These count toward the 50/month allotment. |
| Manual dep bumps (e.g. `next`/`react` major) | Heavy PR with both code changes and lockfile churn | **1 review on open + re-trigger before merge** — same as any code PR |
| Style-comment noise | Every PR | Filtered by `commentTypes` + lint-staged locally (cosmetic, no credit change) |
| PRs/month | 92 (95 PRs in 31 days) | ~95–125 (measured cadence, see below) |
| Reviews/month (all forms) | ~674 | ~140–250 (1.5–2 × 95–125) |
| Overage credits (50 included) | 624 | ~90–200 |
| Monthly retail, old $30-seat + $1/credit model | ~$654 | **~$120–$230** |
| Monthly retail, current $1/credit with no seat fee | ~$674 | **~$140–$250** |
| Monthly with 50% Startup discount (year 1) | ~$330 | **~$70–$125** (confirm how the discount applies to credit purchases) |
| Monthly after discount lapses | ~$654 | **~$140–$250** |

The earlier draft of this table forecast **$30–$40/month**. That was
wrong because it multiplied the 1.5–2× per-PR floor by the same
miscounted 30 PRs. The real cadence is 92–125 PRs/month, so each
review still costs real money — the policy removes the per-push
multiplier, not the per-PR floor.

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

## Measured result, first policy month (Oct 20 – Nov 11, 2026)

The policy landed 2026-10-20. Twenty-three days later, the GitHub
API shows:

| Measure | Sep 19 – Oct 19 (pre-policy) | Oct 20 – Nov 11 (post-policy) |
|---|---|---|
| PRs created | 95 | 95 |
| Commits (pushes) | 568 (6.0/PR) | 199 (2.1/PR) |
| Greptile re-triggers (`@greptileai review`) | 6 | 86, across 58 PRs |
| Billable reviews | 674 (from the invoice) | ~181 (95 opens + 86 re-triggers) |
| Reviews per 30 days | ~652 | ~236 |

At $1/credit that is **~$236/month**, down from **$654** — a ~$415
monthly saving (~$5.0k/year), or ~63% volume reduction. Two things
kept it from matching the forecast:

1. **PR cadence rose.** 124 PRs/30d post-policy versus 92/30d
   before. The per-PR floor is now the whole bill, so more PRs
   means more credits even at 1× per PR.
2. **Re-trigger discipline hasn't held.** 58 of 95 PRs asked for a
   re-review (86 total). The policy's own guidance is "re-baseline
   once, just before merge, on risky PRs" — on routine PRs the
   open review is already the pre-merge diff.

**The remaining lever is re-trigger count, not review depth.** Holding
cadence constant, reserving `@greptileai review` for ~20 PRs/month
takes the bill to roughly **$115/month** (~$535/month saved).

Reproduce with `gh pr list --state all --limit 500` for the PR count,
`commits.totalCount` per PR for pushes, and the author's comments
containing `@greptileai` for re-triggers. The post-policy column is
modelled from billable events — reconcile it against the Oct 20
invoice when it lands and correct this table if it disagrees.

## Dashboard-side checks worth re-running quarterly

These are the things the config file cannot do alone. Open the
Greptile dashboard at
<https://app.greptile.com/-/settings/review> and confirm:

1. **Tier pinning.** Confirm `effort` (called "Review tier" in the
   dashboard) is set to `Base`. The Sep 19 invoice is already all
   Base-tier (`$1.00` flat unit price) so no change is needed, but
   if Plus/Apex line items ever appear, this is why.
   *Completed 2026-10-20: dashboard tier is currently `base`.*
2. **TREX is off.** TREX is Greptile's execution-layer beta; it
   adds 3 credits per run on top of the review credit. Default-off
   is the right posture; turn it on selectively for security /
   auth PRs only. Confirmed off on Sep 19 invoice (no
   "execution-layer" line item).
   *Completed 2026-10-20: dashboard TREX is currently off.*
3. **Status check required on `main`.** In GitHub branch-protection
   rules for `main`, require the `Greptile Review` status check
   (note the exact context name registered by GitHub — not
   lowercase `greptile`). Without this, the `autoReview: ["open"]`
   policy is a soft convention rather than a hard rule — a
   developer could push a fix after a Greptile review without
   re-triggering, and the merge would go through on a stale review
   of stale code.
   *Completed 2026-10-20: branch protection on `main` now needs
   `Greptile Review` (registered against Greptile's GitHub App,
   `app_id=867647`) with both `strict: true` and
   `enforce_admins: true`. `strict: true` is the critical piece —
   it forces the latest commit on the PR branch to have the check
   passing, which means a stale Green-state from an older commit
   cannot satisfy the gate. `enforce_admins: true` removes the
   "I'll just merge my own PR" escape hatch that would defeat the
   gate for solo dev. Override path if Greptile is genuinely
   unavailable: Settings → Branches → main → temporarily clear the
   required check on `Greptile Review`, do the merge, restore it.*

> **Known gap: docs-only PRs cannot satisfy this gate.** The
> `ignorePatterns` that keep markdown out of the reviewed corpus also
> stop Greptile from posting the `Greptile Review` status at all, so a
> markdown-only PR sits in `BLOCKED` forever. The `no-greptile` label
> records the intent but does not produce a passing check. Observed on
> PR #1043. Every docs-only PR therefore needs the override path above,
> which is friction that pushes toward merging docs with code changes
> or temporarily relaxing the requirement for `docs/**`. Worth deciding
> deliberately rather than discovering each time.

## Usage-page sanity check

Open the Greptile usage/billing page monthly and look at:

- Total reviews run vs included allotment (50/seat/month)
- Reviews-per-PR ratio. The forecast is 1.5–2 reviews per PR
  (1× on open + the occasional `@greptileai review` re-trigger
  before merge). If the ratio is much above 2, check whether
  `autoReview: ["open"]` is taking effect or developers are
  requesting reviews on intermediate pushes.
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
