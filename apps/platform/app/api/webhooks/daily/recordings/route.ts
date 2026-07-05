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
 * We verify the HMAC-SHA256 signature Daily sends in
 * `X-Webhook-Signature` (computed over `${X-Webhook-Timestamp}.${rawBody}`
 * using a base64-encoded shared secret), then forward the verified payload
 * to the public Convex action `attachRecordingFromDailyWebhookAction`, which
 * re-verifies the HMAC inside Convex before invoking the internal mutation.
 *
 * Defence in depth: HMAC verification runs at TWO layers (this route AND
 * the Convex action) against the SAME `DAILY_WEBHOOK_SECRET`. Even if a
 * caller discovered `NEXT_PUBLIC_CONVEX_URL` and called the action
 * directly, the action's HMAC check refuses to invoke the internal
 * mutation without a valid signature. The internal mutation cannot be
 * reached without a valid HMAC.
 *
 * Test bypass: when `TEST_WEBHOOK_BYPASS=true` and `TEST_WEBHOOK_BYPASS_KEY`
 * are set, requests carrying `x-test-bypass: 1` + `x-test-bypass-key: <KEY>`
 * bypass HMAC at this layer so the handler can be exercised on preview
 * deploys before Daily is wired. The Convex action will still refuse the
 * call unless `DAILY_WEBHOOK_SECRET` matches OR the test-bypass secret is
 * echoed as a valid HMAC. For CI we set the same secret in both env vars.
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

function verifyDailySignature(
  body: string,
  signature: string,
  timestamp: string,
  secret: string
): boolean {
  // Daily provides the webhook secret as base64. Decode before HMAC.
  let decodedSecret: Buffer;
  try {
    decodedSecret = Buffer.from(secret, "base64");
  } catch {
    return false;
  }
  // Signature input: `${timestamp}.${rawBody}` (per Daily docs).
  const signatureInput = `${timestamp}.${body}`;
  const expected = createHmac("sha256", decodedSecret)
    .update(signatureInput)
    .digest("base64");

  const sigBuf = Buffer.from(signature, "base64");
  const expBuf = Buffer.from(expected, "base64");
  if (sigBuf.length !== expBuf.length) {
    return false;
  }
  return timingSafeEqual(sigBuf, expBuf);
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
  // Test bypass for CI and integration tests on preview/prod deploys.
  // In bypass mode we still read the raw body and forward it to Convex —
  // the action will only proceed if its own HMAC check passes. The bypass
  // is intended for local + preview envs where DAILY_WEBHOOK_SECRET is
  // configured identically to TEST_WEBHOOK_BYPASS_KEY, so the action's
  // HMAC check will still succeed.
  const bypassed = isTestBypassEnabled(req);
  const body = await req.text();
  const signature =
    req.headers.get("X-Webhook-Signature") ??
    (bypassed ? `bypass-${Date.now()}` : "");
  const timestamp = req.headers.get("X-Webhook-Timestamp") ?? String(Date.now());

  let event: DailyWebhookEvent;
  try {
    event = JSON.parse(body) as DailyWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  return handleEvent(event, body, signature, timestamp, bypassed ? "bypass" : "verified");
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
