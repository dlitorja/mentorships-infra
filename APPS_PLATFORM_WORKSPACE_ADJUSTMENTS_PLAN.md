# apps/platform Workspace Adjustments — Implementation Plan

**Date:** 2026-08-25
**Scope:** `apps/platform` workspace UX and permissions for student and instructor users.
**Naming convention:** Continue using `instructor` / `student` (no `mentor` / `mentee`).

## 1. Goals

1. Allow **both students and instructors** to start an ad-hoc workspace call.
2. Do **not auto-join** a user who opens a workspace while a call is already running; instead show a clear "call in progress" indicator and a prominent **Join** button.
3. Make the **Start / Join call button** larger and visually prominent.
4. Show the **session count pill to students** in the workspace, but keep it read-only (no edit UI or buttons).
5. Fix the reported failure when an instructor starts a call **without recording**.
6. Investigate why **Daily.co dashboard recordings are not appearing** in the workspace Videos tab.
7. Simplify the sidebar for instructor/student users to only **Workspace** and **Dashboard**, with **Workspace first**.

## 2. Detailed Plan

### 2.1. Open workspace calls to students ✅

#### Server-side
- `convex/sessions.ts` — `startAdhocCall`
  - Currently authorizes only the workspace’s instructor (`VIDEO_FORBIDDEN_NOT_INSTRUCTOR`).
  - Change to also allow the workspace owner (student): `workspace.ownerId === identity.subject`.
  - Keep the active-call guard and ad-hoc self-heal, but allow either party to be the initiator.
  - Return a new `VIDEO_FORBIDDEN_NOT_PARTICIPANT` error when the caller is neither the instructor nor the owner.
- `convex/sessions.ts` — `deleteOrphanedAdhocSession`
  - Currently checks that the caller is the instructor. Update to allow the owner (student) as well, since they may be the party that starts the call and triggers the cleanup path.
- `convex/inCallNotifications.ts` — `createAdHocCallNotification`
  - Inspect the recipient logic. If the student started the call, the notification should go to the **instructor** rather than the student.
- `apps/platform/app/api/video/start-adhoc/route.ts`
  - Update the error branch for `VIDEO_FORBIDDEN_NOT_INSTRUCTOR` → `VIDEO_FORBIDDEN_NOT_PARTICIPANT`.
  - Ensure the `after()` notification/email block still works when the initiator is a student.

#### Client-side
- `apps/platform/components/workspace/workspace-client-page.tsx`
  - Remove the `userRole === "instructor"` gate around `<StartAdhocButton>`.
- `apps/platform/components/video/start-adhoc-button.tsx`
  - Remove the `if (role !== "instructor") return null;` guard.
  - Keep the consent modal flow. The button should be visible to both roles.
- `apps/platform/components/video/call-status-pill.tsx`
  - Remove the student-only "Waiting for instructor to start the call" pill for `joinable` sessions.
  - Show the **Join Call** button for both students and instructors when a session is `joinable`.

#### Auto-join behavior
- `apps/platform/components/video/video-call-provider.tsx`
  - Remove the unconditional auto-join effect that fires whenever `session.status === "active"`.
  - Replace it with a gated **"requested join"** flag:
    - Track `requestedJoinSessionId` in the provider.
    - The `join` context function marks the call started (if needed) and sets `requestedJoinSessionId`.
    - Only when the user explicitly requested the join (or used a deep-link) and the session becomes active will the provider auto-join.
  - Initialize `requestedJoinSessionId` from `initialJoinSessionId` so deep-links still work.
- `apps/platform/lib/video/video-context.tsx`
  - Remove the `session.status === "active"` clause from `useIsCallOverlayVisible()` so the call overlay does not appear until the user actually clicks Join/Start and `call.status` becomes `joining` / `joined` / `leaving`.

### 2.2. Larger, more prominent Start / Join call button ✅

- Create a single combined `WorkspaceCallAction` component in `apps/platform/components/video/workspace-call-action.tsx` (or fold into `call-status-pill.tsx`) that renders **one** large status card/button instead of the current separate `CallStatusPill` + `StartAdhocButton` pair.
- States:
  - **No active session** → large primary button: **“Start video call”** (both roles).
  - **Joinable session** → status indicator **“Call is ready”** + large primary button **“Join video call”**.
  - **Active session** (not yet joined locally) → status indicator **“Call in progress”** + large primary button **“Join video call”**.
  - **Error** → red error chip + large **Retry** button.
  - **Scheduled session** → countdown chip + disabled **Scheduled** button.
