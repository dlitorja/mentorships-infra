# Handoff — PR 12 PR 1 (`<ClerkUserIdCell>`) shipped

**For:** the next opencode session in this directory.
**Branch state:** `main` is clean. Latest commit `dc6c1bff` (PR #910 squash-merged 2026-10-08 22:48 UTC). Branch `feat/onboarding-improvements-pr1-clerk-user-id-cell` deleted on remote. Local worktree at `/tmp/opencode/pr-12-pr1` still has the branch tip `0eab1822` (pre-squash); safe to `git worktree remove /tmp/opencode/pr-12-pr1 --force` once this handoff is committed.
**What was just done:** PR 12 PR 1 of the onboarding-improvements 4-PR arc is shipped and merged. PRs 12/2–12/4 (resend invitation, status page, questionnaire + abandonment) are still pending — see "Remaining work" below.

**Snapshot date:** 2026-10-08. The repo is in the middle of a multi-PR arc; this handoff is a "where we are" progress note, not an interrupted-session reconstruction. AGENTS.md discourages HANDOFF.md for multi-PR arcs in favor of a Linear Project, but PR 12 doesn't have one yet — once the user creates `Post-Merge Verification` (or equivalent) in Linear and migrates HUC-80 there, this file can be retired.

---

## What you can do immediately on session start

1. **Trigger Linear OAuth.** Call any `linear_*` tool (e.g. `linear_list_teams`). opencode will detect the registered MCP server and pop a browser window to Linear's OAuth flow at `https://mcp.linear.app/mcp`. The user has already authorized this step.

2. **Create the 9 post-merge tasks** in Linear in one batch per `docs/post-merge/instructor-profiles-consolidation.md` (this file is the source of truth — do not paraphrase from this handoff; read the spec).

3. **Prompt the operator to run the 5 Phase-1 smoke tests on prod** once the Linear tasks exist.

---

## Repo state (files relevant to this workstream)

| Path | Purpose |
| - | - |
| `INSTRUCTOR_PROFILES_CONSOLIDATION_PLAN.md` | Full PR-by-PR plan; line 225 still needs the post-merge status flip (T8 in the spec) |
| `docs/post-merge/instructor-profiles-consolidation.md` | Source-of-truth task spec for the 9 Linear issues; Greptile-corrected (rollback ordering + auditLog→runtime logs) |
| `opencode.json` | MCP server config — `linear` remote at `https://mcp.linear.app/mcp`, OAuth-enabled |
| `AGENTS.md` | New "Linear (Project Management)" section documenting when/when-not to use, read-only mode, GitHub sync |

---

## Configuration summary

### opencode MCP servers (workspace-local `opencode.json`)

```
resend      — local, needs RESEND_API_KEY + EMAIL_FROM
firecrawl   — local, needs FIRECRAWL_API_KEY
linear      — remote, OAuth (no env vars; browser flow on first call)
```

### Linear MCP details

- **URL**: `https://mcp.linear.app/mcp`
- **Read-only mode**: `https://mcp.linear.app/mcp/readonly` (use if operator only wants browse, not write)
- **Auth**: OAuth 2.1, browser-based; first call pops the flow, token cached for subsequent sessions on this machine
- **Tool scope** (per Linear's Feb 2026 expansion): find/create/update issues, projects, comments, initiatives, milestones, project updates, labels
- **Reference**: <https://linear.app/docs/mcp.md>

### CLI install state

- `@linear/cli` (binary `lin`, v0.1.0) installed globally at `/home/dlitorja/.nvm/versions/node/v22.21.1/bin/lin`. Uses Ink (TUI library); fails with "Raw mode is not supported" in non-TTY shells, so it works for the user in their terminal but not for an agent in a non-interactive shell.
- `@linear/sdk` v94.0.0 is available on npm but not installed — not needed because MCP is the primary path.

---

## Linear task creation recipe (use exactly this, don't paraphrase)

When the OAuth flow completes, run this sequence (tool names are the Linear MCP server's tool names — verify against the actual tool list once it's loaded; some clients may use slightly different naming):

### Step 1 — Find the team

```
linear_list_teams  →  pick the team the user wants (ask if unclear; default to the team matching the workspace name)
```

### Step 2 — Optional: create project

Ask the user before creating a Linear project. Suggested:
- **Name**: "Post-Merge Verification"
- **Color**: pick any
- **Description**: "Tracking the 4-PR arc closure for the instructorProfiles drop (PRs #830–#834)."

### Step 3 — Create labels (one-time, idempotent)

```
post-merge-2026-09-09   (color: gray, identifies this workstream)
verification            (color: blue)
prod                    (color: red)
monitoring              (color: yellow)
housekeeping            (color: green)
```

### Step 4 — Create the 9 issues

For each task in `docs/post-merge/instructor-profiles-consolidation.md`, call `linear_create_issue` with:

| Field | Value |
| - | - |
| `title` | The exact title from the spec (T1: "npx convex data instructorProfiles --prod returns 'Table not found'", etc.) |
| `description` | The "Steps" + "Pass criterion" + "Why it matters" blocks as markdown |
| `team` | From step 1 |
| `project` | From step 2 (if user opted in) |
| `priority` | T1: 1 (Urgent). T2-T5: 2 (High). T6-T9: 3 (Medium). |
| `labels` | From step 3 (T1-T5 get `verification`+`prod`; T6-T7 get `monitoring`; T8-T9 get `housekeeping`; all get `post-merge-2026-09-09`) |
| `dueDate` | T6: 2026-09-10. T7: 2026-09-11. T8-T9: leave blank. |
| `assignee` | The user's Linear user id (from `linear_list_members` if needed) |
| `state` | T1-T5: "In Progress" (they're meant to be done same-day). T6-T9: "Backlog". |

### Step 5 — Report back

Print the 9 issue URLs in a tidy list for the user.

---

## Things to NOT do

- Do **not** create Linear issues for code-review feedback or commit messages — those stay on the PR/commit per AGENTS.md.
- Do **not** create the issues before OAuth completes.
- Do **not** paraphrase the task descriptions — copy from `docs/post-merge/instructor-profiles-consolidation.md` directly.
- Do **not** create the Linear project without asking the user (they may already have a convention).
- Do **not** modify Clerk config, AGENTS.md, or `opencode.json` — the setup is committed and reviewed (PR #835 got Greptile 5/5 after fixing the rollback ordering and the auditLog metric).

---

## Open context from the previous session

- **PR #834** (squash-merge `f5a5d3ac`, 2026-09-09 13:59 UTC) deleted `instructorProfiles` table from Convex schema. Schema deletion deployed to prod via CI at 14:04 UTC.
- **PR #835** (squash-merge `e35aabd3`, 2026-09-09 20:33 UTC) wired up Linear MCP. Greptile flagged 2 issues on first review, both fixed: (P1) rollback ordering — schema revert must be deployed before snapshot restore; (P2) `convex/auditLog` has no failed-mutation metric, replaced with Convex runtime logs + Functions error-rate view.
- **Operator has not yet run the 5 Phase-1 smoke tests on prod.** They are listed in the spec as T1-T5 and should be the first thing the user works on after Linear is set up.
- **Plan file line 225** still says "Status: 🚧 PR opened" — T8 in the spec covers updating it.

---

## Pre-merge gate reminder (in case the user runs the gate again)

The `scripts/check-reconciliation-status.mjs` reconciliation gate is committed and wired into CI (`reconcile-gate` job → `deploy` job with `needs:` dependency in `.github/workflows/convex-deploy.yml`). Post-PR-834 the gate is a no-op (table missing → exit 0). If anyone re-runs the gate against a deployment where the table exists, it expects `--acceptance-file scripts/reconciliation-acceptance.json` with value-bound overrides (8 entries for the reviewed prod divergences).

---

## Quick verification commands

```bash
# Confirm Linear MCP config is on main
grep -A 4 '"linear"' /home/dlitorja/projects/mentorships-infra/opencode.json

# Confirm latest commit
cd /home/dlitorja/projects/mentorships-infra && git log --oneline -3

# Confirm 9-task spec is intact
cd /home/dlitorja/projects/mentorships-infra && wc -l docs/post-merge/instructor-profiles-consolidation.md

# Trigger Linear OAuth (this is what kicks off the browser popup)
# In the next agent turn: ask the agent to list Linear teams.

---

## PR 12 — Onboarding Improvements progress (post-PR-1, 2026-10-08)

### Shipped (PR 1)
- **PR #910** — `<ClerkUserIdCell>` shared component + `getClerkDashboardUserUrl` helper, replacing 11 ad-hoc Clerk-id render sites across `apps/platform/app/admin/*` and `apps/platform/app/instructor/students/*` + the `admin-onboarding-form.tsx` success card. Single env var `NEXT_PUBLIC_CLERK_APP_ID` (browser-readable). Both `apps/platform/.env.local` and the Vercel `mentorships-infra-platform` project env are updated. `.env.example` has the placeholder.
- **Plan doc:** `docs/plans/pr-12-onboarding-improvements.md` (full 4-PR arc).
- **Greptile fix:** All 3 P1/P2 review threads addressed in commit `0eab1822` before merge. The P1 (process.env indirect lookup) is a real bug — without the fix the dashboard link silently resolves to `undefined` in the browser bundle even when the env var is set. The P1 fix is on the merged commit `dc6c1bff`.

### Linear
- **HUC-80** "Verify `<ClerkUserIdCell>` shared component on prod (PR 12 PR 1)" — created with labels `verification`, `prod`, refs PR #910. Currently `Backlog`; should be moved to `In Progress` and worked through T1–T10 (smoke tests documented in the issue body). Move to `Done` after the smoke tests pass.

### Remaining PRs (PR 2, 3, 4)
- **PR 12 PR 2** — Resend invitation: `convex/adminOnboarding.ts` `resendAdminOnboardingInvitation` mutation + UI button on `/admin/onboardings/[id]` next to `RetryOnboardingButton`. Adds `invitation_resent` to the timeline event union. Independent of PR 1, can start in parallel.
- **PR 12 PR 3** — Onboarding status page `/onboarding/[id]`: read-only view for instructor + post-auth view for student (auto-resume on sign-in if a draft exists). Permission check returns 404 on failure (not 403, to avoid leaking existence).
- **PR 12 PR 4** — Questionnaire (3 questions: how-did-you-hear, goals, inspirations × 3–4 entries) + work examples upload (max 6 per onboarding, 8 MB each) + abandonment reminder pipeline. New `onboardingQuestionnaireSubmissions` Convex table; Inngest cron every 30 min checks for stale drafts (`updatedAt < now - 1h`), max 3 reminders per draft. Auto-save on every field change, debounced ~500ms.

### Deviations from the original plan (locked-in during PR 1)
- **Dashboard URL source:** `NEXT_PUBLIC_CLERK_APP_ID` env var (not "decode publishable key + `clerkClient.instance.get()`"). `@clerk/backend@3.18.1` does NOT expose `instance.get()` — verified by grepping installed `.d.ts` files. The publishable-key base64 segment decodes to the Clerk frontend API host, not the app ID.
- **Component prop:** renamed `userId` → `id` so the cell also covers the Clerk invitation id in the onboarding-form success card.
- **Two render sites disable both buttons** for layout reasons: `workspaces/create/page.tsx` search fallback inside a clickable list item + `products/page.tsx` instructor filter `SelectItem`.

### Constants (locked-in for PR 2–4)
- `MAX_WORK_EXAMPLE_BYTES = 8 MB`, `MAX_WORK_EXAMPLES_PER_ONBOARDING = 6`
- `MIN_INSPIRATIONS = 3`, `MAX_INSPIRATIONS = 4`
- `ONBOARDING_REMINDER_STALE_MS = 60 * 60 * 1000` (1 hour)
- `ONBOARDING_REMINDER_MAX_COUNT = 3`
- B2 prefix for onboarding uploads: `onboarding/{onboardingId}/`

### Next move (after this handoff)
1. Run T1–T10 on prod and move HUC-80 to `Done`.
2. Open PR 12 PR 2 on branch `feat/onboarding-improvements-pr2-resend-invitation` from a new worktree.
3. Open PR 12 PR 3 on a new branch from a new worktree.
4. Open PR 12 PR 4 on a new branch from a new worktree (introduces new Convex table — Linear verification issue + `schema-change` label required per AGENTS.md).
5. Optionally create a Linear Project `PR 12 — Onboarding Improvements` (in Linear UI; the CLI wrapper can't create Projects) to host HUC-80 + the future PR 2/3/4 verification issues.
```
