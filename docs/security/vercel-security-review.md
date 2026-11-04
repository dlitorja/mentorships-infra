# Vercel Security Review — enablement and triage runbook

> Status (2026-11-04): **enabled.** Owner turned on *Review Deployments Automatically*,
> selected the three live projects, and enabled Agent chat. Verified from outside the dashboard:
> `vercel security vulnerabilities --scope dustin-litorjas-projects-95e47775` returns an empty
> list, while the same command against a team without the feature errors with
> `reason: not_found` / "Security Review isn't enabled". The policy paste (§4) is the one item
> that cannot be verified through the API — confirm it in **Settings → Agent**.
> Owner of this runbook: whoever most recently ran a Tier 2 sweep
> (`docs/security/sweep-protocol.md` §3).
> Sources: <https://vercel.com/docs/agent/security-review>,
> <https://vercel.com/docs/agent/security-review/usage>,
> <https://vercel.com/docs/cli/security>.

Security Review is part of **Vercel Agent**. It statically reviews the code you push and files
what it finds in the team's **Vulnerabilities** dashboard. It is **supplementary** to, never a
replacement for, the per-PR gates in `AGENTS.md` §"Pull Request Merge Policy"
(Greptile + CodeRabbit) and the recurring cadence in `docs/security/sweep-protocol.md`.

## 1. What it is, precisely

| Property | Value |
|---|---|
| Trigger | **Every Git push** to a connected GitHub repo — not per pull request |
| Base for the diff | Previous deployment of the branch; falls back to the GitHub API; falls back to **full source** when no base exists (first review) |
| Monorepo behaviour | Scoped to each selected project's root directory |
| Output | Finding in the Vulnerabilities dashboard + a GitHub check on the commit; on a **private/internal** repo with an open PR, also PR comments |
| Analysis type | Static source analysis, AI-assisted. **No** runtime testing, no penetration testing |
| Severity scale | Critical / High / Medium / Low — AI-estimated, **not** scored against a fixed rubric |
| Finding lifecycle | `open` → `dismissed` (human) or `closed` (a later review stopped detecting it — that is *not* confirmation the issue is fixed) |
| Audit trail | `vercel-agent-security-finding-created` in the team audit log (CSV / Audit Log Drain: Enterprise) |
| Plan requirement | Public Beta on **Pro** and **Enterprise** |

### Two things that are easy to get wrong

1. **Push-triggered, not PR-triggered.** A direct push or a force-push to `main` is reviewed.
   Reviews are also not free: cost scales with how often you push × how much changed × how many
   selected projects the monorepo contains.
2. **This repository is public** (`dlitorja/mentorships-infra`). On a public repository Vercel
   posts **only the check**, naming what it reviewed and linking to the dashboard — findings are
   not commented publicly. That protects us, but it also means *we* must not move findings into
   public surfaces ourselves (see §10).

## 2. Preconditions

- Team: `team_n99Fwsu8IikyWGkPmz2Our0L` ("Dustin Litorja's Team"). It bills Pro-tier usage
  (FOCUS billing charges show Fluid/Sandbox/Queues line items plus "Additional Team Seats"), so
  the feature should be offered. If **Settings → Agent → Security Reviews** is absent, check the
  plan before filing anything.
- Role: turning reviews on and choosing **Projects to Review** requires **Owner**. Two members
  exist — `admin@huckleberry.art` (Owner) and `huckleberryartdev@gmail.com` (Developer).
- Findings visibility: Owner / Member / Developer / Security see everything; Contributor sees
  only assigned projects; Billing and Viewer see none.

## 3. Enablement checklist (dashboard, Owner only)

From the team's **Settings → Agent → Security Reviews**:

1. Turn on **Review Deployments Automatically**.
2. **Projects to Review** → *Specific projects*, and select exactly the three live projects:
   - `mentorships-infra-platform` (→ `dev.mentorships.huckleberry.art`)
   - `mentorships-infra-marketing` (→ `mentorships.huckleberry.art`)
   - `mentorships-infra-huckleberry-drive` (→ `drive.huckleberry.art`)

   **Do not select `mentorships-infra`** — it is the paused duplicate that builds
   `apps/platform` again. Selecting it buys a second review of the same tree on every push.
   `5head-app` is out of scope for this repo.
3. Turn on **Enable Chat** if we want the **Fix with Vercel Agent** button. Chat is what lets a
   finding become a proposed PR; without it the dashboard is read-only triage.
4. Paste the policy from §4 and **Save**.

Enablement takes effect for reviews that start after saving. There is no API toggle exposed to
agents today (the Vercel MCP catalog has no Agent-settings write tool), so this step is manual —
record the date in §12 when done.

## 4. Policy

