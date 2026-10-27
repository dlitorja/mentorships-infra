import { task, logger, metadata } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { internal } from "../../convex/_generated/api";
import {
  getDailyRecordingAccessLink,
  deleteDailyRecording,
} from "../../apps/platform/lib/daily";
import { uploadFromUrl, headFile } from "@mentorships/storage";

const CONVEX_DEPLOYMENT_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL;
const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;
const CALLBACK_SECRET = process.env.CONVEX_TRIGGER_CALLBACK_SECRET;

/** Daily DELETE is idempotent (404 = already gone), so retrying it is safe. */
const DAILY_DELETE_MAX_ATTEMPTS = 3;
const DAILY_DELETE_RETRY_DELAYS_MS = [2_000, 5_000];

type Payload = {
  sessionId: string;
  recordingId: string;
  dailyS3Key: string;
  durationSeconds?: number;
  attemptOffset?: number;
  /**
   * Delete-only re-run (from the delete-daily API route): skip the
   * download/upload/attach steps entirely. The session is already
   * `ready` with a B2 key, so this run only verifies that B2 key
   * still exists and then retries the Daily delete. `b2Key` is
   * required in this mode and comes from `sessions.recordingUrl`.
   */
  deleteOnly?: boolean;
  b2Key?: string;
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
 *      `recordings/{sessionId}/{recordingId}.mp4` (≤5 GiB).
 *   3. Verify the B2 object independently of the PUT response:
 *      HEAD it back and require it to exist, be non-empty, and
 *      match the streamed byte count. A PUT that "succeeded"
 *      but left a missing/empty/truncated object must NOT
 *      proceed to the Daily delete.
 *   4. Call back into Convex (`sessions.attachRecordingFromB2Upload`)
 *      to write the B2 key into `sessions.recordingUrl` and mark
 *      the Daily cleanup "pending".
 *   5. Delete the Daily copy, with retries. A delete failure no
 *      longer just logs a warning: it is persisted via
 *      `mark-daily-cleanup-failed` so the session stays `ready`
 *      (the B2 copy is playable) while the failed Daily delete
 *      is visible and re-runnable via the delete-only path below.
 *
 * Failure model:
 *   - On any thrown error before step 4 completes, Trigger.dev
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
 *   - A Daily delete failure is NOT a transfer failure: the B2
 *     copy is already verified and attached, so the task records
 *     the cleanup failure and still returns success. Re-running
 *     the whole transfer for a `ready` row is blocked by the
 *     retry endpoint, so the delete-only mode exists for exactly
 *     this case.
 *
 * Idempotency: the caller (Convex action) sets an idempotency
 * key of `transfer-recording:{sessionId}:{recordingId}`. The
 * manual retry endpoint generates a different key
 * (`transfer-recording:{sessionId}:{recordingId}:retry:{attempt}`)
 * so the operator can force a fresh run after a permanent failure.
 * The delete-only re-run uses its own key
 * (`delete-daily-recording:{sessionId}:{recordingId}:{attempt}`)
 * so it never collides with a transfer run.
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
    const attemptNumber = (payload.attemptOffset ?? 0) + ctx.attempt.number;
    logger.info("Recording transfer started", {
      sessionId: payload.sessionId,
      recordingId: payload.recordingId,
      attempt: attemptNumber,
      deleteOnly: payload.deleteOnly ?? false,
    });
    metadata.set("sessionId", payload.sessionId);
    metadata.set("recordingId", payload.recordingId);
    metadata.set("attempt", attemptNumber);

    // Delete-only re-run: the session is already `ready`, so do NOT
    // call mark-retrying (it would flip the status back to
    // "uploading") and do NOT re-upload. Verify the B2 key the
    // API route read from `sessions.recordingUrl`, then delete.
    if (payload.deleteOnly === true) {
      if (!payload.b2Key) {
        throw new Error(
          "Delete-only run requires b2Key (the session's recordingUrl)"
        );
      }
      const verified = await verifyB2Recording({
        b2Key: payload.b2Key,
      });
      const cleanup = await attemptDailyCleanup({
        sessionId: payload.sessionId,
        recordingId: payload.recordingId,
      });
      return {
        sessionId: payload.sessionId,
        recordingId: payload.recordingId,
        b2Key: payload.b2Key,
        bytes: verified.bytes,
        dailyCleanupStatus: cleanup.status,
        dailyCleanupAttempts: cleanup.attempts,
        deleteOnly: true,
      };
    }

    await convexCallback("mark-retrying", {
      sessionId: payload.sessionId,
      attemptNumber,
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

    // A stable key makes retries overwrite the same object instead of
    // leaking one B2 object whenever upload succeeds but the callback fails.
    const b2Key = `recordings/${payload.sessionId}/${encodeURIComponent(payload.recordingId)}.mp4`;
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

    // Independent confirmation, not just "the PUT didn't throw":
    // a missing, empty, or size-mismatched object throws here, so
    // Trigger retries the upload and the Daily copy is preserved.
    await verifyB2Recording({
      b2Key,
      expectedBytes: uploadResult.bytes,
    });

    await convexCallback("attach-from-b2", {
      sessionId: payload.sessionId,
      b2Key,
      durationSeconds: payload.durationSeconds,
      recordingId: payload.recordingId,
    });
    logger.info("Convex session updated with B2 key", {
      sessionId: payload.sessionId,
    });

    const cleanup = await attemptDailyCleanup({
      sessionId: payload.sessionId,
      recordingId: payload.recordingId,
    });

    return {
      sessionId: payload.sessionId,
      recordingId: payload.recordingId,
      b2Key,
      bytes: uploadResult.bytes,
      dailyCleanupStatus: cleanup.status,
      dailyCleanupAttempts: cleanup.attempts,
    };
  },
  catchError: async ({ error, ctx, payload }) => {
    const attemptNumber = (payload.attemptOffset ?? 0) + ctx.attempt.number;
    logger.error("Recording transfer failed", {
      sessionId: payload.sessionId,
      recordingId: payload.recordingId,
      attempt: attemptNumber,
      maxAttempts: ctx.run.maxAttempts ?? 1,
      error: error instanceof Error ? error.message : String(error),
    });
    if (ctx.attempt.number >= (ctx.run.maxAttempts ?? 1)) {
      // Delete-only runs must never mark the transfer failed: the
      // B2 copy is already `ready`, and flipping it to "failed"
      // would hide a playable recording. Record the cleanup
      // failure instead (e.g. B2 verification kept failing).
      if (payload.deleteOnly === true) {
        try {
          await convexCallback("mark-daily-cleanup-failed", {
            sessionId: payload.sessionId,
            errorMessage:
              error instanceof Error ? error.message : String(error),
          });
        } catch (callbackError) {
          logger.error("Delete-only cleanup-failed callback also failed", {
            sessionId: payload.sessionId,
            error:
              callbackError instanceof Error
                ? callbackError.message
                : String(callbackError),
          });
        }
        return;
      }
      await convexCallback("mark-failed", {
        sessionId: payload.sessionId,
        errorMessage:
          error instanceof Error ? error.message : String(error),
        attempts: attemptNumber,
      });
      logger.error("Recording transfer marked failed (no retries left)", {
        sessionId: payload.sessionId,
        attempts: attemptNumber,
      });
    }
  },
});

