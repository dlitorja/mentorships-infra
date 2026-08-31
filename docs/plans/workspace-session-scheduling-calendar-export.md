---
name: Workspace Session Scheduling and Calendar Export
overview: Add provider-independent session scheduling inside apps/platform workspaces, display upcoming sessions to instructors and students, and offer authenticated one-time iCalendar export for Apple Calendar, Google Calendar, Outlook, and other compatible clients. Keep the platform as the source of truth and leave live external-calendar synchronization out of the MVP.
status: proposed
primary_app: apps/platform
todos:
  - id: confirm-product-decisions
    owner: user
    phase: 0
    content: Confirm the MVP decisions and open questions documented in this plan
    status: pending
  - id: harden-session-creation
    owner: agent
    phase: 1
    content: Secure existing session creation so caller identity, workspace, instructor, student, and session pack relationships are derived or validated server-side
    status: pending
    dependencies:
      - confirm-product-decisions
  - id: associate-sessions-with-workspaces
    owner: agent
    phase: 1
    content: Add an optional workspaceId to sessions, add the required index, and backfill safely where an unambiguous active workspace exists
    status: pending
    dependencies:
      - confirm-product-decisions
  - id: workspace-session-api
    owner: agent
    phase: 1
    content: Add authorized workspace upcoming-session query and instructor-only scheduling mutation with bounded results and server-side validation
    status: pending
    dependencies:
      - harden-session-creation
      - associate-sessions-with-workspaces
  - id: workspace-session-ui
    owner: agent
    phase: 2
    content: Add responsive next-session display, upcoming-session list, and instructor scheduling dialog to the selected workspace
    status: pending
    dependencies:
      - workspace-session-api
  - id: workspace-session-actions
    owner: agent
    phase: 2
    content: Expose existing reschedule and cancel actions from the workspace while preserving authorization and timezone behavior
    status: pending
    dependencies:
      - workspace-session-ui
  - id: ics-export
    owner: agent
    phase: 3
    content: Add an authenticated RFC 5545 iCalendar download endpoint and Add to calendar action for scheduled sessions
    status: pending
    dependencies:
      - workspace-session-ui
  - id: test-and-verify
    owner: agent
    phase: 4
    content: Add backend, API, component, timezone, and calendar-export coverage; run affected app verification
    status: pending
    dependencies:
      - workspace-session-actions
      - ics-export
  - id: rollout-and-observe
    owner: agent
    phase: 5
    content: Roll out the workspace scheduling surface, monitor failures, and collect demand for subscriptions or full provider synchronization
    status: pending
    dependencies:
      - test-and-verify
---

# Workspace Session Scheduling and Calendar Export

## 1. Status

**Status:** Proposed; implementation has not started.

This document is the implementation tracker for provider-independent session scheduling in `apps/platform`. No product or technical decision in this plan should be treated as final until Phase 0 is approved.

## 2. Goal

Give an instructor a basic, dependable way to schedule upcoming sessions from each active student workspace without requiring Google Calendar, Apple Calendar, or another external provider to be connected.

The resulting session must:

- Be stored in the platform as the canonical record.
- Be visible to both workspace participants.
- Reuse the existing session lifecycle, video-call, notes, completion, cancellation, and session-pack behavior.
- Support one-time export to common calendar applications through an `.ics` file.
- Continue to work when all external calendar integrations are unavailable.

## 3. Product Principles

1. **The platform is the source of truth.** External calendars are optional representations of a platform session.
2. **Scheduling must not depend on provider health.** Google or iCloud outages and disconnected accounts cannot prevent an instructor from recording the next session.
3. **Use the existing session model.** Do not create a separate `nextSessionAt` workspace field that can drift from `sessions`.
4. **Workspace relationships are server-derived.** The client must not choose arbitrary instructor, student, or session-pack identifiers.
5. **Calendar export is one-way in the MVP.** Downloading an event does not imply synchronization.
6. **Timezones must be explicit.** A displayed local date must never be silently interpreted in a different timezone.
7. **Keep the first release narrow.** Availability search, recurring sessions, invitations, RSVP handling, and external conflict detection are separate features.

## 4. Current State

### 4.1 Capabilities that already exist