Policies are plain-language context, up to 32,000 characters, and are **context, not commands**:
Vercel's core behaviour wins over anything a policy says. A team policy applies everywhere; a
project policy (project → **Settings → Security → Security Review Policy**) adds context on top
of it. Changes apply only to reviews that start after saving.

The canonical text lives in [`vercel-security-review-policy.md`](./vercel-security-review-policy.md).
Edit that file first, then paste it into the dashboard, so the repo stays the source of truth and
the two do not drift.

## 5. Triage loop

Dashboard: team → **~ → Security → Vulnerabilities** (or the prompt/deep-link a GitHub check
gives you). Terminal, from a machine with the Vercel CLI installed and a team scope selected:

```bash
# One-time
npm i -g vercel            # the CLI is not currently installed on the dev machines
vercel switch              # pick "Dustin Litorja's Team"

# Triage
vercel security vulnerabilities                       # open findings, Production first
vercel security vulnerabilities --severity critical   # or: --project, --environment, --git-branch
vercel security vulnerabilities inspect mentorships-infra-platform/12
vercel security vulnerabilities dismiss mentorships-infra-platform/12 \
  --reason accepted-risk --message "Signature-verified webhook; no cookie session"
vercel security vulnerabilities reopen mentorships-infra-platform/12
```

References are `<project>/<number>` (or `<owner>/<repo>/<number>` for repo-level findings).
`--json` exists on `list`, `inspect`, `dismiss`, and `reopen`; `dismiss` fails in
non-interactive runs without `--reason`.

**Never run `vercel security vulnerabilities` or `vercel security check` in CI on this repo.**
The repo is public and both commands print source snippets, member emails, token names, and
project settings. Actions logs are public, and Actions artifacts on a public repo are
downloadable by anyone. Local invocation only; never paste raw output into a PR body, commit
message, or Linear description (link the finding instead).

### Severity → commitment

| Severity | Response | Tracking |
|---|---|---|
| Critical | Same-week fix PR. If the finding is production-live, also treat as an incident: check runtime logs, consider disabling the affected path. | Linear issue, `bug`/`security` label, highest priority |
| High | Same-week fix PR or a documented dismissal with Owner sign-off | Linear issue |
| Medium | Fix in the next Tier 2 cycle (`sweep-protocol.md` §3), or dismiss with a recorded reason | Linear issue, backlog |
| Low | Batch with the next Medium pass; dismiss freely with a one-line reason | Linear only if it recurs |

A fix is a normal PR: topic branch, `AGENTS.md` gates (Greptile + CodeRabbit), schema changes via
widen–migrate–narrow. "Fix with Vercel Agent" opens its own PR against the finding's branch — it
proposes, never merges; it goes through the same review gates as anything else.

### Dismissal discipline

A dismissal is a decision that leaves no trace in git, so record it:

- `--reason` must be `false-positive` or `accepted-risk` — never leave it implicit.
- `--message` carries the *why* (≤500 chars), e.g. "internal admin route behind Clerk, no
  anonymous reachability".
- `accepted-risk` dismissals **also** get a Linear issue (`security` label, state `Backlog`) with
  the finding reference and the reasoning, so the risk is re-reviewed rather than forgotten.
  `false-positive` dismissals do not need one.
- Reopen (`vercel security vulnerabilities reopen <ref>`) when the premise changes — a route
  loses its SSO, the webhook starts accepting unsigned requests, etc.

## 6. How it composes with the existing controls

| Control | Scope | Cadence | Relationship |
|---|---|---|---|
| Greptile + CodeRabbit | Per PR, whole diff, review comments | Every PR | Canonical merge gate. Security Review does **not** substitute; a clean Security Review check does not waive bot review. |
| `vercel security check` (Security Dashboard checks) | Team/project **configuration** (MFA, token expiry, env-var sensitivity, preview protection) | On demand | Different product surface — posture, not source. Safe to run locally; same public-log caveat. |
| `sweep-protocol.md` Tier 1 | `convex/**` shape scan (authz shapes a–d) | Weekly CI + per PR | Deterministic, greppable, diffable against a committed baseline. Security Review is LLM-based and covers every app; it will not reproduce the shape tally. |
| `sweep-protocol.md` Tier 2 | `convex/**` 3-pass review | Monthly | Security Review's Convex findings should be folded into the Tier 2 diff rather than triaged twice. |
| `sweep-protocol.md` Tier 3 | Third-party deep audit | Deferred | Unchanged. If Tier 3 unlocks, Security Review becomes an input to its candidate ledger, not a replacement. |
| Clerk Changes Policy | Clerk config/code | Always | Security Review may *report* a Clerk-adjacent issue; per `AGENTS.md` nobody acts on it without explicit approval. The policy text tells reviews not to propose Clerk edits. |
| Secret Protection Policy | Secrets in text | Always | Finding details are source snippets. Route them through Linear/PR links, never into committed text or public logs. |

