# Instructor Dashboard 500 + One-Way Call Audio — Investigation (2026-09-24)

Two production-affecting symptoms on the same instructor in the same session on `dev.mentorships.huckleberry.art`:

1. `GET /instructor/dashboard` returns **500 Internal Server Error** with `Error [ForbiddenError]: Instructor role required` (digest `825625058`) — also surfaced earlier as `Error [UnauthorizedError]: Unauthorized` (digest `2290410895`).
2. **One-way audio in the live call** — the student hears the instructor; the instructor cannot hear the student. Instructor reports seeing the browser's "sound playing" icon on the tab but hearing no sound from the speakers.

Both are documented below. Code-level fixes merged to `main` via PR #874 (squash `98a1b276`). Tracked in Linear:
- **HUC-47** — `/instructor/dashboard` returns 500 for instructors whose Clerk `publicMetadata.role` is missing or non-`instructor` — fixed in PR #874, T2 unit tests added in PR #877 (commit `18e34845`).
- **HUC-48** — One-way call audio (instructor can't hear student); root cause unclear; see "Open questions" below. Fixed as diagnostic-only in PR #874.

## Timeline (UTC, from Vercel + browser console)

Ordered by event time. Session ID `mentorship-kd7b06sx4gm0av5r8ym8yxk4nx8f1b9z`. The instructor successfully joined the call (token + consent both 200), then bounced off `/instructor/dashboard` five times across ~2 minutes:

```
17:36:29  POST /api/video/start-adhoc              200
17:36:30  GET  /instructor/dashboard                500  ForbiddenError: Instructor role required
17:36:32  GET  /api/video/token/mentorship-...      200
17:36:53  GET  /instructor/dashboard                500  ForbiddenError: Instructor role required
17:37:35  GET  /instructor/dashboard                500  ForbiddenError: Instructor role required
17:37:37  GET  /workspace/...                       200
17:37:38  GET  /instructor/dashboard (etc)          200  ← UI navigation under /instructor/* still works
17:37:43  POST /api/video/consent/...               200
17:37:44  GET  /api/video/token/...                 200
17:39:54  GET  /instructor/dashboard                500  UnauthorizedError (transient — Clerk auth race?)
```

Browser console message for the user-visible 500:

```
GET https://dev.mentorships.huckleberry.art/instructor/dashboard 500 (Internal Server Error)
4ba4dc2fe15c4a20.js?dpl=dpl_242D5EjiU1wRaCXnX1tALt7SEerZ:1
Error: An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.
A digest property is included on this error instance which may provide additional details about the nature of the error.
```

The "transient `UnauthorizedError`" at 17:39:54 is almost certainly a Clerk auth race during a session-claim refresh — the same effect as the ForbiddenError, just earlier in the request before the Clerk API fallback could resolve.

## Root cause — `/instructor/dashboard` 500

`apps/platform/app/instructor/dashboard/page.tsx:26` calls `requireRole("instructor")` (from `apps/platform/lib/auth-helpers.ts:67`). The relevant branch is:

```ts
// apps/platform/lib/auth-helpers.ts:82-84
if (requiredRole === "instructor" && role !== "instructor" && role !== "admin") {
  throw new ForbiddenError("Instructor role required");
}
```

`role` is resolved in this order:

```ts
// apps/platform/lib/auth-helpers.ts:75-76
const claimsRole = (sessionClaims?.publicMetadata as Record<string, unknown> | undefined)?.role;
const role: UserRole = isKnownRole(claimsRole) ? claimsRole : await getServerUserRole(userId);
```

`getServerUserRole` (`apps/platform/lib/auth-helpers.ts:37-56`) calls `clerkClient().users.getUser(userId)` and reads `user.publicMetadata?.role`. **If Clerk returns `undefined` for `role`, it defaults to `"student"`** (line 55).

So for an instructor whose Clerk `publicMetadata.role` is **missing**, `requireRole("instructor")` always throws ForbiddenError, regardless of whether they are a real instructor in the database.

We can confirm the user IS an instructor in the database: `/api/video/token/[roomName]` returned 200 at 17:36:32, and that endpoint uses `getSessionByVideoRoomName` (`convex/sessions.ts:1917`) to grant `role: "owner"` if `instructor.userId === identity.subject` (`convex/sessions.ts:1958`). The video token endpoint doesn't gate on Clerk role at all — it gates on the database. So the user's database record says "instructor" but their Clerk metadata doesn't.

This is a **silent dual-source-of-truth divergence**: the database has the instructor record, but Clerk's publicMetadata says nothing (or says something else). The video-call path works because it consults the DB; the dashboard path 500s because it consults only Clerk.

## Fix — `/instructor/dashboard` 500

`requireRole("instructor")` (and `requireRoleForApi("instructor")`) should fall back to the database when Clerk's role is missing or unknown. The canonical "is this user an instructor?" query already exists: `api.instructors.getCurrentInstructor` (`convex/instructors.ts:941-956`) returns the instructor row matching `identity.subject`, or `null`.

Pseudocode (the actual diff is small and lives in `apps/platform/lib/auth-helpers.ts`):

```ts
// after Clerk role resolution
if (requiredRole === "instructor" && role !== "instructor" && role !== "admin") {
  // Clerk says "not an instructor". Before throwing, ask Convex.
  // This closes the dual-source-of-truth hole between Clerk
  // publicMetadata.role (often missing for legacy instructors)
  // and the canonical `instructors` table.
  const dbInstructor = await fetchInstructorRecordByClerkUserId(userId);
  if (dbInstructor) {
    return { id: userId, role: "instructor" };
  }
  throw new ForbiddenError("Instructor role required");
}
```

**Trade-offs / risks:**

- One extra Convex read per dashboard hit for instructors whose Clerk role key is missing. Bounded by `by_userId` index, so O(1) in the index.
- The fallback only succeeds when (a) the user has an `instructors` row matching their Clerk `userId` AND (b) that row is not soft-deleted AND (c) the Clerk `publicMetadata.role` key is **absent entirely**. Explicit Clerk-side demotions (`role: "student"`, `role: "support"`, etc.) take effect immediately — the DB fallback is skipped because `sessionClaims.publicMetadata.role !== undefined`. This respects explicit admin demotion while still recovering users with missing/stale Clerk metadata.
- Server-side token (the `convex` template) is already acquired for these calls elsewhere, so the auth helpers can use the same path. If we don't want auth helpers to be async-on-Convex, an alternative is a small server-only helper that uses the existing `fetchQuery` pattern already used in `apps/platform/app/instructor/dashboard/page.tsx:28-32`.
- For `requireRoleForApi`, the same fallback applies — it's the same logic duplicated. Both helpers get the same fallback to keep behavior consistent across page-level and API-level role checks.

**Test plan:**

- Unit-test `requireRole("instructor")` with a mocked Clerk session where `claimsRole` is undefined AND `clerkClient.users.getUser` returns `{ publicMetadata: {} }`. The fallback should return `{ role: "instructor" }` when the Convex lookup finds a row, throw otherwise.
- Integration smoke: log in as an instructor whose Clerk role is missing → `/instructor/dashboard` should render the dashboard, not the 500.

## Root cause — One-way audio (open investigation)

**Status: NOT yet code-fixed.** The instructor's symptoms:
- Student can hear the instructor (student-side audio playback works).
- Instructor cannot hear the student.
- Browser shows the "sound playing" indicator on the tab → the instructor's browser IS producing audio; the user just can't hear it.

### Hypotheses ranked

1. **Instructor-side audio output device is wrong / muted.** The most common cause of "sound icon visible, no sound" in Chrome. Likely candidates: Bluetooth headphones disconnected, audio routed to a non-existent output, system volume at zero, tab muted by Chrome (in which case the icon should show a crossed-out speaker — but users sometimes read the icon incorrectly). The "student hears the instructor" half is consistent with this hypothesis — the student's speakers are fine.

2. **Daily audio playback blocked by the browser's autoplay policy.** When the call joins programmatically (auto-join effect on a deep-link `/workspace/[id]?join=...`), Chrome can suspend audio playback until the user interacts with the page. The browser may report the tab as "playing audio" (sound icon) while the underlying `HTMLAudioElement.play()` promise is rejected — the audio technically reaches the audio output device but the OS layer suppresses it.

3. **Asymmetric subscription state.** `<DailyAudio autoSubscribeActiveSpeaker />` (`apps/platform/components/video/video-call.tsx:226`) is only effective when the call uses **manual** track subscriptions. Daily rooms in this app default to **automatic** subscriptions (`apps/platform/lib/daily.ts:260-302` — no `subscribe_to_tracks` override), so the `autoSubscribeActiveSpeaker` prop is a **no-op** here. With auto-subscription, both sides should receive both sides' audio automatically. If one side doesn't, the issue is almost certainly not the subscription model.

### What the code can fix

Even if the underlying cause is #1 or #2 (user/browser configuration), the app currently has **no observable signal when audio playback fails**. `<DailyAudio>` (`@daily-co/daily-react@0.25.3`, see `node_modules/.../daily-react/dist/components/DailyAudio.d.ts`) accepts an `onPlayFailed` callback. Wiring it up converts "silent audio failure" into a UI-visible warning with a recovery action (e.g., prompt to unmute the tab or check the audio output device).

```tsx
<DailyAudio
  autoSubscribeActiveSpeaker
  onPlayFailed={(e) => {
    // Show a toast: "Couldn't play call audio. Check that this tab
    // isn't muted and your speakers/headphones are connected."
    toast.error("Call audio isn't playing", { description: e.message });
    void reportError({
      source: "video-call.audio-play-failed",
      error: new Error(e.message),
      level: "warn",
    });
  }}
/>
```

This is a **diagnostic improvement**, not a root-cause fix. It should be paired with a runbook entry (this doc, "Operator runbook" section below).

### What we need from the instructor to diagnose

We don't have enough telemetry to distinguish #1 from #2. To narrow it down, ask the instructor:

- Open Chrome's `chrome://settings/content/sound` and check whether the platform's origin (`dev.mentorships.huckleberry.art`) is muted.
- Open `chrome://media-internals` during a call and check the active `AudioStream` rows — if only the instructor's outbound stream is listed and no inbound stream exists, the browser never received a track to play (asymmetric subscription, would invalidate #1 and #3).
- Check the OS-level default audio output device (System Settings → Sound). If a Bluetooth or USB device is the default and is disconnected, macOS will show the icon but route to silence.
- Try a second browser (e.g., Safari) to rule out a Chrome-specific policy.

## Operator runbook — instructor reports "I can't hear the student"

When an instructor reports one-way audio (typically: instructor can't hear the student, but the student hears the instructor), walk through these steps in order. The goal is to distinguish a user-side configuration issue (most common) from a code bug (rare).

1. **Ask whether the instructor's tab is muted in Chrome.** Chrome's tab mute icon is a crossed-out speaker. If they see a normal speaker icon, the tab is NOT muted, but they still might be looking at a different tab.
2. **Ask about their audio output device.** Bluetooth headphones that auto-disconnect are the single most common cause. System Settings → Sound → Output should show a real, connected device.
3. **Open `chrome://media-internals` in another tab during a live call.** Look for the `AudioStream` rows. If the instructor has no inbound audio stream, the browser never received a track from the student's side. If they have an inbound stream but no sound, the audio output is the issue (back to step 2).
4. **Try `/?join=...` deep-link vs. in-app Start Call button.** Auto-joined calls (deep-link from a notification) are more likely to hit Chrome's autoplay policy than calls started by an explicit user click on "Start call".
5. **Check Vercel logs for the call's session id.** If `/api/video/token/...` returned 200 and `/api/video/consent/...` returned 200, the server-side wiring is fine. If the instructor is also seeing `GET /instructor/dashboard 500`, fix the role bug first — they may be navigating away from the call to look at the dashboard, and the navigation issue is the primary friction.

If the diagnostic onPlayFailed handler ships (see "What the code can fix" above), `reportError` will emit a `video-call.audio-play-failed` event the operator can grep for in the observability stack.

## Verification

After the role-fallback fix ships:

- **T1.** `pnpm typecheck` and `pnpm lint` pass on the touched files (`apps/platform/lib/auth-helpers.ts`, `apps/platform/components/video/video-call.tsx`). ✅ PR #874 CI green.
- **T2.** Unit tests for `requireRole("instructor")` and `requireRoleForApi("instructor")` cover the new fallback path: throws on no-instructor-record, returns instructor on DB match. ✅ PR #877 — 30 unit tests in `apps/platform/lib/auth-helpers.test.ts` covering the full Greptile review matrix (round-1 P1 soft-delete filter, round-3 P1 stale `student` claim, round-3 P2 explicit demotion via Clerk API, admin gate, identity drift, Convex outage swallowing). Greptile CLI round 3 confidence 5/5, 0 review comments.
- **T3.** Manual smoke on `dev.mentorships.huckleberry.art`: log in as an instructor whose Clerk `publicMetadata.role` is undefined; `/instructor/dashboard` renders the dashboard skeleton (not the 500 error page). ⏳ Open — requires operator action (impersonate the failing instructor from session `mentorship-kd7b06sx4gm0av5r8ym8yxk4nx8f1b9z`).
- **T4.** Greptile + CodeRabbit review both approve the PR before merge (per `AGENTS.md` PR Merge Policy). ✅ PR #874: Greptile CLI round 4 confidence 5/5, CodeRabbit SUCCESS, merge squash `98a1b276`.

For the audio diagnostic:

- **T1.** Forced audio-play failure (e.g., mute the tab then start a call) surfaces a toast + reportError entry. ⏳ Open — manual browser test, no automated check yet.

## References

- `apps/platform/lib/auth-helpers.ts:67-87` — `requireRole` (the function that 500s).
- `apps/platform/lib/auth-helpers.ts:37-56` — `getServerUserRole` (the function that defaults to `"student"` when Clerk role is missing).
- `apps/platform/app/instructor/dashboard/page.tsx:26` — call site.
- `convex/sessions.ts:1917-1992` — `getSessionByVideoRoomName` (the DB-based role check that DOES work for the instructor, and proves the user IS an instructor).
- `convex/instructors.ts:941-956` — `getCurrentInstructor` (canonical "is this user an instructor" query — the fallback target).
- `apps/platform/components/video/video-call.tsx:226` — `<DailyAudio autoSubscribeActiveSpeaker />` (current single-line audio render; no error handler).
- `node_modules/.pnpm/@daily-co+daily-react@0.25.3.../dist/components/DailyAudio.d.ts` — `onPlayFailed` prop type signature.
- `apps/platform/lib/daily.ts:260-302` — `createDailyRoom` (room config; default auto-subscription).
- `apps/platform/lib/notifications/sound.ts:1-116` — pre-existing `playIncomingCallChime` Web Audio chime (good model for the user-facing copy in the onPlayFailed toast).
