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
 * Triggers the Trigger.dev transfer task. Mirrors the HTTP-trigger
 * pattern used by `convex/workspaces.ts:1591` for workspace exports —
 * the Convex action layer cannot import `@trigger.dev/sdk` directly
 * because it lives on the deploy side, not the trigger side, so we
 * call Trigger.dev's REST API with the same `TRIGGER_SECRET_KEY`
 * (falls back to `TRIGGER_API_KEY`) the workspace-export path uses.
 *
 * Idempotency key is derived from `(sessionId, recordingId)` —
 * re-deliveries from Daily (which Daily explicitly supports for
 * at-least-once semantics on the `recording.ready-to-download`
 * event) reuse the same Trigger.dev run id and don't double-upload.
 *
 * If the trigger request fails for any reason we surface the error
 * so the Next.js route layer returns 500 — but the Convex
 * `attachRecordingFromDailyWebhook` mutation has ALREADY written
 * `recordingTransferStatus: "pending"` to the row by this point,
 * so the drift monitor (`convex/audit/recordingTransferAudit.ts`)
 * can re-fire the transfer task from the cron path.
 */
async function triggerTransferTask(params: {
  sessionId: Id<"sessions">;
  recordingId: string;
  dailyS3Key: string;
  durationSeconds: number | undefined;
}): Promise<void> {
  const triggerSecretKey =
    process.env.TRIGGER_SECRET_KEY ?? process.env.TRIGGER_API_KEY;
  if (!triggerSecretKey) {
    throw new Error(
      "TRIGGER_SECRET_KEY (or TRIGGER_API_KEY) is not configured for the Convex action layer"
    );
  }
  const idempotencyKey = `transfer-recording:${params.sessionId}:${params.recordingId}`;
  const response = await fetch(
    "https://api.trigger.dev/api/v1/tasks/transfer-daily-recording-to-b2/trigger",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${triggerSecretKey}`,
      },
      body: JSON.stringify({
        payload: {
          sessionId: String(params.sessionId),
          recordingId: params.recordingId,
          dailyS3Key: params.dailyS3Key,
          durationSeconds: params.durationSeconds,
        },
        idempotencyKey,
      }),
    }
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Trigger.dev trigger failed: ${response.status} ${body.slice(0, 200)}`
    );
  }
}

/**
 * Public Convex action that performs HMAC-SHA256 verification of the
 * Daily.co webhook payload and then:
 *   1. Invokes the internal mutation `sessions.attachRecordingFromDailyWebhook`
 *      which writes `recordingTransferStatus: "pending"` and captures
 *      Daily's transient `s3_key` for diagnostics. `sessions.recordingUrl`
 *      is intentionally NOT touched here — that field will only hold
 *      a Backblaze B2 key after the transfer task succeeds.
 *   2. HTTP-triggers the Trigger.dev task `transfer-daily-recording-to-b2`
 *      with the (sessionId, recordingId) idempotency key, which streams
 *      the MP4 out of Daily's storage via the access-link API and
 *      `PutObjectCommand`s it into the B2 bucket at
 *      `recordings/{sessionId}/{epoch}.mp4`. The task then calls back
 *      into `sessions.attachRecordingFromB2Upload` via the
 *      `/recording-transfer/attach-from-b2` HTTP endpoint to write the
 *      B2 key into `sessions.recordingUrl`.
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
 * Single verification layer: HMAC is verified here in the Convex action.
 * The Next.js route extracts (or, in bypass mode, generates) the
 * signature and forwards it unverified; this action is the only code
 * that calls verifyDailyHmac before the internal mutation is invoked.
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
  ): Promise<{
    sessionId: Id<"sessions">;
    alreadyAttached: boolean;
    transferTriggered: boolean;
  }> => {
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

    const result = await ctx.runMutation(
      internal.sessions.attachRecordingFromDailyWebhook,
      {
        roomName: parsed.roomName,
        recordingS3Key: parsed.s3Key,
        durationSeconds: parsed.durationSeconds,
        recordingId: parsed.recordingId,
      }
    );

    if (result.alreadyAttached || parsed.recordingId === undefined) {
      return {
        sessionId: result.sessionId,
        alreadyAttached: result.alreadyAttached,
        transferTriggered: false,
      };
    }

    await triggerTransferTask({
      sessionId: result.sessionId,
      recordingId: parsed.recordingId,
      dailyS3Key: parsed.s3Key,
      durationSeconds: parsed.durationSeconds,
    });

    return {
      sessionId: result.sessionId,
      alreadyAttached: result.alreadyAttached,
      transferTriggered: true,
    };
  },
});
