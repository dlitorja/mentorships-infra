# Greptile review-cost policy

This doc captures the cost-control levers the project applies to
Greptile, why each one is on, and the dashboard-side checks worth
re-running on a quarterly basis. The companion config lives in
[`.greptile/config.json`](../.greptile/config.json).

## Why this exists

Greptile is the project's primary AI reviewer. We pay $30/seat/month
plus $1 per credit beyond the 50 included standard reviews per seat.
Last month's bill (~$330 / month after a 50% discount) broke down as
roughly 600 paid credits, concentrated in three places:

1. **Re-reviews on every push.** Per the Greptile dashboard default,
   the GitHub App fires on `synchronize`. A typical agent-driven
   workflow — push, fix, push, amend — eats 3–5 reviews per PR before
   it merges. Almost certainly the biggest line item.
2. **Lockfile-heavy dep bumps.** PR #917 alone shipped 23k+ lines of
   `pnpm-lock.yaml` churn that Greptile processed even though CI
   already typechecks the resulting tree.
3. **Tier mix.** If `effort` was set to `Auto` on the dashboard,
   Greptile was picking `Base` / `Plus` / `Apex` (1 / 3 / 10 credits)
   per PR based on size. Apex reviews on the 3 large dep bumps last
   month were the second biggest driver.

The two genuine P1 catches from last month — "archived workspaces
still accept bookings" on #929 and the reminder-window / recording-
warning lies on #918 — are exactly the class of finding we want to
keep. The fix below preserves them and removes the waste.

## What `.greptile/config.json` sets

| Field | Value | Effect |
|---|---|---|
| `autoReview` | `["open"]` | Fires on PR open / reopen / ready_for_review / trigger label. **No re-review on push.** For a fresh review after fixes, comment `@greptileai review` on the PR — this re-triggers Greptile on demand with the current diff. |
| `effort` | `"base"` | Forces the cheapest review tier (1 credit). Defense-in-depth against the dashboard being flipped to `Auto`. Verify the dashboard side separately. |
| `commentTypes` | `["logic", "syntax"]` | Drops `style`. ESLint + the new `lint-staged` pre-commit hook cover style at local time for free. |
| `strictness` | `2` | Default. P1 / P2 / P3 severity mix unchanged. |
| `ignorePatterns` | (see file) | Excludes lockfiles, all markdown, build outputs, generated files, and pure-post-merge recaps. Greptile's docs claim 30–50% cost reduction on noisy PRs from this. |
| `disabledLabels` | `["no-greptile", "skip-greptile"]` | Opt-out labels. Apply to PRs with no new semantic code (CI-only, secret rotation, experiment reverts). |

## Dashboard-side checks worth re-running quarterly

These are the things the config file cannot do alone. Open the
Greptile dashboard at
<https://app.greptile.com/-/settings/review> and confirm:

1. **Tier pinning.** Confirm `effort` (called "Review tier" in the
   dashboard) is set to `Base` (or `Auto` — both are acceptable if
   you're not seeing Plus/Apex reviews in the usage page logs).
   Anything below the Base line wastes credits; anything above
   wastes them too.
2. **TREX off.** TREX is Greptile's execution-layer beta; it adds
   3 credits per run on top of the review credit. Selective use
   only — including it on every PR is the dominant cost on most
   repos. It must be off by default; turn it on only for security
   or auth-touching PRs.
3. **Status check required on `main`.** In GitHub branch-protection
   rules for `main`, require the `greptile` status check. This
   guarantees that even with `autoReview: ["open"]` only, a PR
   can't merge under a stale review after a sequence of fixes —
   the human review process needs to fire `@greptileai review`
   before merge for a fresh review of the final diff.

## Usage-page sanity check

Open the Greptile usage/billing page monthly and look at:

- Total reviews run
- Tier breakdown — count of Base vs Plus vs Apex reviews
- Re-review rate — reviews per merged PR; if the average is >> 1.5,
  `autoReview: ["open"]` is not taking effect
- Any TREX credits listed (should be near zero)

If Apex reviews are non-zero and `effort` is set to `Auto`, swap
the dashboard setting to `Base`. If re-review rate is high, the
config didn't override the dashboard's push trigger; check whether
the config file is in the PR's source branch (it must be — config
is read from the source, not the base).

## Operator workflow with this policy

- Open a PR. Greptile reviews on open.
- Push fixes. **No re-review.** Iterate locally without burning
  credits; lint, typecheck, convex codegen all run via the pre-push
  hook.
- Mark ready for review. Greptile reviews once (via the `open`
  trigger). No re-review on subsequent pushes.
- Before merge, comment `@greptileai review` to re-baseline the
  final diff against the latest commits. This becomes the
  required-status check that branch protection uses.
- Merge only after the Greptile status check is green.

For PRs that don't need deep review (CI infra, secret rotation,
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
  before; no changes here.
