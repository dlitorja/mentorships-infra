import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { z } from "zod";
import { ConvexError } from "convex/values";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  DailyApiError,
  deleteDailyRoom,
  resolveDailyRoom,
} from "@/lib/daily";
import { convexIdSchema } from "@/lib/validators";
import { reportError, reportInfo } from "@/lib/observability";

export const runtime = "nodejs";

type AdhocConvexErrorCode =
  | "VIDEO_UNAUTHORIZED"
  | "VIDEO_SESSION_NOT_FOUND"
  | "VIDEO_FORBIDDEN_NOT_INSTRUCTOR"
  | "VIDEO_FORBIDDEN_CALL_ACTIVE"
  | "VIDEO_ROOM_NAME_TAKEN";

function getAdhocConvexErrorCode(error: unknown): AdhocConvexErrorCode | null {
  if (
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null
  ) {
    const code = (error.data as { code?: unknown }).code;
    if (
      code === "VIDEO_UNAUTHORIZED" ||
      code === "VIDEO_SESSION_NOT_FOUND" ||
      code === "VIDEO_FORBIDDEN_NOT_INSTRUCTOR" ||
      code === "VIDEO_FORBIDDEN_CALL_ACTIVE" ||
      // PR #7: widen-phase uniqueness guard. Triggered when the
      // deterministic room name (mentorship-{sessionId}) already
      // belongs to another session. Should NOT orphan-delete the
      // new session because (a) the duplicate is in the OTHER
      // session's row, and (b) the deterministic name means a
      // retry will hit the same conflict. Caller must investigate.
      code === "VIDEO_ROOM_NAME_TAKEN"
    ) {
      return code;
    }
  }
  return null;
}

const startAdhocSchema = z.object({
  workspaceId: convexIdSchema,
  recordingConsent: z.boolean(),
});

