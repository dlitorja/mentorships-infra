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
 * Public Convex action that performs HMAC-SHA256 verification of the
 * Daily.co webhook payload and then invokes the internal mutation
 * `sessions.attachRecordingFromDailyWebhook`.
 *
 * Auth model: this action is public (callable from the webhook) but
 * gated by HMAC verification against `DAILY_WEBHOOK_SECRET` (base64-
 * encoded). Without the secret, the verification fails and the action
 * refuses to call the internal mutation. This keeps the HMAC auth
 * boundary inside the Convex function graph rather than relying solely
 * on the Next.js route — closing the gap that let anyone with
 * `NEXT_PUBLIC_CONVEX_URL` overwrite recording fields directly.
 *
 * Defence in depth: the Next.js route at
 * apps/platform/app/api/webhooks/daily/recordings/route.ts also verifies
 * the HMAC at its own layer before forwarding. Two layers, same secret.
 */
export const attachRecordingFromDailyWebhookAction = action({
  args: {
    roomName: v.string(),
    recordingS3Key: v.string(),
    durationSeconds: v.optional(v.number()),
    recordingId: v.optional(v.string()),
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
    return await ctx.runMutation(
      internal.sessions.attachRecordingFromDailyWebhook,
      {
        roomName: args.roomName,
        recordingS3Key: args.recordingS3Key,
        durationSeconds: args.durationSeconds,
        recordingId: args.recordingId,
      }
    );
  },
});
