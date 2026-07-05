import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { reportError } from "@/lib/observability";

/**
 * POST /api/webhooks/daily/recordings
 *
 * Daily.co calls this endpoint when a cloud recording is ready to download.
 * We verify the HMAC-SHA256 signature Daily sends in
 * `X-Webhook-Signature` (computed over `${X-Webhook-Timestamp}.${rawBody}`
 * using a base64-encoded shared secret), then persist the B2 s3_key to
 * the matching Convex `sessions` row via the
 * `api.sessions.attachRecordingFromDailyWebhook` mutation.
 *
 * Auth model: HMAC verification is the security boundary. The mutation is
 * declared `mutation` (public) because ConvexHttpClient.mutation() only
 * accepts public FunctionReferences; there is no Clerk context on a
 * webhook call. Only Daily, holding the shared secret, can produce a
 * valid signature for an existing `sessions.videoRoomName`. Per AGENTS.md
 * secret policy: DAILY_WEBHOOK_SECRET is set in Vercel env only, never in
 * PRs, commits, or .env.local examples.
 *
 * Test bypass: when `TEST_WEBHOOK_BYPASS=true` and `TEST_WEBHOOK_BYPASS_KEY`
 * are set, requests carrying `x-test-bypass: 1` + `x-test-bypass-key: <KEY>`
 * skip HMAC verification so the handler can be exercised on preview deploys
 * before Daily is wired. Mirrors the Stripe webhook at
 * apps/platform/app/api/webhooks/stripe/route.ts.
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
  return (
    timingSafeEqual(aPadded, bPadded) && a.length === b.length
  );
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

export async function POST(req: NextRequest) {
  // Test bypass for CI and integration tests on preview/prod deploys.
  if (isTestBypassEnabled(req)) {
    let bypassEvent: DailyWebhookEvent;
    try {
      bypassEvent = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    return handleEvent(bypassEvent, "bypass");
  }

  const secret = process.env.DAILY_WEBHOOK_SECRET;
  if (!secret) {
    await reportError({
      source: "webhooks/daily",
      error: new Error("DAILY_WEBHOOK_SECRET environment variable is not set"),
      message: "Webhook configuration error",
      level: "error",
    });
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  // Read the raw body BEFORE parsing — the HMAC is computed over the raw body
  // concatenated with the timestamp, so any prior JSON parsing would break it.
  const body = await req.text();
  const signature = req.headers.get("X-Webhook-Signature");
  const timestamp = req.headers.get("X-Webhook-Timestamp");

  if (!signature || !timestamp) {
    return NextResponse.json(
      { error: "Missing X-Webhook-Signature or X-Webhook-Timestamp" },
      { status: 400 }
    );
  }

  // Reject stale timestamps to prevent replay of captured requests. A valid
  // HMAC over an old timestamp still verifies, but the signed request could
  // have been captured from server logs or an MITM. 5 minutes matches the
  // Stripe webhook staleness window.
  //
  // Daily sends X-Webhook-Timestamp as a plain Unix epoch integer in SECONDS
  // (e.g. "1720000000"), not as a date string. Parse as Number and multiply
  // by 1000; Date.parse() would return NaN for the raw epoch string.
  const timestampSec = Number(timestamp);
  if (
    !Number.isFinite(timestampSec) ||
    timestampSec <= 0 ||
    !Number.isInteger(timestampSec)
  ) {
    return NextResponse.json(
      { error: "Invalid X-Webhook-Timestamp" },
      { status: 400 }
    );
  }
  const timestampMs = timestampSec * 1000;
  const skewMs = Math.abs(Date.now() - timestampMs);
  if (skewMs > 5 * 60 * 1000) {
    return NextResponse.json(
      { error: "Webhook timestamp too old" },
      { status: 400 }
    );
  }

  if (!verifyDailySignature(body, signature, timestamp, secret)) {
    await reportError({
      source: "webhooks/daily",
      error: new Error("Daily webhook signature verification failed"),
      message: "Webhook signature mismatch",
      level: "warn",
      context: { signaturePrefix: signature.slice(0, 12) + "..." },
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: DailyWebhookEvent;
  try {
    event = JSON.parse(body) as DailyWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  return handleEvent(event, "verified");
}

async function handleEvent(
  event: DailyWebhookEvent,
  path: "bypass" | "verified"
): Promise<NextResponse> {
  // We currently only act on `recording.ready-to-download`. Acknowledge other
  // event types so Daily doesn't retry them.
  if (event.type !== "recording.ready-to-download") {
    return NextResponse.json({ received: true, path, skipped: "unhandled_type" });
  }

  const payload = event.payload;
  const roomName = payload?.room_name;
  const s3Key = payload?.s3_key;

  if (!roomName || !s3Key) {
    return NextResponse.json(
      { error: "Missing room_name or s3_key in payload" },
      { status: 400 }
    );
  }

  try {
    const convex = getConvexClient();
    const result = await convex.mutation(
      api.sessions.attachRecordingFromDailyWebhook,
      {
        roomName,
        recordingS3Key: s3Key,
        durationSeconds: payload?.duration,
        recordingId: payload?.recording_id,
      }
    );
    return NextResponse.json({ received: true, path, ...result });
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