/**
 * Instructor-only: creates a synthetic `sessions` row for an ad-hoc
 * call (catch-up outside any scheduled session), then provisions a
 * Daily room against it. Mirrors the structure of `rooms/route.ts` —
 * Daily REST call with 409-recovery, then `setVideoRoom` to persist.
 *
 * Auth check happens in two places:
 *   1. Clerk auth in this handler (token required for Convex calls).
 *   2. `startAdhocCall` Convex mutation verifies the caller is the
 *      workspace's instructor (`VIDEO_FORBIDDEN_NOT_INSTRUCTOR`).
 *
 * Returns `{ sessionId, roomName, roomUrl }` on success. The client
 * then treats this session as "joinable" and the VideoCallProvider's
 * existing PR #3 logic handles the join.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const clerkAuth = await auth();
    if (!clerkAuth.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json(
        { error: "Failed to acquire auth token" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parsed = startAdhocSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const { workspaceId, recordingConsent } = parsed.data;
    const workspaceIdTyped = workspaceId as Id<"workspaces">;

    let sessionId: Id<"sessions">;
    try {
      const result = await fetchMutation(
        api.sessions.startAdhocCall,
        { workspaceId: workspaceIdTyped, recordingConsent },
        { token }
      );
      sessionId = result.sessionId;
    } catch (error) {
      const code = getAdhocConvexErrorCode(error);
      if (code === "VIDEO_FORBIDDEN_NOT_INSTRUCTOR") {
        return NextResponse.json(
          { error: "Forbidden: only the workspace's instructor can start an ad-hoc call" },
          { status: 403 }
        );
      }
      if (code === "VIDEO_FORBIDDEN_CALL_ACTIVE") {
        return NextResponse.json(
          { error: "Another call is already active in this workspace" },
          { status: 409 }
        );
      }
      if (code === "VIDEO_SESSION_NOT_FOUND") {
        return NextResponse.json(
          { error: "Workspace not found or not joinable" },
          { status: 404 }
        );
      }
      if (code === "VIDEO_UNAUTHORIZED") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      throw error;
    }

    // Both post-session-creation steps are inside the same try block
    // so a failure in either one triggers the orphan cleanup. Without
    // this, a transient Daily 5xx during `resolveDailyRoom` would
    // leave the session row without a `videoRoomName`, and the next
    // `startAdhocCall` would be blocked by the active-candidate guard
    // (isAdhoc === true) until the 4-hour window expires. The
    // `startAdhocCall` mutation also self-heals such orphans
    // (`activeCandidate.videoRoomName === undefined` branch), so the
    // delete here is defense-in-depth rather than the sole recovery
    // path.
    let roomName: string | undefined;
    let roomUrl: string | undefined;
    try {
      const resolved = await resolveDailyRoom(sessionId, {
        recordingEnabled: recordingConsent,
      });
      roomName = resolved.roomName;
      roomUrl = resolved.roomUrl;

      await fetchMutation(
        api.sessions.setVideoRoom,
        {
          sessionId,
          videoRoomName: roomName,
          videoRoomUrl: roomUrl,
          roomRecordingEnabled: recordingConsent,
        },
        { token }
      );
    } catch (error) {
      // PR #7: skip orphan cleanup when the failure is
      // VIDEO_ROOM_NAME_TAKEN. The deterministic room name
      // (mentorship-{sessionId}) guarantees a retry will hit the
      // same conflict, so orphan-deleting the new session only
      // hides the underlying drift. Let the outer catch return 409
      // so the caller can investigate which session owns the name.
      const isRoomNameConflict =
        getAdhocConvexErrorCode(error) === "VIDEO_ROOM_NAME_TAKEN";

      // The session row exists but the Daily room linkage (and
      // possibly the room itself) is incomplete. Without cleanup, the
      // session shows up to the student as a phantom upcoming session
      // with no join URL, AND a freshly created Daily room leaks
      // toward the account's 200-room quota until its 24h expiry.
      // Swallow cleanup errors and always re-throw the original so
      // the outer catch logs the root cause.
      if (!isRoomNameConflict) {
        try {
          await fetchMutation(
            api.sessions.deleteOrphanedAdhocSession,
            { sessionId },
            { token }
          );
        } catch {
          // best-effort cleanup; `startAdhocCall` self-heals stale
          // roomless ad-hoc rows, so this no longer blocks retries.
        }
        // If `resolveDailyRoom` succeeded before the failure, the Daily
        // room itself was created. Delete it so we don't leak the slot.
        // `roomName` is undefined when `resolveDailyRoom` itself threw
        // before returning, so we skip the cleanup in that case.
        if (roomName !== undefined) {
          try {
            await deleteDailyRoom(roomName);
          } catch {
            // best-effort; Daily's 24h `exp` reaps the room either way
            // and the next attempt's `resolveDailyRoom` will reuse the
            // existing room via the 409-recovery path.
          }
        }
      }
      throw error;
    }

    // PR #4c-2: notify the student that an ad-hoc call has started.
    // Two channels: in-app notification row (read by the sidebar bell +
    // per-workspace badge + toast), and a Resend email (for offline /
    // away-from-UI cases). The email goes through Trigger.dev so the
    // HTTP route returns immediately even if Resend is slow.
    //
    // The notification insert + email enqueue is moved into `after()`
    // (Next.js 16) so the route returns the sessionId to the client
    // without waiting on Trigger.dev network latency. Both steps are
    // best-effort and never block the call: a failure here just means
    // the student gets the workspace UI without an out-of-band
    // notification, not a failed call. Errors are logged at `warn`
    // (not `error`) because the user's experience is already
    // acceptable.
    after(async () => {
      try {
        const notificationId = await fetchMutation(
          api.inCallNotifications.createAdHocCallNotification,
          {
            sessionId,
            workspaceId: workspaceIdTyped,
          },
          { token }
        );

        await enqueueAdHocCallEmail({
          sessionId,
          workspaceId: workspaceIdTyped,
          notificationId,
          token,
        });
      } catch (notifyError) {
        await reportError({
          source: "api/video/start-adhoc.notify",
          error:
            notifyError instanceof Error
              ? notifyError
              : new Error(String(notifyError)),
          level: "warn",
          message: "Failed to create ad-hoc notification or enqueue email",
          context: {
            sessionId: String(sessionId),
            workspaceId: String(workspaceIdTyped),
          },
        });
      }
    });

    return NextResponse.json({ sessionId, roomName, roomUrl });
  } catch (error) {
    // PR #7: handle the new VIDEO_ROOM_NAME_TAKEN before the
    // DailyApiError / generic-error fallthroughs so the route
    // returns a distinguishable 409 instead of a 500.
    const adhocCode = getAdhocConvexErrorCode(error);
    if (adhocCode === "VIDEO_ROOM_NAME_TAKEN") {
      await reportError({
        source: "api/video/start-adhoc",
        error,
        message:
          "videoRoomName already taken by another session; deterministic name means a retry will not help — investigate duplicates",
        level: "warn",
      });
      return NextResponse.json(
        {
          error:
            "Room name already in use by another session; please retry shortly — if the error persists, contact support",
        },
        { status: 409 }
      );
    }
    if (error instanceof DailyApiError) {
      await reportError({
        source: "api/video/start-adhoc",
        error,
        message: "Daily.co create-room failed during ad-hoc start",
        level: "error",
        context: { statusCode: error.statusCode, errorType: error.errorType },
      });
      return NextResponse.json(
        {
          error: "Failed to create video room",
          details: error.info ?? error.message,
        },
        { status: error.statusCode === 409 ? 409 : 502 }
      );
    }
    await reportError({
      source: "api/video/start-adhoc",
      error,
      message: "Unexpected error in POST /api/video/start-adhoc",
      level: "error",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PR #4c-2: best-effort Trigger.dev REST trigger for the ad-hoc call
 * invite email. Runs inside `after()` so the route's HTTP response is
 * not gated on Resend latency. Returns silently on any failure —
 * the in-app notification row still shows in the bell + badge, so the
 * student gets the message in-UI even if email is delayed.
 *
 * Idempotency: the `idempotencyKey` collapses duplicate triggers for
 * the same `(sessionId, recipientUserId)` pair into a single
 * execution, replacing the previously-proposed `markEmailSent`
 * mutation (which was a Greptile P1 finding). A new ad-hoc call
 * (different sessionId) intentionally produces a new key so the
 * student is notified again.
 *
 * Skips silently if Trigger.dev credentials are missing or the
 * workspace lookup fails — the in-app notification is the primary
 * surface and email is a best-effort enhancement.
 */
