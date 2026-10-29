import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import {
  getDailyRecordingsByRoomName,
  signDailyWebhookPayload,
} from "@/lib/daily";
import { reportError } from "@/lib/observability";
import { resolveConvexBaseUrl } from "@/lib/convex-server-call";
import { convexIdSchema } from "@/lib/validators";
import type { Id } from "@/convex/_generated/dataModel";
import { tasks } from "@trigger.dev/sdk";
import type { transferDailyRecordingToB2 } from "@/trigger/recording-transfer";

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

  const parsedBody = z
    .object({ workspaceId: convexIdSchema })
    .safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Missing or invalid workspaceId" },
      { status: 400 }
    );
  }
  const { workspaceId } = parsedBody.data;

  const secret = process.env.DAILY_WEBHOOK_SECRET;
  if (!secret || secret.length === 0) {
    return NextResponse.json(
      { error: "Recording sync is not configured (DAILY_WEBHOOK_SECRET missing)" },
      { status: 503 }
    );
  }

  let convex;
  try {
    convex = await getAuthenticatedConvexClient();
  } catch (err) {
    await reportError({
      source: "api/video/recordings/sync",
      error: err,
      message: "Failed to authenticate Convex client",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    await reportError({
      source: "api/video/recordings/sync",
      error: err,
      message: "Failed to fetch sessions for sync",
      context: { workspaceId },
    });
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
      await reportError({
        source: "api/video/recordings/sync",
        error: err,
        message: "Failed to list Daily recordings for room",
        context: { roomName: session.videoRoomName, workspaceId },
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
        const result = await convex.action(
          api.dailyRecordingActions.attachRecordingFromDailyWebhookAction,
          { timestamp, signature, rawBody, triggerTransfer: false }
        );
        if (result.sessionId && !result.alreadyAttached) {
          try {
            await tasks.trigger<typeof transferDailyRecordingToB2>(
              "transfer-daily-recording-to-b2",
              {
                sessionId: String(result.sessionId),
                recordingId: recording.recordingId,
                dailyS3Key: recording.s3Key,
                durationSeconds: recording.durationSeconds,
              },
              {
                idempotencyKey: `transfer-recording:${result.sessionId}:${recording.recordingId}`,
              }
            );
          } catch (triggerError) {
            // The action already flipped the session to `pending`. Mark
            // it `failed` so the instructor's retry route can recover it;
            // otherwise both sync (skips any transfer status) and retry
            // (failed only) would ignore the row forever.
            await markTransferFailed({
              sessionId: String(result.sessionId),
              errorMessage: `Unable to start recording transfer: ${
                triggerError instanceof Error
                  ? triggerError.message
                  : String(triggerError)
              }`,
            });
            throw triggerError;
          }
        }
        synced++;
      } catch (err) {
        await reportError({
          source: "api/video/recordings/sync",
          error: err,
          message: "Failed to attach recording from sync",
          context: {
            roomName: session.videoRoomName,
            recordingId: recording.recordingId,
            workspaceId,
          },
        });
      }
    }
  }

  return NextResponse.json({ synced, checked: sessions.length });
}

/**
 * Best-effort `mark-failed` callback so a session whose task trigger
 * failed is retryable. Without this the row stays `pending`, which both
 * the manual sync (skips any transfer status) and the retry route
 * (failed only) ignore.
 */
async function markTransferFailed(params: {
  sessionId: string;
  errorMessage: string;
}): Promise<void> {
  const callbackSecret = process.env.CONVEX_TRIGGER_CALLBACK_SECRET;
  const convexHttpKey = process.env.CONVEX_HTTP_KEY;
  const baseUrl = resolveConvexBaseUrl();
  if (!callbackSecret || !convexHttpKey || !baseUrl) return;

  const response = await fetch(`${baseUrl}/recording-transfer/mark-failed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${convexHttpKey}`,
      "X-Trigger-Callback-Secret": callbackSecret,
    },
    body: JSON.stringify({
      sessionId: params.sessionId,
      errorMessage: params.errorMessage,
      attempts: 0,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `mark-failed callback failed: ${response.status} ${text.slice(0, 200)}`
    );
  }
}