- Styling: use `size="lg"`, bold text, a clear video icon, high-contrast primary color, and enough vertical padding so the action is the obvious call-to-action in the workspace header.
- Keep the existing consent modal flow before any join/start action.
- Remove the now-redundant `StartAdhocButton` from the action row when a session already exists (the unified component handles it).

### 2.3. Read-only session count for students ✅

- `apps/platform/components/workspace/session-count-controls.tsx`
  - Add a `readOnly?: boolean` prop.
  - When `readOnly` is true, render only the rounded pill with the remaining-session count and total; do **not** render the pencil / reset icons or the edit/reset dialogs.
  - Keep the polling/optimistic logic inactive when read-only (no PATCHes should be attempted).
- `apps/platform/components/workspace/workspace-client-page.tsx`
  - Render `<SessionCountControls>` for **both** roles when `selectedWorkspace.sessionPackId` exists.
  - Pass `readOnly={userRole !== "instructor"}`.
- The server-side `PATCH /api/instructor/session-packs/[sessionPackId]` already rejects non-instructors, so this is a UI hardening change.

### 2.4. Fix starting a call without recording ✅

Root-cause hypothesis: `apps/platform/lib/daily.ts` sends `enable_recording: "off"` to Daily when `recordingEnabled` is false. Daily’s `POST /rooms` endpoint only accepts `enable_recording: "cloud"` or `"local"`; `"off"` is not a documented value and likely causes the room creation to fail or be misinterpreted.

- `apps/platform/lib/daily.ts` — `createDailyRoom`
  - When `recordingEnabled` is false, **omit** the `enable_recording` property from the room creation body instead of sending `"off"`.
- `apps/platform/lib/daily.ts` — `resolveDailyRoom` / `patchDailyRoomProperties`
  - In the 409-recovery PATCH, only set `enable_recording: "cloud"` when enabling. When disabling, **omit** the property rather than sending `"off"`.
  - Note: an existing room that was previously created with recording enabled may keep `enable_recording: "cloud"`, but no recording will start because the meeting token will not include `start_cloud_recording` when consent is false.
- `apps/platform/app/api/video/consent/[sessionId]/route.ts`
  - Update the `patchDailyRoomProperties` call to omit `enable_recording` when the new desired value is false, or only patch to `"cloud"` when true.
- Add/update tests to assert that a `recordingConsent: false` ad-hoc start succeeds and creates a room without `enable_recording`.

### 2.5. Investigate Daily recordings not appearing in the Videos tab ✅ (fallback implemented)

The Videos tab is driven by `convex/sessions.ts:getCallRecordingsForWorkspace`, which returns rows with `recordingUrl` or `recordingTransferStatus`. If Daily dashboard shows recordings but the tab stays empty, the most likely causes are webhook delivery failure or the B2 transfer pipeline not completing.

- **Root cause identified:** webhooks are configured by ops, but the code cannot confirm they are delivered. The invalid `enable_recording: "off"` bug (fixed in 2.4) could also prevent a call from ever starting, but once a call is recorded on Daily, the missing UI rows are almost certainly missed webhooks.
- **Implemented fallback:**
  - New query `convex/sessions.ts:getSessionsMissingRecordingsForWorkspace` lists sessions with a Daily room but no attached recording.
  - New query `convex/sessions.ts:canSyncRecordingsForWorkspace` gates the UI by the same auth rules.
  - New route `apps/platform/app/api/video/recordings/sync/route.ts` queries the Daily `/recordings` REST API for each missing room and replays a synthetic `recording.ready-to-download` webhook through the existing HMAC-verified action, triggering the normal B2 transfer pipeline.
  - New `apps/platform/lib/daily.ts:getDailyRecordingsByRoomName` helper wraps the Daily API.
  - New `apps/platform/lib/daily.ts:signDailyWebhookPayload` helper reuses the same HMAC signing used by the test-bypass path.
  - `apps/platform/components/workspace/calls-tab.tsx` now shows a **“Sync recordings”** button for the instructor or workspace owner when recordings are missing.
- **Remaining ops-side checks:**
  - Confirm the Daily dashboard webhook URL points to the deployed endpoint (`/api/webhooks/daily/recordings` or the edge-function route).
  - Confirm `DAILY_WEBHOOK_SECRET` is set and matches the base64 secret in the Daily dashboard.
  - Check production logs for `webhooks/daily` errors (missing signature, HMAC failure, unknown room).
  - Confirm `TRIGGER_SECRET_KEY` / `TRIGGER_API_KEY` and Backblaze B2 credentials are configured.

