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

**Plan approved. PR #1 → PR #4b shipped; PR #4c (recording playback) remaining.**

- Plan merged via PR #593.
- Instructor-dashboard `seatReservations` query P2s + Instructor Call Flows section landed via PR #594 (commit `803313ca`).
- **PR #1 (Phase 1) — shipped.** Schema additions for Daily.co call metadata + recording webhook handler at `/api/webhooks/daily/recordings`. Webhook security (HMAC-SHA256, base64-decoded secret, `crypto.timingSafeEqual`, `${timestamp}.${rawBody}` input), idempotency, and per-session authorization landed.
- **PR #2 (Phase 2) — shipped.** Room creation (`POST /api/video/rooms`), token generation (`GET /api/video/token/[roomName]`), active-call query (`GET /api/video/active/[workspaceId]`), and call-end (`POST /api/video/end/[sessionId]`) endpoints. Role resolved server-side from authenticated Clerk session; never trusted from URL/body.
- **PR #3 (Phase 3) — shipped.** `VideoCallProvider`, `VideoPanel` (50/50 draggable split via `react-resizable-panels`, persisted to `localStorage`), `PictureInPicture`, `CallStatusPill`, `WaitingRoom`, `VideoCall` component, mount in `workspace-client-page.tsx` gated by active session, mobile/narrow viewport (<900px PiP-only, <600px full-screen + bottom-sheet drawer), keyboard shortcuts (Cmd/Ctrl + Shift + V/M/S/H/L/K), Join Call button on session cards.
- **PR #4a (Phase 4 prep) — shipped.** Per-party recording consent (`instructorRecordingConsent` + `studentRecordingConsent` ANDed into existing `recordingConsent`), Daily-room reconciliation drift-detection loop (`syncRoomRecording` + `confirmRoomRecording`), `POST /api/video/start-adhoc` (instructor-only, creates synthetic `sessions` row with `isAdhoc: true`), `StartAdhocButton`, orphan cleanup + self-healing on retry.
- **PR #4b (Phase 4 — workspace content integration) — shipped.** See [PR #4b Delivery](#pr-4b-delivery--workspace-content-integration). All four todos (`auto-tag-content`, `live-session-note`, `clipboard-image-paste`, `quick-capture`) done. `recording-playback` deferred to PR #4c.

**Phasing** (each is one PR, independently reviewable, must pass Greptile no-new-P1 + all 4 Vercel preview apps `READY` before the next PR opens):

| Phase | Scope | Owner | PR |
|---|---|---|---|
| 0 | Daily.co account + B2 bucket + IAM key + webhook secret | user | — |
| 1 | Schema + dependencies + recording webhook | agent | PR #1 ✅ |
| 2 | Room / token / active / end endpoints | agent | PR #2 ✅ |
| 3 | VideoCallProvider + VideoPanel + mount + Join Call button | agent | PR #3 ✅ |
| 4 prep | Ad-hoc endpoint + Start-ad-hoc button + consent modal + Daily-room reconciliation | agent | PR #4a ✅ |
| 4 | Auto-tag composers + live session note + clipboard paste + Quick Capture | agent | PR #4b ✅ |
| 5 | Calls sub-section in Notes tab (Play + Download signed B2 URL + TTL refresh) | agent | PR #4c |

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

### Phase 6: Ad-hoc Calls (Instructor Only) — Shipped in PR #4a

- [x] Implement `POST /api/video/start-adhoc` (creates synthetic `sessions` row with `isAdhoc: true`, `recordingConsent: true` default)
- [x] Add instructor-only "Start ad-hoc call" button in workspace header (hidden in the UI for students, not just gated server-side)
- [x] Consent modal opens with recording toggled ON by default
- [x] Per-party recording consent (`instructorRecordingConsent` + `studentRecordingConsent`) ANDed into `recordingConsent`
- [x] Daily-room reconciliation drift-detection loop (`syncRoomRecording` + `confirmRoomRecording`) when consent changes after room provisioned
- [ ] Student receives in-app notification (workspace list badge + optional email) — deferred to PR #4c
- [x] Recording playback sub-section at top of Notes tab (Play + Download) — shipped in PR #4c-1
- [x] Greptile: no new P1; Vercel: all 4 apps READY

### Phase 7: Mobile & Narrow Viewport
- [ ] Implement narrow viewport (< 900px): PiP-only default, no split panel
- [ ] Implement mobile (< 600px): full-screen video + bottom-sheet workspace drawer
- [ ] Ensure Quick Capture composer works at all viewport sizes

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

### Deferred to PR #4c

- Recording playback sub-section in Notes tab (Play + Download signed B2 URL + TTL refresh)
- Student in-app notification for ad-hoc calls (workspace list badge + email)
- "Shared during current call" student subpanel in Links tab (resources surfaced without exposing the Resources management UI)
- Mobile/narrow viewport polish (<900px PiP-only, <600px full-screen + bottom-sheet drawer)


## File Changes

### New Files

**Video Components:**
- `apps/platform/components/video/video-provider.tsx` — DailyProvider wrapper
- `apps/platform/components/video/video-call.tsx` — Main video grid component
- `apps/platform/components/video/video-controls.tsx` — Control bar (mute, camera, share, record)
- `apps/platform/components/video/video-panel.tsx` — Split panel container (50/50 default, draggable divider)
- `apps/platform/components/video/picture-in-picture.tsx` — PiP floating video
- `apps/platform/components/video/waiting-room.tsx` — Waiting room UI for students
- `apps/platform/components/video/quick-capture.tsx` — Floating Cmd/Ctrl+K composer (text/link/clipboard-image)
- `apps/platform/components/video/call-status-pill.tsx` — Workspace header live indicator (timer, participants)

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
- `apps/platform/app/api/video/start-adhoc/route.ts` — Instructor-only ad-hoc call creation

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
- Signed B2 URLs for recording download need a TTL policy + refresh strategy (deferred to PR #4c).
- Quick Capture shortcut `Cmd/Ctrl+K` lives in its own listener (`lib/hooks/use-quick-capture-shortcut.ts`) because `use-keyboard-shortcuts.ts:42` swallows `metaKey|ctrlKey|altKey`. It also skips events when target is `<input>`/`<textarea>`/`<select>`/contentEditable.
- `useVideoCallContext()` is the bridge for active-call state on the workspace client. The session object (`session?.sessionId`, `session?.status`) plus `workspaceId` (set by the provider from `useCurrentOrUpcomingSessionForWorkspace`) are the props all PR #4b composers receive.
- `assertSessionBelongsToWorkspace` (typed `MutationCtx`) is the single source of truth for cross-workspace session id validation. Every PR #4b write path calls it after `getWorkspaceRole`.

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
- **Duplicate room names misroute recordings (P1)** — resolved by `.collect()` + `if (matches.length > 1) throw`. Future PR will enforce `by_videoRoomName` as a unique index once data drift is investigated.
- **Webhook runtime missing (P1)** — resolved by adding `export const runtime = "nodejs"` at the top of the route file.
- **Mutation result leaked in webhook response (CodeRabbit 🟠)** — resolved: `convex.action()` call no longer spreads `result` into the public NextResponse.
- **Payload type guard (CodeRabbit 🟡)** — resolved: `isValidRecordingPayload` validates field types before forwarding to Convex, returning 400 on malformed input instead of 500.
- **Explicit return type (CodeRabbit 🔵)** — resolved: `POST(req: NextRequest): Promise<NextResponse>`.
