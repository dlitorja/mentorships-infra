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
```

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

---

# Post-PR-12 follow-up: in-app onboarding gate (PR #937)

**Shipped:** PR #937 squash-merged on `ee62ae3d187e7157bfa4ed0e2b026796f5e097a7` (2026-10-16T04:44:43Z).
Branch `fix/student-onboarding-gate` from worktree `/home/dlitorja/projects/mentorships-infra-onboarding-gate`. Greptile CLI: 5/5 confidence, zero new findings on the merged HEAD. Pre-merge CI: all checks SUCCESS (typecheck, lint, convex tests, unit, E2E, build-apps, four Vercel previews).

This PR is a follow-up to PR 12 PR 4b (questionnaire + remediation cron) plus the HUC-92/HUC-93/HUC-94/HUC-95 verifications: it does not depend on any schema change but it IS a `workflow-change` per AGENTS.md (proxy.ts redirect path mutates for every navigation by a freshly-signed-up student). Linear HUC-106 ("Verify in-app onboarding gate on prod") is now `In Progress` and references the merge commit.

## Out-of-scope items recorded in Linear (not in this PR)

- HUC-107 (Backlog, Medium): broaden the Inngest reminder cron to scan `adminOnboardings` directly so the cron covers students who never reach the questionnaire form (current code only fires on `onboardingQuestionnaireSubmissions.draft`). Plus the silent-fail loud patch in `apps/platform/inngest/functions/onboarding.ts:783-790` (`throw NonRetriableError` on `error.code === "missing_api_key"`).
- Operator action: confirm `<RESEND_API_KEY_PLACEHOLDER>` and `<EMAIL_FROM_PLACEHOLDER>` are deployed to the Vercel prod environment. HUC-106 T0 has this as a prerequisite.
- Operator action: add the `workflow-change` (purple `#a855f7`) label to PR #937 in GitHub. The Linear CLI wrapper doesn't expose a label-creation subcommand and the raw MCP `create_label` call returns SSE `event: message\ndata:` that the wrapper doesn't parse cleanly. This is a one-time manual step.
- Operator action from HUC-106 T1–T6: walk the prod smoke tests on a fresh test-student email.

## Cross-session WIP preserved

The main checkout `/home/dlitorja/projects/mentorships-infra/` had unrelated modified `scripts/linear-cli.mjs` WIP from a prior session. Both this session's work and the `fix/student-onboarding-gate` branch live in a separate worktree, so that WIP was untouched — preserved per AGENTS.md parallel-session safety policy.

## Other session note

PR #936 (`feat/linear-cli-opencode-db-credential-fix`, commit `f1f4a63a399a4dd7e35b3b42c7938e7b37f62210`, merged 2026-10-16T04:44:53Z) was also unblocked in this session: two Greptile P1 findings (token refresh endpoint reverted to `/oauth/token`, expired database tokens hiding working credentials) were both fixed (`c8155ca4` → `f1f4a63a`). Greptile CLI: 5/5 confidence.

---

# Post-PR-937 follow-up: streamlined student /onboarding funnel (PR #939)

**Shipped:** PR #939 squash-merged on `b05fa759fa99d299e9c275e40b4b70bf641b0656` (2026-10-16T15:08:43Z).
Branch `feat/student-onboarding-funnel` from worktree `/home/dlitorja/projects/mentorships-infra-onboarding-funnel`. Greptile GitHub App on PR #939: **5/5 confidence, no actionable issues**. CodeRabbit skipped review (repo has fewer than 10 stars — per AGENTS.md, Greptile alone is sufficient). Pre-merge CI: all checks SUCCESS.

**Why:** the operator signed in as a test-student and found the previous `/onboarding/[id]` page (4-step stepper "Invitation sent / Account created / Workspaces ready / Onboarding complete", instructor list with Preparing/Ready badges, "What happens next" copy block) irrelevant to the student. The student's only real action is the questionnaire, so the URL they land on (from the deep-link email / dashboard banner / proxy.ts gate) should go straight to the form.

**Behavior on prod:**

