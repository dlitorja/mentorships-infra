import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import {
  getDailyRecordingsByRoomName,
  signDailyWebhookPayload,
} from "@/lib/daily";
import { reportError } from "@/lib/observability";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";

/**
 * POST /api/video/recordings/sync
 *
 * Manually backfill recordings into the workspace Videos tab. We query
 * Daily.co for finished recordings for each session room in the workspace
 * that does not already have a recording or transfer status, then replay
 * a synthetic `recording.ready-to-download` webhook event through the
 * same HMAC-verified action used by the real webhook.
 *
 * Auth: only the instructor on the workspace or the workspace owner
 * (student) may trigger a sync. We reuse the session ownership checks in
 * `getSessionsMissingRecordingsForWorkspace`.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { workspaceId?: unknown }).workspaceId !== "string"
  ) {
    return NextResponse.json(
      { error: "Missing workspaceId" },
      { status: 400 }
    );
  }
  const { workspaceId } = body as { workspaceId: string };

  const secret = process.env.DAILY_WEBHOOK_SECRET;
  if (!secret || secret.length === 0) {
    return NextResponse.json(
      { error: "Recording sync is not configured (DAILY_WEBHOOK_SECRET missing)" },
      { status: 503 }
    );
  }

  const convex = getConvexClient();

  let sessions: { sessionId: string; videoRoomName: string }[];
  try {
    sessions = await convex.query(
      api.sessions.getSessionsMissingRecordingsForWorkspace,
      { workspaceId: workspaceId as Id<"workspaces"> }
    );
  } catch (err) {
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    reportError(err, { route: "/api/video/recordings/sync", phase: "query" });
    return NextResponse.json(
      { error: "Failed to fetch sessions for sync" },
      { status: 500 }
    );
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  let synced = 0;

  for (const session of sessions) {
    let recordings;
    try {
      recordings = await getDailyRecordingsByRoomName(session.videoRoomName);
    } catch (err) {
      reportError(err, {
        route: "/api/video/recordings/sync",
        phase: "list-recordings",
        roomName: session.videoRoomName,
      });
      continue;
    }

    for (const recording of recordings) {
      const rawBody = JSON.stringify({
        type: "recording.ready-to-download",
        payload: {
          room_name: recording.roomName,
          s3_key: recording.s3Key,
          duration: recording.durationSeconds,
          recording_id: recording.recordingId,
        },
      });
      const signature = signDailyWebhookPayload(rawBody, timestamp, secret);

      try {
        await convex.action(
          api.dailyRecordingActions.attachRecordingFromDailyWebhookAction,
          { timestamp, signature, rawBody }
        );
        synced++;
      } catch (err) {
        reportError(err, {
          route: "/api/video/recordings/sync",
          phase: "attach-recording",
          roomName: session.videoRoomName,
          recordingId: recording.recordingId,
        });
      }
    }
  }

  return NextResponse.json({ synced, checked: sessions.length });
}
