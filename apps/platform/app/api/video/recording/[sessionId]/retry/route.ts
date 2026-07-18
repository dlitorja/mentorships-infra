import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { convexIdSchema } from "@/lib/validators";
import { reportError } from "@/lib/observability";

export const runtime = "nodejs";

/**
 * POST /api/video/recording/[sessionId]/retry
 *
 * Re-triggers the Daily → B2 transfer task for a session whose
 * recording transfer has terminally failed. The UI surfaces a
 * "Recording unavailable, retry?" affordance on rows where
 * `recordingTransferStatus === "failed"` (PR video-recording-to-b2);
 * the instructor (or workspace owner) clicks it to fire this
 * endpoint.
 *
 * Auth: only the instructor on the session (per the existing
 * `assertParticipantForSession` helper used by the playback route).
 * Students cannot retry a failed transfer — same auth model as the
 * rooms/start-adhoc endpoints that gate recording lifecycle on the
 * instructor.
 *
 * Idempotency: the underlying Trigger.dev task uses a fresh
 * idempotency key derived from the existing attempt counter
 * (`transfer-recording:{sessionId}:{recordingId}:retry:{attempt+1}`)
 * so a re-fire always runs a fresh task body, not the prior
 * dead-and-buried run.
 *
 * 404 if the session is missing or already has a `recordingUrl`
 * (i.e., transfer already succeeded — the UI should not be calling
 * retry in this case; we 404 instead of 409 to keep the contract
 * simple).
 *
 * 409 if `recordingTransferStatus !== "failed"` — i.e., retry
 * raced against the task's catchError hook. Surface as 409 so the
 * UI's retry button can render a "Recording is being processed"
 * pill instead.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
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

    const { sessionId } = await params;
    if (!sessionId || sessionId.length === 0) {
      return NextResponse.json(
        { error: "Missing sessionId" },
        { status: 400 }
      );
    }
    const parsedSessionId = convexIdSchema.safeParse(sessionId);
    if (!parsedSessionId.success) {
      return NextResponse.json(
        { error: "Invalid sessionId format" },
        { status: 400 }
      );
    }
    const sessionIdTyped = parsedSessionId.data as Id<"sessions">;

    const participant = await fetchQuery(
      api.workspaces.getSessionParticipantForRecording,
      { sessionId: sessionIdTyped },
      { token }
    );
    if (!participant) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (participant.role !== "instructor") {
      return NextResponse.json(
        { error: "Only the session's instructor can retry a failed transfer" },
        { status: 403 }
      );
    }

    const session = await fetchQuery(
      api.sessions.getSessionById,
      { id: sessionIdTyped },
      { token }
    );
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (session.recordingUrl !== undefined) {
      return NextResponse.json(
        { error: "Recording already available; nothing to retry" },
        { status: 404 }
      );
    }
    if (session.recordingTransferStatus !== "failed") {
      return NextResponse.json(
        {
          error: `Transfer is in '${session.recordingTransferStatus ?? "unknown"}' state; retry only valid for failed transfers`,
        },
        { status: 409 }
      );
    }
    if (session.recordingId === undefined || session.recordingId.length === 0) {
      return NextResponse.json(
        { error: "Recording id missing from session; cannot retry" },
        { status: 409 }
      );
    }

    const triggerSecretKey =
      process.env.TRIGGER_SECRET_KEY ?? process.env.TRIGGER_API_KEY;
    if (!triggerSecretKey) {
      await reportError({
        source: "api/video/recording/retry",
        error: new Error("TRIGGER_SECRET_KEY (or TRIGGER_API_KEY) is not configured"),
        message: "Transfer trigger is not configured",
        level: "error",
        context: { sessionId },
      });
      return NextResponse.json(
        { error: "Transfer trigger is not configured" },
        { status: 500 }
      );
    }
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) {
      return NextResponse.json(
        { error: "NEXT_PUBLIC_CONVEX_URL is not set" },
        { status: 500 }
      );
    }

    const nextAttempt = (session.recordingTransferAttempts ?? 0) + 1;
    const idempotencyKey = `transfer-recording:${sessionIdTyped}:${session.recordingId}:retry:${nextAttempt}`;

    const convex = new ConvexHttpClient(convexUrl);
    await convex.mutation(api.sessions.markRecordingTransferRetryingPublic, {
      sessionId: sessionIdTyped,
      attemptNumber: nextAttempt,
    });

    const response = await fetch(
      "https://api.trigger.dev/api/v1/tasks/transfer-daily-recording-to-b2/trigger",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${triggerSecretKey}`,
        },
        body: JSON.stringify({
          payload: {
            sessionId: String(sessionIdTyped),
            recordingId: session.recordingId,
            dailyS3Key: session.recordingDailyS3Key ?? "",
            durationSeconds: session.recordingDurationSeconds,
          },
          idempotencyKey,
        }),
      }
    );
    if (!response.ok) {
      const body = await response.text();
      await reportError({
        source: "api/video/recording/retry",
        error: new Error(`Trigger.dev re-trigger failed: ${response.status}`),
        message: "Trigger.dev re-trigger failed",
        level: "error",
        context: {
          sessionId,
          recordingId: session.recordingId,
          status: response.status,
        },
      });
      return NextResponse.json(
        { error: `Trigger.dev re-trigger failed: ${response.status}`, detail: body.slice(0, 200) },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { ok: true, attemptNumber: nextAttempt, idempotencyKey },
      { status: 202 }
    );
  } catch (error) {
    await reportError({
      source: "api/video/recording/retry",
      error,
      message: "Unexpected error in POST /api/video/recording/[sessionId]/retry",
      level: "error",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
