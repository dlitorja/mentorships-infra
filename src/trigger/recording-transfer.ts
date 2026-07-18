import { task, logger, metadata } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { internal } from "../convex/_generated/api";
import { getDailyRecordingAccessLink, deleteDailyRecording } from "../apps/platform/lib/daily";
import { uploadFromUrl } from "@mentorships/storage";

const CONVEX_DEPLOYMENT_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL;
const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;
const CALLBACK_SECRET = process.env.TRIGGER_CONVEX_CALLBACK_SECRET;

type Payload = {
  sessionId: string;
  recordingId: string;
  dailyS3Key: string;
  durationSeconds?: number;
};

type CallbackBody = {
  sessionId: string;
  b2Key?: string;
  errorMessage?: string;
  attempts?: number;
  attemptNumber?: number;
  durationSeconds?: number;
  recordingId?: string;
};

/**
 * Convex → Trigger task that pulls a Daily.co cloud recording into
 * our Backblaze B2 bucket. Triggered from
 * `convex/dailyRecordingActions.ts` after the Daily
 * `recording.ready-to-download` webhook verifies; the task itself
 * is the only place where the actual MP4 transfer happens.
 *
 * Pipeline:
 *   1. Fetch a short-lived presigned download URL via Daily's
 *      access-link API.
 *   2. Stream the MP4 into B2 with a single PutObjectCommand at
 *      `recordings/{sessionId}/{epoch}.mp4` (≤5 GiB).
 *   3. Call back into Convex (`sessions.attachRecordingFromB2Upload`)
 *      to write the B2 key into `sessions.recordingUrl`.
 *   4. Best-effort DELETE the Daily copy so we don't accumulate
 *      Daily storage cost on our end.
 *
 * Failure model:
 *   - On any thrown error before step 3 completes, Trigger.dev
 *     retries the whole task (configured `maxAttempts: 5`).
 *     Between retries we call `markRecordingTransferRetrying` so
 *     the UI pill flips "Pending" → "Processing (attempt N/5)".
 *   - On final failure (after maxAttempts) the task's `catchError`
 *     hook calls `markRecordingTransferFailed` so the UI shows
 *     "Recording unavailable, retry?" with the instructor-side
 *     retry endpoint surfaced as an action.
 *   - A 404 from Daily's access-link (recording auto-purged by
 *     Daily's 7-day retention before we processed the webhook) is
 *     treated as permanent failure — retries cannot resurrect a
 *     deleted file.
 *
 * Idempotency: the caller (Convex action) sets an idempotency
 * key of `transfer-recording:{sessionId}:{recordingId}`. The
 * manual retry endpoint generates a different key
 * (`transfer-recording:{sessionId}:{recordingId}:retry:{attempt}`)
 * so the operator can force a fresh run after a permanent failure.
 */
export const transferDailyRecordingToB2 = task({
  id: "transfer-daily-recording-to-b2",
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
    randomize: true,
  },
  run: async (payload: Payload, { ctx }) => {
    logger.info("Recording transfer started", {
      sessionId: payload.sessionId,
      recordingId: payload.recordingId,
      attempt: ctx.attempt.attempts,
    });
    metadata.set("sessionId", payload.sessionId);
    metadata.set("recordingId", payload.recordingId);
    metadata.set("attempt", ctx.attempt.attempts);

    await convexCallback("mark-retrying", {
      sessionId: payload.sessionId,
      attemptNumber: ctx.attempt.attempts,
    });

    const downloadUrl = await getDailyRecordingAccessLink(payload.recordingId);
    if (downloadUrl === null) {
      throw new Error(
        `Daily recording ${payload.recordingId} not found — likely auto-purged by Daily's 7-day retention before transfer ran`
      );
    }
    logger.info("Got Daily access link", {
      recordingId: payload.recordingId,
    });

    const epoch = Date.now();
    const b2Key = `recordings/${payload.sessionId}/${epoch}.mp4`;
    const uploadResult = await uploadFromUrl({
      sourceUrl: downloadUrl,
      key: b2Key,
      contentType: "video/mp4",
    });
    logger.info("B2 upload complete", {
      sessionId: payload.sessionId,
      b2Key,
      bytes: uploadResult.bytes,
      etag: uploadResult.etag,
    });
    metadata.set("b2Key", b2Key);
    metadata.set("bytes", uploadResult.bytes);

    await convexCallback("attach-from-b2", {
      sessionId: payload.sessionId,
      b2Key,
      durationSeconds: payload.durationSeconds,
      recordingId: payload.recordingId,
    });
    logger.info("Convex session updated with B2 key", {
      sessionId: payload.sessionId,
    });

    try {
      await deleteDailyRecording(payload.recordingId);
      logger.info("Daily recording deleted", {
        recordingId: payload.recordingId,
      });
    } catch (err) {
      logger.warn("Daily cleanup failed (B2 copy is the source of truth)", {
        recordingId: payload.recordingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      sessionId: payload.sessionId,
      recordingId: payload.recordingId,
      b2Key,
      bytes: uploadResult.bytes,
    };
  },
  catchError: async ({ error, ctx, payload }) => {
    logger.error("Recording transfer failed", {
      sessionId: payload.sessionId,
      recordingId: payload.recordingId,
      attempt: ctx.attempt.attempts,
      maxAttempts: ctx.run.maxAttempts,
      error: error instanceof Error ? error.message : String(error),
    });
    if (ctx.attempt.attempts >= ctx.run.maxAttempts) {
      await convexCallback("mark-failed", {
        sessionId: payload.sessionId,
        errorMessage:
          error instanceof Error ? error.message : String(error),
        attempts: ctx.attempt.attempts,
      });
      logger.error("Recording transfer marked failed (no retries left)", {
        sessionId: payload.sessionId,
        attempts: ctx.attempt.attempts,
      });
    }
  },
});

/**
 * Fire-and-forget HTTP POST to the Convex HTTP endpoint backing the
 * transfer task. Validates the shared callback secret against the
 * Convex HTTP layer (`convex/http.ts:verifyAuth`). If the secret is
 * missing we throw — failing loud is better than silently dropping a
 * callback that would leave a row stuck in `uploading` forever.
 */
async function convexCallback(
  pathSuffix: "attach-from-b2" | "mark-retrying" | "mark-failed",
  body: CallbackBody
): Promise<void> {
  if (!CONVEX_DEPLOYMENT_URL) {
    throw new Error("CONVEX_DEPLOYMENT_URL / NEXT_PUBLIC_CONVEX_URL not set");
  }
  if (!CONVEX_HTTP_KEY) {
    throw new Error("CONVEX_HTTP_KEY not set");
  }
  if (!CALLBACK_SECRET) {
    throw new Error(
      "TRIGGER_CONVEX_CALLBACK_SECRET not set — refusing to callback without shared secret"
    );
  }
  const response = await fetch(
    `${CONVEX_DEPLOYMENT_URL}/recording-transfer/${pathSuffix}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONVEX_HTTP_KEY}`,
        "X-Trigger-Callback-Secret": CALLBACK_SECRET,
      },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Convex callback /recording-transfer/${pathSuffix} failed: ${response.status} ${text.slice(0, 200)}`
    );
  }
}