- `convex/schema.ts` contains first-class `sessions` records with `scheduledAt`, status, recording consent, notes, video metadata, and an optional Google event identifier.
- `convex/sessions.ts` contains creation, rescheduling, cancellation, completion, and instructor/student session queries.
- `apps/platform/components/instructor/book-session-dialog.tsx` already provides an instructor-facing manual date/time form.
- `apps/platform/app/api/instructor/students/[studentId]/sessions/route.ts` already creates a session without requiring Google Calendar.
- `apps/platform/components/instructor/session-actions.tsx` already provides reschedule and cancel dialogs.
- `apps/platform/components/workspace/workspace-client-page.tsx` already renders the selected workspace header, session-count controls, call status, and role-aware actions.
- Workspaces expose their active `sessionPackId` through `api.workspaces.getUserWorkspaces`.

### 4.2 Gaps to resolve before reuse

The existing manual path should not simply be mounted in a workspace unchanged.

1. The manual API verifies that a supplied session pack exists and is active, but it does not prove that the pack belongs to the selected student and authenticated instructor.
2. `api.sessions.createSession` currently accepts instructor, student, and pack identifiers directly and does not enforce participant ownership itself.
3. The existing manual dialog parses `datetime-local` using the browser timezone rather than an explicitly displayed instructor timezone.
4. Sessions do not currently store `workspaceId`; workspace membership is inferred through instructor/student or session-pack relationships.
5. There is no workspace query dedicated to a bounded list of upcoming sessions.
6. There is no provider-neutral calendar export.
7. Existing UI text suggests some session changes notify the student, but notification delivery is not part of the basic creation route and must not be implied unless implemented and verified.

## 5. MVP Scope

### 5.1 In scope

1. Schedule a future session from an active instructor/student workspace.
2. Show the next upcoming session in the selected workspace to both participants.
3. Show a bounded list of additional upcoming sessions for that workspace.
4. Allow the instructor to reschedule or cancel a scheduled workspace session.
5. Store a direct workspace association on newly created sessions.
6. Backfill direct associations for existing sessions where the matching workspace is unambiguous.
7. Keep session-pack consumption behavior unchanged; scheduling does not consume an additional session unless the existing completion flow does so.
8. Generate an authenticated `.ics` file for a session.
9. Provide an `Add to calendar` or `Download calendar event` action to both participants.
10. Handle desktop and mobile workspace layouts.
11. Add authorization, timezone, API, component, and iCalendar tests.

### 5.2 Out of scope

- Reading Apple Calendar or Google Calendar availability.
- Preventing conflicts against an external calendar.
- Automatically creating, updating, or deleting external events.
- Two-way synchronization.
- Calendar account connection settings.
- iCloud CalDAV credentials or app-specific passwords.
- Native EventKit integration.
- Recurring session rules.
- Student self-scheduling from the workspace.
- Proposed-time approval workflows.
- RSVP tracking or organizer/attendee invitation semantics.
- Emailing `.ics` invitations or cancellation messages.
- Private subscribable calendar feeds.
- Changing session-pack accounting rules.
- Supporting group sessions with multiple students.
- Replacing the existing Google Calendar work already in progress.

## 6. Proposed User Experience

### 6.1 Workspace header

Add a compact scheduling surface near the existing call-status and session-count controls.

When a future session exists:

```text
Next session
Tue, Sep 8 at 2:00 PM EDT
[Add to calendar] [Manage]
```

When no future session exists, instructors see:

```text
No upcoming session
[Schedule session]
```

Students see `No upcoming session` without a scheduling control.

### 6.2 Multiple upcoming sessions

The primary surface shows the earliest scheduled session. If more exist, display a small `View all` action with a count. The expanded view should be bounded, initially showing at most 10 upcoming sessions ordered by `scheduledAt` ascending.

The implementation must not model the feature as a single mutable date. Instructors may schedule more than one upcoming session by adding sessions one at a time.

### 6.3 Scheduling dialog

Instructor-only fields:

- Date.
- Start time.
- Explicit timezone.
- Optional private session notes, subject to the existing 500-character limit.

Initial duration is fixed at 60 minutes and stated in the dialog. Configurable duration is deferred until there is a concrete product requirement.

The timezone defaults to the instructor profile timezone when valid. If no valid profile timezone exists, use the browser-detected IANA timezone as the proposed value and require it to remain visibly selected when the instructor submits.

