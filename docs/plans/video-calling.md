---
name: Video Calling
overview: Integrate Daily.co video calling into apps/platform workspaces with a 50/50 user-resizable hybrid split-panel UX, screenshare, and cloud recording stored on Backblaze B2, replacing Discord mentorship calls. Workspace content (Notes/Images/Links/Chat) is auto-tagged to the active session during a call so users can post things discussed without leaving the workspace. Daily's in-call chat is disabled in favor of the workspace Chat tab. Recording playback lives as a sub-section in the Notes tab.
todos:
  - id: daily-account-setup
    owner: user
    phase: 0
    content: Set up Daily.co account and API key
    status: pending
  - id: b2-iam-role
    owner: user
    phase: 0
    content: Configure B2 bucket IAM role for Daily.co recording storage
    status: pending
  - id: sdk-integration
    owner: agent
    phase: 1
    content: Add @daily-co/daily-react SDK to apps/platform
    status: pending
  - id: schema-content-sessionid
    owner: agent
    phase: 1
    content: Add sessionId foreign key to workspace_notes, workspace_links, workspace_images + callStartedAt/callEndedAt to sessions
    status: pending
  - id: recording-storage
    owner: agent
    phase: 1
    content: Add recording webhook (POST /api/webhooks/daily/recordings) and store recordingUrl in Convex
    status: pending
  - id: room-creation-api
    owner: agent
    phase: 2
    content: Create room creation API endpoint (POST /api/video/rooms)
    status: pending
  - id: token-generation
    owner: agent
    phase: 2
    content: Implement token generation with role derived server-side from authenticated session (GET /api/video/token/[roomName])
    status: pending
  - id: active-call-query
    owner: agent
    phase: 2
    content: Implement GET /api/video/active/[workspaceId] to determine if a call is live in a workspace
    status: pending
  - id: video-call-provider
    owner: agent
    phase: 3
    content: Create VideoCallProvider with Jotai atoms (panelMode, splitRatio, activeSessionId, callState, liveSessionNoteId)
    status: pending
  - id: hybrid-panel-ui
    owner: agent
    phase: 3
    content: Create VideoPanel with 50/50 default + draggable divider (min 360px/side) using react-resizable-panels; persist ratio to localStorage
    status: pending
  - id: picture-in-picture
    owner: agent
    phase: 3
    content: Create PictureInPicture floating component (bottom-right)
    status: pending
  - id: call-status-pill
    owner: agent
    phase: 3
    content: Create CallStatusPill in workspace header (live indicator, timer, participants)
    status: pending
  - id: waiting-room
    owner: agent
    phase: 3
    content: Create WaitingRoom UI for student admit by instructor
    status: pending
  - id: video-component
    owner: agent
    phase: 3
    content: Create video call component with DailyProvider, DailyVideo, controls (chat disabled)
    status: pending
  - id: workspace-mount
    owner: agent
    phase: 3
    content: Mount VideoPanel in workspace-client-page.tsx gated by active session
    status: pending
  - id: chat-tab-banner
    owner: agent
    phase: 3
    content: Add banner on Chat tab explaining it replaces Daily chat while a call is active
    status: pending
  - id: keyboard-shortcuts
    owner: agent
    phase: 3
    content: Wire keyboard shortcuts (Cmd/Ctrl+K quick capture, +Shift+L tag toggle, +Shift+H hide panel, +Shift+V toggle panel, +Shift+M mute, +Shift+S screenshare, Escape PiP)
    status: pending
  - id: mobile-narrow-viewport
    owner: agent
    phase: 3
    content: Implement narrow viewport (<900px: PiP-only, <600px: full-screen video with bottom-sheet workspace drawer)
    status: pending
  - id: session-integration
    owner: agent
    phase: 3
    content: Add "Join Video Call" button on session cards (both roles)
    status: pending
  - id: adhoc-call-api
    owner: agent
    phase: 4
    content: Implement POST /api/video/start-adhoc (instructor only, creates synthetic session)
    status: done
  - id: adhoc-call-ui
    owner: agent
    phase: 4
    content: Add instructor-only "Start ad-hoc call" button in workspace header
    status: done
  - id: recording-consent
    owner: agent
    phase: 4
    content: Add recording consent UI to session booking and call join flows
    status: done
  - id: auto-tag-content
    owner: agent
    phase: 4
    content: Update Notes/Images/Link composers to default sessionId tagging while a call is active, with untag toggle
    status: done
  - id: live-session-note
    owner: agent
    phase: 4
    content: Auto-create live session note on callStartedAt transition, pin at top of Notes tab
    status: done
  - id: clipboard-image-paste
    owner: agent
    phase: 4
    content: Add "Paste from clipboard" button on Images tab while a call is active
    status: done
  - id: quick-capture
    owner: agent
    phase: 4
    content: Create QuickCapture floating composer (Cmd/Ctrl+K) for text/link/clipboard-image → tagged Note/Link/Image
    status: done
  - id: recording-playback
    owner: agent
    phase: 4
    content: Add Calls sub-section in Notes tab with Play (modal video player) + Download (signed B2 URL) — deferred to PR #4c (Phase 5)
    status: done
  - id: signed-b2-ttl
    owner: agent
    phase: 5
    content: Implement signed B2 URL TTL policy (1h) + refresh-on-view + queued-during-playback — PR #4c-1
    status: done
  - id: student-notification-bell
    owner: agent
    phase: 5
    content: Add cross-workspace notification bell (sidebar) with count badge + dropdown + mark-all-read — PR #4c-2
    status: done
  - id: student-notification-row-badge
    owner: agent
    phase: 5
    content: Add per-workspace red-dot row badge on picker so context is preserved — PR #4c-2
    status: done
  - id: student-notification-toast
    owner: agent
    phase: 5
    content: Sonner toast + Web Audio chime + browser Notification API for new invites — PR #4c-2
    status: done
  - id: deep-link-route
    owner: agent
    phase: 5
    content: Add /workspace/[id]?join={sessionId} deep-link route + auto-join via VideoCallProvider.initialJoinSessionId — PR #4c-2
    status: done
  - id: notification-preferences-ui
    owner: agent
    phase: 5
    content: Add opt-in preferences card on /settings (sound + desktop, gated by browser permission state) — PR #4c-2
    status: done
  - id: adhoc-call-email
    owner: agent
    phase: 5
    content: Resend email via Trigger.dev with idempotency key on (sessionId, recipientUserId) — PR #4c-2
    status: done
  - id: resources-student-subpanel
    owner: agent
    phase: 5
    content: "Shared during current call" subpanel in Links tab for students (deferred from PR #4b) — PR #4c-3
    status: pending
  - id: mobile-narrow-viewport
    owner: agent
    phase: 7
    content: Implement narrow viewport (<900px: PiP-only, <600px: full-screen video with bottom-sheet workspace drawer)
    status: pending
---

# Video Calling Integration (Daily.co + Backblaze B2)

## Goal

Replace Discord mentorship calls with integrated Daily.co video calling that lives inside `/workspaces` for **all user types** (instructors and students). The workspace tabs (Chat, Notes, Images, Links, Resources) remain fully usable during a call so users can post things discussed without leaving the page.

Key behaviors:

- **Hybrid split-panel UX** — 50/50 default, user-resizable, draggable divider (min 360px per side), ratio persisted to `localStorage`.
- **Screenshare** for both instructors and students.
- **Cloud recording** stored directly to Backblaze B2, playback lives as a sub-section inside the Notes tab.
- **Auto-tag workspace content to the live call** — anything posted in Notes/Images/Links during a call is automatically tagged with the `sessionId` (untag-able in the composer).
- **Quick capture composer** (`Cmd/Ctrl+K`) — floating overlay while a call is active for fast text/link/clipboard-image capture without leaving the call.
- **Auto-created live session note** — a Notes row is created when the call starts, pinned at the top of the Notes tab while the call is active.
- **Daily's in-call chat is disabled** — the workspace Chat tab replaces it (persistent thread that survives the call).
- **Waiting room** for controlled student entry.
- **Role-based permissions** (instructor = owner, student = participant).
- **Ad-hoc calls** — instructor only, for catch-up calls outside scheduled sessions (creates a synthetic session record).
- **Picture-in-Picture mode** for minimized video when not actively using call.
- **Mobile / narrow viewport** support — PiP-only below 900px, full-screen video with bottom-sheet workspace drawer below 600px.

## Status

**Plan approved. PR #1 → PR #5 shipped. Hotfix PR #607 (identity.subject vs tokenIdentifier) landed before PR #5.**

- Plan merged via PR #593.
- Instructor-dashboard `seatReservations` query P2s + Instructor Call Flows section landed via PR #594 (commit `803313ca`).
- **PR #1 (Phase 1) — shipped.** Schema additions for Daily.co call metadata + recording webhook handler at `/api/webhooks/daily/recordings`. Webhook security (HMAC-SHA256, base64-decoded secret, `crypto.timingSafeEqual`, `${timestamp}.${rawBody}` input), idempotency, and per-session authorization landed.
- **PR #2 (Phase 2) — shipped.** Room creation (`POST /api/video/rooms`), token generation (`GET /api/video/token/[roomName]`), active-call query (`GET /api/video/active/[workspaceId]`), and call-end (`POST /api/video/end/[sessionId]`) endpoints. Role resolved server-side from authenticated Clerk session; never trusted from URL/body.
- **PR #3 (Phase 3) — shipped.** `VideoCallProvider`, `VideoPanel` (50/50 draggable split via `react-resizable-panels`, persisted to `localStorage`), `PictureInPicture`, `CallStatusPill`, `WaitingRoom`, `VideoCall` component, mount in `workspace-client-page.tsx` gated by active session, mobile/narrow viewport (<900px PiP-only, <600px full-screen + bottom-sheet drawer), keyboard shortcuts (Cmd/Ctrl + Shift + V/M/S/H/L/K), Join Call button on session cards.
- **PR #4a (Phase 4 prep) — shipped.** Per-party recording consent (`instructorRecordingConsent` + `studentRecordingConsent` ANDed into existing `recordingConsent`), Daily-room reconciliation drift-detection loop (`syncRoomRecording` + `confirmRoomRecording`), `POST /api/video/start-adhoc` (instructor-only, creates synthetic `sessions` row with `isAdhoc: true`), `StartAdhocButton`, orphan cleanup + self-healing on retry.
- **PR #4b (Phase 4 — workspace content integration) — shipped.** See [PR #4b Delivery](#pr-4b-delivery--workspace-content-integration). All four todos (`auto-tag-content`, `live-session-note`, `clipboard-image-paste`, `quick-capture`) done. `recording-playback` deferred to PR #4c-1; student notification surface deferred to PR #4c-2.
- **PR #4c-1 (Phase 5 — recording playback) — shipped.** See [PR #4c-1 Delivery](#pr-4c-1-delivery--recording-playback). Calls sub-section in Notes tab with Play (modal `<video>`) + Download (signed B2 URL with 1h TTL + refresh-on-view + queued-during-playback) + defensive `assertParticipantForSession` typed `QueryCtx` helper for cross-workspace access prevention.
- **PR #4c-2 (Phase 5 — student ad-hoc notification surface) — shipped.** See [PR #4c-2 Delivery](#pr-4c-2-delivery--student-ad-hoc-notification-surface). Cross-workspace bell + per-workspace row badge + Sonner toast + Web Audio chime + browser Notification API (opt-in) + `/workspace/[id]?join={sessionId}` deep-link auto-join + Resend email via Trigger.dev with `(sessionId, recipientUserId)` idempotency.
- **PR #4c-3 (Phase 5 — student "Shared during current call" Links subpanel) — shipped.** See [PR #4c-3 Delivery](#pr-4c-3-delivery--shared-during-current-call-links-subpanel). Indexed query (`by_workspaceId_sessionId`) auth-bound via `assertParticipantForSession` + a workspaceId cross-check; subpanel renders above the Links list while a call is active with loading/error/empty states; both roles see it; strict sessionId match (no call-window fallback for pre-#4b links).
- **PR #4c-4 (Phase 7 — mobile / narrow viewport polish) — shipped.** See PR #605. PiP-only below 900px, full-screen video with bottom-sheet workspace drawer below 600px, mobile-only E2E spec (`tests/e2e/video-call-mobile.spec.ts`) with Daily stub + Clerk auth fixture.
- **PR #5 (Phase 8 — `instructorResources` share-to-call) — shipped.** See [PR #5 Delivery](#pr-5-delivery--instructorresources-share-to-call). Widen-only schema (`sessionId?` + `by_workspaceId_sessionId`), tagged resources surface in the PR #4c-3 subpanel alongside links with a type badge.
- **Hotfix PR #607 (identity.subject) — shipped before PR #5.** P1: `POST /api/video/start-adhoc` returned 403 on `dev.mentorships.huckleberry.art` because `convex/sessions.ts` compared `instructor.userId` (bare Clerk ID) against `identity.tokenIdentifier` (issuer-prefixed canonical). Standardized 30+ comparisons across `convex/sessions.ts`, `convex/inCallNotifications.ts`, `convex/instructors.ts` on `identity.subject` (matches existing convention in `bookings.ts`, `seatReservations.ts`, `instructorResources.ts`); narrowed `requireIdentity` return type; added `clerk.dev.mentorships.huckleberry.art` to the auth.config.ts fallback for Vercel preview deploys.

**Phasing** (each is one PR, independently reviewable, must pass Greptile no-new-P1 + all 4 Vercel preview apps `READY` before the next PR opens):

| Phase | Scope | Owner | PR |
|---|---|---|---|
| 0 | Daily.co account + B2 bucket + IAM key + webhook secret | user | — |
| 1 | Schema + dependencies + recording webhook | agent | PR #1 ✅ |
| 2 | Room / token / active / end endpoints | agent | PR #2 ✅ |
| 3 | VideoCallProvider + VideoPanel + mount + Join Call button | agent | PR #3 ✅ |
| 4 prep | Ad-hoc endpoint + Start-ad-hoc button + consent modal + Daily-room reconciliation | agent | PR #4a ✅ |
| 4 | Auto-tag composers + live session note + clipboard paste + Quick Capture | agent | PR #4b ✅ |
| 5a | Calls sub-section in Notes tab (Play + Download signed B2 URL + TTL refresh) | agent | PR #4c-1 ✅ |
| 5b | Student notification surface (bell + badge + toast + deep-link + email) | agent | PR #4c-2 ✅ |
| 5c | Student "Shared during current call" Links subpanel | agent | PR #4c-3 ✅ |
| 7 | Mobile / narrow viewport polish (<900px PiP-only, <600px full-screen + drawer) | agent | PR #4c-4 ✅ |
| 8 | `instructorResources` share-to-call — widen schema + union "Shared during current call" subpanel | agent | PR #5 ✅ |

## Phase 0 Prerequisites (User Action Required)

Before any code lands, the user creates these resources outside the repo. The agent integrates against the env var names; values are pasted only into the Vercel project env (never into PRs, commits, or `.env.local` examples — per AGENTS.md secret policy).

| Resource | Where to create | Env var name |
|---|---|---|
| Daily.co account + domain | https://dashboard.daily.co/ | `DAILY_API_KEY` |
| B2 bucket for recordings | Backblaze B2 | `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME` |
| IAM-limited Daily access key for B2 | B2 → Application Keys, scope `listBuckets`, `listFiles`, `readFiles`, `writeFiles` to recordings bucket only | `DAILY_B2_KEY_ID`, `DAILY_B2_APPLICATION_KEY` |
| Webhook secret (Daily → `/api/webhooks/daily/recordings`) | Daily dashboard generates the secret as base64 (NOT hex). Paste into Daily webhook config + Vercel as `DAILY_WEBHOOK_SECRET`. | `DAILY_WEBHOOK_SECRET` |

When done, paste the env var names into the Vercel project's environment variables (preview + production). Ping the agent with "Phase 0 done" to start PR #1.

## Why Daily.co

| Feature | Daily.co | Discord |
|---------|----------|---------|
| Screenshare | ✅ Full support | ❌ Not available |
| Cloud Recording | ✅ Composited video | ❌ Not available |
| S3 Storage | ✅ Any S3-compatible (B2) | ❌ Not available |
| Waiting Room | ✅ Built-in | ❌ Not available |
| Role Permissions | ✅ Token-based | ❌ Limited |
| Workspace Integration | ✅ Embeddable | ❌ External |
| PiP Support | ✅ Native | ❌ Not available |
| `enable_chat: false` | ✅ Configurable | ❌ Not available |

## UI Architecture: Hybrid Panel Approach

Video calling integrates into the workspace as a **collapsible split-panel**, not a separate page. Users can conduct calls while referencing workspace content (notes, links, images) and posting things discussed in real time without leaving the page.

### Layout Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **Split Panel** | Workspace (50%) \| Video (50%) — draggable divider, min 360px/side | Active call, reference workspace content |
| **Minimized PiP** | Floating thumbnail video in bottom-right | Collapsed, still in call, workspace as primary surface |
| **Fullscreen** | Video only, workspace hidden | Focus on call (presentation / screenshare) |
| **Off** | No active call | Normal workspace use |
| **Narrow viewport (< 900px)** | PiP-only default, no split | Tablet / small laptop |
| **Mobile (< 600px)** | Full-screen video + bottom-sheet workspace drawer | Phone |

### Default Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ [Workspace Name]   🔴 Live · 00:32:15 · 2 participants           │
│                                          [📹 Call] [⋯ Ad-hoc]    │
├─────────────────────────────────────┬───────────────────────────┤
│                                     │                           │
│  Workspace Content                  │   Video Call Panel        │
│  (Notes/Links/Images/Chat)          │                           │
│                                     │   ┌─────────┐ ┌─────────┐ │
│                                     │   │ You     │ │ Student │ │
│                                     │   │         │ │         │ │
│                                     │   └─────────┘ └─────────┘ │
│                                     │                           │
│                                     │   [🎤] [📹] [🖥️] [⏺️] [−] │
├─────────────────────────────────────┴───────────────────────────┤
│ [Collapse → PiP]    [Fullscreen]    [End Call]   ┃ ← drag divider │
└─────────────────────────────────────────────────────────────────┘
```

### Split Panel Sizing Policy

- **Default ratio**: 50/50.
- **Divider**: draggable, min 360px per side (prevents the Notes editor or image grid from becoming unusable).
- **Persistence**: ratio saved to `localStorage` under `videoPanel.splitRatio` so user's last choice is remembered across sessions.
- **Tab-aware bias**: when the active tab is `notes` or `images` (which need more horizontal room for the editor / grid), the panel auto-suggests 40/60 (workspace/video). User can override; the override persists.
- **Library**: `react-resizable-panels` for the draggable divider.

### Minimized PiP Mode

When user clicks "Collapse", video shrinks to floating picture-in-picture in bottom-right corner. Workspace becomes the primary surface again, but the call is still active and audio flows.

```
┌─────────────────────────────────┐
│ My Workspace         🔴 Live     │
│ [Chat] [Notes] [Images] [Links] │
├─────────────────────────────────┤
│                                 │
│  # Session Notes (live)         │
│                                 │
│  Today we discussed...          │
│                                 │
│  ## Action Items                │
│  - Review portfolio             │
│  - Practice technique           │
│                                 │
│  [scrolling content]            │
│                                 │
│                           ┌──────────┐
│                           │ PiP Video│
│                           │  00:12:43│
│                           └──────────┘
│                                 │
│                  [📝 Quick capture] ← Cmd/Ctrl+K
└─────────────────────────────────┘
```

## Workspace Content Integration (NEW)

The defining UX principle: **workspace content and the call are not separate surfaces — they are one surface.** During a live call, all five workspace tabs (Chat, Notes, Images, Links, Resources) remain usable, and content posted in them is automatically associated with the call.

### Auto-tag to current call

When a call is active in the current workspace, composers in Notes / Images / Links show a **"Tag this to current call"** toggle that defaults to **ON**. Posting creates a row with `sessionId` set to the live session. User can untag per-posting.

Affected tables: `workspace_notes`, `workspace_links`, `workspace_images`. New field: `sessionId: v.optional(v.id("sessions"))`.

### Auto-created live session note

When a call starts (first participant joins), a Convex mutation automatically creates a `workspace_notes` row with `sessionId` set and a generated title like `"Live notes — Jun 28, 2026 2:00 PM"`. While the call is active, this note is **pinned at the top of the Notes tab** with a 🔴 Live badge and updates timestamp. After the call ends, it remains pinned with a "Past call" badge and is listed under the Calls sub-section.

### Chat tab replaces Daily's in-call chat

Daily's built-in chat is **disabled** at the room level (`enable_chat: false`). The workspace Chat tab serves both roles:

- **Async messages** before/after the call (today's behavior).
- **In-call messages** during the call (replaces Daily's ephemeral chat).

When a call is active, the Chat tab shows a banner: *"You're in a call. Messages here are saved and visible after the call ends."* This makes the persistence guarantee explicit and removes the "do I chat here or in Daily?" confusion.

### Quick capture overlay (`Cmd/Ctrl+K`)

While a call is active, a floating **Quick Capture** composer sits at the bottom-center of the viewport. Triggered by `Cmd/Ctrl+K` (or click). Accepts:

- **Plain text** → creates a tagged `workspace_notes` row.
- **URL** (detected by regex) → creates a tagged `workspace_links` row.
- **Pasted image** (clipboard) → uploads to existing images API and creates a tagged `workspace_images` row.

Always pinned bottom-center while a call is active, dismissible, never blocks the workspace tabs.

### Clipboard image paste on Images tab

While a call is active, the Images tab exposes a **"Paste from clipboard"** button. Listens to `paste` events on the workspace, uploads to the images bucket, tags with `sessionId`. (Safari clipboard-image API is restrictive — scope as a follow-up if needed.)

### Resources tab visibility

The Resources tab is **instructor-only today** (`workspace-client-page.tsx:146`). During a call, students do **not** get a Resources tab, but they see a "Shared during current call" subpanel inside the Links tab when the instructor adds resources tagged to the session. This avoids leaking the full Resources management UI to students while still letting them see what was shared live.

### Recording playback — sub-section inside Notes tab

The Notes tab grows a **"Calls" sub-section at the top**, above regular notes. Each entry:

- Thumbnail (Daily's first-frame preview).
- Title (auto: `"Call on {date} · {duration}"`).
- Participant names + role badges.
- **Play** button → opens a modal `<video>` player that overlays the workspace (workspace remains interactive behind the modal).
- **Download** button → fetches a signed B2 URL and triggers a browser download.

Keeps the workspace tab count at 5 (no new "Calls" tab). Recordings feel like part of the workspace history rather than a separate surface.

## Ad-hoc Calls (Instructor Only)

Instructors can start a call from the workspace **outside scheduled sessions** (catch-up, quick check-in). Synthetic `sessions` row is created so:

- Recording has a session record to attach to.
- Notes/Links/Images posted during the call can be tagged with `sessionId`.
- Retention / billing flows treat it like a normal session.

There is no UI to start an ad-hoc call from the dashboard or sessions list today — the entry point lives in the workspace header (see [Instructor Call Flows in /workspace](#instructor-call-flows-in-workspace), entry point 2).

**Recording default for ad-hoc calls: ON.** The consent modal opens with recording toggled on; both parties are notified that the call is being recorded; the recording lands in B2 and surfaces in the Notes tab Calls sub-section on call end. If either party declines consent, the call proceeds without recording (no webhook fires, no Notes sub-section entry).

Flow:

1. Instructor workspace header shows a small **"📹 Start ad-hoc call"** button (instructors only — never visible to students).
2. Click → consent modal (recording toggle defaults to ON) → `POST /api/video/start-adhoc` creates a synthetic session + Daily room.
3. Student gets an in-app notification (and optionally email) with a deep link to the workspace.
4. From step 5 onward, the same flow as a scheduled session call.

Ad-hoc calls cannot be started by students. Students always enter a call via the **"Join Call"** button on a session card or a notification.

## Mobile & Narrow Viewport

| Viewport width | Behavior |
|----------------|----------|
| ≥ 900px | Full split panel (default) |
| < 900px (tablet / small laptop) | PiP-only default; "Fullscreen video" button collapses the workspace. No split panel. |
| < 600px (phone) | Full-screen video + a small "Workspace" button that opens a **bottom-sheet drawer** (~60% height) for taking notes/links mid-call. Closing the drawer returns to full-screen video. |

The Quick Capture composer (`Cmd/Ctrl+K`) remains available at all viewport sizes while a call is active.

### User Flow

1. User clicks **"Join Call"** (session card) or **"📹 Call"** (workspace header, enabled ±15 min of scheduled start) or **"Start ad-hoc call"** (instructor, workspace header).
2. If recording required: consent modal.
3. Split panel opens: workspace left, video right.
4. Student joins → enters waiting room → instructor sees admit toast and clicks "Admit".
5. During call: users reference notes/links/images while discussing; all postings auto-tag to the session.
6. `Cmd/Ctrl+K` opens Quick Capture overlay for fast capture without leaving the call.
7. **Collapse** button → video becomes floating PiP (bottom-right).
8. Click PiP → returns to split panel mode.
9. **Fullscreen** → video only, workspace hidden (full-screen video on narrow viewports).
10. End call → `callEndedAt` set, panel animates out, recording webhook fires, Notes tab now shows the Calls sub-section at top.

## Instructor Call Flows in /workspace

Instructors have **three** entry points for conducting a call from inside a workspace. Each is intentionally available without leaving the workspace tabs so the call and the workspace content stay on one surface.

### Entry point 1 — Scheduled session in window (both roles)

Trigger: a session for the workspace's `(instructor, student)` pair is scheduled within the next 15 minutes or is currently in progress.

```
┌───────────────────────────────────────────────────────────────┐
│ My Workspace    🔴 Live · 00:32:15 · 2 participants           │
│ Chat │ Notes │ Images │ Links │ Resources     [📹 Join Call]   │
└───────────────────────────────────────────────────────────────┘
```

1. The workspace header shows a **"📹 Join Call"** button (enabled). It is visible to both the instructor and the student of the workspace.
2. The button is disabled (with tooltip "Your next session starts in HH:MM") outside the ±15-minute window.
3. Both parties see the same button. Clicking from either side opens the consent modal (if recording), then mounts the VideoPanel in split mode.
4. The instructor takes the `owner` Daily.co role automatically (resolved server-side from `clerkUserId` matching `sessions.instructorId`). The student takes `participant`.

### Entry point 2 — Ad-hoc call (instructor only)

Trigger: the instructor wants to start a call outside any scheduled session (catch-up, quick check-in).

```
┌───────────────────────────────────────────────────────────────┐
│ My Workspace    🔴 Live · 00:32:15 · 2 participants           │
│ Chat │ Notes │ Images │ Links │ Resources  [📹 Call] [⋯ Ad-hoc]│
└───────────────────────────────────────────────────────────────┘
```

1. The workspace header shows a small **"⋯ Start ad-hoc call"** button **only when the current user is the instructor of this workspace**. Students never see this button.
2. Click → consent modal (if recording) → `POST /api/video/start-adhoc` (instructor-only endpoint) creates a **synthetic `sessions` row** with `isAdhoc: true` and a Daily.co room.
3. The student gets an **in-app notification** (workspace list badge + optional email) with a deep link to the workspace.
4. From this point the flow is identical to entry point 1: VideoPanel opens in split mode, role resolved server-side, auto-tagging active, recording webhook fires on end.

### Entry point 3 — Session card (both roles)

Trigger: the user is browsing sessions (not the workspace) and wants to join from there.

- Session cards in the instructor dashboard and student sessions page show a **"📹 Join Call"** button (already in today's UI, currently alongside Reschedule / Cancel / Notes).
- Clicking from a session card navigates to `/workspaces/[workspaceId]` with the call already mounted. The instructor or student lands directly in the split panel.

### What the instructor sees during a call

While the call is active, the instructor's workspace shows the same chrome students see, plus:

- The **CallStatusPill** in the header (`🔴 Live · HH:MM:SS · 2 participants`) — the only place the call duration is visible.
- The **Waiting Room** UI when a student is admitted. The instructor sees an admit toast and clicks "Admit" — students never see this control.
- The **"Tag to current call"** toggle is **ON by default** in the Notes/Images/Links composers, with a clear visual indicator so the instructor knows anything posted will be associated with this session.
- The **Quick Capture composer** (`Cmd/Ctrl+K`) lets the instructor drop a link or paste an image without leaving the call.
- After the call ends, the **Calls sub-section at the top of the Notes tab** shows the recording (if enabled), with Play and Download.

### What students never see

- The **"Start ad-hoc call"** button is instructor-only at the UI layer (not just the endpoint) — the workspace header hides it for students.
- The **Resources tab** is instructor-only; during a call, students see a "Shared during current call" subpanel inside the Links tab instead, so they can see resources the instructor handed out live without gaining access to the full Resources management UI.
- The **admit-from-waiting-room** control is instructor-only.
- The instructor-only **owner token** is generated server-side and never reaches the browser (no persisted `instructorToken` in Convex).

### Role boundary summary

| Capability | Instructor | Student |
|---|---|---|
| Join scheduled call from workspace header | ✅ | ✅ |
| Start ad-hoc call | ✅ | ❌ (button hidden + endpoint rejects) |
| See CallStatusPill | ✅ | ✅ |
| See admit-from-waiting-room control | ✅ | ❌ |
| See full Resources tab | ✅ | ❌ (sees "shared during call" only) |
| Post to Notes / Links / Images during call | ✅ (auto-tagged) | ✅ (auto-tagged) |
| Open Quick Capture composer (`Cmd/Ctrl+K`) | ✅ | ✅ |
| End call | ✅ | ✅ (leaves room) |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + Shift + V` | Toggle video panel |
| `Cmd/Ctrl + Shift + M` | Mute / unmute |
| `Cmd/Ctrl + Shift + S` | Toggle screenshare |
| `Cmd/Ctrl + Shift + H` | Hide / show video panel (keep audio) |
| `Cmd/Ctrl + Shift + L` | Tag current composer to live call (toggle) |
| `Cmd/Ctrl + K` | Quick capture composer (text / link / clipboard image) |
| `Escape` | Minimize to PiP (when in split mode) |

## Architecture

### Endpoints

| Method + path | Auth | Behavior |
|---|---|---|
| `POST /api/video/rooms` | session owner (instructor OR student on the session) | Create Daily room `mentorship-{sessionId}` with `enable_chat: false`, `enable_screenshare: true`, recording per consent. Returns `{ roomName, roomUrl }`. |
| `GET /api/video/token/[roomName]` | session owner | Resolves role **server-side** from `clerkUserId` against `sessions.instructorId` (or workspace membership). Returns Daily JWT with `is_owner` flag. **Role never trusted from URL/body.** |
| `GET /api/video/active/[workspaceId]` | workspace member | Returns `{ active: true, sessionId, startedAt }` if a session with `callStartedAt > now - 4h && callEndedAt === undefined` exists for this workspace, else `{ active: false }`. |
| `POST /api/video/start-adhoc` | **instructor of the workspace** | Creates synthetic `sessions` row with `isAdhoc: true`, `recordingConsent: true` (default ON), Daily room. Notifies the student. |
| `POST /api/video/end/[sessionId]` | instructor OR student on the session | Sets `callEndedAt: Date.now()`. Daily webhook fires with recording shortly after. |
| `POST /api/webhooks/daily/recordings` | unauthenticated; HMAC-verified via `X-Webhook-Signature` over `${X-Webhook-Timestamp}.${rawBody}` with base64-decoded `DAILY_WEBHOOK_SECRET` (constant-time compare) | Writes `sessions.recordingUrl` (B2 s3_key) + `sessions.callEndedAt`. Returns 400 on missing/malformed/mismatched signature before parsing the body. Mounted under `/api/webhooks/*` because `proxy.ts:196-208` whitelists that path as a public route — avoids touching proxy.ts per AGENTS.md Clerk policy. |
| `GET /api/video/recordings/[sessionId]` | session owner | Returns signed B2 URL with TTL policy. |

Detailed per-endpoint authorization: see [Endpoint Authorization](#endpoint-authorization) below.

### Components

All new components live under `apps/platform/components/video/`:

| File | Mount point | Both roles | Instructor only |
|---|---|---|---|
| `video-call-provider.tsx` | wraps workspace tree | ✅ | |
| `video-panel.tsx` | below tab strip | ✅ | |
| `call-status-pill.tsx` | workspace header | ✅ | |
| `join-call-button.tsx` | workspace header (±15 min window) | ✅ | |
| `start-adhoc-button.tsx` | workspace header | | ✅ (hidden for students) |
| `picture-in-picture.tsx` | bottom-right floating | ✅ | |
| `quick-capture.tsx` | overlay (`Cmd/Ctrl+K`) | ✅ | |
| `consent-modal.tsx` | on join + on ad-hoc start | ✅ | |
| `waiting-room.tsx` | below header | | ✅ |
| `recording-playback.tsx` | Notes tab sub-section | ✅ | |

1. **Daily.co SDK** (`@daily-co/daily-react`)
   - React hooks for video call state.
   - Prebuilt UI components (DailyVideo, DailyAudio).
   - Screenshare controls.
   - Recording controls.
   - In-call chat **disabled** (`enable_chat: false`) — workspace Chat tab is used instead.

2. **Room Management**
   - Create room per session via Daily.co REST API.
   - Room properties: `max_participants: 2`, `enable_emoji_reactions`, `enable_hand_raising`, `enable_screenshare`, `enable_recording: "cloud"`, `enable_chat: false`, `privacy: "private"` (token required).

3. **Token Generation**
   - Instructor token: `owner` role (full permissions, can manage recording, admit from waiting room).
   - Student token: `participant` role (send audio/video/screenshare, no admin).
   - Tokens expire after session duration + buffer.
   - **Role is resolved server-side from the authenticated session, never from a request parameter.** The handler looks up the session row, compares the caller's Clerk user ID against `sessions.instructorId` (and the student-side counterpart), and grants `owner` only when the caller is the instructor for that session. Any URL/body parameter that hints at a role is ignored.

4. **Recording to B2**
   - Configure B2 bucket in room properties via IAM role assumption.
   - Recording layout: `single-participant` (focus on speaker) or `default` (grid).
   - Max duration: 4 hours (15000 seconds).
   - Output: MP4 file stored in B2 at `recordings/{sessionId}/{timestamp}.mp4`.

5. **Hybrid Panel State** (Jotai atoms in `VideoCallContext`)
   - `activeSessionIdAtom` — id of session currently in-call for the open workspace, or null.
   - `panelModeAtom` — `split | pip | fullscreen | off`.
   - `splitRatioAtom` — persisted to `localStorage` under `videoPanel.splitRatio`.
   - `callStateAtom` — `idle | connecting | connected | reconnecting | ended`.
   - `liveSessionNoteIdAtom` — id of the auto-created live session note, used to pin it in the Notes tab.

### Data Model (Convex)

```typescript
// sessions table additions (PR #1)
videoRoomUrl: v.optional(v.string()),
videoRoomName: v.optional(v.string()),
// NOTE: instructorToken is intentionally NOT persisted to the database.
// Daily.co owner-role JWTs grant room-owner access (manage recording,
// waiting room, call termination). Anyone able to read the sessions
// table — via a future Convex query, a DB export, or a misconfigured
// access policy — would otherwise gain owner-level access to every
// room. Tokens are generated fresh by GET /api/video/token/[roomName]
// on each join request and live only in the response payload.
videoSessionStartedAt: v.optional(v.number()),
callStartedAt: v.optional(v.number()),       // Set when first participant joins
callEndedAt: v.optional(v.number()),         // Set on call end (also set by Daily webhook)
isAdhoc: v.optional(v.boolean()),            // True for instructor-started ad-hoc calls

// sessions table — already present (NOT added in PR #1)
recordingConsent: v.boolean(),               // Required, set at session booking
recordingUrl: v.optional(v.string()),        // B2 s3_key; signed URLs generated in PR #4
recordingExpiresAt: v.optional(v.number()),

// workspaceNotes additions (PR #1)
sessionId: v.optional(v.id("sessions")),     // Auto-set during live call, untag-able
// new index: by_workspaceId_sessionId

// workspaceLinks additions (PR #1)
sessionId: v.optional(v.id("sessions")),
// new index: by_workspaceId_sessionId

// workspaceImages additions (PR #1)
sessionId: v.optional(v.id("sessions")),
// new index: by_workspaceId_sessionId

// sessions indexes added in PR #1
// .index("by_videoRoomName", ["videoRoomName"])        — Daily webhook lookup
// .index("by_instructorId_isAdhoc", ["instructorId", "isAdhoc"])  — ad-hoc listing
```

### API Endpoints

```
POST   /api/video/rooms                                - Create Daily.co room for session (instructor only)
GET    /api/video/token/[roomName]                     - Get participant token (role derived server-side, session participants only)
POST   /api/webhooks/daily/recordings                  - Daily.co webhook for recording ready (HMAC-verified; public)
GET    /api/video/recordings/[sessionId]               - Get recording URL for session (session participants only)
GET    /api/video/active/[workspaceId]                 - Returns { sessionId, roomUrl, startedAt } | null (workspace members only)
POST   /api/video/start-adhoc                          - Instructor only; creates synthetic session + Daily room
```

### Webhook Security (Daily.co → /api/webhooks/daily/recordings)

`POST /api/webhooks/daily/recordings` is an unauthenticated callback that mutates `sessions.recordingUrl` and `sessions.callEndedAt`. Without verification, any caller could POST a fake payload and attach an arbitrary URL to any session in Convex.

Daily.co sends two headers: `X-Webhook-Signature` (base64-encoded HMAC-SHA256) and `X-Webhook-Timestamp`. The signature is computed over the string `${timestamp}.${rawBody}` (NOT just the raw body) using the base64-decoded shared secret. The handler **must**:

1. Read the raw request body (not the parsed JSON) before any other parsing.
2. Decode `DAILY_WEBHOOK_SECRET` from base64.
3. Compute `hmacSha256(decodedSecret, ${X-Webhook-Timestamp}.${rawBody}).toString("base64")` and compare against `X-Webhook-Signature` using `crypto.timingSafeEqual` after a length check.
4. Return `400` for missing headers, malformed signature, or signature mismatch before doing any other work.
5. Only then parse the body, filter for `type: "recording.ready-to-download"`, extract `payload.room_name` + `payload.s3_key`, and persist to Convex.

The webhook secret is sourced from `DAILY_WEBHOOK_SECRET` env var and configured in the Daily.co dashboard under the room's webhook settings. Rotating the secret must invalidate all old signatures.

**Why `/api/webhooks/daily/recordings` and not `/api/video/recordings`:** `proxy.ts:196-208` whitelists `/api/webhooks/*` as a public route (alongside `/api/webhooks/stripe`, `/api/webhooks/clerk`, `/api/webhooks/paypal`). Per AGENTS.md Clerk policy, modifying `proxy.ts` (Clerk proxy wiring) requires explicit approval. Mounting under the existing whitelisted prefix avoids touching `proxy.ts` and gets the `"webhook"` rate-limit policy for free (`proxy.ts:272-274`).

**Auth model:** The corresponding Convex mutation `api.sessions.attachRecordingFromDailyWebhook` is declared `mutation` (public) because `ConvexHttpClient.mutation()` only accepts public FunctionReferences and there is no Clerk context on a webhook call. HMAC verification upstream is the security boundary — only Daily, holding the shared secret, can produce a valid signature.

### Endpoint Authorization

Every endpoint below the webhook must derive the caller's permissions from the authenticated Clerk session and the Convex row it references — never from URL or body parameters.

| Endpoint | Allowed callers | Server-side check |
|---|---|---|
| `POST /api/video/rooms` | **Instructor only** | Compare `clerkUserId` against the session's `instructorId`. Students must not be able to create rooms, even for sessions they are a party to, because that would let them burn Daily.co API quota or create orphan rooms tied to arbitrary session IDs. |
| `POST /api/video/start-adhoc` | **Instructor only** | Same check as above. Creates a synthetic session, so only the instructor may invoke it. |
| `GET /api/video/token/[roomName]` | **Session participants only** | Resolve the room to its `sessions` row, then check the caller is the session's instructor OR appears in the workspace's participant list. Reject otherwise. Role (`owner` vs `participant`) is derived from that check. |
| `GET /api/video/recordings/[sessionId]` | **Session participants only** | The sessionId is returned in many Convex queries, so checking "is the caller authenticated" is not enough. Verify the caller is the instructor OR a participant of the referenced session before issuing the signed B2 URL. |
| `GET /api/video/active/[workspaceId]` | **Workspace members only** | The caller must appear in the workspace's membership (instructor or student of that workspace pair). Reject otherwise. |

The same identity-check helper should be reused across all endpoints to keep authorization logic in one place and easy to audit.

### B2 IAM Role (Daily.co)

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DailyRecordings",
    "Effect": "Allow",
    "Action": [
      "s3:PutObject",
      "s3:GetObject",
      "s3:ListBucketMultipartUploads",
      "s3:AbortMultipartUpload",
      "s3:ListBucketVersions",
      "s3:ListBucket",
      "s3:GetObjectVersion",
      "s3:ListMultipartUploadParts"
    ],
    "Resource": [
      "arn:aws:s3:::instructor-uploads",
      "arn:aws:s3:::instructor-uploads/recordings/*"
    ]
  }]
}
```

> **Scope note:** Resources are scoped to `recordings/*` so Daily.co's storage service can only read/write recording objects — not user-uploaded workspace content that shares the bucket. Bucket-level ARNs are retained only because `s3:ListBucket` requires them; restrict that action with a `Condition` (`s3:prefix=recordings/`) if B2 supports it.

## Implementation Phases

### Phase 1: Setup
- [ ] Create Daily.co account (paid plan for recording)
- [ ] Get Daily.co API key
- [ ] Configure B2 bucket with IAM role for Daily
- [ ] Add `@daily-co/daily-react` to apps/platform

### Phase 2: Schema + Core Integration
- [ ] Add `sessionId` to `workspace_notes`, `workspace_links`, `workspace_images`
- [ ] Add `callStartedAt`, `callEndedAt`, `isAdhoc` to `sessions`
- [ ] Create `VideoCallProvider` context and Jotai atoms
- [ ] Create `VideoCall` component with DailyProvider
- [ ] Create `VideoControls` component (mute, camera, screenshare, record)
- [ ] Implement room creation endpoint (`POST /api/video/rooms`)
- [ ] Implement token generation endpoint (`GET /api/video/token/[roomName]`) — role resolved server-side from authenticated session, never from request input
- [ ] Implement active call query endpoint (`GET /api/video/active/[workspaceId]`)
- [ ] Add "Join Video Call" button to session cards (both roles)

### Phase 3: Hybrid Panel UI
- [ ] Create `VideoPanel` container with 50/50 default + draggable divider (`react-resizable-panels`, min 360px/side)
- [ ] Persist split ratio to `localStorage`
- [ ] Create `PictureInPicture` floating component
- [ ] Mount `VideoPanel` in `workspace-client-page.tsx` gated by `activeSessionIdAtom`
- [ ] Implement keyboard shortcuts (Cmd/Ctrl + Shift + V, M, S, H, L, K)
- [ ] Add minimize / expand / close / fullscreen controls
- [ ] Add call timer display
- [ ] Create `CallStatusPill` in workspace header

### Phase 4: Workspace Content Integration — ✅ Shipped in PR #4b
- [x] Update Notes composer: default `sessionId` tagging, untag toggle, "Tag to current call" UI
- [x] Update Images composer: default `sessionId` tagging + "Paste from clipboard" while call is active
- [x] Update Links composer: default `sessionId` tagging
- [x] Auto-create `workspace_notes` row on `callStartedAt` transition (live session note)
- [x] Pin live session note at top of Notes tab while call is active
- [x] Add Chat tab banner explaining it replaces Daily chat
- [x] Disable `enable_chat` in Daily room config
- [x] Create `QuickCapture` floating composer (Cmd/Ctrl+K) for text/link/clipboard-image

### Phase 5: Recording

Recording-consent UI + Daily-room config + webhook handler + `recordingUrl` field all shipped (PR #1 + PR #4a). Playback (Play modal + Download signed B2 URL + TTL refresh) deferred to PR #4c.

- [x] Handle recording webhook (`POST /api/webhooks/daily/recordings`) — shipped in PR #1. HMAC-SHA256, base64-decoded secret, `crypto.timingSafeEqual`, `${timestamp}.${rawBody}` input. Idempotent via `if (session.recordingUrl !== undefined) return { alreadyAttached: true }`.
- [x] Add `recordingUrl` to session in Convex — shipped in PR #1.
- [x] Configure room for cloud recording to B2 — shipped in PR #4a.
- [x] Add recording consent UI to session booking and call join flows — shipped in PR #4a (per-party `instructorRecordingConsent` + `studentRecordingConsent` ANDed into existing `recordingConsent`; drift-detection loop reconciles Daily's `enable_recording` after the room is provisioned).
- [x] Add Calls sub-section in Notes tab with Play (modal video player) + Download (signed B2 URL) — shipped in PR #4c-1
- [x] Implement signed B2 URL refresh strategy (TTL policy) — shipped in PR #4c-1 (1-hour TTL, refresh-on-view, 60s check, queued-during-playback)

### Phase 6: Ad-hoc Calls (Instructor Only) — Shipped in PR #4a, PR #4c-1, PR #4c-2

- [x] Implement `POST /api/video/start-adhoc` (creates synthetic `sessions` row with `isAdhoc: true`, `recordingConsent: true` default)
- [x] Add instructor-only "Start ad-hoc call" button in workspace header (hidden in the UI for students, not just gated server-side)
- [x] Consent modal opens with recording toggled ON by default
- [x] Per-party recording consent (`instructorRecordingConsent` + `studentRecordingConsent`) ANDed into `recordingConsent`
- [x] Daily-room reconciliation drift-detection loop (`syncRoomRecording` + `confirmRoomRecording`) when consent changes after room provisioned
- [x] Student receives in-app notification (workspace bell + per-workspace row badge + Sonner toast + optional Web Audio chime + browser Notification API) — shipped in PR #4c-2
- [x] Student receives Resend email via Trigger.dev with `(sessionId, recipientUserId)` idempotency — shipped in PR #4c-2
- [x] `/workspace/[id]?join={sessionId}` deep-link route + auto-join via `VideoCallProvider.initialJoinSessionId` — shipped in PR #4c-2
- [x] Recording playback sub-section at top of Notes tab (Play + Download) — shipped in PR #4c-1
- [x] "Shared during current call" student subpanel in Links tab — shipped in PR #4c-3
- [x] Greptile: no new P1; Vercel: all 4 apps READY

### Phase 7: Mobile & Narrow Viewport — PR #4c-4 (pending)
- [ ] Implement narrow viewport (< 900px): PiP-only default, no split panel
- [ ] Implement mobile (< 600px): full-screen video + bottom-sheet workspace drawer
- [ ] Ensure Quick Capture composer works at all viewport sizes
- [ ] Verify layouts in E2E on a phone-sized viewport (375×667) and a small laptop (1280×720)

## PR #4b Delivery — Workspace Content Integration

**Branch:** `feat/video-calling-pr4b` (rebased onto `main`)
**PR:** #599 — `feat(platform): video calling PR #4b - workspace content integration`
**Commits:** `80c09b08` (feature) → `66b0b466` (Greptile R1 fixes) → `9a10e920` (Greptile R2/R3 fixes)
**Status:** MERGEABLE, all 7 CI checks + 4 Vercel previews green.

### What shipped

The defining UX principle: **workspace content and the call are not separate surfaces — they are one surface.** During a live call, all workspace tabs (Chat, Notes, Images, Links) remain usable, and content posted in them is automatically associated with the call.

#### 1. Auto-tag composers

`Notes` / `Images` / `Links` composers show a **"Tag to current call"** toggle that defaults to ON while a call is active. Posting creates a row with `sessionId` set to the live session; user can untag per-posting.

- **Schema:** `workspaceNotes.sessionId`, `workspaceLinks.sessionId`, `workspaceImages.sessionId` — all `v.optional(v.id("sessions"))`. New indexes `by_workspaceId_sessionId` on each table.
- **Mutations widened:** `createWorkspaceNote`/`updateWorkspaceNote` (with `clearSessionId: v.boolean()`)/`createWorkspaceLink`/`createWorkspaceImage`/`createWorkspaceMessage`/`createWorkspaceImageAndMessage`/`createWorkspaceFileMessage` all accept and forward `sessionId`.
- **Composers:** `apps/platform/components/workspace/notes.tsx`, `images.tsx`, `links.tsx` each read `activeSessionId` from props (sourced from `useVideoCallContext()` in `workspace-client-page.tsx`).
- **Chat banner:** `apps/platform/components/workspace/chat.tsx` shows an in-call banner + 🔴 dot on tagged messages; `sessionId` forwarded in `handleSendMessage`, image/file handlers, and `ShareLinkButton`.

#### 2. Auto-created live session note

When the call starts (`callStartedAt` transitions), a Convex mutation automatically creates a `workspace_notes` row with `sessionId` set and `isLiveSessionNote: true`. While the call is active, this note is **pinned at the top of the Notes tab** with a 🔴 Live badge.

- **Server-side trigger:** `convex/sessions.ts markCallStarted` calls `internal.workspaces.createLiveSessionNote` after `callStartedAt` patch; errors swallowed so the call itself is never blocked by note-creation failure.
- **Idempotency:** `internalMutation workspaces.createLiveSessionNote` uses new index `by_sessionId_isLiveSessionNote` to dedupe — two simultaneous participants cannot produce duplicate live notes.
- **Workspace lookup:** deterministic — filter by `instructorId === session.instructorId` first (because `by_ownerId` returns cross-instructor workspaces the student ever owned), then prefer active → most-recently-ended (`endedAt` desc) → any.
- **Client hook:** `useLiveSessionNote(sessionId)` in `apps/platform/lib/queries/convex/use-workspaces.ts` returns the pinned row or null; documented sentinel-id invariant for the typed `Id<"sessions">` arg validator.
- **Pin UI:** `notes.tsx` renders the live note at the top with "🔴 Live · auto-created" badge; un-tagging via XCircle button preserves the row but clears `sessionId`.

#### 3. Clipboard image paste on Images tab

While a call is active, the Images tab exposes a **"Paste from clipboard"** button. Listens to `paste` events on the workspace, uploads to the images bucket, tags with `sessionId`.

- **Trigger:** `images.tsx` window `paste` listener gated on `activeSessionId`; uses `capture: true` so it runs before the workspace's generic paste handler.
- **Retry-with-sessionId:** `handleRetryUpload`/`handleRetryAll` forward `sessionId` on retry.

#### 4. Quick Capture overlay (`Cmd/Ctrl+K`)

While a call is active, a floating **Quick Capture** composer (`Cmd/Ctrl+K`) lets the user capture text, a link, or a pasted image WITHOUT leaving the live call.

- **New hook:** `apps/platform/lib/hooks/use-quick-capture-shortcut.ts` — separate from `use-keyboard-shortcuts.ts:42` which swallows modifier keys.
- **New component:** `apps/platform/components/video/quick-capture.tsx` — Radix Dialog with note/link/image tabs. Mounted once at the top of `workspace-client-page.tsx` inside `<VideoCallProvider>`, so it survives workspace switches via the provider key.
- **Shortcut gating:** listener gated on `callIsActive` AND skips events when target is `<input>`/`<textarea>`/`<select>`/`contentEditable` (so Cmd+K in the Notes editor doesn't open the overlay).
- **Escape handler:** capture-phase listener to win over the in-call PiP Escape handler.
- **Workspace ID source:** `useVideoCallContext().workspaceId` (set by the provider from `useCurrentOrUpcomingSessionForWorkspace`). `CurrentOrUpcomingSession` does NOT carry `workspaceId` — sourcing it from the context avoids stale data.
- **Tabs:** Note → `createWorkspaceNote({ sessionId })`; Link → URL detected by regex → `createWorkspaceLink({ sessionId })`; Image → paste via `workspaceImageUpload` → `createWorkspaceImage({ sessionId })`.
- **Image paste gating:** `ImageCaptureForm` receives an `isActive={mode === "image"}` prop; the paste `useEffect` early-returns when not active. Radix TabsContent keeps all panes mounted (just CSS-hidden), so without this gate the listener would steal a paste intended for the Note or Link tab.

### Greptile R1 fixes (commit `66b0b466`)

Confidence 4/5 → 3/5. 4 P1 + 1 P2 addressed:

1. **`updateWorkspaceNote` and `getLiveSessionNote` lacked workspace auth** — now require auth, fetch note's workspace, call `getWorkspaceRole`, then `assertSessionBelongsToWorkspace`.
2. **`createWorkspaceMessage`/`Image`/`ImageAndMessage`/`FileMessage` lacked sessionId validation** — all 6 create mutations now call `assertSessionBelongsToWorkspace` after role check; `createWorkspaceMessage` also rejects when `senderRole` unset.
3. **`markCallStarted` workspace selection was non-deterministic** — `by_ownerId` returns every workspace the student ever owned across all instructors, so a student with multiple instructors could have their live note attached to the wrong workspace. Now filters by `instructorId === session.instructorId` first, then prefers active → most-recently-ended → any.
4. **Quick Capture paste listener would double-fire with Images tab paste listener** — Quick Capture's `ImageCaptureForm` uses `capture: true` + `e.stopImmediatePropagation()` so it wins when its Image tab is the active Quick Capture surface. The Images tab listener still fires while Quick Capture is closed.
5. (P2) **`assertSessionBelongsToWorkspace` helper duplicated role-check logic** — extracted to a single helper called from all 6 mutations.

### Greptile R2 + R3 fixes (commit `9a10e920`)

1 P1 + 3 P2 addressed:

1. **R3 P1: Image paste listener fires on inactive tabs** — `isActive={mode === "image"}` prop gates the `useEffect` in `ImageCaptureForm`. (R3 cited line `1463-1481` against a 547-line file — review snapshot was stale; gate was already in place.)
2. **R2 P2: `tagNewNoteToCall` did not sync when `activeSessionId` changed at runtime** — added `useEffect(() => setTagNewNoteToCall(activeSessionId !== null), [activeSessionId])` so the toggle defaults to ON whenever a call goes live (matching `links.tsx` pattern).
3. **R2 P2: `useLiveSessionNote` sentinel `"0000…01"`** — documented invariant explaining why the sentinel is dead data on the client side only. Greptile's suggested spread-ternary `{queryKey, queryFn}` form fails TanStack Query's overload matching (`tsc` rejects it); the documented sentinel+`enabled:false` is the canonical pattern.
4. **R2 P2: `assertSessionBelongsToWorkspace` used `ctx: any`** — typed as `MutationCtx` imported from `./_generated/server`.

### Security: `assertSessionBelongsToWorkspace`

`convex/workspaces.ts` exports a typed `MutationCtx` helper that fetches the session and workspace rows in parallel and rejects when the session's instructor/student pair doesn't match the workspace's instructor/owner pair. Called by every PR #4b write path (`createWorkspaceNote`/`updateWorkspaceNote`/`createWorkspaceLink`/`createWorkspaceImage`/`createWorkspaceMessage`/`createWorkspaceImageAndMessage`/`createWorkspaceFileMessage`) AND by `getLiveSessionNote`. A non-participant who passes a "valid-looking" session id is rejected even after the role check, so the live note cannot leak across workspaces.

### Deferred to PR #4c-4

PR #4c was split into four sub-PRs for reviewability. As of 2026-07-07, #4c-1 + #4c-2 + #4c-3 are merged and the following remains:

- **PR #4c-4** — Mobile / narrow viewport polish (<900px PiP-only, <600px full-screen + bottom-sheet workspace drawer). Phase 7 in the plan; the <900px/<600px layouts were scaffolded in PR #3 but not exercised in E2E, so this PR is the verification + UX polish pass.


## PR #4c-1 Delivery — Recording Playback

**Branch:** `feat/video-calling-pr4c-1` (rebased onto `main`)
**PR:** #600 — `feat(platform): video calling PR #4c-1 - recording playback in Notes tab`
**Status:** MERGED as `a5bcc328` on `main` (2026-07-07).

### What shipped

Recording playback lives as a sub-section at the top of the Notes tab in `apps/platform/components/workspace/notes.tsx`. Instructors and students see the same UI: each call row shows a **Play** button (opens a modal with a native `<video controls>` player) and a **Download** button (serves a fresh signed B2 URL).

- **Convex query:** `convex/workspaces.ts getCallRecordingsForWorkspace` returns `CallRecording[]` from `v.string()` `recordingUrl` rows, sorted descending by `startedAt`. Uses index `by_workspaceId_callStartedAt` for the index scan and `.collect()` to fetch the full list (the user's workspace is bounded so this is safe).
- **Cross-workspace access prevention:** `assertParticipantForSession` typed `QueryCtx` helper fetches `session.workspaceId` and verifies the caller (`identity.tokenIdentifier`) is the workspace's instructor or owner. Called by `getCallRecordingsForWorkspace` and `getCallRecordingDownloadUrlBySessionId` (the latter is the signed-URL query endpoint).
- **Signed B2 URL TTL policy:** 1-hour expiry. Refreshed via `useEffect` that runs:
  - On mount (so first paint is always a fresh URL).
  - Every 60 seconds in the background.
  - On user-visible URL change (re-fetch on focus if the cached URL is within 10 minutes of expiry).
- **Queued-during-playback:** if the modal player is open (`isPlayingRef`), the refresh effect defers the next fetch until playback ends. Avoids mid-play URL rotation that would 404 the `<video>` element.
- **Filename format:** date-only — `recording-{YYYY-MM-DD}.mp4` — per the AGENTS.md guidance (no session id in user-visible filenames; instructors/students see the same date).
- **Greptile R0 → R5:** 5 iterations to reach confidence 5/5. Key findings addressed:
  - **P1** — `assertParticipantForSession` originally used `ctx: any`; re-typed as `QueryCtx` from `./_generated/server`.
  - **P2** — `getCallRecordingDownloadUrlBySessionId` originally fetched `session` twice (once for participant check, once for the URL); collapsed to one fetch + local variable.
  - **P2** — `recording-filename.ts` originally took a Date and re-constructed it; now takes a `number` timestamp (the actual stored shape) and the test asserts both formats.

## PR #4c-2 Delivery — Student Ad-hoc Notification Surface

**Branch:** `feat/video-calling-pr4c-2` (rebased onto `main`)
**PR:** #601 — `feat(platform): video calling PR #4c-2 - student ad-hoc notification surface`
**Status:** MERGED as `39a6a1a6` on `main` (2026-07-07).

### What shipped

When an instructor clicks "Start ad-hoc call" in a workspace, the student receives the invite on three surfaces simultaneously — in-app (Sonner toast + sidebar bell + per-workspace row badge), out-of-band (Resend email via Trigger.dev), and in-place (deep-link to `/workspace/[id]?join={sessionId}` that auto-joins). Sound + desktop notifications are opt-in per user.

- **Convex table:** `convex/schema.ts inCallNotifications` — `kind: v.literal("ad_hoc_call_invite")`, `expiresAt = createdAt + 24h`, `readAt?`, indexes `by_userId_sessionId` (dedupe), `by_userId_readAt` (bell feed), `by_workspaceId_sessionId` (row badge).
- **Public mutations:** `createAdHocCallNotification` (idempotent on `(userId, sessionId)`), `markRead` (auth-gated by `identity.tokenIdentifier`), `markReadMany` (batch, used by the bell's Mark-all-read). No public `markEmailSent` or `getBySessionId` — those were Greptile P1 findings (a caller with the IDs could suppress email send or enumerate sessions).
- **Queries:** `getUnreadForUser` (used by bell + toast), `getUnreadForWorkspace` (used by row badge). All queries bound via indexes; no `.filter()` in queries.
- **In-app notification:**
  - **Bell** — `components/notifications/notification-bell.tsx` renders a red count badge and dropdown. Closes on outside click + Escape. Mark-all-read fires one `markReadMany` round-trip.
  - **Row badge** — `components/workspace/workspace-row-badge.tsx` renders a small red dot on each picker row that has an active invite.
  - **Toast + chime + desktop** — `components/notifications/incoming-call-toast.tsx` listens on `getUnreadForUser`. Captures `mountedAt` snapshot after first render so unread backlog doesn't trigger alert storms on dashboard open. Sound/desktop gated by `localStorage` preferences (`lib/notifications/preferences.ts`).
- **Deep-link route:** `app/workspace/[id]/page.tsx` parses `?join={sessionId}`, auth-gates via `getWorkspaceByIdForUser`, redirects to `/workspace` if not a participant. `<IncomingCallMarker>` (no-render component) fires `markRead` on mount — fixes the nav race where the bell clears before the row badge sees the row.
- **Auto-join:** `VideoCallProvider.initialJoinSessionId` prop threads through from `WorkspaceClientPage` (sourced from URL `searchParams.join`). The provider queries `api.sessions.getSessionById` directly for the deep-link session (the workspace's "current" winner can disagree when a freshly-scheduled session wins the index scan). If status is `"joinable"`, fires `markCallStarted`; if status is `"active"`, the existing join effect picks it up. Deep-link `markCallStarted` failure surfaces via `reportError` so the dashboard has telemetry.
- **Email:** `POST /api/video/start-adhoc` enqueues via Trigger.dev REST API with `idempotencyKey: ad-hoc-call-email:{sessionId}:{recipientUserId}`. Notification insert + email enqueue moved into `after()` (Next.js 16) so the HTTP response isn't gated on Resend latency. A single `clerkClient.users.getUser` call returns email + first name (previously two separate calls).
- **Preferences UI:** `components/notifications/notification-preferences-card.tsx` on `/settings` (replaced the placeholder "coming soon" Card). Sound switch is always interactive; desktop switch stays interactive in `default` state to trigger the permission prompt, becomes disabled only when `Notification.permission === "denied" | "unsupported"`. "Test sound" button always enabled so users can preview the chime before opting in.
- **Permission state:** `lib/notifications/desktop.ts` normalises `Notification.permission` to `"default" | "granted" | "denied" | "unsupported"` via explicit `normalisePermission()` widening helper (no `as PermissionState` cast).

### Greptile R0 → R5 (5/5 confidence)

5 iterations. Key findings:

- **P1** — Drop `markEmailSent` + `getBySessionId` from `convex/inCallNotifications.ts`. A caller with the right IDs could suppress an actual email send (by writing `emailSentAt` before Trigger ran) or enumerate all session IDs in the system. Replaced email idempotency with Trigger.dev's built-in `idempotencyKey`.
- **P2 #1** — Initial-invite-skips-alert. The original `lastSeenIdRef` + first-render-return suppressed the alert for any notification already present at mount, so unread backlog never alerted. Replaced with `mountedAtRef` snapshot taken after the first query settles — only notifications with `createdAt >= mountedAt` fire.
- **P2 #2** — Target-session-can-disappear. The deep-link auto-join effect compared `session.sessionId` from `getCurrentOrUpcomingSessionForWorkspace` to `initialJoinSessionId` — those can disagree when a freshly-scheduled session wins the index scan. Now queries the deep-link session directly.
- **P2 #3** — Read-state-clears-before-landing. Bell Link `onClick` was firing `markRead.mutate` — won the navigation race so `WorkspaceRowBadge` saw `readAt !== undefined` before the destination page mounted, hiding the red dot on landing. Removed from bell; added `<IncomingCallMarker>` that fires `markRead` on workspace mount.
- **R0 P1** — First-time desktop opt-in unreachable. Desktop switch was blanket-disabled when permission wasn't "granted", so first-time users (permission default) couldn't click to trigger the prompt. Removed blanket disable; switch stays interactive in `default` state and calls `requestDesktopPermission()` on click.

### CodeRabbit CHANGES_REQUESTED round (commit `5a97c2a5`)

18 review comments addressed:

- `start-adhoc/route.ts` — consolidated two `clerkClient.users.getUser` calls into one (email + first name in a single round-trip); moved notification + email into `after()`; decoupled the in-app notification insert from email/Clerk lookups so the notification row exists even when Resend/Clerk is down.
- `notification-bell.tsx` — added outside-click + Escape close for the dropdown; batched mark-all-read via new `markReadMany` mutation.
- `notification-preferences-card.tsx` — enabled "Test sound" before opt-in; wrapped `requestDesktopPermission` in try/catch.
- `incoming-call-toast.tsx` — replaced 30s preferences polling with cross-tab `storage` event.
- `video-call-provider.tsx` — added `reportError` on deep-link `markCallStarted` failure (was the only deep-link auto-join path with silent failures).
- `workspace-row-badge.tsx` — replaced `as never` cast with `Id<"workspaces">` typing.
- `desktop.ts` — replaced `as PermissionState` cast with explicit `normalisePermission()` widening helper.
- `sound.ts` — drops cached `AudioContext` when state is `"closed"` so backgrounded tabs reuse a fresh context.
- `workspace/[id]/page.tsx` — dedupes `requireAuth()` call.
- `workspace/page.tsx` — defers `getServerUserRole` past the single-workspace redirect (the redirect path no longer hits Clerk API).
- Wording — "mentorship call" → "video call" / "ad-hoc session" throughout student-facing surfaces (bell, toast, prefs).


## PR #4c-3 Delivery — Shared During Current Call Links Subpanel

**Branch:** `feat/video-calling-pr4c-3` (rebased onto `main`)
**PR:** #603 — `feat(platform): video calling PR #4c-3 - shared during current call Links subpanel`
**Commits:** `7b18fa8c` (feature) → `c4215cd4` (R1 fixes: Greptile P2 + CodeRabbit error-state)
**Status:** MERGED as `713d8f97` on `main` (2026-07-07).

### What shipped

While a video call is active in the workspace, the Links tab now shows a **"Shared during current call"** subpanel above the existing list — surfacing links tagged to the active session via the PR #4b `workspaceLinks.sessionId` field. Originally bundled in PR #4b but pulled out so the PR #4b diff stayed under review focus.

- **Convex query:** `convex/workspaces.ts getSharedLinksForActiveSession(workspaceId, sessionId)`.
  - **Auth-bound via `assertParticipantForSession`** (typed `QueryCtx` helper from PR #4c-1). Cross-workspace leakage impossible: a caller who is a participant on workspace X cannot read another workspace's session links.
  - **Indexed read** via the existing `by_workspaceId_sessionId` compound index — O(matched rows), not O(workspace links).
  - **WorkspaceId cross-check** (R1 fix): after `assertParticipantForSession` returns, verifies `workspace._id === args.workspaceId` and throws on mismatch. Prevents a stale-cached workspaceId (e.g. workspace switch before provider remount) from silently returning empty.
  - **Soft-delete filter** in JS after the indexed read (bounded set per call, single-digit rows typical).
  - **Strict sessionId match** — no call-window fallback for pre-#4b links (documented limitation; resurfacing them would require a backfill or window-bounded scan — out of scope).
- **React hook:** `useSharedLinksForActiveSession(workspaceId, sessionId | null)` with `enabled: !!workspaceId && !!sessionId`. The query never fires with a `null` sessionId (which Convex's `v.id("sessions")` validator would reject); the `as Id<"sessions">` cast is safe behind the `enabled` guard.
- **UI:** `apps/platform/components/workspace/links.tsx` renders the subpanel above the existing list when `activeSessionId` is non-null.
  - **Three render states** (R1 fix added the error branch): loading (`Loader2` spinner), error (destructive copy + Retry button via `refetch`), empty ("No links shared yet this call"), populated (compact rows with `LinkIcon` + title/url + ExternalLink).
  - **Header:** `Shared during current call` with a 🔴 pulsing dot + link count (suppressed during loading + error).
  - **Hidden entirely** outside an active call so the existing list's "No links shared yet" empty state still surfaces normally.
  - **`data-testid="shared-during-call-subpanel"`** for future E2E selectors (PR #4c-4 will add Playwright coverage).
  - **Both roles see it** (instructor + student) — the subpanel reflects "what was tagged to this call," regardless of who posted.

### Greptile R0 → R2

2 iterations. Greptile R0 was confidence 4/5 with one P2; R2 (after R1 fixes) is **confidence 5/5 — safe to merge**.

- **R1 P2** — `args.workspaceId` was not cross-checked against the workspace `assertParticipantForSession` returned. A caller passing a mismatched id would silently get an empty result. Fixed: post-assertion `if (workspace._id !== args.workspaceId) throw new Error("Workspace does not match this session");`.

### CodeRabbit R1 (CHANGES_REQUESTED)

2 actionable comments; 1 fully addressed, 1 deliberately skipped with documented rationale.

- **Addressed** — Treat a failed fetch differently from an empty result. The original `sharedLinksLoading ? Loader : sharedLinks.length > 0 ? map : empty` flow conflated error and empty. R1 fix destructured `isError`/`error`/`refetch` from the hook and added a distinct error branch with a Retry button + the server's error message.
- **Skipped** (with rationale on the PR) — Extract a reusable `LinkRow` component shared by the subpanel and the main list. The two row shapes differ intentionally (subpanel: compact `h-7` button, no `Tagged` badge, no `Delete` since the subpanel doesn't claim ownership). Extracting would need a parameterized component for ~6 lines of shared anchor markup — not worth the indirection.

### Verification

- `pnpm typecheck` — clean (0 errors).
- `pnpm lint` — 0 new warnings/errors from changed files (136 pre-existing warnings, none in this PR's diff).
- `pnpm test:unit` — 73 passed, 3 pre-existing skipped, 0 failed.
- `npx convex codegen` — succeeded; running TypeScript after upload.

### Risks + naming

- **No schema change.** `by_workspaceId_sessionId` index already exists from PR #4b.
- **No Clerk changes.** Untouched per AGENTS.md Clerk policy.
- **Naming.** No `mentor`/`mentee` words in code. UI copy uses neutral "current call" wording — no "mentorship" / "mentor" / "mentee" (avoids the singular-mentorship CodeRabbit flag from PR #4c-2).
- **Documentation limitation.** Pre-#4b links have `sessionId === undefined` and won't appear in the subpanel even when their `createdAt` overlaps a call window. Documented in the query's JSDoc; out of scope to fix in this PR.


## PR #5 Delivery — instructorResources Share-to-Call

**Branch:** `feat/video-calling-pr5-resources-share`
**PR:** #608 — `feat(platform): video calling PR #5 — instructorResources share-to-call`
**Commits:** `3debd48d` (feature) → `4259353b` (R0 fixes: restore strict ownership, surface no-op patches, dedupe auth fetch)
**Status:** MERGED as `60e08ec6` on `main` (2026-07-08).

### What shipped

While a video call is active in the workspace, instructors can now tag any resource in the **My Resources** tab to the active call. Tagged resources appear in the same "Shared during current call" subpanel that PR #4c-3 added inside the Links tab — alongside tagged links, with a type badge that distinguishes them.

- **Schema widen** — `instructorResources.sessionId: v.optional(v.id("sessions"))` plus a new `by_workspaceId_sessionId` compound index (`schema.ts:369-383`). Pure schema add — pre-#5 rows default to `sessionId === undefined` and won't appear in the subpanel (matches the documented pre-#4b links limitation at `workspaces.ts:917`).
- **Auth helper** — `assertResourceBelongsToInstructor(ctx: MutationCtx, args)` (`instructorResources.ts`) is the typed single-source-of-truth for resource-ownership checks. Returns `{ resource, workspace, identity, role }` so callers don't repeat the auth + role fetch. R0 fix: restored strict ownership check unconditionally (admins and instructors alike must be the owning instructor — matches the original `deleteInstructorResource` behavior and the JSDoc intent).
- **Mutations**
  - `uploadInstructorResource` — now accepts `sessionId: v.optional(v.id("sessions"))` and forwards it to the insert. Calls `assertSessionBelongsToWorkspace` after the role check.
  - `deleteInstructorResource` — uses the helper instead of the inline ownership check.
  - `shareResourceToChat` — uses the helper with `expectedWorkspaceId` so the resource's workspace is cross-checked against the caller-supplied workspaceId. R0 fix: reuses the helper's returned `identity` + `role` instead of re-fetching both.
  - `embedResourceInNote` — uses the helper with `expectedWorkspaceId` derived from the parent note's workspaceId. R0 fix: same dedupe as `shareResourceToChat`.
  - `updateInstructorResource` (NEW) — mirror of `updateWorkspaceNote` (`workspaces.ts:634`). Args: `{ id, sessionId?, clearSessionId? }`. The `sessionId + clearSessionId: v.optional(v.boolean())` arg pair matches the notes/links convention (boolean flag rather than `null` overloading). Calls `assertResourceBelongsToInstructor` + `assertSessionBelongsToWorkspace`. R0 fix: throws when neither `sessionId` nor `clearSessionId` is supplied (no silent empty patch).
- **Query** — `getSharedResourcesForActiveSession` (NEW). Mirror of `getSharedLinksForActiveSession`. Auth via `assertParticipantForSession` + workspaceId cross-check (R1 P2 fix from PR #4c-3); indexed read via the new `by_workspaceId_sessionId`; soft-delete filter in JS after the indexed read.
- **Hooks** — `useSharedResourcesForActiveSession` + `useUpdateInstructorResource` in `use-workspaces.ts`. `InstructorResource` interface gains `_creationTime: number` (required for the subpanel sort) plus an optional `sessionId?: Id<"sessions">`.
- **UI**
  - **Resources tab** (`apps/platform/components/workspace/resources.tsx`) — accepts `activeSessionId: Id<'sessions'> | null` (mirrors the prop added to `WorkspaceLinks` in PR #4b). Each resource row gains a `Tag` / `XCircle` toggle (visible on hover) that calls the new `useUpdateInstructorResource` mutation. Tag state is locally optimistic via a `clearedSessionIdByResource` Set (mirrors `clearedSessionIdByNote` in notes.tsx:115-117).
  - **Links subpanel** (`apps/platform/components/workspace/links.tsx`) — `data-testid="shared-during-call-subpanel"` now renders BOTH `workspaceLinks` AND `instructorResources` rows. Each row carries `data-testid="shared-during-call-subpanel-row-link"` or `...-row-resource"` for downstream selectors. Loading/error/empty branches refactored to handle both sources independently — Retry refetches both. Header chip reads "X items" rather than "X links". Empty-state copy updated to "No links or resources shared yet this call".
  - **Workspace client page** — single-line addition: `<WorkspaceResources>` now receives `activeSessionId={activeSessionId}` (the prop was already in scope from `useVideoCallContext()`).
- **Seed script** — `scripts/seed-test-workspaces.ts` now creates a session pack and an active `sessions` row (via the test-only `instructorResources:seedActiveSessionForE2E` mutation which inserts a session with `callStartedAt` already populated — bypassing the join-window check that `markCallStarted` enforces for real callers).
- **E2E spec** — `tests/e2e/instructor-resources-share.spec.ts` exercises the Resources-tab toggle + subpanel surfacing at 1280×720 (the desktop layout where the subpanel matters most). Modeled on `tests/e2e/video-call-mobile.spec.ts`. Three tests: tag+surface, untag+empty, row data-testid.

### Greptile R0 → R1

2 iterations. Greptile R0 was confidence 3/5 with one P1 + two P2s; R1 (after fixes) is **confidence 5/5 — safe to merge**.

- **R0 P1** — `assertResourceBelongsToInstructor` silently widened `deleteInstructorResource` to allow any platform admin to mutate another instructor's resources. The original handler had no admin bypass — only the owning instructor could mutate. Fixed: moved the `instructorId` ownership check unconditionally so admins and instructors must both be the owning instructor. Matches the helper's JSDoc intent.
- **R0 P2** — `shareResourceToChat` and `embedResourceInNote` re-fetched identity + role after `assertResourceBelongsToInstructor` already did. Fixed: helper returns `{ identity, role }` so callers reuse them.
- **R0 P2** — `updateInstructorResource` accepted a no-op patch (`{ id }` with no other args) and wrote an empty object silently. Fixed: throws `"updateInstructorResource: no fields to update — pass sessionId or clearSessionId"` on empty patch.

### CodeRabbit R0

Rate-limited — no review. R1 review available in 35 minutes; will be auto-triggered on the next push.

### Verification

- `pnpm typecheck` (root) — clean.
- `pnpm --filter @mentorships/platform run typecheck` — clean.
- `pnpm --filter @mentorships/convex typecheck` — clean (`npx tsc --noEmit --project convex/tsconfig.json`).
- `pnpm lint` — 0 errors (136 pre-existing warnings unrelated).
- `pnpm build` — clean.
- CI: 16/16 jobs passed (Build, CodeRabbit, Detect Changes, E2E Tests, Greptile Review, Lint & Type Check, Unit Tests, Vercel Preview Comments, 4× Vercel previews READY, build-apps, convex-codegen, typecheck-apps, typecheck-convex).

### Risks + naming

- **No schema migration.** `v.optional` field; pre-#5 rows stay valid.
- **No Clerk changes.** Untouched per AGENTS.md Clerk policy.
- **Naming.** No `mentor`/`mentee` words in code or UI copy. UI uses "instructor" / "student" / "Resources" / "My Resources".
- **Test-only mutation `seedActiveSessionForE2E`** is the only public mutation added. Marked with `confirmSeed: v.literal(true)` so a misconfigured caller fails immediately.




## File Changes

### New Files (across all PRs)

**Video Components:**
- `apps/platform/components/video/video-provider.tsx` — DailyProvider wrapper
- `apps/platform/components/video/video-call.tsx` — Main video grid component
- `apps/platform/components/video/video-controls.tsx` — Control bar (mute, camera, share, record)
- `apps/platform/components/video/video-panel.tsx` — Split panel container (50/50 default, draggable divider)
- `apps/platform/components/video/picture-in-picture.tsx` — PiP floating video
- `apps/platform/components/video/waiting-room.tsx` — Waiting room UI for students
- `apps/platform/components/video/quick-capture.tsx` — Floating Cmd/Ctrl+K composer (text/link/clipboard-image)
- `apps/platform/components/video/call-status-pill.tsx` — Workspace header live indicator (timer, participants)

**Notifications (PR #4c-2):**
- `apps/platform/components/notifications/notification-bell.tsx` — Sidebar bell with cross-workspace count + dropdown + mark-all-read (batches via `markReadMany`)
- `apps/platform/components/notifications/incoming-call-toast.tsx` — Sonner toast + chime + desktop notification on new invites (mounted in `<ProtectedLayout>`)
- `apps/platform/components/notifications/incoming-call-marker.tsx` — No-render marker that fires `markRead` when destination workspace mounts (fixes nav race)
- `apps/platform/components/notifications/notification-preferences-card.tsx` — Opt-in settings UI on `/settings` (sound + desktop, gated by `Notification.permission`)
- `apps/platform/components/workspace/workspace-row-badge.tsx` — Per-workspace red dot in picker
- `apps/platform/lib/notifications/sound.ts` — Web Audio API two-note chime (D5+A5) at 30% volume
- `apps/platform/lib/notifications/desktop.ts` — `Notification` API wrapper with permission gating
- `apps/platform/lib/notifications/preferences.ts` — localStorage-backed preferences (`huckleberry.notificationPreferences.v1`)
- `packages/emails/src/ad-hoc-call.ts` — Resend template (`buildAdHocCallInviteEmail`)
- `src/trigger/ad-hoc-call-email.ts` — Trigger.dev task `send-ad-hoc-call-invite-email`

**Context & Hooks:**
- `apps/platform/context/video-call-context.tsx` — Global video call state (Jotai atoms)
- `apps/platform/hooks/use-video-call.ts` — Video call management hook
- `apps/platform/hooks/use-keyboard-shortcuts.ts` — Keyboard shortcut handler
- `apps/platform/hooks/use-active-session.ts` — Subscribes to active session for the open workspace

**API Routes:**
- `apps/platform/app/api/video/rooms/route.ts` — Room creation
- `apps/platform/app/api/video/token/[roomName]/route.ts` — Token generation (role derived server-side)
- `apps/platform/app/api/webhooks/daily/recordings/route.ts` — Webhook for recording complete (HMAC-verified, public)
- `apps/platform/app/api/video/active/[workspaceId]/route.ts` — Active call query
- `apps/platform/app/api/video/start-adhoc/route.ts` — Instructor-only ad-hoc call creation (PR #4c-2: enqueues email + notification inside `after()`)

**Deep-link route (PR #4c-2):**
- `apps/platform/app/workspace/[id]/page.tsx` — Server-rendered dynamic route, auth-gates, parses `?join={sessionId}`, mounts `<IncomingCallMarker>`

**Utilities:**
- `apps/platform/lib/daily.ts` — Daily.co API helpers

### Modified Files

- `convex/schema.ts` — Add `sessionId` to `workspace_notes/links/images`; add `callStartedAt`, `callEndedAt`, `isAdhoc` to `sessions`
- `convex/sessions.ts` — Add room creation/query mutations; trigger live-session-note creation on `callStartedAt` transition
- `apps/platform/components/instructor/session-cards.tsx` — Add "Join Call" button
- `apps/platform/components/workspace/workspace-client-page.tsx` — Mount `VideoPanel`, pass `isCallActive` to tabs, gate by active session
- `apps/platform/components/workspace/workspace.tsx` — Wrap with `VideoCallProvider`
- `apps/platform/components/workspace/notes.tsx` — Auto-create live session note, pin it, add Calls sub-section with Play/Download
- `apps/platform/components/workspace/images.tsx` — Add "Paste from clipboard" while call is active; default `sessionId` tagging
- `apps/platform/components/workspace/links.tsx` — Default `sessionId` tagging; show "Shared during current call" subpanel
- `apps/platform/components/workspace/chat.tsx` — Add banner explaining it replaces Daily chat while call is active
- `apps/platform/components/workspace/resources.tsx` — (instructor-only) Surface resources shared during current call

## Environment Variables

```env
DAILY_API_KEY=<FROM_DAILY_DASHBOARD>
DAILY_API_URL=https://api.daily.co/v1
DAILY_WEBHOOK_SECRET=<FROM_DAILY_DASHBOARD>
```

## Dependencies

```json
{
  "@daily-co/daily-react": "^0.17.0",
  "@daily-co/daily-js": "^0.57.0",
  "jotai": "^2.6.0",
  "react-resizable-panels": "^2.0.0"
}
```

## Notes

- Recording requires paid Daily.co plan.
- Student joins waiting room, instructor admits.
- Recording auto-stops at 4-hour limit.
- B2 storage uses same bucket as existing uploads (`instructor-uploads`).
- Recording files stored at: `recordings/{sessionId}/{timestamp}.mp4`.
- PiP uses CSS `position: fixed` with `z-index` stacking.
- Panel resize uses `react-resizable-panels` (added to dependencies).
- Daily's in-call chat is **disabled** — workspace Chat tab is the single chat surface during a call.
- Live session note is auto-created on `callStartedAt` transition by `internalMutation workspaces.createLiveSessionNote`; idempotent via `by_sessionId_isLiveSessionNote`. Both roles can post to it.
- Ad-hoc calls are instructor-only; synthetic session row is created so recording + tagging work the same as scheduled calls.
- Signed B2 URLs use 1-hour TTL with refresh-on-view (60s background check) and queued-during-playback (PR #4c-1).
- Student ad-hoc call notifications are decoupled across three surfaces — bell (cross-workspace rollup), row badge (per-workspace context), toast/chime/desktop (liveness) — all reading the same `inCallNotifications` table with a 24h `expiresAt` and `(userId, sessionId)` dedupe index (PR #4c-2).
- Email idempotency for ad-hoc call invites uses Trigger.dev's `idempotencyKey: ad-hoc-call-email:{sessionId}:{recipientUserId}` rather than a Convex `emailSentAt` marker — the marker would have been a writable public mutation exposed for any caller with the IDs (PR #4c-2).
- The "Shared during current call" Links subpanel reads from `workspaceLinks` filtered by `sessionId` via `by_workspaceId_sessionId`. PR #5 (Phase 8) widens this to union `instructorResources` filtered by the same index — instructors can tag uploaded resources to the active call from the Resources tab (`Tag to current call` / `Untag from current call` per-row toggle, mirrors the Notes tab pattern). The subpanel renders both kinds with a type badge (`Link` vs `Resource`) and the existing `data-testid="shared-during-call-subpanel"` block.
- Mark-read for an invite fires on the destination workspace mount (`<IncomingCallMarker>`), not on the bell click. Marking on click loses the navigation race: the bell query refetches before the per-workspace row badge mounts, hiding the red dot on landing (PR #4c-2).
- Quick Capture shortcut `Cmd/Ctrl+K` lives in its own listener (`lib/hooks/use-quick-capture-shortcut.ts`) because `use-keyboard-shortcuts.ts:42` swallows `metaKey|ctrlKey|altKey`. It also skips events when target is `<input>`/`<textarea>`/`<select>`/contentEditable.
- `useVideoCallContext()` is the bridge for active-call state on the workspace client. The session object (`session?.sessionId`, `session?.status`) plus `workspaceId` (set by the provider from `useCurrentOrUpcomingSessionForWorkspace`) are the props all PR #4b composers receive.
- `assertSessionBelongsToWorkspace` (typed `MutationCtx`) is the single source of truth for cross-workspace session id validation. Every PR #4b write path calls it after `getWorkspaceRole`.
- `assertResourceBelongsToInstructor` (typed `MutationCtx`, PR #5) is the single source of truth for instructor-resource ownership. Every `instructorResources` mutation (upload/delete/share/embed/update) calls it instead of inlining the role + instructorId check. Returns `{ resource, workspace }` so callers don't re-fetch.
- `instructorResources.sessionId` is `v.optional` (PR #5). Pre-#5 resources do not appear in the subpanel even if their `createdAt` overlaps a call window — documented limitation matching the pre-#4b links behavior (`workspaces.ts:917`).

## Session Card Integration

```
┌─────────────────────────────────────────────────────┐
│ Session with John Doe                               │
│ June 28, 2026 at 2:00 PM                           │
├─────────────────────────────────────────────────────┤
│ [📅 Reschedule] [❌ Cancel] [📹 Join Call] [📝 Notes]│
└─────────────────────────────────────────────────────┘
```

## Workspace Header Integration

```
┌───────────────────────────────────────────────────────────────┐
│ My Workspace    🔴 Live · 00:32:15 · 2 participants           │
│ Chat │ Notes │ Images │ Links │ Resources     [📹 Call] [⋯]    │
│                                              (Instructor only: │
│                                                "Start ad-hoc") │
└───────────────────────────────────────────────────────────────┘
```

## Open Questions / Deferred

These surfaced during Greptile review of PR #594 (commit `803313ca`) and are queued for a follow-up PR (planned alongside PR #4, not blocking):

- **Workspace-only students sort to top of dashboard.** `getInstructorStudentsWithRemainingSessions` emits workspace rows with `sessionPack: null` and `remainingSessions: 0`. The final sort is ascending by `remainingSessions`, so these rows land at position zero — interleaved with students who have genuinely depleted packs. An instructor with several workspace-only students who haven't been assigned a pack will see them at the very top of the list. **Resolution:** push workspace rows with `hasSessionPack: false` to the bottom, or split them into a separate section.
- **TOCTOU gap in `/api/instructor/session-packs/[sessionPackId]/route.ts:142-147`** — resolved in PR #1. The upfront `deletedAt` check is now paired with a catch on `"Session pack not found"` errors thrown by the underlying mutations, returning 404 instead of 500. Same 404 also returned when `updatedPack === null`.
- **Public mutation auth bypass (`api.sessions.attachRecordingFromDailyWebhook`)** — resolved in PR #1 by splitting into (a) `internalMutation` `attachRecordingFromDailyWebhook` in `convex/sessions.ts` (idempotent + duplicate-room-name guard) and (b) public `action` `attachRecordingFromDailyWebhookAction` in `convex/dailyRecordingActions.ts` (HMAC-verified wrapper that calls the internal mutation via `ctx.runMutation`). The Next.js route now forwards `rawBody + timestamp + signature` to the action, which re-verifies the HMAC against `DAILY_WEBHOOK_SECRET` before calling the mutation. Defence in depth: both layers verify the same secret.
- **Duplicate recording events overwrite (P1)** — resolved by idempotency check: `if (session.recordingUrl !== undefined) return { alreadyAttached: true }`. Daily re-firing the same event no longer overwrites the original recording.
- **Duplicate room names misroute recordings (P1)** — resolved by `.collect()` + `if (matches.length > 1) throw`. Future PR (PR #7) will enforce `by_videoRoomName` as a unique index once data drift is investigated.
- **Webhook runtime missing (P1)** — resolved by adding `export const runtime = "nodejs"` at the top of the route file.
- **Mutation result leaked in webhook response (CodeRabbit 🟠)** — resolved: `convex.action()` call no longer spreads `result` into the public NextResponse.
- **Payload type guard (CodeRabbit 🟡)** — resolved: `isValidRecordingPayload` validates field types before forwarding to Convex, returning 400 on malformed input instead of 500.
- **Explicit return type (CodeRabbit 🔵)** — resolved: `POST(req: NextRequest): Promise<NextResponse>`.

## Open Questions / Deferred (post-PR #5)

These surfaced during Greptile / CodeRabbit review of PR #5 (commit `60e08ec6`) and are queued for a follow-up PR (not blocking):

- **Subpanel sort key uses `_creationTime`** — links and resources are sorted by `_creationTime` desc in `links.tsx:121-125`. Same key for both sources. No issue observed, but if a future PR stores `createdAt` differently for one source this becomes load-bearing.
- **R1 nits from PR #5 review** — 3 small items: (a) null-URL href fallback in `links.tsx:407` (current `url ?? "#"` is technically valid but degrades UX to a no-op anchor), (b) optimistic untag asymmetry in `resources.tsx:142-177` (Tag is optimistic, Untag is not — both should be), (c) E2E coverage gap for the Tag toggle itself (PR #5 only asserts the row data-testid, not the toggle UX).
- **Unique index on `by_videoRoomName`** — duplicate-room-name guard at `convex/sessions.ts:1108-1117` and `1327-1340` is `.collect()` + manual `throw` today. PR #7 will migrate to `.unique()` after data drift is verified.
- **Schema-wide identity.subject migration** — PR #607 standardized 30+ comparisons on `identity.subject` to match existing convention. A future PR could migrate the storage layer (seed scripts + Inngest lifecycle) to write `tokenIdentifier` instead of bare Clerk IDs, then standardize back on the canonical form per the Convex guideline. Out of scope for now.