For the assigned student visiting `/onboarding/[id]`:
- `failed` → minimal "We couldn't finish setting this up" card (failure-reason + support contact). No stepper, no questionnaire form, no instructors list.
- `cancelled` → minimal "This onboarding was cancelled" card (support contact). Same as today, but stripped of the surrounding noise.
- `queued` / `processing` / `completed` → server-side 307 to `/onboarding/[id]/questionnaire`, which renders the form (empty / draft / already-submitted). The "Submitted" card on the form appears when the questionnaire has been submitted (keyed off `onboardingQuestionnaireSubmissions.status === "submitted"`, not off the row's `adminOnboardings.status === "completed"`).

`/onboarding/[id]/questionnaire` gains a matching `failed` block: if a stale tab / shared link lands here directly for a failed row, the editable form is refused.

The HUC-92 self-heal path still runs at the top of `/onboarding/[id]/page.tsx`, so a signed-up student who lands there before the `user.created` Clerk webhook completes their claim still gets a viewable `/questionnaire` redirect.

Instructors / admins / support fall through to the unchanged full status page (stepper, instructor list, timeline, submitted questionnaire answers, work examples).

**Out-of-scope items recorded in Linear:**

- HUC-108 ("Verify streamlined /onboarding student funnel on prod") — `In Progress`, references merge commit `b05fa759`. Operator: walk T1–T6 (fresh-student → /questionnaire; returning-with-draft → /questionnaire; failed-row → minimal card; cancelled-row → minimal card; HUC-92 self-heal still works; instructor view unchanged). Same T0 prerequisite as HUC-106: confirm `<RESEND_API_KEY_PLACEHOLDER>` and `<EMAIL_FROM_PLACEHOLDER>` are deployed to Vercel prod.
- Operator action: add `workflow-change` (purple `#a855f7`) label to PR #939 in GitHub. The Linear CLI wrapper doesn't expose a label-creation subcommand and the raw MCP `create_label` call returns SSE the wrapper can't parse cleanly. One-time manual step.
- HUC-107 (still `Backlog`, Medium): broaden the Inngest reminder cron to scan `adminOnboardings` directly so the cron covers students who never reach the questionnaire form (the current code only fires on `onboardingQuestionnaireSubmissions.draft`) plus the `throw NonRetriableError` on `missing_api_key` patch at `apps/platform/inngest/functions/onboarding.ts:783-790`. This PR doesn't address HUC-107 because the student funnel redirect drops the student onto the questionnaire form by default; the only onboarding rows that don't reach the form are the failed/cancelled rows, which are intentionally terminal on the user's side.

**Operator cleanup:** worktree `/home/dlitorja/projects/mentorships-infra-onboarding-funnel` and local branch `feat/student-onboarding-funnel` are still around (the current checkout when the merge happened, so `gh pr merge --delete-branch` skipped them). From the main checkout, run `git worktree remove /home/dlitorja/projects/mentorships-infra-onboarding-funnel && git branch -D feat/student-onboarding-funnel`. If Git refuses because the worktree contains uncommitted or untracked files, preserve that work before retrying; do not force removal.

---

# Post-PR-939 follow-up: questionnaire UX polish + student timezone picker (PR #941)

**Shipped:** PR #941 squash-merged on `60a55e86ae47cdb09f5723d9dc561b15a7b32438` (2026-10-16T19:31:55Z).
Branch `feat/student-timezone-picker` from worktree `/home/dlitorja/projects/mentorships-infra-tz`. Greptile GitHub App: **5/5 confidence** on merge-base commit `52f41194`; cumulative CLI review over the local CLI's review-branch also showed 5/5. CodeRabbit skipped (repo <10 stars). Pre-merge CI: typecheck + lint clean, 712 Convex tests passing (the 4 new `setStudentTimezone` cases included), all green.

**Three things in one PR:**

1. **Questionnaire UX polish** (the operator-quoted copy). Inspirations help text is now *"Which artists inspire you the most? Name 3-4. You can post links to artists as well."* (operator's wording verbatim). Work examples description is now *"Upload 4-6 images of your best and most recent work. Your instructor will review these to evaluate where you're currently at."* (operator used a hyphen in *4-6*, kept verbatim). Both copy changes live in `apps/platform/lib/onboarding-questions.ts` and `apps/platform/components/onboarding/onboarding-questionnaire-form.tsx`.

2. **`<Linkify>` review helper** (new file `apps/platform/components/ui/linkify.tsx`). Staff-side reviewers of `/onboarding/[id]` now see URLs in free-text answers and in `inspirations[].name` rendered as clickable `<a target="_blank" rel="noopener noreferrer">` tags. URL_PATTERN matches `http(s)://`, `www.`, `mailto:`, `tel:`. Trailing-punctuation strip uses a per-character walker (NOT a blanket regex) so balanced URL parens like `(series)` are preserved. Safe-scheme gate refuses `javascript:` / `data:` / `vbscript:` / `file:` and renders them as plain text.

3. **`<TimezonePicker>` on the questionnaire.** New client component mounted at the bottom of `/onboarding/[id]/questionnaire`. Auto-detects via `Intl.DateTimeFormat().resolvedOptions().timeZone` (no permission prompt — OS-set zone is accurate when system clock is correct). Dropdown override is grouped by IANA region prefix and falls back to a curated list of ~50 common zones if `Intl.supportedValuesOf("timeZone")` is unavailable (older browsers, locked-down WebView shells). Persists via the new public mutation `setStudentTimezone` in `convex/adminOnboarding.ts`:
   * `adminOnboardings.studentTimezone?: string` and `studentTimezoneSetAt?: number` — **additive optional fields, no migration, no index**. Pre-existing rows resolve to `undefined` for both.
   * `setStudentTimezone(onboardingId, timezone)` — only the assigned student may write (`identity.subject === row.assignedStudentClerkId`); non-owners receive `UNAUTHORIZED: not the assigned student`, while missing rows return `NOT_FOUND: onboarding row missing`. Validation: regex + `Intl.DateTimeFormat` cross-check; throws `INVALID_ARGUMENT` on length > 64 or any non-IANA charset including `javascript:` / `data:` smuggling patterns. Empty / whitespace input clears both fields.
   * Staff-side `/onboarding/[id]/page.tsx` now renders `Student timezone: <zone> · set <ISO datetime>` in the header for rows with a pegged value.
   * `getOnboardingView` `returns` validator extended so all readers (instructor, admin, support gate-banners, `/api/.../admin/onboardings/...`) see the new fields; legacy rows return `studentTimezone: undefined`.

4. **Suppress `OnboardingGateBanner` on `/onboarding/*` routes.** New `currentPath` prop on the questionnaire page's `<ProtectedLayout>` calls (was missing before) plus a wider gate-banner suppression rule (`currentPath?.startsWith("/onboarding")`) so the student inside the funnel doesn't see "Finish onboarding" against the same form.

**Two adjacent scope-creeps Greptile surfaced and which were addressed because they were on the same review surface:**

* `instructor-page-gate-banner.tsx` (the soft-gate banner on `/instructors`): widened the existing "skip if instructor record" check to include admins and support users via `getServerUserRole` from `lib/auth-helpers.ts`.
* Same widening mirrored in `apps/platform/components/navigation/protected-layout.tsx`'s `likelyRole` mapping (added a `support` arm above the student fall-through) and in `apps/platform/app/dashboard/DashboardContent.tsx`'s gate-query enable condition. An admin or support user with a stale unfinished-student `adminOnboardings` row no longer sees "Finish onboarding" prompts on `/instructors`, on protected pages, or on the dashboard.

**Operator smoke tests on prod (HUC-109):**

To be walked in the verification window. Verbatim from PR #941's body:

1. Pick `America/New_York` from the dropdown → "Saving…" → "Saved as America/New_York" → refresh → choice survives → staff-side header shows `Student timezone: America/New_York · set ...`.
2. Empty `studentTimezone` → dropdown pre-fills with the OS-set zone in a top-of-dropdown "Detected from your browser" group.
3. Persisted choice is recoverable across route refresh.
4. Cross-tab/cross-session smuggling: from a different signed-in student session, attempt to write timezones to another student's row via the Convex dashboard → reject with `UNAUTHORIZED: not the assigned student`. (Important: do NOT pass with `UNAUTHORIZED: sign-in required` — that's the no-session branch, not the ownership branch; the test must specifically exercise the assigned-student check to confirm the row-level gating.)
5. Invalid zone (`Not/A/Real/Zone`) rejected with `INVALID_ARGUMENT`.
6. Staff header shows `Student timezone: <zone> · set <datetime>` for rows with a value; no line for legacy rows.
7. Staff clicking through answers / inspirations on `/onboarding/[id]` opens the URLs in a new tab without copy-paste, and dangerous schemes (e.g. pasted `javascript:alert(1)`) render as plain text.

**Out-of-scope items still in Linear / flagged as future work:**

* **HUC-109** (newly filed verification issue, `In Progress`, references merge commit `60a55e86`). Same T0 prerequisite as HUC-106 / HUC-108: confirm placeholder `<RESEND_API_KEY>` and `<EMAIL_FROM>` are deployed to Vercel prod.
* **Google Calendar / Apple Calendar integrations** that would actually consume `adminOnboardings.studentTimezone` to render local-time copy. The picker now captures the data; rendering it into a real calendar UI is intentionally out of scope for PR #941.
* **HUC-107 (still `Backlog`, Medium)** — broaden the Inngest reminder cron to scan `adminOnboardings` directly so the cron covers students who never reach the questionnaire form plus the `throw NonRetriableError` on `missing_api_key` patch at `apps/platform/inngest/functions/onboarding.ts:783-790`. Adjacent to the funnel work but not addressed here.
* **Operator action**: add the `schema-change` + `workflow-change` (purple `#a855f7`) labels to PR #941 in GitHub. The Linear CLI wrapper `scripts/linear-cli.mjs` doesn't expose a label-creation subcommand yet; the raw MCP `create_label` call returns SSE the wrapper doesn't parse cleanly. Same one-time manual step as for PR #937 and PR #939 (per this HANDOFF for those merges).

**Greptile review round-by-round ledger (six fixup commits on `feat/student-timezone-picker`):**

* `9b554b88` — questionnaire UX polish + Linkify + gate-banner suppression (clean)
* `959afb8b` — student timezone picker schema + mutation + tests + UI (clean)
* `68381084` — round-1 P2 fixes (banner suppression regex widened, admin/support skip on `instructor-page-gate-banner`, auto-save detected zone, lastSavedRef advanced post-success, balanced-paren tail-strip in Linkify)
* `88b8e7c8` — round-2 P2 fixes (fallback IANA zone list, skip-rule now also gates on `persist.isPending`)
* `b7533bed` — round-3 P2 fix (cleanup flushes the pending pick on unmount so submit-within-400ms is never dropped)
* `bd72f32f` — round-4 P2 fix (cleanup reads `fireSave` via `fireSaveRef` so the cleanup hook doesn't re-run on every TanStack re-render — stabilizer for the 400ms debounce)
* `52f41194` — round-5 P2 fix (extended staff-role exemption to support users on `ProtectedLayout`'s likelyRole and the DashboardContent gate)
* `7d920f2e` — round-6 test-coverage follow-up (added a `Not/A/Real/Zone` plain-IANA-bogus assertion so the Intl cross-check is exercised independently of the regex)
* Squash: `60a55e86ae47cdb09f5723d9dc561b15a7b32438`

**Worktree cleanup:** `/home/dlitorja/projects/mentorships-infra-tz/` is still around (the current checkout when `gh pr merge` ran, so the `--delete-branch` step skipped). It contains only committed work — safe to remove. From the main checkout, run:

```
git worktree remove /home/dlitorja/projects/mentorships-infra-tz
git branch -D feat/student-timezone-picker
```

If Git refuses because the worktree picked up new untracked files, preserve them before retrying — do not `--force` removal of operator WIP.