### 2.6. Sidebar: only Workspace and Dashboard for instructors and students ✅

- `apps/platform/components/navigation/protected-layout.tsx`
  - For instructors: `navItems = [Workspace, Dashboard]` (remove `My Sessions`, `Availability`, `Onboarding`, `Profile`, `Settings`).
  - For students: `navItems = [Workspace, Dashboard]` (remove `Sessions`, `Calendar`, `Settings`).
  - Keep admin navigation unchanged (out of scope).
  - Preserve the notification bell in the sidebar footer.

### 2.7. Remove picture-in-picture button from workspace video call controls ✅

The PiP toggle in the in-call controls bar is causing UX problems and is not useful for mentorship calls. The responsive narrow-layout floating panel can remain, but the manual toggle must go.

- `apps/platform/components/video/video-controls.tsx` — remove the `PictureInPicture` icon button and its context destructuring.
- `apps/platform/lib/hooks/use-keyboard-shortcuts.ts` — remove the `p` → `onTogglePip` shortcut and the handler from the handlers object.
- `apps/platform/components/video/video-call-provider.tsx` — remove `onTogglePip` from the keyboard-shortcuts handlers object.
- `apps/platform/lib/video/constants.ts` — remove `togglePictureInPicture` from `VIDEO_SHORTCUTS`.

## 3. Files to touch

- `convex/sessions.ts`
- `convex/inCallNotifications.ts`
- `apps/platform/app/api/video/start-adhoc/route.ts`
- `apps/platform/app/api/video/consent/[sessionId]/route.ts`
- `apps/platform/lib/daily.ts`
- `apps/platform/components/workspace/workspace-client-page.tsx`
- `apps/platform/components/workspace/session-count-controls.tsx`
- `apps/platform/components/video/call-status-pill.tsx`
- `apps/platform/components/video/start-adhoc-button.tsx`
- `apps/platform/components/video/video-call-provider.tsx`
- `apps/platform/lib/video/video-context.tsx`
- `apps/platform/components/navigation/protected-layout.tsx`
- `apps/platform/components/workspace/calls-tab.tsx` (sync fallback UI)
- `convex/sessions.ts` (sync/queries)
- `apps/platform/app/api/video/recordings/sync/route.ts` (sync fallback API)
- `apps/platform/lib/daily.ts` (recording list + HMAC helper)
- `apps/platform/components/video/video-controls.tsx` (PiP button removal)
- `apps/platform/lib/hooks/use-keyboard-shortcuts.ts` (PiP shortcut removal)
- `apps/platform/lib/video/constants.ts` (PiP shortcut removal)

## 4. Acceptance criteria

1. Both students and instructors can start an ad-hoc call from the workspace.
2. When a call is already active, a user who opens the workspace sees a **“Call in progress”** indicator and a large **“Join video call”** button instead of being auto-joined.
3. The Start / Join call button is large, visually distinct, and clearly labeled.
4. Students see the session count pill in the workspace but cannot edit or reset it; no edit icons are shown.
5. Starting an ad-hoc call with recording declined succeeds and the call can be joined.
6. Recordings that appear in the Daily.co dashboard also appear in the workspace Videos tab, or the cause of the mismatch is identified and fixed.
7. Instructor and student sidebars show only **Workspace** and **Dashboard**, in that order, with Workspace at the top.

## 5. Open questions / assumptions

1. **Admin sidebar remains unchanged.** The requirement specifically targets instructor and student users.
2. **Notification bell stays in the sidebar footer.** It is not a navigation item.
3. **When a student starts an ad-hoc call, the in-app notification and email go to the instructor.** This is the natural inverse of the current instructor-starts flow.
4. **Recording-disabled rooms omit `enable_recording`.** Daily does not document `"off"`, so we avoid sending it.
5. **Deep-link auto-join still works.** We keep the `initialJoinSessionId` behavior but gate it through the new explicit-join flag.

## 6. Testing

1. `pnpm test` in `apps/platform` must pass.
2. `pnpm typecheck` and `pnpm lint` for the affected apps must pass.
3. Manually test the workspace call flow for both roles in a preview environment.
4. Send a test `recording.ready-to-download` event via the bypass route to confirm the webhook pipeline still attaches a recording row.
5. Verify the sidebar renders only Workspace and Dashboard for instructor and student accounts.