The dialog must:

- Reject invalid or past times.
- Parse the entered wall-clock time in the selected timezone.
- Reject nonexistent local times during daylight-saving transitions.
- Clearly disambiguate repeated local times if the timezone library cannot choose safely.
- Disable submission while pending.
- Preserve entered values after a recoverable server error.
- Explain why scheduling is unavailable when the workspace has ended or no active session pack is available.

### 6.4 Session management

The `Manage` action opens the existing reschedule/cancel functionality or a workspace-specific wrapper around it.

- Only the owning instructor can reschedule or cancel.
- Students can view status but cannot mutate it.
- A canceled session no longer appears as the next session.
- The next later scheduled session becomes visible automatically through the Convex subscription.
- Ended or deleted workspaces do not permit new scheduling.

### 6.5 Calendar action

Both participants can download the calendar event. UI copy must explain that this adds a copy and that later platform changes may require downloading the event again.

Recommended copy:

```text
Add this session to Apple Calendar, Google Calendar, Outlook, or another calendar app. This downloaded event will not stay synchronized automatically.
```

## 7. Data Model

### 7.1 Session workspace association

Widen `sessions` with:

```ts
workspaceId?: Id<"workspaces">
```

Add an index designed for the workspace upcoming-session query:

```text
by_workspaceId_status_scheduledAt
```

Index fields:

```text
workspaceId, status, scheduledAt
```

The index enables an exact range query for scheduled sessions in one workspace after a client-supplied `now` value. The query must not call `Date.now()` because Convex queries do not rerun merely as wall-clock time advances.

Before adding the index, inspect production table size. If the sessions table is large enough for index backfill to affect deployment, add it as a staged index and activate it in a later deployment.

### 7.2 Backfill strategy

Use widen-migrate-narrow discipline:

1. Widen the schema with optional `workspaceId`.
2. Begin writing `workspaceId` for every new scheduled workspace session.
3. Backfill an existing session only when exactly one non-deleted workspace matches its instructor and student relationship.
4. Prefer the workspace associated with the session pack when that relationship is available and valid.
5. Record and report ambiguous or unmatched rows; do not guess.
6. Keep `workspaceId` optional because historical, imported, and ad-hoc sessions may legitimately lack a workspace.
7. Do not narrow to required unless a later audit proves every supported session type has a workspace.

### 7.3 Duration

Do not add duration fields in the initial implementation. The `.ics` end time is `scheduledAt + 60 minutes`.

If configurable duration becomes a requirement, add `durationMinutes` as an optional validated integer in a separate change and default historical rows to 60 minutes at read/export time.

## 8. Backend Design

### 8.1 Workspace upcoming-session query

Add a public authenticated Convex query conceptually shaped as:

```ts
getUpcomingForWorkspace({
  workspaceId,
  now,
  limit,
})
```

Requirements:

- Validate all arguments.
- Require the caller to be an authorized workspace participant.
- Reject or return no data for soft-deleted workspaces.
- Query `by_workspaceId_status_scheduledAt` with `status = scheduled` and `scheduledAt > now`.
- Clamp `limit` to a small server-controlled maximum, initially 10.
- Return results ordered ascending.
- Return only UI-required fields.
- Do not leak private notes to students if existing notes are intended to remain instructor-only.

The client should refresh the supplied `now` periodically or at the next-session boundary so a session that passes naturally drops from the upcoming list without a database write.

### 8.2 Instructor scheduling mutation

Add a dedicated mutation conceptually shaped as:

```ts
scheduleForWorkspace({
  workspaceId,
  scheduledAt,
  notes?,
})
```

The mutation must derive the following from the authenticated workspace and related records:

- Instructor ID.
- Student user ID.
- Active session-pack ID.
- Workspace ID.

Server-side validation:

1. Caller is authenticated.
2. Caller is the instructor assigned to the workspace.
3. Workspace exists, is not deleted, and has not ended.
4. Workspace has both an instructor and student owner.
5. The resolved session pack belongs to that exact instructor/student pair.
6. The pack is active, not expired, and has at least one remaining session.
7. `scheduledAt` is finite and in the future.
8. Notes are trimmed and no longer than 500 characters.
9. An exact duplicate scheduled session is not already present for the same workspace and timestamp.

