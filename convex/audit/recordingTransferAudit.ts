import { internalAction, internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

type StuckRow = {
  sessionId: Id<"sessions">;
  transferStatus: "pending" | "uploading" | "ready" | "failed" | "purged";
  attempts: number | null;
  lastUpdated: number;
  dailyS3Key: string | null;
  error: string | null;
};

type CleanupRow = {
  sessionId: Id<"sessions">;
  cleanupStatus: "pending" | "failed";
  attempts: number | null;
  lastUpdated: number;
  error: string | null;
};

type AuditResult = {
  totalSessions: number;
  sessionsWithTransferState: number;
  pendingStuck: StuckRow[];
  uploadingStuck: StuckRow[];
  failedStuck: StuckRow[];
  cleanupPendingStuck: CleanupRow[];
  cleanupFailed: CleanupRow[];
  generatedAt: number;
};

/**
 * Drift monitor for the Daily → B2 recording-transfer pipeline
 * (PR video-recording-to-b2). Surfaces rows where the transfer is
 * stuck in a non-terminal state longer than expected so an
 * operator can either re-fire the Trigger.dev task from the UI
 * retry endpoint or investigate the underlying failure
 * (Daily 7-day auto-purge, B2 credentials rotated, etc).
 *
 * Stuck thresholds:
 *   - `pending` or `uploading` for >10 min: usually means the
 *     Trigger task crashed before calling back; the row is
 *     recoverable via the manual retry endpoint.
 *   - `failed` for >24h: usually means the recording was purged
 *     by Daily before transfer ran; these are non-recoverable
 *     and should be surfaced so we know to bill the user or
 *     refund a session pack if applicable.
 *
 * Audit query is `internalQuery` (not `query`) so it is NOT
 * publicly callable. Same exposure model as the
 * `videoRoomNameAudit.ts` precedent.
 *
 * Cron runs every hour via `convex/crons.ts`. The action logs
 * `console.error` with a structured payload for any drift;
 * no email/Slack — the project's existing Convex log export
 * to Axiom is the alerting path.
 */
const PENDING_STUCK_MS = 10 * 60 * 1000;
const FAILED_STUCK_MS = 24 * 60 * 60 * 1000;

export const auditRecordingTransferDrift = internalQuery({
  args: {},
  handler: async (ctx): Promise<AuditResult> => {
    const all = await ctx.db.query("sessions").collect();

    const now = Date.now();
    const pendingStuck: StuckRow[] = [];
    const uploadingStuck: StuckRow[] = [];
    const failedStuck: StuckRow[] = [];
    const cleanupPendingStuck: CleanupRow[] = [];
    const cleanupFailed: CleanupRow[] = [];
    let withState = 0;

    for (const s of all) {
      if (s.deletedAt !== undefined) continue;

      // Daily-side cleanup state is tracked independently of the
      // transfer status: a `ready` row with a failed Daily delete is
      // playable but still needs operator attention.
      if (s.recordingDailyCleanupStatus !== undefined) {
        const cleanupUpdated =
          s.recordingDailyCleanupUpdatedAt ?? s._creationTime;
        const base = {
          sessionId: s._id,
          attempts: s.recordingDailyCleanupAttempts ?? null,
          lastUpdated: cleanupUpdated,
          error: s.recordingDailyCleanupError ?? null,
        };
        if (s.recordingDailyCleanupStatus === "pending") {
          if (now - cleanupUpdated > PENDING_STUCK_MS) {
            cleanupPendingStuck.push({ ...base, cleanupStatus: "pending" });
          }
        } else if (s.recordingDailyCleanupStatus === "failed") {
          cleanupFailed.push({ ...base, cleanupStatus: "failed" });
        }
      }

      if (s.recordingTransferStatus === undefined) continue;
      withState++;

      const lastUpdated = s.recordingTransferUpdatedAt ?? s._creationTime;
      const row: StuckRow = {
        sessionId: s._id,
        transferStatus: s.recordingTransferStatus,
        attempts: s.recordingTransferAttempts ?? null,
        lastUpdated,
        dailyS3Key: s.recordingDailyS3Key ?? null,
        error: s.recordingTransferError ?? null,
      };

      if (s.recordingTransferStatus === "pending") {
        if (now - lastUpdated > PENDING_STUCK_MS) {
          pendingStuck.push(row);
        }
      } else if (s.recordingTransferStatus === "uploading") {
        if (now - lastUpdated > PENDING_STUCK_MS) {
          uploadingStuck.push(row);
        }
      } else if (s.recordingTransferStatus === "failed") {
        if (now - lastUpdated > FAILED_STUCK_MS) {
          failedStuck.push(row);
        }
      }
    }

    pendingStuck.sort((a, b) => a.lastUpdated - b.lastUpdated);
    uploadingStuck.sort((a, b) => a.lastUpdated - b.lastUpdated);
    failedStuck.sort((a, b) => a.lastUpdated - b.lastUpdated);
    cleanupPendingStuck.sort((a, b) => a.lastUpdated - b.lastUpdated);
    cleanupFailed.sort((a, b) => a.lastUpdated - b.lastUpdated);

    return {
      totalSessions: all.length,
      sessionsWithTransferState: withState,
      pendingStuck,
      uploadingStuck,
      failedStuck,
      cleanupPendingStuck,
      cleanupFailed,
      generatedAt: now,
    };
  },
});

type DriftMonitorResult = {
  pendingStuckCount: number;
  uploadingStuckCount: number;
  failedStuckCount: number;
  cleanupPendingStuckCount: number;
  cleanupFailedCount: number;
  totalSessions: number;
  ranAt: number;
};

/**
 * Scheduled drift monitor wrapper. Runs every hour via
 * `crons.interval` in `convex/crons.ts`. Surfaces stuck rows to
 * the Convex dashboard log so drift does not silently accumulate.
 */
export const auditRecordingTransferDriftMonitor = internalAction({
  args: {},
  handler: async (ctx): Promise<DriftMonitorResult> => {
    const ranAt = Date.now();
    try {
      const result = await ctx.runQuery(
        internal.audit.recordingTransferAudit.auditRecordingTransferDrift,
        {}
      );

      if (
        result.pendingStuck.length +
          result.uploadingStuck.length +
          result.failedStuck.length +
          result.cleanupPendingStuck.length +
          result.cleanupFailed.length >
        0
      ) {
        console.error(
          `[recordingTransfer drift] pending=${result.pendingStuck.length} uploading=${result.uploadingStuck.length} failed=${result.failedStuck.length} cleanupPending=${result.cleanupPendingStuck.length} cleanupFailed=${result.cleanupFailed.length} (of ${result.totalSessions} total sessions). Re-run 'npx convex run --prod audit/recordingTransferAudit:auditRecordingTransferDrift {}' for full detail.`,
          {
            pending: result.pendingStuck,
            uploading: result.uploadingStuck,
            failed: result.failedStuck,
            cleanupPending: result.cleanupPendingStuck,
            cleanupFailed: result.cleanupFailed,
          }
        );
      }

      return {
        pendingStuckCount: result.pendingStuck.length,
        uploadingStuckCount: result.uploadingStuck.length,
        failedStuckCount: result.failedStuck.length,
        cleanupPendingStuckCount: result.cleanupPendingStuck.length,
        cleanupFailedCount: result.cleanupFailed.length,
        totalSessions: result.totalSessions,
        ranAt,
      };
    } catch (error) {
      console.error(
        `[recordingTransfer drift] audit query threw. Convex cron will mark this run as failed; inspect the attached error, and if it is a query/read-limit failure, paginate the audit before NARROW lands.`,
        error
      );
      throw error;
    }
  },
});
