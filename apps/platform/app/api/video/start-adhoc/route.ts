import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { ConvexError } from "convex/values";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  DailyApiError,
  resolveDailyRoom,
} from "@/lib/daily";
import { convexIdSchema } from "@/lib/validators";
import { reportError } from "@/lib/observability";

export const runtime = "nodejs";

type AdhocConvexErrorCode =
  | "VIDEO_UNAUTHORIZED"
  | "VIDEO_SESSION_NOT_FOUND"
  | "VIDEO_FORBIDDEN_NOT_INSTRUCTOR"
  | "VIDEO_FORBIDDEN_CALL_ACTIVE";

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
      code === "VIDEO_FORBIDDEN_CALL_ACTIVE"
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

    const { roomName, roomUrl } = await resolveDailyRoom(sessionId, {
      recordingEnabled: recordingConsent,
    });

    try {
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
      // Daily room is provisioned but the session row is still missing
      // videoRoomName/videoRoomUrl. Without cleanup, the session shows
      // up to the student as a phantom upcoming session with no join
      // URL. Delete the orphan row; the next startAdhocCall attempt can
      // re-create everything. Failure of the cleanup itself is
      // swallowed (logged via reportError in the outer catch) — better
      // to surface the original error to the user than to mask it.
      await fetchMutation(
        api.sessions.deleteOrphanedAdhocSession,
        { sessionId },
        { token }
      );
      throw error;
    }

    return NextResponse.json({ sessionId, roomName, roomUrl });
  } catch (error) {
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
