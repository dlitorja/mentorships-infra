# Workspace & dashboard fixes (4 issues) — scoping

**Status:** scoping — not implemented yet. Open-questions below; awaiting decisions before kicking any branches.

**Origin:** spec drafted with Muse from instructor feedback + admin UI experience.

**Repo context:**
- Convex backend at repo root (`convex/`) — generated `apps/platform/convex/_generated` mirrors it; one runtime per backend.
- `apps/platform` is the consumer; `apps/web` is the legacy app (Inngest v3, separate Convex dep). Nothing in this plan touches `apps/web` mutations — changes stay in `convex/` and `apps/platform/`.
- Naming: **instructor / student** only. No "mentor" / "mentee" anywhere in code or copy. The single allowed exception is the existing "mentorships" UI copy and the apps' slug (`apps/platform`, `apps/web`, `apps/huckleberry-drive`).
- Reviews: Greptile + CodeRabbit (Greptile primary; CodeRabbit skips if the repo has <10 stars); do not merge without at least one bot approval per `AGENTS.md` PR-merge policy.
- High-blast-radius changes (this plan touches `convex/workspaces.ts`, the `workspaces` schema, the `users` mutation surface, and `studentInvitations` gating) each get a Linear `Verify "..." on prod` issue opened at PR time per the post-merge verification convention.

---

## Issue 1 — Clerk IDs dominate the instructor dashboard list

### What the spec says (paraphrased)
`InstructorDashboardContent.getDisplayName()` falls back to the raw Clerk `userId` when the row has no name/email. Show "Unnamed student" as the headline and demote the Clerk ID to a small mono subtitle (and/or row tooltip). Audit other surfaces; do not paper over missing data — fix the sync.

### What I found while exploring

**UI fix is sound.** `apps/platform/app/instructor/dashboard/InstructorDashboardContent.tsx:19-22` does:

```ts
function getDisplayName(row: StudentSessionRow): string {
  const fullName = [row.studentFirstName, row.studentLastName].filter(Boolean).join(" ");
  return fullName || row.studentEmail || row.userId;
}
```

Theided fallback chain (name → email → Clerk userId) is exactly what the spec calls out. The audit is already what the spec says:

- `/instructor/students/page.tsx:259` — uses `<ClerkUserIdCell>` for the ID column, primary label is email. Fine.
- `/admin/workspaces/[id]/page.tsx` and other admin surfaces — all use `<ClerkUserIdCell>` as an explicit dev affordance, never as the headline. Fine.
- `ClerkUserIdCell` in `packages/ui/src/components/clerk-user-id-cell.tsx` already gives truncate + copy + Clerk dashboard deep link. Use it (not a raw `<code>`).

**Data-side is the real story, and worse than the spec reflects.** Reading `syncUser` (`convex/users.ts:446-595`) and the call graph:

- `/api/auth/sync` (`apps/platform/app/api/auth/sync/route.ts`) calls `convex.mutation(api.users.syncUser, { firstName, lastName, role })` — **but this route is never invoked from the platform app**. It is wired only by `apps/marketing/lib/providers/query-provider.tsx:127` for first-time admin sync. Searching `apps/platform` for `/api/auth/sync` only finds the route file, the route constant in `lib/routes.ts`, and the README docs — no caller.
- Clerk webhook handler (`apps/platform/app/api/webhooks/clerk/route.ts:104-114`) dispatches `clerk/user.created` to Inngest but does **not** call `syncUser` directly. It only links `sessionPacks` / `seatReservations` / `workspaces` to the new Clerk userId.
- The Inngest handler for `clerk/user.created` (`inngest/functions/clerk-user-linking.ts`) likewise only calls `/internal/link-*` endpoints — never `syncUser`. The companion `inngest/functions/clerk-user-instructor-lifecycle.ts` only updates instructor rows.
- `syncUser` is only called on the platform side from the admin/instructor backfill paths (`/api/admin/instructors/upload`, `…/backfill-images`, `…/seed-role`, `/api/instructor/sync-role`).

**Result:** a student who signs up via Clerk invitation, has their `seatReservations` linked by `clerk-user-linking`, and visits `/instructor/dashboard` before any admin action that touches them has no `users` row keyed by their `userId`. The dashboard's `by_userId` lookup in `seatReservations.getInstructorStudentsWithRemainingSessions:151-166` returns `null` → `studentFirstName/LastName/Email` are all `null` → `getDisplayName` falls through to `row.userId` (a raw Clerk ID). The spec's "Unnamed student" UI fix is correct for this case but does nothing for the broader data-quality problem.

### Proposed scope

Two related changes — implement them in the same PR so the UI assertion has data behind it.

1. **UI (the spec body):**
   - File: `apps/platform/app/instructor/dashboard/InstructorDashboardContent.tsx`.
   - Change the `getDisplayName` headline to `"Unnamed student"` (sentence case, matches the existing section copy) when `firstName + lastName + email` are all missing.
   - Add a second line under the headline: `text-xs text-muted-foreground font-mono truncate` showing the Clerk ID with `title="Clerk user id"` for hover-to-copy. Reuse `<ClerkUserIdCell>` (or a slimmer in-file variant of its `code` + copy icon) — but the dashboard is not an admin surface, so **do not** add the Clerk dashboard deep link here. Admins only.
   - Move the email line up so it remains prominent when it exists: `<headline>`, then email (only when present and different from headline), then the muted Clerk-ID line.
   - Make `getDisplayName` return `{ headline: string; clerkId: string }` so the render is unambiguous — avoid the current pattern of "compute name + decide which line to render" that already bit us in the existing email-vs-name conditional at line 76.