The duplicate guard protects against double-submit and retry behavior. It is not an external-calendar conflict detector.

The mutation inserts a standard `sessions` row with:

- `workspaceId`.
- Derived instructor, student, and pack identifiers.
- `status: "scheduled"`.
- Existing recording-consent defaults selected by the product.
- Optional notes.

### 8.3 Existing session creation hardening

The existing generic creation path is used by other booking surfaces and needs separate authorization hardening rather than a client-side workaround.

Required outcomes:

- An authenticated student can create only a session for their own eligible pack and its instructor.
- An authenticated instructor can create only for a workspace/student and pack assigned to them.
- The client cannot pair a valid pack with a different instructor or student.
- Direct Convex calls receive the same checks as Next.js API calls.
- Existing Google-backed student booking remains functional.
- If a public generic mutation cannot express these roles clearly, split it into purpose-specific mutations and make shared insert logic internal.

### 8.4 Reschedule and cancellation

Reuse the existing session lifecycle after verifying:

- Authorization is enforced in Convex, not only in the UI or API route.
- Rescheduling rejects past timestamps.
- Workspace association remains unchanged.
- Calendar-provider failures do not block the platform update.
- UI copy does not promise an email or external-calendar update unless that operation is implemented.

Live Google event synchronization, where available, remains existing-provider behavior and is not expanded by this plan.

## 9. iCalendar Export

### 9.1 Endpoint

Add an authenticated endpoint following the existing route conventions, for example:

```text
GET /api/sessions/{sessionId}/calendar.ics
```

Authorization:

- Require an authenticated user.
- Load the session and associated workspace server-side.
- Permit only the workspace instructor or student owner.
- Return `404` rather than exposing the existence of an inaccessible session where appropriate.

Response headers:

```text
Content-Type: text/calendar; charset=utf-8
Content-Disposition: attachment; filename="session-{safe-id}.ics"
Cache-Control: private, no-store
```

### 9.2 Event format

Generate RFC 5545-compatible content with CRLF line endings and correct escaping/folding.

Minimum fields:

- `BEGIN:VCALENDAR`
- `VERSION:2.0`
- `PRODID`
- `CALSCALE:GREGORIAN`
- `BEGIN:VEVENT`
- Stable `UID` derived from the session ID and an application-owned domain.
- `DTSTAMP` in UTC.
- `DTSTART` in UTC.
- `DTEND` in UTC, initially 60 minutes after start.
- `SUMMARY` with non-sensitive product copy.
- `DESCRIPTION` with a workspace deep link and no private notes.
- `URL` pointing to the workspace.
- `STATUS:CONFIRMED` for scheduled sessions.
- `END:VEVENT`
- `END:VCALENDAR`

Do not include organizer or attendee fields in the MVP. Those fields can trigger invitation and update semantics that require delivery, RSVP, cancellation, and duplicate-management behavior outside this scope.

### 9.3 Update limitations

A downloaded file is a snapshot. Rescheduling or canceling the platform session does not reliably modify a previously imported event.

The stable `UID` helps compatible clients recognize repeated imports, but the product must not claim automatic synchronization. A later calendar subscription or provider adapter would be required for that guarantee.

## 10. Frontend Design

### 10.1 Likely files

Existing files likely to change:

- `apps/platform/components/workspace/workspace-client-page.tsx`
- `apps/platform/components/instructor/book-session-dialog.tsx`
- `apps/platform/components/instructor/session-actions.tsx`
- `apps/platform/lib/queries/convex/use-sessions.ts`
- `apps/platform/lib/timezone.ts`
- `apps/platform/app/api/instructor/students/[studentId]/sessions/route.ts`
- `convex/schema.ts`
- `convex/sessions.ts`

Likely new files:

- A focused workspace next-session component.
- A workspace scheduling dialog or a generalized secure session dialog.
- An authenticated `.ics` route.
- iCalendar serialization utility and tests.
- Convex session authorization/scheduling tests.

Exact names should be chosen during implementation based on nearby conventions. Avoid embedding all scheduling state into `workspace-client-page.tsx`.

### 10.2 Loading and error states

