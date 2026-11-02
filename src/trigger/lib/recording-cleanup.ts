import type { FileMetadata } from "@mentorships/storage";

/**
 * Daily-side cleanup helpers for the recording transfer task.
 *
 * Extracted from `recording-transfer.ts` so the retry/verification
 * paths can be unit-tested without a Trigger.dev runtime or real
 * Daily/B2 calls. Behaviour is intentionally identical.
 */

export const DAILY_DELETE_MAX_ATTEMPTS = 3;
export const DAILY_DELETE_RETRY_DELAYS_MS = [2_000, 5_000];

type LogContext = Record<string, unknown> | undefined;

export type RecordingCleanupLogger = {
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
};

export type RecordingCleanupNotifyPath =
  | "mark-daily-cleanup-done"
  | "mark-daily-cleanup-failed";

export type RecordingCleanupDeps = {
  headFile: (key: string) => Promise<FileMetadata | null>;
  deleteDailyRecording: (recordingId: string) => Promise<void>;
  notify: (
    path: RecordingCleanupNotifyPath,
    body: Record<string, unknown>
  ) => Promise<void>;
  log: RecordingCleanupLogger;
  sleep: (ms: number) => Promise<void>;
};

export type VerifyB2Result = { bytes: number; etag?: string };

export type DailyCleanupResult = {
  status: "done" | "failed";
  attempts: number;
  error?: string;
};

export function createRecordingCleanup(deps: RecordingCleanupDeps) {
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
  }): Promise<VerifyB2Result> {
    const metadata = await deps.headFile(params.b2Key);
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
    deps.log.info("B2 verification passed", {
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
   * Neither callback failure turns a verified B2 recording into a
   * transfer failure.
   */
  async function attemptDailyCleanup(params: {
    sessionId: string;
    recordingId: string;
  }): Promise<DailyCleanupResult> {
    let attempts = 0;
    let lastError: unknown = null;
    for (
      let attempt = 1;
      attempt <= DAILY_DELETE_MAX_ATTEMPTS;
      attempt++
    ) {
      attempts = attempt;
      try {
        await deps.deleteDailyRecording(params.recordingId);
        deps.log.info("Daily recording deleted", {
          recordingId: params.recordingId,
          attempts,
        });
        try {
          await deps.notify("mark-daily-cleanup-done", {
            sessionId: params.sessionId,
          });
        } catch (callbackError) {
          // Daily is already gone; a stale "pending" status is
          // recoverable by a delete-only re-run (404 → done).
          deps.log.warn(
            "Daily cleanup done-callback failed (Daily copy deleted)",
            {
              recordingId: params.recordingId,
              error:
                callbackError instanceof Error
                  ? callbackError.message
                  : String(callbackError),
            }
          );
        }
        return { status: "done", attempts };
      } catch (err) {
        lastError = err;
        deps.log.warn("Daily cleanup attempt failed, will retry", {
          recordingId: params.recordingId,
          attempt,
          maxAttempts: DAILY_DELETE_MAX_ATTEMPTS,
          error: err instanceof Error ? err.message : String(err),
        });
        if (attempt < DAILY_DELETE_MAX_ATTEMPTS) {
          await deps.sleep(
            DAILY_DELETE_RETRY_DELAYS_MS[attempt - 1] ?? 5_000
          );
        }
      }
    }
    const errorMessage =
      lastError instanceof Error ? lastError.message : String(lastError);
    deps.log.error(
      "Daily cleanup failed after retries (B2 copy is the source of truth)",
      {
        recordingId: params.recordingId,
        attempts,
        error: errorMessage,
      }
    );
    try {
      await deps.notify("mark-daily-cleanup-failed", {
        sessionId: params.sessionId,
        errorMessage,
      });
    } catch (callbackError) {
      deps.log.error("Daily cleanup failed-callback also failed", {
        recordingId: params.recordingId,
        error:
          callbackError instanceof Error
            ? callbackError.message
            : String(callbackError),
      });
    }
    return { status: "failed", attempts, error: errorMessage };
  }

  return { verifyB2Recording, attemptDailyCleanup };
}

export type RecordingCleanup = ReturnType<typeof createRecordingCleanup>;
