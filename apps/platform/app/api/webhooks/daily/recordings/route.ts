import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { reportError } from "@/lib/observability";

export const runtime = "nodejs";

/**
 * POST /api/webhooks/daily/recordings
 *
 * Daily.co calls this endpoint when a cloud recording is ready to download.
 * The route forwards the raw body + `X-Webhook-Signature` + `X-Webhook-Timestamp`
 * to the public Convex action `attachRecordingFromDailyWebhookAction`, which
 * performs HMAC verification inside Convex before invoking the internal
 * mutation.
 *
 * Auth model: signature verification happens in the Convex action layer
 * (against `DAILY_WEBHOOK_SECRET`, base64-encoded). The internal mutation
 * is `internalMutation` and is not callable from any public client; the
 * only way to invoke it is through the action, which refuses without a
 * valid HMAC. Even if a caller discovered `NEXT_PUBLIC_CONVEX_URL` and
 * called the action directly, they would still need the shared secret
 * to forge a signature.
 *
 * Test bypass: when `TEST_WEBHOOK_BYPASS=true` and `TEST_WEBHOOK_BYPASS_KEY`
 * are set, requests carrying `x-test-bypass: 1` + `x-test-bypass-key: <KEY>`
 * skip the route's bypass check and the route then signs the body locally
 * with `DAILY_WEBHOOK_SECRET` (which is set to the same value as the
 * bypass key in CI/preview envs). The Convex action's HMAC check succeeds
 * because both layers use the same secret.
 *
 * Reference: https://docs.daily.co/reference/rest-api/webhooks
 */

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

function isTestBypassEnabled(req: NextRequest): boolean {
  if (process.env.TEST_WEBHOOK_BYPASS !== "true") return false;
  const expected = process.env.TEST_WEBHOOK_BYPASS_KEY;
  if (typeof expected !== "string" || expected.length === 0) return false;
  if (req.headers.get("x-test-bypass") !== "1") return false;
  const provided = req.headers.get("x-test-bypass-key");
  if (typeof provided !== "string") return false;
  // Timing-safe comparison: avoid leaking the bypass secret length via
  // timing. Pad to a fixed-length buffer to neutralise length leakage.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const len = Math.max(a.length, b.length, 64);
  const aPadded = Buffer.alloc(len);
  const bPadded = Buffer.alloc(len);
  a.copy(aPadded);
  b.copy(bPadded);
  return timingSafeEqual(aPadded, bPadded) && a.length === b.length;
}

function getConvexClient(): ConvexHttpClient {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

/**
 * Lightweight runtime type guard for the DailyRecordingReadyPayload shape.
 * Returns false if any expected field has the wrong type — protects the
 * downstream Convex call from receiving a stringly-typed duration that
 * would otherwise fail type validation inside Convex and surface as a 500.
 */
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
  if (
    payload.duration !== undefined &&
    typeof payload.duration !== "number"
  ) {
    return false;
  }
  return true;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const bypassed = isTestBypassEnabled(req);
  const body = await req.text();

  // Test bypass for CI and integration tests on preview/prod deploys.
  // In bypass mode we still read the raw body and forward it to Convex —
  // the action will only proceed if its own HMAC check passes. The bypass
  // is intended for local + preview envs where DAILY_WEBHOOK_SECRET is
  // configured identically to TEST_WEBHOOK_BYPASS_KEY, so we generate a
  // valid HMAC over the body using that same secret and pass it as the
  // signature. The action's HMAC check will succeed because both layers
  // use the same secret.
  let signature: string;
  let timestamp: string;
  if (bypassed) {
    const secret = process.env.DAILY_WEBHOOK_SECRET;
    if (!secret) {
      return NextResponse.json(
        { error: "Bypass requires DAILY_WEBHOOK_SECRET to be configured" },
        { status: 500 }
      );
    }
    timestamp = String(Math.floor(Date.now() / 1000));
    signature = signForBypass(body, timestamp, secret);
  } else {
    const sigHeader = req.headers.get("X-Webhook-Signature");
    const tsHeader = req.headers.get("X-Webhook-Timestamp");
    if (!sigHeader || !tsHeader) {
      return NextResponse.json(
        { error: "Missing X-Webhook-Signature or X-Webhook-Timestamp" },
        { status: 400 }
      );
    }
    signature = sigHeader;
    timestamp = tsHeader;
  }

  let event: DailyWebhookEvent;
  try {
    event = JSON.parse(body) as DailyWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  return handleEvent(event, body, signature, timestamp, bypassed ? "bypass" : "verified");
}

/**
 * Compute a valid HMAC over `(timestamp, body)` using the same
 * base64-decoded secret Daily uses. The action's HMAC check will
 * pass because both layers sign with the same secret.
 */
function signForBypass(body: string, timestamp: string, base64Secret: string): string {
  const decoded = Buffer.from(base64Secret, "base64");
  return createHmac("sha256", decoded)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("base64");
}

async function handleEvent(
  event: DailyWebhookEvent,
  rawBody: string,
  signature: string,
  timestamp: string,
  path: "bypass" | "verified"
): Promise<NextResponse> {
  // We currently only act on `recording.ready-to-download`. Acknowledge other
  // event types so Daily doesn't retry them.
  if (event.type !== "recording.ready-to-download") {
    return NextResponse.json({ received: true, path, skipped: "unhandled_type" });
  }

  if (!isValidRecordingPayload(event.payload)) {
    return NextResponse.json(
      { error: "Invalid or missing fields in recording payload" },
      { status: 400 }
    );
  }

  const roomName = event.payload.room_name;
  const s3Key = event.payload.s3_key;

  try {
    const convex = getConvexClient();
    // The Convex action re-verifies the HMAC against DAILY_WEBHOOK_SECRET
    // (base64) inside Convex. We pass the raw body + signature + timestamp
    // through so the action can perform that verification before invoking
    // the internal mutation. Defence in depth — both layers verify.
    await convex.action(api.dailyRecordingActions.attachRecordingFromDailyWebhookAction, {
      roomName,
      recordingS3Key: s3Key,
      durationSeconds: event.payload.duration,
      recordingId: event.payload.recording_id,
      timestamp,
      signature,
      rawBody,
    });
    // Do NOT spread the action result into the public response — the
    // mutation may return session-level fields that we don't want to
    // leak to the webhook caller (Daily).
    return NextResponse.json({ received: true, path });
  } catch (err) {
    // "No session found for videoRoomName: ..." is permanent — Daily retries
    // on 5xx up to 5x. Return 422 so Daily stops retrying a delivery that
    // will never resolve. Transient Convex errors fall through to 500.
    if (
      err instanceof Error &&
      err.message.startsWith("No session found for videoRoomName:")
    ) {
      await reportError({
        source: "webhooks/daily",
        error: err,
        message: "Recording received for unknown room",
        level: "warn",
        context: { roomName },
      });
      return NextResponse.json(
        { error: "No session matches videoRoomName" },
        { status: 422 }
      );
    }
    if (err instanceof Error && err.message.includes("Multiple sessions")) {
      await reportError({
        source: "webhooks/daily",
        error: err,
        message: "Duplicate room names detected",
        level: "error",
        context: { roomName },
      });
      return NextResponse.json(
        { error: "Duplicate room names" },
        { status: 422 }
      );
    }
    await reportError({
      source: "webhooks/daily",
      error: err,
      message: "Failed to persist recording metadata",
      level: "error",
      context: { roomName },
    });
    return NextResponse.json({ error: "Failed to persist recording" }, { status: 500 });
  }
}