- Render a compact skeleton while the workspace session query loads.
- Keep the rest of the workspace usable if scheduling data fails.
- Surface a retry action for query failures.
- Use actionable mutation errors such as ended workspace, depleted pack, stale data, or invalid time.
- Do not convert server authorization failures into generic success or empty states.

### 10.3 Responsive behavior

- Desktop: keep the next-session surface inline with or immediately below workspace actions without crowding call controls.
- Mobile: stack the date and actions vertically; keep primary actions at least the existing design-system touch target size.
- Active call: do not duplicate scheduling controls inside the call overlay unless a later UX review explicitly requires them.

### 10.4 Accessibility

- Associate every date, time, timezone, and notes input with a visible label.
- Ensure dialog focus trapping and restoration use the existing design-system primitives.
- Give icon-only actions accessible names.
- Announce success and error outcomes through the existing toast/live-region behavior.
- Do not communicate canceled or scheduled status by color alone.

## 11. Testing Scope

### 11.1 Convex tests

Add tests for:

- Assigned instructor can schedule in an active workspace.
- Student cannot schedule through the instructor mutation.
- Unrelated instructor and unrelated student are denied.
- Ended and deleted workspaces are denied.
- Missing, inactive, expired, depleted, or mismatched packs are denied.
- Past and invalid timestamps are denied.
- Duplicate submission does not create duplicate sessions.
- New rows contain the correct workspace, instructor, student, and pack IDs.
- Upcoming query returns only scheduled future sessions for that workspace in ascending order.
- Query result is bounded.
- A participant cannot read another workspace's sessions.
- Existing student booking remains authorized and functional after hardening.

### 11.2 API and utility tests

Add tests for:

- Unauthenticated `.ics` requests.
- Nonparticipant `.ics` requests.
- Missing and soft-deleted sessions.
- Correct response headers.
- UTC start/end values.
- Stable UID.
- Escaping commas, semicolons, backslashes, and newlines.
- CRLF output and long-line folding.
- No private notes, email addresses, credentials, or internal identifiers beyond the opaque session UID.

### 11.3 Component tests

Add tests for:

- Instructor empty state and scheduling action.
- Student read-only empty state.
- Next-session rendering.
- Multiple-upcoming-session count and expansion.
- Submit disabled/pending behavior.
- Timezone visible in the form and rendered result.
- Server error preservation and retry.
- Reschedule/cancel permissions.
- Calendar download action.

### 11.4 Verification commands

Determine exact package scripts at implementation time, then run at minimum:

- `apps/platform` typecheck.
- `apps/platform` lint.
- Affected Vitest suites.
- Convex tests.
- `apps/platform` production build.
- Relevant end-to-end workspace tests if the authenticated fixture is available.
- Local Greptile review before opening a pull request, as required by repository policy.

## 12. Delivery Phases

### Phase 0: Product confirmation

Confirm:

- Instructors schedule; students view only.
- Multiple future sessions are allowed.
- Initial duration is fixed at 60 minutes.
- Notes remain private to instructors.
- Calendar export is a one-time snapshot.
- No email notification is promised in the MVP.

### Phase 1: Backend foundation

1. Harden existing creation authorization.
2. Widen the session schema with optional `workspaceId` and the upcoming-session index.
3. Add and run the deterministic backfill.
4. Add workspace-scoped query and scheduling mutation.
5. Add backend authorization and behavior tests.

Suggested pull request boundary: backend only, with no user-facing workspace control.

### Phase 2: Workspace scheduling UI

1. Add next-session and bounded upcoming-session surfaces.
2. Add the instructor scheduling dialog.
3. Reuse secured reschedule/cancel actions.
4. Add loading, error, mobile, and accessibility states.
5. Add component tests.

Suggested pull request boundary: usable provider-independent scheduling.

### Phase 3: Calendar export

1. Add the iCalendar serializer.
2. Add the authenticated download endpoint.
3. Add calendar actions and limitation copy.
4. Add endpoint and serializer tests.

Suggested pull request boundary: one-time external calendar portability.

### Phase 4: Verification

1. Run typecheck, lint, tests, and production build.
2. Manually test instructor and student views across desktop and mobile.
3. Import an exported event into Apple Calendar, Google Calendar, and Outlook where test clients are available.
4. Verify Google Calendar connection and booking behavior has not regressed.
5. Run local Greptile review and address findings before creating each pull request.

