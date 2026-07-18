import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { convexIdSchema } from "@/lib/validators";
import { reportError } from "@/lib/observability";
import { tasks } from "@trigger.dev/sdk";
import type { transferDailyRecordingToB2 } from "@/trigger/recording-transfer";

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
 *
 * Failure recovery: when the row is flipped to `uploading` and the
 * subsequent `tasks.trigger()` call throws (network / Trigger API
 * error / 5xx), we POST a compensating `mark-failed` callback to
 * Convex so the row returns to the `failed` state with the
 * incremented attempt counter and the operator-visible error.
 * Otherwise the row would sit in `uploading` forever and the
 * manual retry endpoint would 409 on the next click.
 *
 * The `mark-retrying` / `mark-failed` callbacks share the same
 * `TRIGGER_CONVEX_CALLBACK_SECRET` + `CONVEX_HTTP_KEY` auth as the
 * Trigger task — there is no public Convex mutation for these
 * transitions (Greptile review flagged the prior
 * `markRecordingTransferRetryingPublic` mutation as an auth
 * bypass). The instructor-auth check is performed here at the
 * route layer; the callbacks themselves are server-side only.
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

    const callbackSecret = process.env.TRIGGER_CONVEX_CALLBACK_SECRET;
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    const convexHttpKey = process.env.CONVEX_HTTP_KEY;
    if (!callbackSecret || !convexUrl || !convexHttpKey) {
      await reportError({
        source: "api/video/recording/retry",
        error: new Error(
          "TRIGGER_CONVEX_CALLBACK_SECRET / NEXT_PUBLIC_CONVEX_URL / CONVEX_HTTP_KEY are not all configured"
        ),
        message: "Transfer retry is not configured",
        level: "error",
        context: { sessionId },
      });
      return NextResponse.json(
        { error: "Transfer retry is not configured" },
        { status: 500 }
      );
    }

    const nextAttempt = (session.recordingTransferAttempts ?? 0) + 1;
    const idempotencyKey = `transfer-recording:${sessionIdTyped}:${session.recordingId}:retry:${nextAttempt}`;

    await postConvexTransferCallback({
      convexUrl,
      convexHttpKey,
      callbackSecret,
      path: "mark-retrying",
      body: {
        sessionId: String(sessionIdTyped),
        attemptNumber: nextAttempt,
      },
    });

    try {
      const handle = await tasks.trigger<typeof transferDailyRecordingToB2>(
        "transfer-daily-recording-to-b2",
        {
          sessionId: String(sessionIdTyped),
          recordingId: session.recordingId,
          dailyS3Key: session.recordingDailyS3Key ?? "",
          durationSeconds: session.recordingDurationSeconds,
        },
        { idempotencyKey }
      );

      return NextResponse.json(
        {
          ok: true,
          attemptNumber: nextAttempt,
          idempotencyKey,
          runId: handle.id,
        },
        { status: 202 }
      );
    } catch (triggerError) {
      await reportError({
        source: "api/video/recording/retry",
        error: triggerError,
        message: "Trigger.dev re-trigger threw; rolling session back to failed",
        level: "error",
        context: {
          sessionId,
          recordingId: session.recordingId,
          attemptNumber: nextAttempt,
        },
      });
      try {
        await postConvexTransferCallback({
          convexUrl,
          convexHttpKey,
          callbackSecret,
          path: "mark-failed",
          body: {
            sessionId: String(sessionIdTyped),
            errorMessage: `Retry trigger failed: ${triggerError instanceof Error ? triggerError.message : String(triggerError)}`,
            attempts: nextAttempt,
          },
        });
      } catch (rollbackError) {
        await reportError({
          source: "api/video/recording/retry",
          error: rollbackError,
          message: "Compensating mark-failed callback also threw",
          level: "error",
          context: { sessionId, attemptNumber: nextAttempt },
        });
      }
      return NextResponse.json(
        { error: "Unable to start recording transfer" },
        { status: 502 }
      );
    }
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

async function postConvexTransferCallback(params: {
  convexUrl: string;
  convexHttpKey: string;
  callbackSecret: string;
  path: "mark-retrying" | "mark-failed";
  body: Record<string, unknown>;
}): Promise<void> {
  const response = await fetch(
    `${params.convexUrl}/recording-transfer/${params.path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.convexHttpKey}`,
        "X-Trigger-Callback-Secret": params.callbackSecret,
      },
      body: JSON.stringify(params.body),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Convex callback /recording-transfer/${params.path} failed: ${response.status} ${text.slice(0, 200)}`
    );
  }
}
