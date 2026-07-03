---
name: Video Calling
overview: Integrate Daily.co video calling into apps/platform workspaces with a 50/50 user-resizable hybrid split-panel UX, screenshare, and cloud recording stored on Backblaze B2, replacing Discord mentorship calls. Workspace content (Notes/Images/Links/Chat) is auto-tagged to the active session during a call so users can post things discussed without leaving the workspace. Daily's in-call chat is disabled in favor of the workspace Chat tab. Recording playback lives as a sub-section in the Notes tab.
todos:
  - id: daily-account-setup
    content: Set up Daily.co account and API key
    status: pending
  - id: b2-iam-role
    content: Configure B2 bucket IAM role for Daily.co recording storage
    status: pending
  - id: sdk-integration
    content: Add @daily-co/daily-react SDK to apps/platform
    status: pending
  - id: schema-content-sessionid
    content: Add sessionId foreign key to workspace_notes, workspace_links, workspace_images + callStartedAt/callEndedAt to sessions
    status: pending
  - id: video-component
    content: Create video call component with DailyProvider, DailyVideo, controls (chat disabled)
    status: pending
  - id: room-creation-api
    content: Create room creation API endpoint (POST /api/video/rooms)
    status: pending
  - id: token-generation
    content: Implement token generation with role derived server-side from authenticated session (GET /api/video/token/[roomName])
    status: pending
  - id: active-call-query
    content: Implement GET /api/video/active/[workspaceId] to determine if a call is live in a workspace
    status: pending
  - id: adhoc-call-api
    content: Implement POST /api/video/start-adhoc (instructor only, creates synthetic session)
    status: pending
  - id: video-call-provider
    content: Create VideoCallProvider with Jotai atoms (panelMode, splitRatio, activeSessionId, callState, liveSessionNoteId)
    status: pending
  - id: hybrid-panel-ui
    content: Create VideoPanel with 50/50 default + draggable divider (min 360px/side) using react-resizable-panels; persist ratio to localStorage
    status: pending
  - id: picture-in-picture
    content: Create PictureInPicture floating component (bottom-right)
    status: pending
  - id: quick-capture
    content: Create QuickCapture floating composer (Cmd/Ctrl+K) for text/link/clipboard-image → tagged Note/Link/Image
    status: pending
  - id: call-status-pill
    content: Create CallStatusPill in workspace header (live indicator, timer, participants)
    status: pending
  - id: waiting-room
    content: Create WaitingRoom UI for student admit by instructor
    status: pending
  - id: session-integration
    content: Add "Join Video Call" button on session cards (both roles)
    status: pending
  - id: recording-consent
    content: Add recording consent UI to session booking and call join flows
    status: pending
  - id: workspace-mount
    content: Mount VideoPanel in workspace-client-page.tsx gated by active session
    status: pending
  - id: auto-tag-content
    content: Update Notes/Images/Link composers to default sessionId tagging while a call is active, with untag toggle
    status: pending
  - id: live-session-note
    content: Auto-create live session note on callStartedAt transition, pin at top of Notes tab
    status: pending
  - id: clipboard-image-paste
    content: Add "Paste from clipboard" button on Images tab while a call is active
    status: pending
  - id: chat-tab-banner
    content: Add banner on Chat tab explaining it replaces Daily chat while a call is active
    status: pending
  - id: keyboard-shortcuts
    content: Wire keyboard shortcuts (Cmd/Ctrl+K quick capture, +Shift+L tag toggle, +Shift+H hide panel, +Shift+V toggle panel, +Shift+M mute, +Shift+S screenshare, Escape PiP)
    status: pending
  - id: recording-storage
    content: Add recording webhook (POST /api/video/recordings) and store recordingUrl in Convex
    status: pending
  - id: recording-playback
    content: Add Calls sub-section in Notes tab with Play (modal video player) + Download (signed B2 URL)
    status: pending
  - id: mobile-narrow-viewport
    content: Implement narrow viewport (<900px: PiP-only, <600px: full-screen video with bottom-sheet workspace drawer)
    status: pending
  - id: adhoc-call-ui
    content: Add instructor-only "Start ad-hoc call" button in workspace header
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