### Phase 5: Rollout and follow-up evaluation

Track:

- Scheduling mutation failures by reason.
- Calendar-download failures.
- User confusion about one-time export versus synchronization.
- Requests for recurring sessions.
- Requests for automatic updates.
- Requests to read external availability.

Use that evidence to choose whether the next investment should be calendar subscriptions, provider-specific adapters, or a third-party calendar integration service.

## 13. Acceptance Criteria

The MVP is complete when:

1. An assigned instructor can schedule a future session from an active student workspace without connecting a calendar.
2. The session appears reactively as the next session for both workspace participants.
3. Additional upcoming sessions are accessible in chronological order.
4. An unrelated user cannot create, view, reschedule, cancel, or export the session.
5. Instructor, student, workspace, and pack relationships cannot be forged through client arguments.
6. Rescheduling and cancellation update the workspace display without a full page reload.
7. Scheduling and display use explicit, tested timezone conversion.
8. Both participants can download a valid `.ics` event.
9. The exported event imports successfully into at least Apple Calendar and one non-Apple calendar client.
10. UI copy clearly states that the exported event does not automatically synchronize.
11. Existing Google Calendar flows continue to work.
12. Typecheck, lint, tests, and production build pass for the affected app.

## 14. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Existing session creation permits mismatched relationships | Harden Convex authorization before exposing the workspace UI. |
| Browser timezone differs from instructor timezone | Parse against an explicitly selected IANA timezone and store UTC milliseconds. |
| Existing sessions lack direct workspace IDs | Use optional widening and a deterministic, auditable backfill; do not guess ambiguous mappings. |
| Users assume `.ics` stays synchronized | Place limitation copy adjacent to the calendar action. |
| Repeated clicks create duplicate sessions | Disable pending UI and enforce a server-side exact-duplicate guard. |
| Calendar export leaks private notes or participant details | Export neutral summary/description only and authorize every request. |
| New workspace UI crowds call controls | Use a compact component and stack actions on narrow screens. |
| Google integration behavior becomes coupled to core scheduling | Commit the platform session first; treat provider behavior as an optional adapter. |

## 15. Follow-up Options

These are intentionally not committed by this plan.

### 15.1 Private calendar subscription

Expose a revocable, high-entropy calendar-feed URL containing the user's upcoming sessions. Apple Calendar, Google Calendar, and Outlook can subscribe read-only. Updates and cancellations can eventually propagate, but client refresh timing is controlled by each calendar application.

This requires token rotation, revocation, feed privacy, cancellation semantics, and cache behavior design.

### 15.2 Provider adapters

Continue Google Calendar support behind an adapter interface and evaluate a separate iCloud-capable path only if users need availability reads or automatic event writes.

Apple's EventKit is native-platform technology. Web/server iCloud access has different account authorization and CalDAV considerations and should not be treated as a small extension of the Google integration.

### 15.3 Third-party calendar integration service

Evaluate a vendor only if multi-provider two-way synchronization becomes strategically important. Compare provider coverage, iCloud authorization UX, pricing, webhook reliability, data retention, security posture, and migration/exit costs.

### 15.4 Notifications

Add idempotent in-app and email notifications for scheduled, rescheduled, and canceled sessions. Notification copy and delivery state must be distinct from external-calendar synchronization state.

## 16. Open Questions

Resolve these in Phase 0:

1. Should students remain view-only, or should they be allowed to propose a time?
2. Is a fixed 60-minute duration acceptable for the MVP?
3. Are session notes private to the instructor, shared with the student, or omitted from this scheduling surface?
4. Should instructors be allowed to schedule more upcoming sessions than the pack's remaining count, given that credits are consumed later?
5. Should scheduling be blocked when another platform session for the same instructor overlaps, even without external-calendar availability?
6. Should the MVP send an email confirmation, or is reactive visibility inside the workspace sufficient?
7. Is `Add to calendar` acceptable wording with explanatory copy, or should the action be labeled more literally as `Download calendar event`?

## 17. Progress Log

Add dated entries here as decisions are made and phases are completed.

| Date | Phase | Update | Evidence |
|---|---|---|---|
| 2026-08-30 | Planning | Initial detailed scope drafted; no implementation started. | This document |
