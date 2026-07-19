import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

type DriftRow = {
  sessionId: Id<"sessions">;
  recordingUrl: string;
  recordingExpiresAt: number;
  recordingTransferStatus: string;
  ageOverdueMs: number;
};

type AuditResult = {
  totalReadyRecordings: number;
  overdueNotPurged: DriftRow[];
  oldestOverdueMs: number;
  generatedAt: number;
};

/**
 * R12: drift monitor for the call-recording retention pipeline
 * (see `convex/recordingRetention.ts`). Surfaces rows where
 * `recordingUrl` is set AND `recordingExpiresAt` is in the past
 * AND `recordingTransferStatus` is NOT `purged` — i.e. the
 * Trigger cleanup schedule
 * (`src/trigger/recording-retention.ts`) failed to delete the
 * B2 object or did not update the row.
 *
 * The drift threshold (24h overdue) is intentionally
 * generous: the cleanup schedule runs daily at 5 AM UTC and
 * B2 deletes can take a few seconds per object; anything
 * sitting overdue for >24h is a real signal that either (a)
 * the Trigger schedule is broken, (b) B2 delete is failing
 * (creds rotated, bucket policy changed), or (c) the
 * mark-deleted callback is failing.
 *
 * Cron runs hourly (`convex/crons.ts`). The action logs
 * `console.error` with a structured payload for any drift;
 * no email/Slack — the project's existing Convex log export
 * to Axiom is the alerting path.
 */
const OVERDUE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export const auditRecordingRetentionDrift = internalQuery({
  args: {},
  handler: async (ctx): Promise<AuditResult> => {
    const all = await ctx.db.query("sessions").collect();

    const now = Date.now();
    const overdue: DriftRow[] = [];
    let withReadyRecording = 0;

    for (const s of all) {
      if (s.deletedAt !== undefined) continue;
      if (s.recordingUrl === undefined) continue;
      if (s.recordingTransferStatus !== "ready") continue;
      withReadyRecording++;

      if (s.recordingExpiresAt === undefined) continue;
      const overdueMs = now - s.recordingExpiresAt;
      if (overdueMs <= OVERDUE_THRESHOLD_MS) continue;

      overdue.push({
        sessionId: s._id,
        recordingUrl: s.recordingUrl,
        recordingExpiresAt: s.recordingExpiresAt,
        recordingTransferStatus: s.recordingTransferStatus,
        ageOverdueMs: overdueMs,
      });
    }

    overdue.sort((a, b) => b.ageOverdueMs - a.ageOverdueMs);

    return {
      totalReadyRecordings: withReadyRecording,
      overdueNotPurged: overdue,
      oldestOverdueMs:
        overdue.length > 0 ? overdue[0].ageOverdueMs : 0,
      generatedAt: now,
    };
  },
});

type DriftMonitorResult = {
  overdueCount: number;
  totalReadyRecordings: number;
  oldestOverdueMs: number;
  ranAt: number;
};

/**
 * Scheduled drift monitor wrapper. Runs every hour via
 * `crons.interval` in `convex/crons.ts`. Surfaces overdue
 * rows to the Convex dashboard log so drift does not silently
 * accumulate.
 */
export const auditRecordingRetentionDriftMonitor = internalAction({
  args: {},
  handler: async (ctx): Promise<DriftMonitorResult> => {
    const ranAt = Date.now();
    try {
      const result = await ctx.runQuery(
        internal.audit.recordingRetentionAudit.auditRecordingRetentionDrift,
        {}
      );

      if (result.overdueNotPurged.length > 0) {
        console.error(
          `[recordingRetention drift] overdue=${result.overdueNotPurged.length} (of ${result.totalReadyRecordings} ready recordings, oldest ${result.oldestOverdueMs} ms). Re-run 'npx convex run --prod audit/recordingRetentionAudit:auditRecordingRetentionDrift {}' for full detail.`,
          {
            overdue: result.overdueNotPurged,
          }
        );
      }

      return {
        overdueCount: result.overdueNotPurged.length,
        totalReadyRecordings: result.totalReadyRecordings,
        oldestOverdueMs: result.oldestOverdueMs,
        ranAt,
      };
    } catch (error) {
      console.error(
        `[recordingRetention drift] audit query threw. Convex cron will mark this run as failed; inspect the attached error, and if it is a query/read-limit failure, paginate the audit before NARROW lands.`,
        error
      );
      throw error;
    }
  },
});
