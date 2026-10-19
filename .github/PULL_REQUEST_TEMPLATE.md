<!-- Optional Linear: leave blank if N/A; otherwise `Refs HUC-XX`.
     Linear's GitHub integration auto-links issues by branch name / PR title.
     Use `Refs`, not `Fixes` — `Fixes` auto-closes the issue when the PR merges. -->

## What & why

<!-- 1–3 sentences: what does this PR do, and what problem does it solve? -->

## Test plan

<!-- One line: how was this verified locally? (typecheck, test, manual repro, etc.) -->

<!-- Schema-changing PRs (modifies `convex/schema.ts`):
     create a `Verify "..." on prod` issue in Linear with the `schema-change` label
     and link it here as `Refs HUC-XX` (NOT `Fixes` — see AGENTS.md). -->

## Review-bot gating

<!-- Greptile review policy (PR #946). Both bots still run by default.
     Opt out of Greptile on PRs that don't need a deep semantic review
     (CI-only, secret rotation, reverting an experiment, etc.) by
     applying either `no-greptile` or `skip-greptile`. -->

- [ ] This PR has semantic code changes worth a Greptile review
- [ ] OR I applied `no-greptile` / `skip-greptile` to opt out
- [ ] Linear verification issue filed if this PR touches `convex/schema.ts`,
  auth/role gates, production Trigger/Inngest tasks, public Convex queries,
  or a deploy-gating workflow (see AGENTS.md "Post-merge verification convention")