/**
 * HEAD the B2 object back and require it to be present, non-empty,
 * and — when we know how many bytes we streamed — exactly that size.
 * Throws on any mismatch so the caller retries (or, for a delete-only
 * run, records a cleanup failure) instead of deleting the Daily
 * source on the strength of a PUT response alone.
 */
async function verifyB2Recording(params: {
  b2Key: string;
  expectedBytes?: number;
}): Promise<{ bytes: number; etag?: string }> {
  const metadata = await headFile(params.b2Key);
  if (metadata === null) {
    throw new Error(
      `B2 verification failed: ${params.b2Key} not found after upload`
    );
  }
  if (metadata.size === undefined) {
    throw new Error(
      `B2 verification failed: ${params.b2Key} returned no size`
    );
  }
  if (metadata.size === 0) {
    throw new Error(
      `B2 verification failed: ${params.b2Key} is empty (0 bytes) — refusing to delete the Daily source`
    );
  }
  if (
    params.expectedBytes !== undefined &&
    metadata.size !== params.expectedBytes
  ) {
    throw new Error(
      `B2 verification failed: ${params.b2Key} is ${metadata.size} bytes, expected ${params.expectedBytes} streamed bytes`
    );
  }
  logger.info("B2 verification passed", {
    b2Key: params.b2Key,
    bytes: metadata.size,
    etag: metadata.etag,
  });
  return { bytes: metadata.size, etag: metadata.etag };
}

