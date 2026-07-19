import { logger, schedules } from "@trigger.dev/sdk";
import { deleteFromB2 } from "@mentorships/storage";

const CONVEX_DEPLOYMENT_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL;
const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;

type CleanupCandidate = {
  _id: string;
  _creationTime: number;
  recordingUrl: string;
  recordingExpiresAt: number;
};

type NotificationRecipient = {
  userId: string;
  role: "instructor" | "student";
};

type NotificationWindow = {
  sessionId: string;
  workspaceId: string;
  recordingExpiresAt: number;
  daysUntilDeletion: number;
  recipients: NotificationRecipient[];
};

async function callConvex(
  path: string,
  init: RequestInit = {}
): Promise<unknown> {
  if (!CONVEX_DEPLOYMENT_URL || !CONVEX_HTTP_KEY) {
    throw new Error("Convex deployment URL or HTTP key not configured");
  }
  const response = await fetch(`${CONVEX_DEPLOYMENT_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CONVEX_HTTP_KEY}`,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Convex ${path} failed: ${response.status} ${text.slice(0, 200)}`);
  }
  return response.json();
}

/**
 * R12: daily cleanup schedule that deletes expired call
 * recordings from Backblaze B2 and patches the matching
 * `sessions` row to `recordingTransferStatus = "purged"`.
 *
 * Schedule: `0 5 * * *` UTC (after the instructor-uploads
 * cleanup at 3 AM and before the warnings job at 10 AM).
 *
 * Pipeline:
 *   1. GET `/recording-retention/needing-cleanup` → array of
 *      sessions whose `recordingExpiresAt` is in the past
 *      AND `recordingUrl` is set AND status is `ready`.
 *      The HTTP query is bounded at 200 rows; we re-fetch
 *      until empty (drain pattern, MAX_ITERATIONS=50 →
 *      ≈ 10,000 rows per run).
 *   2. For each: call `deleteFromB2(recordingUrl)` (the B2
 *      API call is idempotent — a missing object returns 404
 *      silently).
 *   3. POST `/recording-retention/mark-deleted` → patches the
 *      session to `purged` + records `recordingDeletedAt`.
 *      We post one row at a time so a partial failure on one
 *      session does not lose the others (mirrors
 *      `workspace-retention.ts` error isolation).
 *
 * Failure model: a B2 delete error is logged but does NOT
 * abort the loop (other recordings still get cleaned). The
 * `audit-recording-retention-drift` cron surfaces any
 * recordings whose `recordingExpiresAt` passed but the
 * cleanup didn't mark them — that's the operator alert path.
 */
export const cleanupExpiredCallRecordings = schedules.task({
  id: "cleanup-expired-call-recordings",
  cron: "0 5 * * *",
  maxDuration: 1800,
  run: async (payload) => {
    logger.info("Starting call-recording retention cleanup", {
      timestamp: payload.timestamp,
      lastTimestamp: payload.lastTimestamp,
    });

    // Greptile P2: drain the queue. Convex query HTTP responses
    // are bounded (200 rows by default), so a single fetch could
    // miss up to N − 200 rows when the backlog is large. We loop
    // until the API returns an empty page or we hit our
    // `maxIterations` safety cap (≈ 200 × 50 = 10,000 rows).
    const MAX_ITERATIONS = 50;
    const results = {
      candidates: 0,
      deleted: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const page = (await callConvex(
        "/recording-retention/needing-cleanup"
      )) as { recordings: CleanupCandidate[] };

      const items = page.recordings ?? [];
      if (items.length === 0) {
        logger.info(
          `Drain complete after ${iteration} iteration(s) — no more candidates`,
          { deleted: results.deleted, failed: results.failed }
        );
        break;
      }

      results.candidates += items.length;
      logger.info(
        `Iteration ${iteration}: processing ${items.length} expired recordings`
      );

      for (const candidate of items) {
        const sessionId = candidate._id;
        const recordingUrl = candidate.recordingUrl;
        try {
          await deleteFromB2(recordingUrl);
          await callConvex("/recording-retention/mark-deleted", {
            method: "POST",
            body: JSON.stringify({ sessionId }),
          });
          results.deleted++;
          logger.info("Deleted call recording", {
            sessionId,
            recordingUrl,
          });
        } catch (error) {
          results.failed++;
          const message =
            error instanceof Error ? error.message : String(error);
          results.errors.push(`${sessionId}: ${message}`);
          logger.error("Failed to delete call recording", {
            sessionId,
            recordingUrl,
            error: message,
          });
        }
      }
    }

    logger.info("Call-recording retention cleanup completed", {
      candidates: results.candidates,
      deleted: results.deleted,
      failed: results.failed,
      errors: results.errors.length,
    });

    return results;
  },
});