## 7. Cost model

Billing is provider inference at the underlying token rate with no markup, plus the Vercel Token
Rate of **$0.25 per million tokens**. Reviews run **per Git push**, so the driver is pushes ×
diff size × selected projects — a three-project selection triples the per-push reviews for a
monorepo commit that touches all three roots.

Per `AGENTS.md` §"Fly Sprites" cost-disclosure posture:

- No pre-approval needed at the expected volume (a few pushes/day across three projects stays
  within the sub-$3/month band for most weeks).
- If a week's Vercel Agent line crosses **$3/month cumulative**, say so in the relevant PR or
  Linear issue before turning on anything broader (e.g. *All projects*).
- If it crosses **$20/month cumulative**, confirm with the operator, citing the measured
  per-push cost and the alternative (Tier 1 scan, or a monthly manual run).
- Measure after two weeks: Vercel Agent pricing/usage in the dashboard, then replace this
  paragraph's estimates with the observed number.

## 8. Rollback

Turn off **Review Deployments Automatically** (or remove projects from *Projects to Review*).
Existing findings stay in the dashboard and keep their status; the GitHub check stops appearing on
new commits. No repo change is required — nothing in this repo depends on the feature at build or
runtime.

## 9. Known limitations

- Static analysis only. A clean review is not evidence of absence; it never replaces a real
  audit (`sweep-protocol.md` Tier 3) or runtime testing.
- Severity is AI-estimated. Re-rate against our own threat model before spending a week on a
  "High".
- `closed` means "a later review stopped detecting it", not "fixed and verified". Confirm with the
  PR that claimed the fix.
- Reviews are diff-scoped after the first run, so a long-lived pre-existing vulnerability is only
  re-surfaced when the file changes. The full-source first review is the one chance to catch the
  backlog — read that one carefully.
- Monorepo root scoping means a finding in `packages/db` may be reported per project; dedupe when
  filing Linear issues.

## 10. Privacy notes specific to this repository

- Findings include source snippets, including confidential and personal data.
- The repo is **public**. Consequences:
  - Vercel posts only its check on commits/PRs here — do not "helpfully" quote a finding into a
    PR comment, commit message, or Linear issue; link to the dashboard finding instead.
  - Do not write findings to `docs/security/`, `/tmp` artifacts that get uploaded, CI logs, or
    workflow artifacts. `docs/security/pilot-baseline/` is a one-time historical snapshot, not a
    template for adding new findings.
- Once a fix merges, the *code* is public anyway; what stays private is the exploitation detail.

## 11. Decision log

| Date (UTC) | Decision | Trigger |
|---|---|---|
| 2026-11-04 | Adopt Vercel Security Review as a supplementary, push-triggered control; document enablement, policy, and triage here. Enablement deliberately left to the Owner (dashboard-only). | Operator request to implement <https://vercel.com/docs/agent/security-review>. |
| 2026-11-04 | Scope reviews to the three live projects; exclude the paused `mentorships-infra` duplicate and `5head-app`. | `AGENTS.md` §"Project topology": `mentorships-infra` rebuilds `apps/platform`, so including it doubles reviews of one tree. |
| 2026-11-04 | No CI job for `vercel security vulnerabilities` / `vercel security check`. | Repo is public; both commands emit source snippets and security posture, and public Action logs/artifacts are readable by anyone. |
| 2026-11-04 | `accepted-risk` dismissals require a Linear issue; `false-positive` dismissals do not. | Dismissals leave no git trace; the risk has to live somewhere re-reviewable. |
| 2026-11-04 | **Enabled** for `platform`, `marketing`, `huckleberry-drive` (Owner dashboard action); Agent chat on so *Fix with Vercel Agent* is available. Empty-vs-error CLI comparison confirms the team-level toggle; project selection and policy text are dashboard-only and are confirmed by the first review check on a push. | Operator confirmed setup; verification recorded in the doc header. |

## 12. Cross-references

- Policy text (source of truth, paste into dashboard):
  [`vercel-security-review-policy.md`](./vercel-security-review-policy.md)
- Recurring cadence and tiers: [`sweep-protocol.md`](./sweep-protocol.md)
- Historical security baseline: [`pilot-baseline/`](./pilot-baseline/)
- Mother policy: `<repo>/AGENTS.md` — "Pull Request Merge Policy", "Secret Protection Policy",
  "Clerk Changes Policy (Do Not Touch)", "Naming Conventions (instructor/student)",
  "Linear (Project Management)", "Vercel Plugin".