/**
 * Delete the Daily source with retries, then persist the outcome
 * without touching the transfer status. Success (including a 404,
 * which `deleteDailyRecording` swallows as already-purged) marks
 * the cleanup done; exhausted retries mark it failed with the
 * error, so the delete-only endpoint can find and re-run it.
 * Neither callback failure is allowed to turn a verified B2
 * recording into a transfer failure: the done-callback failing
 * just leaves the status "pending" (a re-run is a safe no-op
 * against a 404), and the failed-callback failing is logged.
 */
async function attemptDailyCleanup(params: {
  sessionId: string;
  recordingId: string;
}): Promise<{
  status: "done" | "failed";
  attempts: number;
  error?: string;
}> {
  let attempts = 0;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= DAILY_DELETE_MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    try {
      await deleteDailyRecording(params.recordingId);
      logger.info("Daily recording deleted", {
        recordingId: params.recordingId,
        attempts,
      });
      try {
        await convexCallback("mark-daily-cleanup-done", {
          sessionId: params.sessionId,
        });
      } catch (callbackError) {
        // Daily is already gone; a stale "pending" status is
        // recoverable by a delete-only re-run (404 → done).
        logger.warn("Daily cleanup done-callback failed (Daily copy deleted)", {
          recordingId: params.recordingId,
          error:
            callbackError instanceof Error
              ? callbackError.message
              : String(callbackError),
        });
      }
      return { status: "done", attempts };
    } catch (err) {
      lastError = err;
      logger.warn("Daily cleanup attempt failed, will retry", {
        recordingId: params.recordingId,
        attempt,
        maxAttempts: DAILY_DELETE_MAX_ATTEMPTS,
        error: err instanceof Error ? err.message : String(err),
      });
      if (attempt < DAILY_DELETE_MAX_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, DAILY_DELETE_RETRY_DELAYS_MS[attempt - 1] ?? 5_000)
        );
      }
    }
  }
  const errorMessage =
    lastError instanceof Error ? lastError.message : String(lastError);
  logger.error("Daily cleanup failed after retries (B2 copy is the source of truth)", {
    recordingId: params.recordingId,
    attempts,
    error: errorMessage,
  });
  try {
    await convexCallback("mark-daily-cleanup-failed", {
      sessionId: params.sessionId,
      errorMessage,
    });
  } catch (callbackError) {
    logger.error("Daily cleanup failed-callback also failed", {
      recordingId: params.recordingId,
      error:
        callbackError instanceof Error
          ? callbackError.message
          : String(callbackError),
    });
  }
  return { status: "failed", attempts, error: errorMessage };
}

/**
 * Fire-and-forget HTTP POST to the Convex HTTP endpoint backing the
 * transfer task. Validates the shared callback secret against the
 * Convex HTTP layer (`convex/http.ts:verifyAuth`). If the secret is
 * missing we throw — failing loud is better than silently dropping a
 * callback that would leave a row stuck in `uploading` forever.
 */
async function convexCallback(
  pathSuffix:
    | "attach-from-b2"
    | "mark-retrying"
    | "mark-failed"
    | "mark-daily-cleanup-done"
    | "mark-daily-cleanup-failed",
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
      "CONVEX_TRIGGER_CALLBACK_SECRET not set — refusing to callback without shared secret"
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
