import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { ConvexError } from "convex/values";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexIdSchema } from "@/lib/validators";
import { reportError } from "@/lib/observability";

export const runtime = "nodejs";

type ConsentConvexErrorCode =
  | "VIDEO_UNAUTHORIZED"
  | "VIDEO_SESSION_NOT_FOUND"
  | "VIDEO_FORBIDDEN_NOT_PARTICIPANT";

function getConsentConvexErrorCode(
  error: unknown
): ConsentConvexErrorCode | null {
  if (
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null
  ) {
    const code = (error.data as { code?: unknown }).code;
    if (
      code === "VIDEO_UNAUTHORIZED" ||
      code === "VIDEO_SESSION_NOT_FOUND" ||
      code === "VIDEO_FORBIDDEN_NOT_PARTICIPANT"
    ) {
      return code;
    }
  }
  return null;
}

const consentSchema = z.object({
  consent: z.boolean(),
});

/**
 * Records a participant's recording consent on a session. Either
 * party on the session (instructor OR student) may invoke this via
 * the consent modal. The session's `recordingConsent` field is the
 * combined consent flag — whichever value is persisted last wins
 * (currently the modal flow only writes once per session). This
 * matches Daily's `enable_recording: "cloud" | "off"` semantics
 * rather than per-participant consent tracking.
 *
 * Used by `ConsentModal` (PR #4a). The Daily room's
 * `enable_recording` flag is reconciled by `POST /api/video/rooms`
 * which reads the session's current `recordingConsent` on each room
 * creation.
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
    const parsedId = convexIdSchema.safeParse(sessionId);
    if (!parsedId.success) {
      return NextResponse.json(
        { error: "Invalid sessionId" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const parsed = consentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const sessionIdTyped = parsedId.data as Id<"sessions">;

    const session = await fetchQuery(
      api.sessions.getSessionById,
      { id: sessionIdTyped },
      { token }
    );
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const result = await fetchMutation(
      api.sessions.recordConsent,
      {
        sessionId: sessionIdTyped,
        consent: parsed.data.consent,
      },
      { token }
    );

    return NextResponse.json({
      recordingConsent: result.recordingConsent,
      changed: result.changed,
    });
  } catch (error) {
    const code = getConsentConvexErrorCode(error);
    if (code === "VIDEO_FORBIDDEN_NOT_PARTICIPANT") {
      return NextResponse.json(
        { error: "Forbidden: only session participants can record consent" },
        { status: 403 }
      );
    }
    if (code === "VIDEO_SESSION_NOT_FOUND") {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (code === "VIDEO_UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await reportError({
      source: "api/video/consent",
      error,
      message: "Unexpected error in POST /api/video/consent/[sessionId]",
      level: "error",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