Flow:

1. Instructor workspace header shows a small **"📹 Start ad-hoc call"** button (instructors only — never visible to students).
2. Click → consent modal (if recording) → `POST /api/video/start-adhoc` creates a synthetic session + Daily room.
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

### Components

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
// sessions table additions
videoRoomUrl: v.optional(v.string()),
videoRoomName: v.optional(v.string()),
instructorToken: v.optional(v.string()),
recordingConsent: v.boolean(),
recordingUrl: v.optional(v.string()),
recordingExpiresAt: v.optional(v.number()),
videoSessionStartedAt: v.optional(v.number()),
callStartedAt: v.optional(v.number()),       // Set when first participant joins
callEndedAt: v.optional(v.number()),         // Set on call end
isAdhoc: v.optional(v.boolean()),            // True for instructor-started ad-hoc calls

// workspace_notes additions
sessionId: v.optional(v.id("sessions")),     // Auto-set during live call, untag-able

// workspace_links additions
sessionId: v.optional(v.id("sessions")),

// workspace_images additions
sessionId: v.optional(v.id("sessions")),
```

### API Endpoints

```
POST   /api/video/rooms                                - Create Daily.co room for session
GET    /api/video/token/[roomName]                     - Get participant token (role derived server-side)
POST   /api/video/recordings                           - Webhook for recording complete
GET    /api/video/recordings/[sessionId]               - Get recording URL for session
GET    /api/video/active/[workspaceId]                 - Returns { sessionId, roomUrl, startedAt } | null
POST   /api/video/start-adhoc                          - Instructor only; creates synthetic session + Daily room
```

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

### Phase 4: Workspace Content Integration
- [ ] Update Notes composer: default `sessionId` tagging, untag toggle, "Tag to current call" UI
- [ ] Update Images composer: default `sessionId` tagging + "Paste from clipboard" while call is active
- [ ] Update Links composer: default `sessionId` tagging
- [ ] Auto-create `workspace_notes` row on `callStartedAt` transition (live session note)
- [ ] Pin live session note at top of Notes tab while call is active
- [ ] Add Chat tab banner explaining it replaces Daily chat
- [ ] Disable `enable_chat` in Daily room config
- [ ] Create `QuickCapture` floating composer (Cmd/Ctrl+K) for text/link/clipboard-image

### Phase 5: Recording
- [ ] Add recording consent UI to session booking and call join flows
- [ ] Configure room for cloud recording to B2
- [ ] Handle recording webhook (`POST /api/video/recordings`)
- [ ] Add `recordingUrl` to session in Convex
- [ ] Add Calls sub-section in Notes tab with Play (modal video player) + Download (signed B2 URL)
- [ ] Implement signed B2 URL refresh strategy (TTL policy)

### Phase 6: Ad-hoc Calls (Instructor Only)
- [ ] Implement `POST /api/video/start-adhoc` (creates synthetic session + Daily room)
- [ ] Add instructor-only "Start ad-hoc call" button in workspace header
- [ ] Implement student notification on ad-hoc call start (in-app + optional email)

### Phase 7: Mobile & Narrow Viewport
- [ ] Implement narrow viewport (< 900px): PiP-only default, no split panel
- [ ] Implement mobile (< 600px): full-screen video + bottom-sheet workspace drawer
- [ ] Ensure Quick Capture composer works at all viewport sizes

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
- `apps/platform/app/api/video/recordings/route.ts` — Webhook for recording complete
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
- Live session note is auto-created on `callStartedAt` transition by a Convex mutation; both roles can post to it.
- Ad-hoc calls are instructor-only; synthetic session row is created so recording + tagging work the same as scheduled calls.
- Signed B2 URLs for recording download need a TTL policy + refresh strategy (Phase 5).

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
