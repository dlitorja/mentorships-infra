import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { convexIdSchema } from "@/lib/validators";
import { reportError } from "@/lib/observability";
import { resolveConvexBaseUrl } from "@/lib/convex-server-call";
import { tasks } from "@trigger.dev/sdk";
import type { transferDailyRecordingToB2 } from "@/trigger/recording-transfer";

export const runtime = "nodejs";

/**
 * POST /api/video/recording/[sessionId]/delete-daily
 *
 * Re-runs ONLY the Daily-side delete for a session whose B2
 * recording is already `ready` but whose Daily source was not
 * deleted — i.e. `recordingDailyCleanupStatus === "failed"`, or a
 * legacy row that predates cleanup tracking (`undefined`).
 *
 * This exists because the full-transfer retry endpoint refuses
 * `ready` rows (404 when `recordingUrl` is set): without this
 * route, a transient Daily API failure during cleanup left an
 * orphaned Daily copy with no operator path to remove it short
 * of calling Daily's API by hand.
 *
 * Auth: only the instructor on the session, same model as the
 * transfer retry endpoint. Students cannot trigger a Daily
 * delete — same auth model as the rooms/start-adhoc endpoints
 * that gate recording lifecycle on the instructor.
 *
 * Safety: the task re-verifies the B2 key (read here from
 * `sessions.recordingUrl`) via HEAD before deleting anything,
 * and the Daily DELETE itself is idempotent (404 = already
 * purged), so a duplicate click is a safe no-op.
 *
 * 404 if the session is missing, has no `recordingUrl`, or the
 * Daily cleanup is already marked "done".
 * 409 if `recordingTransferStatus !== "ready"`, the session has
 * no `recordingId`, or `recordingUrl` is not a `recordings/` B2
 * key — there is nothing verified to clean up against yet.
 *
 * Idempotency: the route claims the run through
 * `mark-daily-cleanup-retrying` BEFORE triggering, and derives the
 * Trigger key from the incremented counter. Trigger.dev keeps keys
 * for 30 days, so deriving the key from a counter that only
 * advances on failure would make later clicks resolve to the first
 * run (a silent no-op). If the trigger call itself throws, the
 * route compensates with `mark-daily-cleanup-failed` so the row
 * does not sit in "pending".
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
        { error: "Only the session's instructor can retry a Daily delete" },
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
    if (session.recordingUrl === undefined) {
      return NextResponse.json(
        { error: "Recording not yet available in B2; nothing to clean up" },
        { status: 404 }
      );
    }
    // Only B2 keys written by `attachRecordingFromB2Upload` are
    // safe to HEAD and clean up against. Legacy rows can hold a
    // Daily `s3_key` in `recordingUrl`; those are not transfer
    // artifacts and there is nothing verified to delete.
    if (!session.recordingUrl.startsWith("recordings/")) {
      return NextResponse.json(
        {
          error:
            "recordingUrl is not a B2 transfer key; nothing verified to clean up",
        },
        { status: 409 }
      );
    }
    if (session.recordingDailyCleanupStatus === "done") {
      return NextResponse.json(
        { error: "Daily recording already deleted" },
        { status: 404 }
      );
    }
    if (session.recordingTransferStatus !== "ready") {
      return NextResponse.json(
        {
          error: `Transfer is in '${session.recordingTransferStatus ?? "unknown"}' state; Daily cleanup only valid for ready recordings`,
        },
        { status: 409 }
      );
    }
    if (session.recordingId === undefined || session.recordingId.length === 0) {
      return NextResponse.json(
        { error: "Recording id missing from session; cannot delete from Daily" },
        { status: 409 }
      );
    }

    const callbackSecret = process.env.CONVEX_TRIGGER_CALLBACK_SECRET;
    // Prefer the server-only `CONVEX_URL` and rewrite a `.convex.cloud`
    // host to `.convex.site`: HTTP actions are only served on the
    // latter (see `apps/platform/lib/convex-server-call.ts`).
    const convexUrl = resolveConvexBaseUrl();
    const convexHttpKey = process.env.CONVEX_HTTP_KEY;
    if (!callbackSecret || !convexUrl || !convexHttpKey) {
      await reportError({
        source: "api/video/recording/delete-daily",
        error: new Error(
          "CONVEX_TRIGGER_CALLBACK_SECRET / NEXT_PUBLIC_CONVEX_URL / CONVEX_HTTP_KEY are not all configured"
        ),
        message: "Daily cleanup retry is not configured",
        level: "error",
        context: { sessionId },
      });
      return NextResponse.json(
        { error: "Daily cleanup retry is not configured" },
        { status: 500 }
      );
    }

    // Claim the run BEFORE triggering. The counter must advance on
    // every click, not just on failure: Trigger.dev stores
    // idempotency keys for 30 days, so a key derived from a
    // non-advancing counter would silently resolve later clicks to
    // the first run and the endpoint would become a no-op. This
    // also gives the drift monitor a "cleanup pending since" stamp.
    let attemptNumber: number;
    try {
      const claimed = await postConvexCleanupCallback<{
        attempts: number;
        alreadyDone: boolean;
      }>({
        convexUrl,
        convexHttpKey,
        callbackSecret,
        path: "mark-daily-cleanup-retrying",
        body: { sessionId: String(sessionIdTyped) },
      });
      // Another run finished after our read; do not reopen or
      // double-trigger a cleanup that already landed.
      if (claimed.alreadyDone) {
        return NextResponse.json(
          { error: "Daily recording already deleted" },
          { status: 404 }
        );
      }
      attemptNumber = claimed.attempts;
    } catch (claimError) {
      await reportError({
        source: "api/video/recording/delete-daily",
        error: claimError,
        message: "Could not claim a Daily cleanup run",
        level: "error",
        context: { sessionId },
      });
      return NextResponse.json(
        { error: "Unable to start Daily delete" },
        { status: 502 }
      );
    }

    const idempotencyKey = `delete-daily-recording:${sessionIdTyped}:${session.recordingId}:${attemptNumber}`;

    try {
      const handle = await tasks.trigger<typeof transferDailyRecordingToB2>(
        "transfer-daily-recording-to-b2",
        {
          sessionId: String(sessionIdTyped),
          recordingId: session.recordingId,
          dailyS3Key: session.recordingDailyS3Key ?? "",
          b2Key: session.recordingUrl,
          deleteOnly: true,
        },
        { idempotencyKey }
      );

      return NextResponse.json(
        {
          ok: true,
          attemptNumber,
          idempotencyKey,
          runId: handle.id,
        },
        { status: 202 }
      );
    } catch (triggerError) {
      await reportError({
        source: "api/video/recording/delete-daily",
        error: triggerError,
        message:
          "Trigger.dev delete-only re-trigger threw; marking cleanup failed",
        level: "error",
        context: {
          sessionId,
          recordingId: session.recordingId,
          attemptNumber,
        },
      });
      // Compensate: the run was claimed but never started, so the
      // row must not sit in "pending" until the next click.
      try {
        await postConvexCleanupCallback({
          convexUrl,
          convexHttpKey,
          callbackSecret,
          path: "mark-daily-cleanup-failed",
          body: {
            sessionId: String(sessionIdTyped),
            errorMessage: `Delete-only trigger failed: ${
              triggerError instanceof Error
                ? triggerError.message
                : String(triggerError)
            }`,
          },
        });
      } catch (rollbackError) {
        await reportError({
          source: "api/video/recording/delete-daily",
          error: rollbackError,
          message: "Compensating mark-daily-cleanup-failed callback threw",
          level: "error",
          context: { sessionId, attemptNumber },
        });
      }
      return NextResponse.json(
        { error: "Unable to start Daily delete" },
        { status: 502 }
      );
    }
  } catch (error) {
    await reportError({
      source: "api/video/recording/delete-daily",
      error,
      message: "Unexpected error in POST /api/video/recording/[sessionId]/delete-daily",
      level: "error",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST a server-to-server callback to the Convex HTTP layer with the
 * same two-key auth the Trigger task uses (`CONVEX_HTTP_KEY` bearer
 * + `X-Trigger-Callback-Secret`). The mutations behind these routes
 * are `internalMutation`, so this is the only way to claim a cleanup
 * run or record a failure from the Next.js side.
 */
async function postConvexCleanupCallback<T = unknown>(params: {
  convexUrl: string;
  convexHttpKey: string;
  callbackSecret: string;
  path: "mark-daily-cleanup-retrying" | "mark-daily-cleanup-failed";
  body: Record<string, unknown>;
}): Promise<T> {
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
  return (await response.json()) as T;
}
