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

Going forward, expected per-PR review count after the policy lands:

| Cost element | Before (Sep 19 – Oct 19) | After policy | Multiplier |
|---|---|---|---|
| Reviews/PR (push multiplier) | ~22 | ~1.2 (open + `@greptileai` on final diff) | **18× off** |
| Lockfile-credit burn on dep bumps | 23k-line lockfile PRs counted | Off via `ignorePatterns` | **3 PRs/mo → zero** |
| Style-comment noise | Every PR | Filtered by `commentTypes` + lint-staged locally | Cosmetic |
| Reviews/month (30 PRs) | ~674 | ~40 (1.2 × 30 + a handful of `@greptileai` re-triggers) | **17× off** |
| Overage credits (50 included) | 624 | ~0 | **Within allotment** |
| Monthly retail total | ~$654 ($30 seat + 624 × $1) | ~$30 (just seat) | **$624/mo off** |
| Monthly with 50% Startup discount (year 1) | ~$330 | ~$30 | **$300/mo off** |
| Monthly after discount lapses | ~$654 | ~$30 | **$624/mo off** |

The hard ceiling on the post-policy bill is `$30/month × number of
seat-months`. Even with the discount lapsing, the per-push-re-review
volume goes away and the bill collapses to seat-only.

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
- Merge only after the fresh `greptile` status check is green.
- For PRs that don't need deep review (CI infra, secret rotation,
  post-merge recap edits), apply `no-greptile` or `skip-greptile`
  and skip the bot entirely.

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