async function enqueueAdHocCallEmail(args: {
  sessionId: Id<"sessions">;
  workspaceId: Id<"workspaces">;
  notificationId: Id<"inCallNotifications">;
  token: string;
}): Promise<void> {
  const triggerSecretKey =
    process.env.TRIGGER_SECRET_KEY ?? process.env.TRIGGER_API_KEY;
  if (!triggerSecretKey) {
    await reportInfo({
      source: "api/video/start-adhoc.triggerEmail",
      level: "warn",
      message: "Trigger.dev credentials missing; skipping email enqueue",
      context: { sessionId: String(args.sessionId) },
    });
    return;
  }

  const workspace = await fetchQuery(
    api.workspaces.getWorkspaceById,
    { id: args.workspaceId },
    { token: args.token }
  );
  if (!workspace) {
    await reportInfo({
      source: "api/video/start-adhoc.triggerEmail",
      message: "Workspace not found at email-enqueue time; skipping",
      context: { workspaceId: String(args.workspaceId) },
    });
    return;
  }

  const studentClerkId = workspace.ownerId;
  if (!studentClerkId) {
    await reportInfo({
      source: "api/video/start-adhoc.triggerEmail",
      message: "Workspace has no ownerId; skipping email",
      context: { workspaceId: String(args.workspaceId) },
    });
    return;
  }

  // Single Clerk fetch for both email and first-name lookups. The
  // previous version called `clerkClient.users.getUser` twice (once
  // for email, once for firstName); each call costs ~80-150ms and a
  // Clerk rate-limit event would double the surface area. Returns
  // `null` on any failure so the email path is never gating on
  // Clerk — if Clerk is down, we still get the in-app notification.
  const student = await fetchStudentContact(studentClerkId);
  if (!student.email) {
    await reportInfo({
      source: "api/video/start-adhoc.triggerEmail",
      message: "Student has no primary email; skipping email",
      context: { studentClerkId },
    });
    return;
  }

  const instructorRecord = workspace.instructorId
    ? await fetchQuery(
        api.instructors.getInstructorById,
        { id: workspace.instructorId },
        { token: args.token }
      )
    : null;

  const instructorName =
    typeof instructorRecord?.name === "string" &&
    instructorRecord.name.trim().length > 0
      ? instructorRecord.name.trim()
      : "Your instructor";

  const idempotencyKey = `ad-hoc-call-email:${String(args.sessionId)}:${studentClerkId}`;

  const response = await fetch(
    "https://api.trigger.dev/api/v1/tasks/send-ad-hoc-call-invite-email/trigger",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${triggerSecretKey}`,
      },
      body: JSON.stringify({
        payload: {
          notificationId: String(args.notificationId),
          recipientUserId: studentClerkId,
          recipientEmail: student.email,
          recipientFirstName: student.firstName,
          sessionId: String(args.sessionId),
          workspaceId: String(args.workspaceId),
          instructorName,
          workspaceName: workspace.name || "your mentorship workspace",
        },
        idempotencyKey,
      }),
    }
  );

  if (!response.ok) {
    await reportError({
      source: "api/video/start-adhoc.triggerEmail",
      error: new Error(`Trigger.dev request failed: ${response.status}`),
      level: "warn",
      message: "Failed to enqueue ad-hoc call invite email",
      context: {
        sessionId: String(args.sessionId),
        workspaceId: String(args.workspaceId),
      },
    });
    return;
  }

  await reportInfo({
    source: "api/video/start-adhoc.triggerEmail",
    message: "Ad-hoc call invite email enqueued",
    context: {
      sessionId: String(args.sessionId),
      workspaceId: String(args.workspaceId),
      notificationId: String(args.notificationId),
    },
  });
}

async function fetchStudentContact(
  clerkUserId: string
): Promise<{ email: string | null; firstName: string | null }> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(clerkUserId);
    const primary = user.emailAddresses.find(
      (e) => e.id === user.primaryEmailAddressId
    );
    return {
      email: primary?.emailAddress.toLowerCase() ?? null,
      firstName: user.firstName ?? null,
    };
  } catch {
    return { email: null, firstName: null };
  }
}