2. **Sync data (the spec footer):**
   - Identify the right primary attachment point. Two candidates:
     - **Append `await convex.mutation(api.users.syncUser, …)` to the `clerk-user-linking` Inngest step after the existing link calls.** Pros: single funnel for every new Clerk user, low latency (event-bus driven), follows the existing pattern of the route + Inngest funneling for `user.created`. Cons: Inngest is async — a student who logs in and immediately lands on `/instructor/dashboard` may still see `Unnamed student` for a few seconds. Self-healing on first refetch.
     - **Mount an `AuthDrivenInvalidator`-style client-side effect that POSTs to `/api/auth/sync` on every auth change.** Pros: synchronous (mutation completes before the next render). Cons: every page load incurs a Clerk API + Convex write on the hot path; doesn't help if the user is blocked from reaching a page that mounts the effect.
   - **Recommendation (open for input):** Both. Wire `/api/auth/sync` into `apps/platform/lib/providers/query-provider.tsx` immediately after the auth-driven invalidation step (single POST per `(userId, role)` tuple — match `apps/marketing/lib/providers/query-provider.tsx` pattern; mark `inFlightRef` so dev-mode StrictMode double-mount does not double-fire). AND append `syncUser` to the Inngest step so anyone who never reaches a covered page still gets a row. The first-time-write cost is small: `syncUser` is idempotent and indexed by email / clerkId.
   - **Open question for the spec author:** do we accept that `/instructor/dashboard` may show "Unnamed student" for a few seconds after a new student signs up (async Inngest path), or do we want `/api/auth/sync` to be the synchronous path-of-record (slower landing page, no eventual consistency window)? I recommend: client-side sync as the synchronous-of-record path + Inngest as a backfill for students who never reload — accept the per-mount latency cost.

3. **Out of scope** for this PR (call out explicitly):
   - Email preservation logic in `syncUser:522-563`. The current code only sets `email` on insert, not on patch. If a student changes their Clerk email after-the-fact, the Convex row keeps the old one. Worth fixing later, but a separate change since it can affect identifier fallback on `getInstructorStudentsWithRemainingSessions`.
   - Backfilling existing rows in `users` for the two stale test-account emails. That pairs with Issue 3's cancel flow.

### Verification
- `pnpm --filter @mentorships/platform typecheck && pnpm --filter @mentorships/platform build`.
- Manual: impersonate the test instructor (`clerk impersonate` per `AGENTS.md`), open `/instructor/dashboard`, confirm:
  - Row with linked `users` row → name + email + (if needed) muted Clerk ID.
  - Row with no linked `users` row → "Unnamed student" + Clerk ID.
  - Tooltip / copy works on the Clerk ID cell.
- End-to-end: refresh the route with a brand-new student via `clerk impersonate` → confirm the data-side sync wrote a `users` row with `firstName` / `lastName` from the test Clerk identity.

---

## Issue 2 — Workspace archive / unarchive (instructors)

### What the spec says
Soft-delete (`deletedAt`) exists but is admin-only. Add an `archived` concept — instructors can hide their own workspaces without losing data. Schema changes + mutations + queries + UI on the workspace sidebar/settings + the `/workspace` picker.

### What I found while exploring

- **Schema (`convex/schema.ts:363-401`)** currently has `deletedAt` + `endedAt` on `workspaces` plus the indexes `by_instructorId`, `by_instructorId_deletedAt` (existing), `by_instructorId_ownerId_…_endedAt_deletedAt`, and `by_deletedAt`. `type` filter for `admin_instructor` workspaces exists.
- **Existing soft-delete:** `workspaces.deleteWorkspace` (`convex/workspaces.ts:877-883`) is admin-only via `requireAdmin`. No instructor-facing archive hides — `workspaces.softDelete` etc. do not exist.
- **`getCallerWorkspaceRole` (`workspaces.ts:109-120`)** treats `deletedAt`-set workspaces as inaccessible; `endedAt`-set workspaces remain readable for the 18-month retention window. Archive semantics should sit *between* `deletedAt` (gone) and `deletedAt === undefined` (fully active). The spec calls this out: "an archived workspace is not bookable."
- **Queries that resolve a workspace for booking — must exclude archived:**
  - `resolveActiveWorkspaceForPair` (`workspaces.ts:456-473`) — returns the active workspace for `(instructor, student)`. Used by `getInstructorStudentsWithRemainingSessions`, `getWorkspaceBySessionPackId`, and the workspace dashboard's `workspaceId` column.
  - `getWorkspaceBySessionPackId` (`workspaces.ts:658-678`) — used by the "Open workspace" CTA on student packs.
  - `getInstructorStudentsWithRemainingSessions` (`seatReservations.ts:105-219`) — projects `workspaceId` into each row.
  - Possibly `bookings` row creation path — should not let an instructor book a session into an archived workspace.
- **Picker (`WorkspaceClientPage` sidebar at `components/workspace/workspace-client-page.tsx:313-352`)**: the sidebar lists workspaces via `.map(workspace => …)`. No active/archived split today. The parent route's redirect for `workspaces.length === 1` (`app/workspace/page.tsx:45-47`) also matters — currently counts both deleted-excluded and non-archived; archived should also bump this count.
- **Workspace rename header (`components/workspace/workspace-rename-title.tsx`)** is the natural place for an Archive action button (next to the rename pencil), and it has access to the role + workspace id. Reuse that role check pattern instead of a new ad-hoc one.

### Proposed scope

Four PR-blocks or one PR — recommend one PR (medium size, but each piece is contained):

1. **Schema (`convex/schema.ts:363-401`):**
   - Add `archivedAt: v.optional(v.number())` and `archivedBy: v.optional(v.string())`. `archivedBy` stores `identity.subject` (Clerk id) at archive time.
   - Add `by_instructorId_archivedAt: ["instructorId", "archivedAt"]` so the picker can filter on the index. Track `archivedAt` (rather than `archivedAt === undefined`) as the filtered endpoint; Convex's `q.eq("archivedAt", undefined)` and `q.gt("archivedAt", 0)` both work on this column.
   - **Add an admin-only `by_ownerId_archivedAt`** is unnecessary — owner-owned workspaces already flow through `getUserWorkspaces` which dedupes across owned + instructor. Don't recreate the soft-delete pattern.

