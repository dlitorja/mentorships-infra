import type { Env } from "../../lib/env";
import { logError, logInfo } from "../../lib/observability";

interface DailyRecordingReadyPayload {
  recording_id?: string;
  room_name?: string;
  start_ts?: number;
  status?: string;
  max_participants?: number;
  duration?: number;
  share_token?: string;
  s3_key?: string;
}

interface DailyWebhookEvent {
  version?: string;
  type?: string;
  id?: string;
  payload?: DailyRecordingReadyPayload;
  event_ts?: number;
}

/**
 * POST /webhooks/daily
 * Worker-side port of apps/platform/app/api/webhooks/daily/recordings/route.ts.
 * Validates the Daily.co webhook shape and forwards the raw body, signature,
 * and timestamp to the public Convex action. Convex verifies the HMAC.
 */
export async function handleDailyWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  const source = "webhooks/daily";

  const signature = request.headers.get("X-Webhook-Signature");
  const timestamp = request.headers.get("X-Webhook-Timestamp");

  if (!signature || !timestamp) {
    return json({ error: "Missing X-Webhook-Signature or X-Webhook-Timestamp" }, 400);
  }

  const rawBody = await request.text();

  let event: DailyWebhookEvent;
  try {
    event = JSON.parse(rawBody) as DailyWebhookEvent;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (event.type !== "recording.ready-to-download") {
    return json({ received: true, path: "verified", skipped: "unhandled_type" });
  }

  if (!isValidRecordingPayload(event.payload)) {
    return json({ error: "Invalid or missing fields in recording payload" }, 400);
  }

  const roomName = event.payload.room_name;

  try {
    const convexUrl = env.CONVEX_URL;
    if (!convexUrl) {
      throw new Error("CONVEX_URL is not configured");
    }

    const response = await fetch(`${convexUrl}/api/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: "dailyRecordingActions:attachRecordingFromDailyWebhookAction",
        format: "json",
        args: {
          timestamp,
          signature,
          rawBody,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Convex action failed: ${response.status} ${text}`);
    }

    const result = (await response.json()) as { status?: string; errorMessage?: string; errorData?: unknown };

    if (result.status === "error") {
      const errorMessage = typeof result.errorMessage === "string" ? result.errorMessage : "Unknown Convex error";
      if (errorMessage.startsWith("No session found for videoRoomName:")) {
        logError(source, new Error(errorMessage), "Recording received for unknown room", { roomName });
        return json({ error: "No session matches videoRoomName" }, 422);
      }
      if (errorMessage.includes("Multiple sessions")) {
        logError(source, new Error(errorMessage), "Duplicate room names detected", { roomName });
        return json({ error: "Duplicate room names" }, 422);
      }
      throw new Error(errorMessage);
    }

    logInfo(source, "Forwarded Daily recording webhook to Convex", { roomName });
    return json({ received: true, path: "verified" });
  } catch (err) {
    logError(source, err, "Failed to persist recording metadata", { roomName });
    return json({ error: "Failed to persist recording" }, 500);
  }
}

function isValidRecordingPayload(
  payload: DailyRecordingReadyPayload | undefined
): payload is DailyRecordingReadyPayload & {
  recording_id: string;
  room_name: string;
  s3_key: string;
  duration?: number;
} {
  if (!payload || typeof payload !== "object") return false;
  if (typeof payload.recording_id !== "string") return false;
  if (typeof payload.room_name !== "string") return false;
  if (typeof payload.s3_key !== "string") return false;
  if (payload.duration !== undefined && typeof payload.duration !== "number") {
    return false;
  }
  return true;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
