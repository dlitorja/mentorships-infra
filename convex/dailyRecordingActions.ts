"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Id } from "./_generated/dataModel";

/**
 * HMAC-SHA256 verification matching Daily.co's webhook spec:
 * - secret is base64-encoded
 * - signature input is `${timestamp}.${rawBody}`
 * - output is base64-encoded HMAC-SHA256
 */
function verifyDailyHmac(
  rawBody: string,
  timestamp: string,
  signature: string,
  base64Secret: string
): boolean {
  try {
    const secretBytes = Buffer.from(base64Secret, "base64");
    if (secretBytes.length === 0) return false;
    const hmac = createHmac("sha256", secretBytes);
    hmac.update(`${timestamp}.${rawBody}`, "utf8");
    const expected = hmac.digest("base64");
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(signature);
    if (expectedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}

/**
 * Parses the fields that get written to the database from the verified
 * rawBody. The HMAC binds the signature to the rawBody; if parsing fails,
 * we treat the delivery as malformed and refuse to call the mutation.
 *
 * Critical security boundary: every field we write downstream MUST come
 * from this parser (i.e. from the signed rawBody), NOT from caller-
 * supplied action arguments. Otherwise a captured signed body could be
 * replayed with substituted arguments (e.g. a different `roomName` or
 * `s3_key`).
 */
function parseVerifiedPayload(rawBody: string): {
  type: string;
  roomName: string;
  s3Key: string;
  durationSeconds: number | undefined;
  recordingId: string | undefined;
} {
  const event = JSON.parse(rawBody) as {
    type?: string;
    payload?: {
      room_name?: string;
      s3_key?: string;
      duration?: number;
      recording_id?: string;
    };
  };
  if (event.type !== "recording.ready-to-download") {
    throw new Error(
      `Unhandled Daily webhook event type: ${event.type ?? "undefined"}`
    );
  }
  const payload = event.payload;
  if (!payload || typeof payload !== "object") {
    throw new Error("Daily webhook payload missing");
  }
  if (typeof payload.room_name !== "string") {
    throw new Error("Daily webhook payload missing room_name");
  }
  if (typeof payload.s3_key !== "string") {
    throw new Error("Daily webhook payload missing s3_key");
  }
  if (
    payload.duration !== undefined &&
    typeof payload.duration !== "number"
  ) {
    throw new Error("Daily webhook payload duration is not a number");
  }
  if (
    payload.recording_id !== undefined &&
    typeof payload.recording_id !== "string"
  ) {
    throw new Error("Daily webhook payload recording_id is not a string");
  }
  return {
    type: event.type,
    roomName: payload.room_name,
    s3Key: payload.s3_key,
    durationSeconds: payload.duration,
    recordingId: payload.recording_id,
  };
}

/**
 * Public Convex action that performs HMAC-SHA256 verification of the
 * Daily.co webhook payload and then invokes the internal mutation
 * `sessions.attachRecordingFromDailyWebhook`.
 *
 * Auth model: this action is public (callable from the webhook) but
 * gated by HMAC verification against `DAILY_WEBHOOK_SECRET` (base64-
 * encoded). Without the secret, the verification fails and the action
 * refuses to call the internal mutation.
 *
 * SECURITY: every field written downstream is parsed from the verified
 * rawBody (inside `parseVerifiedPayload`). The action takes ONLY
 * `(timestamp, signature, rawBody)` as args — no caller-supplied field
 * values. This closes the gap where a captured signed body could be
 * replayed with substituted recording arguments (e.g. a different
 * `roomName` or `s3_key`).
 *
 * Defence in depth: the Next.js route at
 * apps/platform/app/api/webhooks/daily/recordings/route.ts also verifies
 * the HMAC at its own layer before forwarding. Two layers, same secret.
 */
export const attachRecordingFromDailyWebhookAction = action({
  args: {
    timestamp: v.string(),
    signature: v.string(),
    rawBody: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ sessionId: Id<"sessions">; alreadyAttached: boolean }> => {
    const secret = process.env.DAILY_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error("DAILY_WEBHOOK_SECRET is not configured");
    }
    const verified = verifyDailyHmac(
      args.rawBody,
      args.timestamp,
      args.signature,
      secret
    );
    if (!verified) {
      throw new Error("Daily webhook signature verification failed");
    }
    const parsed = parseVerifiedPayload(args.rawBody);
    return await ctx.runMutation(
      internal.sessions.attachRecordingFromDailyWebhook,
      {
        roomName: parsed.roomName,
        recordingS3Key: parsed.s3Key,
        durationSeconds: parsed.durationSeconds,
        recordingId: parsed.recordingId,
      }
    );
  },
});