2. **Mutations (`convex/workspaces.ts`):**
   - `archiveWorkspace` and `unarchiveWorkspace` — both as public mutations, both gated on `getCallerWorkspaceRole` returning `"instructor" | "student"` AND `workspace.type !== "admin_instructor"` (preserve current admin-visible archive semantics — admin staff viewing admin-created instructor workspaces should archive via the existing admin delete path, not the new instructor-facing one) **OR** the caller is admin (do not block admins, just don't expose the UI). Implementation: set/clear `archivedAt` + `archivedBy`.
   - Mirror the `deleteWorkspaceImpl` / `createWorkspaceImpl` / `updateWorkspaceImpl` split (`workspaces.ts:851-907`) for the new ops — public + internal variants. Internal variant for the cleanup cron / migration.
   - Reject archive when `deletedAt !== undefined` (already gone) or `endedAt !== undefined` (can't archive a workspace in retention — that path already handles its own visibility).
   - Reject archive when `type === "admin_student"` — admin worksites shouldn't be archived by the student (they aren't owned by the student in the same way). Open question — see below.

3. **Queries:**
   - Add `includeArchived: v.optional(v.boolean())` arg (default `false`) to every workspace list query that currently excludes `deletedAt`:
     - `getUserWorkspaces` (`workspaces.ts:563-623`) — also bump the "redirect when 1 workspace" branch to use this flag (one-workspace redirect should ignore archived — instructors don't get redirected into a hidden archive).
     - `getInstructorWorkspaces` (`workspaces.ts:626-638`) — admin / instructor tooling.
   - Add an internal Indexed filter helper next to `resolveActiveWorkspaceForPair` that excludes `archivedAt` + `deletedAt` + `endedAt`, AND update `resolveActiveWorkspaceForPair` to use it (so the spec's "an archived workspace is not bookable" holds). `getWorkspaceBySessionPackId` is already using `resolveActiveWorkspaceForPair`, so a single edit covers it.
   - Keep `getWorkspaceByIdForUser` (`workspaces.ts:531-560`) unchanged for now — `deletedAt` already gates this; archive is a different status (instructor's workspace is still readable for them; we don't want to log them out of the page they navigated to). The `pendingSwitchTo` confirmation still works because the data is already loaded.

4. **UI:**

   The categorical surface for archived mentorships is the **instructor dashboard** (`/instructor/dashboard`), not the workspace picker. Per operator clarification: archived workspaces must remain accessible from anywhere they appear; the dashboard provides the dedicated "Archive vs active" categorical view. The picker and sidebar stay flat — no separate Archived tab needed.

   - **`instructor/dashboard/page.tsx`** — the platform instructor dashboard currently renders only `InstructorDashboardContent` (a "Students & Remaining Sessions" `Card`). Add a sibling `ArchivedWorkspacesCard` so the page shows two cards stacked on mobile, side-by-side on desktop. Type check: `includeArchived: v.optional(v.boolean())` arg shape, but the archived card needs student metadata that the existing card doesn't carry — recommend a new `getInstructorArchivedMentorships` query (see "Additional queries" below) rather than bolting more args onto `getUserWorkspaces`.
   - **Archived Workspaces card body** — one row per archived mentorship workspace: student name + email (`student.firstName/lastName/email` joined from `users`), workspace name/alias, `archivedAt` formatted as a date, and an **Open** button → `/workspace/{id}` (still navigable — archived workspaces remain readable; the badge + opacity-60 mute them visually, they're not gated). Empty state: *"No archived mentorships yet."*
   - **The existing card is renamed to "Active Mentorships"** — symmetry with the new "Archived Workspaces" card and reads cleaner. Single-line label change in `InstructorDashboardContent.tsx`.
   - No mutating actions in the Archived card. **Unarchive lives on the workspace header** (accessed via Open), matching the `ResendInvitationButton` precedent — actions on the detail page where the full workspace context is visible. This keeps the dashboard card a pure read surface.
   - **`WorkspaceRenameTitle` (`components/workspace/workspace-rename-title.tsx`)** — append an Archive icon button next to the rename affordance, only when `canRename === true` AND `workspace.archivedAt === undefined`. Confirmation dialog explains the workspace moves to the dashboard's Archived Workspaces card and is no longer bookable; data is preserved. When `workspace.archivedAt !== undefined` (open an archived workspace), render an "Unarchive" button adjacent.
   - **`WorkspaceInner` (`components/workspace/workspace-client-page.tsx:412-504`)** — render a muted "Archived" `Badge` strip below `<WorkspaceRenameTitle>` when `selectedWorkspace.archivedAt !== undefined`.
   - **Sidebar list (`workspace-client-page.tsx:313-352`)** — keep ALL of the instructor's workspaces visible (active + archived). Archived rows are visually de-emphasized — opacity-60 styling + the "Archived" `Badge` next to the workspace name; LIVE indicator suppressed — but they remain navigable. This is the "should not be inaccessible" half of the design intent: archived workspaces are reachable from any other workspace the instructor has open. `pendingSwitchTo` confirmation continues to work for both kinds. Existing `requestSwitch` mechanism accommodates; no logic change beyond the visual.
   - **Picker route (`app/workspace/page.tsx`)** — flat list (matches the sidebar). No dedicated Archived tab — the dashboard (`/instructor/dashboard`) is the dedicated categorical surface for archived mentorships. Single-workspace redirect excludes archived per the picker-redirect decision (`workspaces[0].archivedAt === undefined` check).
   **Page layout on `/instructor/dashboard`:** single scrollable column with two cards (stacked on mobile, side-by-side on desktop). No new tabs, no new subroutes.

   **Additional queries** (added alongside the existing workspace queries):

   - `getInstructorArchivedMentorships({ instructorId })` — public query, gated on `ctx.auth.getUserIdentity()` matching `instructors.userId` (mirrors `getInstructorStudentsWithRemainingSessions:111-119`'s pattern). Returns enriched rows: `{ workspaceId, archivedAt, archivedBy, workspaceName, workspaceAlias, studentUserId, studentFirstName, studentLastName, studentEmail }`. Index `by_instructorId_archivedAt` enables `.eq("instructorId", …).gt("archivedAt", 0)` — efficient and ordered by archived-time.
   - Same query, internal variant for any scripts / migrations that need it (`getInstructorArchivedMentorshipsInternal`).

5. **Out of scope:**
   - Bulk-archive (multi-select).
   - Auto-archive after `endedAt` retention expires.
   - Migration of existing soft-deleted workspaces — keep them as-is (`deletedAt` is the destructive path; archive is the reversible path).

### Recommendations on archive per workspace type (decided; please push back if wrong)

These are my read of the use case + conservative default. Flag any disagreement before PR-C merges — easy to revisit before the merge, expensive after.

- **`type: "mentorship"`** — archiveable by the participant (instructor OR student/owner). Use case for archive is real and is the spec author / instructor feedback driver.
- **`type: "admin_student"`** — admin-only. The student is the `ownerId`, but the worksite is staff comms (default name `"Admin Communication - {studentName}"`; the auto-`ensureAdminStudentWorkspace` post-payment path in `convex/adminWorkspaces.ts:282-331` and `apps/platform/inngest/functions/payments/process-*-checkout.ts:32-33` mean admin staff may have ongoing coordination needs on this thread). If the student archives it within minutes of payment, admin loses the surface for followups (refund disputes, retention failsafes). Matches the existing admin-only delete precedent (`adminWorkspaces.deleteWorkspaceAdmin`).
- **`type: "admin_instructor"`** — admin-only. Same justification as `admin_student`. The instructor is a participant via `instructorId`; the admin is `ownerId`. Admin owns the coordination thread.

**Implementation:** in both new mutations, accept the call when `callerIsAdmin || (workspace.type === "mentorship" && role === "instructor" || role === "student")`. Reject otherwise with a clear message. The archive button in `WorkspaceRenameTitle` is rendered only when `selectedWorkspace.type === "mentorship"` so the UI mirrors the gate. Admins still see and use the action — they just take it through their admin surfaces (which already exist for delete).

### Picker auto-redirect (decided)

`app/workspace/page.tsx:45-47` currently redirects on `getUserWorkspaces.length === 1`. After Issue 2, an instructor could have **only** archived workspaces; surfacing them under the Archived tab is what they want, and redirecting would skip past it. Add the same `archivedAt === undefined` check that the new `getUserWorkspaces` filter already uses internally:

```ts
if (workspaces && workspaces.length === 1 && workspaces[0].archivedAt === undefined) {
  redirect(`/workspace/${workspaces[0]._id}`);
}
```

Tradeoff: a user whose only workspace is archived loses the auto-shortcut into that workspace, gaining one extra click into the picker. The cost is negligible vs the UX surprise of "I clicked /workspace and I'm in a hidden workspace."

### Index staging (decided)

`by_instructorId_archivedAt` — **unstaged** (`staged` omitted). Rationale:

- `workspaces` has six existing indexes (`by_ownerId`, `by_instructorId`, `by_instructorId_deletedAt`, `by_instructorId_ownerId`, `by_instructorId_and_ownerId_and_type_and_endedAt_and_deletedAt`, `by_deletedAt`, `by_type_deletedAt`). One more is incremental.
- Production row count is on the order of "one per paying student" — likely hundreds to low thousands.
- Convex unstaged backfill on a small table is well under a minute.
- The deployment-blocking risk does not justify the extra step (deploy without index → backfill async → redeploy to remove the flag — vs. one deploy with the index ready).

If a reviewer later discovers the table is larger than expected (e.g. >50K rows on the Convex dashboard at PR-merge time), change to `staged: true` — additive, no schema rewrite. I'll add a comment in `schema.ts`'s PR-Body/heading referencing the row-count cue.

---

## Issue 3 — Pending invitations need actions

### What the spec says
Per-row Resend + Cancel buttons on `PendingInvitationsCard`. Cancel wires to the existing `updateStudentInvitationStatus` after adding an admin gate; Resend is a new admin-gated `/api/admin/students/invitations/[id]/resend` mirroring PR #912's onboarding-resend pattern. Never insert a second `studentInvitations` row on resend.

### What I found while exploring

**The ungated mutation is real.** `convex/studentInvitations.ts:103-115`:

```ts
export const updateStudentInvitationStatus = mutation({
  args: { id: v.id("studentInvitations"), status: v.union(...) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    await ctx.db.patch(args.id, { status: args.status });
    return args.id;
  },
});
```

The check is `identity !== undefined`. Any signed-in Clerk user can flip any invitation's status to `cancelled` / `accepted` / `pending` — `{ ok: false }` is **not** the blast radius here, but the data is mutable by anyone. Per spec: low blast radius, but worth gating now while we're touching it.

**The resend pattern is well-trodden.** `apps/platform/app/api/admin/onboardings/[id]/resend-invitation/route.ts` + `convex/adminOnboarding.ts:704-771` together:
- Mint fresh Clerk invite FIRST (so a Clerk failure doesn't strand the student with no link).
- Patch the row's `clerkInvitationId` (and `perInstructor[i].clerkInvitationId` for non-renewal pairs).
- Append a timeline entry.
- Write an `audit` log row.
- Best-effort revoke the prior Clerk invite AFTER the save.
- Chain `retryAdminOnboarding` if prior status was `failed`.

For `studentInvitations` the analog is simpler — there are no pairs, no timeline, no `retry` step. The spec wants:
- Revoke prior Clerk invitation best-effort.
- Mint new Clerk invitation (`createStudentClerkInvitation` in `apps/platform/lib/clerk-invitations.ts:105-140`).
- Update the `studentInvitations` row's `clerkInvitationId`, `expiresAt`, and reset `status` to `pending`.
- **Never create a second `studentInvitations` row.** Use `ctx.db.patch` on the existing row.

**`createStudentInvitation` (`studentInvitations.ts:64-97`) already gates itself** with a "rows already exist for `(email, instructorId)`" check at lines 76-85 — but only when that row is `pending` AND not expired. So the cleanest path for resend is to bypass that guard and patch the row directly (the row already exists and the guard would block a re-create, which is exactly what we want).

**The list query (`listStudentInvitations`, `studentInvitations.ts:8-58`) is also ungated** — reads should also be `requireAdminOrSupport`-gated for consistency. Boundary: it currently returns `[]` for unauthenticated only; any signed-in user gets everyone's invitations. **Recommendation:** add the same gate to `listStudentInvitations` (admin/support only). The existing `GET /api/admin/students/invite` route already requires admin, so this only matters for direct Convex calls — tightening it stops the same blast radius from being readable.

### Proposed scope

Two PR-blocks or one PR — recommend one PR (each mutation is small, they land together cleanly):

1. **Gate the existing mutations + queries (`convex/studentInvitations.ts`):**
   - Add a private `requireAdminOrSupport(ctx)` helper mirroring `convex/adminOnboarding.ts:152-163` (which is the canonical "admin or support" gate already used for the resend pattern).
   - Gate `updateStudentInvitationStatus`, `updateStudentInvitationClerkId`, `listStudentInvitations`, `createStudentInvitation`, and `migrateInvitation` on it. `migrateInvitation` is admin-only today in spirit but should match. `createStudentInvitation` only called from the `/api/admin/students/invite` admin-gated route today — second line of defense.
   - The gate throw message: `"Forbidden: admin or support role required"` (match `adminOnboarding.ts:227`).

2. **Resend mutation (`convex/studentInvitations.ts`):**
   - New public mutation `resendStudentInvitation({ invitationId })` gated on the helper.
   - Patch the row's `clerkInvitationId` (`newClerkInvitationId` placeholder — actual mint happens in the route), `expiresAt = now + 7 days`, `status = "pending"`.
   - **Idempotency:** refuse if `currentStatus !== "pending"` to match the onboarding-resend "Cannot resend from terminal status" pattern (`adminOnboarding.ts:718-722`). The onboarding-resend refuses on `completed` / `cancelled`; here the spec implies the row status gates the button visibility (`PendingInvitationsCard` already has a status filter). **Open question:** should the resend mutation refuse on `accepted` only (since `cancelled` rows are not pending and the route's UI never offers the button on them, but if someone calls directly with `cancelled` we should refuse). I'll gate on `status !== "cancelled" && status !== "accepted"` — pending + expired are resendable.
   - No timeline event (the table doesn't have one). Pair with an `auditLogs` write — same shape as the onboarding-resend (`convex/adminOnboarding.ts:749-762`).

3. **Resend route (`apps/platform/app/api/admin/students/invitations/[id]/resend/route.ts`):**
   - Mirror the onboarding-resend middleware plumbing:
     - `await requireRoleForApi("admin")` (existing helper).
     - Validate `id` with `convexIdSchema`.
     - Load the row via `convex.query(api.studentInvitations.listStudentInvitations, ...)` — but that's now gated; **use a new `internalQuery`** named `getStudentInvitationById` (admin-only path) so the route can read the row without going through the public list. Or add an `includePrivate: true` mode. Recommendation: separate internal query, mirroring `adminOnboarding.getAdminOnboardingInternal` (`adminOnboarding.ts:859-864`).
     - Verify `NEXT_PUBLIC_APP_URL` is set FIRST (Greptile P1-from-onboarding-resend).
     - Mint new Clerk invite via `createStudentClerkInvitation`.
     - Call new mutation.
     - Best-effort `client.invitations.revokeInvitation(prev)` AFTER save success.
   - **Error mapping:** 401/403/400/404/409 (terminal status) mirror onboarding-resend.

4. **Cancel route (`apps/platform/app/api/admin/students/invitations/[id]/cancel/route.ts`):** optional — could just call the gated `updateStudentInvitationStatus` directly. **Recommendation:** call the mutation directly from the client once gated. The onboarding-resend is a route because it needs Node-runtime Clerk SDK access; cancel doesn't.

   - **Open question:** the spec says "wire to updateStudentInvitationStatus". I'll wire it directly (no new route needed). If we want a server-side audit-log for cancel, add an `auditLogs` write in the mutation itself.

5. **UI (`apps/platform/app/admin/students/invite/page.tsx:262-311`):**
   - Add a Resend button and a Cancel button (with confirmation dialog) per pending row, only when `invitation.status === "pending"`.
   - Add a hidden / disabled state for the action row when status is `accepted` / `expired` / `cancelled` (hide entirely per spec wording — these are pending-card actions).
   - Cancel: calls `convex.mutation(api.studentInvitations.updateStudentInvitationStatus, { id, status: "cancelled" })` directly from the React Query client.
   - Resend: `apiFetch` against the new route, on success invalidate `["student-invitations", statusFilter]`.
   - Add `aria-label`s on the new icons and a small toast on success / failure (the rest of the codebase uses `Console.error` / inline error UI — match the existing pattern, don't reach for a global toast lib).
   - **Open question:** the existing `queryKey` for the list is `["student-invitations", statusFilter]`. The mutation result for cancel flips status to `cancelled` — that row disappears from the `pending` filter and reappears under `cancelled` — invalidate ALL pending-related queries. The cleanest fix is to invalidate the global `["student-invitations"]` namespace. Tiny perf cost, simpler code.

6. **Audit log scope:**
   - Both mutations (`resendStudentInvitation`, `updateStudentInvitationStatus`) write to `auditLogs` mirroring `adminOnboarding.resendAdminOnboardingInvitation` style. Tags: `targetType: "studentInvitation"`, `action: "resend_student_invitation"` / `"cancel_student_invitation"`.

7. **Out of scope:**
   - Bulk resend/cancel.
   - Email-link-from-UI shortcut (the spec keeps the Resend email as the "send again" mechanism — no in-app email viewer). Good.
   - A "Re-send pre-acceptance reminder" cron for expired + high-age pending rows.

### Verification
- Strict unit test: call `updateStudentInvitationStatus` as a non-admin user → throws `Forbidden`. Confirms the gate.
- End-to-end: as admin, cancel a pending invitation → it disappears from `pending` filter, appears under `cancelled`.
- End-to-end: as admin, resend a pending invitation → new `clerkInvitationId` on the row, prior `clerkInvitationId` revoked in Clerk.
- Negative: try cancel/resend as a non-admin → 403.

### Exploitation assessment (per spec footnote)
- `updateStudentInvitationStatus` is currently writable by any signed-in user. Capability scope: only `studentInvitations.status` patches. A miscreant could flip an invitation from `pending` to `cancelled` to prevent a legit student from signing up, or flip from `cancelled` to `pending` to revive one and confuse admins. **Low blast radius but real.** The gate closes it.
- `updateStudentInvitationClerkId` is the same shape — could redirect an invitation to a different Clerk id if abused. **Same fix:** gate it.
- `listStudentInvitations` reads all invitations. Privacy leak (PII: student emails). **Same fix:** gate it.

---

## Issue 4 — `/workspace` sidebar shows only one workspace

### What the spec says
`apps/platform/app/workspace/[id]/page.tsx` passes `workspaces={[workspace]}` — a one-element array — so the sidebar can only render the current workspace. Fetch the full list (matching the picker route) and pass it as `workspaces` while keeping the existing `getWorkspaceByIdForUser` redirect.

### What I found while exploring

`apps/platform/app/workspace/[id]/page.tsx:99-108`:
```tsx
<WorkspaceClientPage
  clerkUserId={clerkUserId}
  workspaces={[workspace]}
  userRole={userRole}
  initialWorkspaceId={workspaceId}
  initialJoinSessionId={joinSessionId}
  initialVideoSessionId={videoSessionId}
/>
```

`WorkspaceClientPage` (`components/workspace/workspace-client-page.tsx:313-352`) renders the sidebar from the `workspaces` prop via `.map`. With `[workspace]`, only one entry.

The picker route (`app/workspace/page.tsx:39-43`) already calls `api.workspaces.getUserWorkspaces({ ownerId: clerkUserId })` and passes the full array. The spec is exactly right — this is a one-line fix in `[id]/page.tsx`. The cost is one extra convex `getUserWorkspaces` query per page mount.

**Interaction with Issue 2 (archive):** if Issue 2 lands first, the new `includeArchived` plumbing means this `getUserWorkspaces` call should pass `includeArchived: false` (the sidebar should match the picker default). If Issue 2 hasn't shipped yet, this PR uses the existing `getUserWorkspaces` and is independent of the archive work — order them Issue 4 first or last, doesn't matter.

### Proposed scope

One PR, tiny:

1. **`apps/platform/app/workspace/[id]/page.tsx`:**
   - After fetching `workspace = api.workspaces.getWorkspaceByIdForUser(...)`, also fetch `api.workspaces.getUserWorkspaces({ ownerId: clerkUserId })` (includeArchived false — matches the picker route's default).
   - Pass the full array as `workspaces`. Keep `initialWorkspaceId={workspaceId}` so the deep-link from a notification lands in the right tab.
   - The existing not-found redirect via `if (!workspace) redirect("/workspace")` stays put.

2. **Out of scope:**
   - Refactoring `WorkspaceClientPage` sidebar to toggle "show archived" — that's Issue 2.
   - Adding a workspace-create shortcut from the sidebar — out of band.

### Verification (PR-C — Issue 2)
- `pnpm --filter @mentorships/platform typecheck && pnpm --filter @mentorships/platform build`.
- Manual scenarios (impersonate via `clerk impersonate user_… --open`):
  1. Instructor with 2+ ACTIVE workspaces → archives one via the header button → dashboard's Archived Workspaces card shows the row, sidebar still shows all (muted entry), picker still shows all (muted entry).
  2. Open the archived workspace → header shows "Archived" badge + an Unarchive button → click Unarchive → workspace returns to active state in all three surfaces.
  3. Instructor with 1 active + 0 archived → picker still auto-redirects into the one workspace.
  4. Instructor with 0 active + 1 archived → picker lists the one workspace (muted), does NOT redirect.
  5. `resolveActiveWorkspaceForPair` smoke check: instructor + student pair with an archived worksite → `getInstructorStudentsWithRemainingSessions` returns the row with `workspaceId: null` (no auto-bookable workspace).
  6. `getWorkspaceBySessionPackId` smoke check: student with an active pack on an archived worksite → returns `null`.

### Verification (PR-A — Issue 4)
- `pnpm --filter @mentorships/platform typecheck && pnpm --filter @mentorships/platform build`.
- Manual: instructor with 2+ workspaces, navigate directly to `/workspace/{any-one-of-them}` via deep link → sidebar shows all.
- Manual: in-call switch confirmation still works (the existing `pendingSwitchTo` state in `WorkspaceInner:282-294` is preserved because we're passing the same props shape).
- Manual: with one workspace, the existing single-workspace redirect at `app/workspace/page.tsx:45-47` still works.

---

## Implementation order

Status (updated 2026-10-13T21:23Z):
- **PR-A (Issue 4)** — **MERGED** as #927 (squash merge, commit `756321d5`, mergedAt 2026-10-13T21:22:53Z). Branch `feat/workspace-sidebar-fix` deleted locally and on origin. Final diff: 2 files, +66/-9 in `apps/platform/app/workspace/[id]/page.tsx` and `apps/platform/components/workspace/workspace-client-page.tsx`. No Linear Verify issue warranted per AGENTS.md (low-blast-radius display/prop change — no schema, no auth, no workflow touch). Final local Greptile confidence 5/5 after P2 comment-text trim; CodeRabbit skipped per AGENTS.md OSS < 10 stars.

I recommend the following order across separate PRs (each PR = one mergeable unit + one Greptile review). Each PR is post-merge-verified per the convention.

1. **PR-A: Issue 4** (sidecar fix, ~1 hour of work). Lowest blast radius. Decouples the sidebar work from the archive work.
2. **PR-B: Issue 3** (invite gates + resend + cancel UI). Has its own scope creep risk (admin-only ingress). Keep in one PR but flag as a "high-blast-radius PR" for the Linear issue.
3. **PR-C: Issue 2** (workspace archive/unarchive). Largest PR shape; expect Greptile round-trip on the schema add.
4. **PR-D: Issue 1** (dashboard display + sync data-side). Last because it is the only PR where the spec has data-side risk; we want the rest of the dashboard rest clean first.
5. **PR-E: Issue 5** (notification email deep-link auth-flow). Standalone after A-D merge for clean blast-radius isolation. Differs from the dashboard fixes because it's auth-flow adjacent (touches `/auth-redirect` route handler + email composition). Warrants its own `Verify "..." on prod` Linear issue at PR-open time per AGENTS.md convention.

Alternative: combine 2 + 4 in a single PR if the team wants faster Q/A cycles. I recommend separate PRs.

## Open questions blocking implementation

Resolved above (commit to these unless pushback in the next session): per-type archive gating (mentorship = participant; `admin_*` = admin-only); `getUserWorkspaces` excludes archived by default and the picker auto-redirect gates on `archivedAt === undefined`; `by_instructorId_archivedAt` declared unstaged.

**Still open** (could push back on these before any PR-D merge):

- **Issue 1 sync path-of-record:** wire `/api/auth/sync` into `apps/platform/lib/providers/query-provider.tsx`'s `AuthDrivenInvalidator` (per-`(userId, role)` tuple POST with `inFlightRef`, matching `apps/marketing/lib/providers/query-provider.tsx:127`) AND append `syncUser` to `clerk-user-linking.ts`'s `user.created` step as a backfill. Recommendation: both. Tradeoff is a small per-mount latency cost vs. eventual-consistency window when a student lands on `/instructor/dashboard` directly after signup. If the operator wants one path only, recommend the client-side effect (synchronous-of-record) over the Inngest-only path.
- **Issue 1 stale-account migration:** the two test accounts that Issue 3 makes cancellable may also lack `users` rows. After Issue 3 PR merges and those rows are cancelled, decide whether to write a one-off `internal/migrate-stale-accounts` mutation callable from a `convex/deploy` invocation, per the migrations precedent in `convex/migrations.ts`. Acceptable to defer — the `Unnamed student` UI display is graceful regardless of `users` row presence.

## Files we'll touch (one big map)

```
convex/
  schema.ts                         # Issue 2 (archivedAt, archivedBy, by_instructorId_archivedAt)
  workspaces.ts                     # Issue 2 (4 new mutations, archive-aware filter helpers, getWorkspaceBySessionPackId update)
  studentInvitations.ts             # Issue 3 (gate 5 mutations/queries, resendStudentInvitation mutation)
  users.ts                          # Issue 1 (data-side — verify syncUser correct, optional email-on-update fix)
  auditLog.ts (existing)            # Issue 3 (re-use existing writeAuditLog)

apps/platform/
  app/workspace/[id]/page.tsx       # Issue 4 (full workspaces array)
  server-side render cost +1 query  # Issue 4 (getUserWorkspaces on every mount)
  app/instructor/dashboard/InstructorDashboardContent.tsx  # Issue 1 display
  lib/providers/query-provider.tsx  # Issue 1 sync trigger
  app/admin/students/invite/page.tsx# Issue 3 UI (Resend + Cancel buttons)
  app/api/admin/students/invitations/[id]/resend/route.ts (NEW)  # Issue 3 resend route
  components/admin/student-invitation-row.tsx (NEW, optional)    # Issue 3 row component if we want to break out
  components/workspace/workspace-rename-title.tsx        # Issue 2 archive icon
  components/workspace/workspace-client-page.tsx         # Issue 2 archived badge + sidebar
  components/workspace/archived-workspace-badge.tsx (NEW, optional)  # Issue 2 badge component
  app/workspace/page.tsx                                 # Issue 2 archived tab (if added)
  convex/inventoryBackfill.* (or migrations)            # Issue 1 backfill + Issue 3 stale test account migration

packages/emails/src/
  auth-redirect-link.ts (NEW)              # Issue 5 (buildAuthRedirectUrl helper)
  ad-hoc-call.ts                           # Issue 5 (route ?join= link through /auth-redirect)
  ad-hoc-call.test.ts                      # Issue 5 (update deep-link assertions)
  recording-ready.ts                       # Issue 5 (route ?videos= link through /auth-redirect)

apps/platform/
  app/auth-redirect/page.tsx               # Issue 5 (extend resolveRequestedRedirect whitelist to /workspace/)
```

## Risks I'm calling out

- **Issue 1 spec gap:** the spec mentions "verify /api/auth/sync → syncUser actually populates users" but does not explicitly cover the **email-on-update** bug (`syncUser:522-563` only sets `email` on insert). This is a separate data-quality issue that pairs with Issue 1 but is not strictly in scope. Surface for the spec author.
- **Issue 2 archive semantics vs retention:** an archived workspace that has `endedAt !== undefined` is in retention — should we let it be archived, or hide archive behind `(endedAt === undefined)`? I recommend: allow — archive is independent of retention status.
- **Issue 3 audit log:** the `convex/studentInvitations.ts` mutations currently don't write audit log rows. Adding them is good hygiene but is a behavior change visible to anyone grepping for `audit`. Document in PR body.
- **Issue 4 typecheck risk:** the `UserWorkspace` type in `workspace-client-page.tsx:47-57` is loose (`name?: string`, etc.); widening `workspaces` could surface tsc errors if we type the field strictly. Read the type before writing `workspaces={getUserWorkspaces}`.

## Issue 5 — Notification email deep links don't survive sign-in

(Logged by the instructor after the PR arc started; folded into the scope here as PR-E.)

### What the spec says

> the instructor informed me that notification emails that link to the workspace do not work correctly (and probably the same for students). It should be some form of Magic link that automatically signs them in and brings them to the correct workspace

### What I found

The bug is real but the *mechanism* misnamed. The auth part already works (users can sign in via Clerk normally, with session cookies). What's broken is **destination preservation** during the signed-out → signed-in round-trip:

1. **Email composition point** — `packages/emails/src/recording-ready.ts:49` and `packages/emails/src/ad-hoc-call.ts:50` build the link as a bare `${baseUrl}/workspace/{workspaceId}?videos={sessionId}` or `?join={sessionId}` deep link. No auth-redirect wrapping.
2. **Signed-out bounce** — `apps/platform/proxy.ts:361-363` forwards the request to `/sign-in?redirect_url=<req.url>` when a protected route is hit unauthenticated.
3. **Sign-in round-trip** — after Clerk processes sign-in, control lands on `apps/platform/app/auth-redirect/page.tsx`. That route is intended to forward the user to the original destination.
4. **Silent destination drop** — `resolveRequestedRedirect` at `auth-redirect/page.tsx:140-159` only whitelists paths starting with `/onboarding/`. Anything else (including `/workspace/...`) is silently dropped, and the user falls through to the role-driven default (`/dashboard` for students, `/instructor/dashboard` for instructors).

So the visible symptom is: "I click a recording email, I sign in, I land somewhere that isn't the workspace named in the email." It's not a missing magic link — it's a dropped URL during the auth bounce.

The same Greptile-flagged pattern was already fixed for onboarding (search `Greptile round-23 P2 #1` in `auth-redirect/page.tsx:127-138` and `Greptile P1 #11` in `onboarding-questionnaire-reminders.ts:173-181`). The fix never extended to `/workspace/` because no email pointed there before this arc surfaced the bug.

### What we're NOT doing

- **No new magic-link issuance.** The existing `apps/platform/lib/clerk-magic-links.ts:120-123` (`email_link` strategy via Clerk Backend API) stays a no-touch module. We're not adding a new dispatch path; we're just routing the existing destination through `/auth-redirect`.
- **No Clerk config changes.** AGENTS.md Clerk Do-Not-Touch is not implicated: no `ClerkProvider` props, no env vars, no dashboard-domain wiring touched. The change is in `apps/platform`'s route handler + email composition, same scope as the Greptile-approved onboarding fix.
- **No `session-changes.ts` or `booking.ts` updates.** Those send to `/calendar` and `/instructor/dashboard` — both happen to be the role-driven default, so they work by accident today. Out of scope for PR-E; flag as a separate cleanup.

### Proposed scope (PR-E)

1. `apps/platform/app/auth-redirect/page.tsx:140-159` — extend the `resolveRequestedRedirect` whitelist to accept paths starting with `/workspace/` in addition to `/onboarding/`. Keep the safety checks (must `startsWith("/")`, not start with `/workspace/../`).
2. New helper `packages/emails/src/auth-redirect-link.ts` — exports `buildAuthRedirectUrl(baseUrl: string, target: string) => string` returning `${baseUrl}/auth-redirect?redirect_url=${encodeURIComponent(target)}`. Single source of truth so future emails don't hand-roll the wrapping.
3. `packages/emails/src/recording-ready.ts:49` and `ad-hoc-call.ts:50` — replace `${getBaseUrl()}/workspace/...` direct links with `${buildAuthRedirectUrl(getBaseUrl(), '/workspace/...?videos=...')}` calls. Update the JSDoc comments to reflect the new convention.
4. Tests:
   - Extend `packages/emails/src/ad-hoc-call.test.ts:20-26` to assert the output contains `/auth-redirect?redirect_url=%2Fworkspace%2F...%3Fjoin%3D...` (not a bare `/workspace/...?join=...`).
   - Add a unit test for `recording-ready.ts` symmetry (the file doesn't appear to have a test today; flag if review rejects new test file).
5. Linear `Verify "Notify magic link email deep-link on prod"` issue at PR-open time per AGENTS.md convention (with `auth-change`-adjacent label since it touches how auth-bounced URLs are resolved).

### Verification

- `pnpm --filter @mentorships/platform typecheck && pnpm --filter @mentorships/platform build`.
- `pnpm --whole-repo typecheck && pnpm --whole-repo lint` (the new file lives in `packages/emails`, not apps/platform alone).
- Unit tests: existing test runner on `packages/emails/src/*.test.ts`, plus the new assertions above.
- End-to-end archive-ready scenarios (post-merge verification, on the staging URL):
  1. Signed-out instructor receives a recording-ready email for workspace `wA`. Click the link → land on `/auth-redirect?redirect_url=/workspace/wA?videos=sX` → land on `/sign-in?redirect_url=%2Fworkspace%2FwA%3Fvideos%3DsX`. After Clerk sign-in, control returns to `/auth-redirect?redirect_url=/workspace/wA?videos=sX` (NOT into `/auth-redirect` first — it goes to the deeper URL directly via Clerk). Eventually arrive at `/workspace/wA?videos=sX` with the workspace chrome rendering the videos tab.
  2. Repeat #1 for an ad-hoc-call email (`?join=...`). Should land on `/workspace/wA?join=sX` with the auto-join UI per the existing PR #4c-2 wiring.
  3. Repeat #1 but signed-in: user clicks the link in their inbox. Already authenticated, no bounce. Still lands on `/workspace/wA?videos=sX` (skips `/auth-redirect` because the middleware sees auth and passes through). Verify by impersonating `clerk impersonate` with a session cookie active; the deep link works in one click.
  4. Tampering check: an attacker constructs `/auth-redirect?redirect_url=https://evil.example.com/foo` and clicks the link. The current `resolveRequestedRedirect` `startsWith("/")` guard already rejects non-relative URLs. Confirm in unit-test coverage that `https://...` returns `null` (so the post-`/auth-redirect` redirect goes to `/sign-in` and falls through to role-default).
- Cross-app health: `/onboarding/...` deep links unaffected.

### Out of scope (PR-E)

- Updating `/calendar` and `/instructor/dashboard` email links for routing-uniformity. They work today by accident; would be a soft followup.
- Extending the `/auth-redirect` whitelist to include `/calendar/`, `/instructor/...`, `/admin/...` beyond `/workspace/`. Conservative per operator's choice — minimum footgun surface, addresses the actual reported bug.
- Re-issuing magic links at the existing send sites (`process-stripe-checkout.ts`, `process-paypal-checkout.ts`). Not needed.

## PR-merge policy recap

Per `AGENTS.md`: every PR must clear at least one bot review (Greptile primary; CodeRabbit fallback). Each PR in this plan touches a high-blast-radius surface — they all warrant a Linear `Verify "..." on prod` issue opened at PR-open time per the post-merge verification convention. Specifically:

- PR-C (Issue 2 schema change) → schema-change label, verification issue, "exercise archive/unarchive on every workspace type".
- PR-B (Issue 3 ungated-mutation fix) → security-change label, verification issue, "confirm the cancel button works in prod".
- PR-A (Issue 4) → not high-blast-radius; doesn't warrant a verification issue on its own.
- PR-D (Issue 1) → not high-blast-radius; verification issue lists the two stale test accounts and whether their `users` rows got synced.
- PR-E (Issue 5 email-deep-link auth-flow) → warrants verification issue because /auth-redirect is auth-adjacent; label "auth-change" (or "url-forwarding" if you prefer the lower-stakes framing). Verification scenarios listed under Issue 5 above.
