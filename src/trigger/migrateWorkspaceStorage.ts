import { logger, schedules, task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const CONVEX_DEPLOYMENT_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL;
const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;

function getConvex(): ConvexHttpClient {
  if (!CONVEX_DEPLOYMENT_URL) {
    throw new Error("Convex deployment URL not configured (NEXT_PUBLIC_CONVEX_URL)");
  }
  const client = new ConvexHttpClient(CONVEX_DEPLOYMENT_URL);
  if (CONVEX_HTTP_KEY) {
    client.setAdminAuth(CONVEX_HTTP_KEY);
  }
  return client;
}

type MigrateOnePayload = {
  fileUploadId: Id<"fileUploads">;
};

type MigrateOneResult = {
  status: "migrated" | "already_migrated" | "skipped_orphan" | "skipped_too_recent" | "skipped_no_storage";
  b2Key: string | undefined;
};

/**
 * PR workspace-storage-2 (migrate): per-row Trigger.dev task.
 * Triggered by `workspaceStorageBackfillSweep` (below) once per
 * `fileUploads` row that needs to be moved from Convex storage
 * to the workspace B2 bucket. Idempotent — re-running against a
 * row that already has `b2Key !== undefined` is a no-op.
 *
 * Failure model:
 *   - Trigger.dev retries with exponential backoff (3 attempts).
 *   - Permanent failures (orphan rows, malformed ledger) are
 *     returned as `skipped_*` statuses so the cron can report
 *     them without rolling the trigger back. Transient failures
 *     (B2 5xx, network) are thrown so the retry pipeline picks
 *     them up.
 *   - The per-row trigger never deletes the Convex-storage blob;
 *     PR 3 does that after the cutover flag flips.
 */
export const migrateConvexStorageRowToB2 = task({
  id: "migrate-convex-storage-row-to-b2",
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
    randomize: true,
  },
  run: async (payload: MigrateOnePayload): Promise<MigrateOneResult> => {
    logger.info("migrateConvexStorageRowToB2 start", {
      fileUploadId: payload.fileUploadId,
    });
    const convex = getConvex();
    const result = await convex.action(
      internal.workspaceStorage.migrateConvexStorageRowToB2,
      { fileUploadId: payload.fileUploadId }
    );
    logger.info("migrateConvexStorageRowToB2 result", {
      fileUploadId: payload.fileUploadId,
      status: result.status,
      b2Key: result.b2Key,
    });
    return result;
  },
});

type SweepResult = {
  scanned: number;
  scheduled: number;
  alreadyMigrated: number;
  skippedOrphan: number;
  skippedTooRecent: number;
  failed: number;
  nextCursor: string | null;
  dedupHit: boolean;
};

/**
 * PR workspace-storage-2: daily sweep that finds un-migrated
 * `fileUploads` rows and schedules a per-row Trigger.dev task
 * for each one. Runs at 03:00 UTC so it is offset from the
 * chat-retention cron (also 03:00 in `cleanup/chatFileRetention`
 * — Trigger.dev and Convex run them on separate runtimes so
 * they do not collide).
 *
 * Re-entrancy: `stampBackfillSchedule` returns `dedupHit: true`
 * if a recent schedule is already in place; the sweep then
 * short-circuits without scheduling any tasks. The window is
 * `SCHEDULE_BACKFILL_DEDUP_MS` (6h) so a backlogged sweep does
 * not double-trigger the per-row tasks (which are themselves
 * idempotent but would waste Trigger.dev quota).
 *
 * Pagination: the sweep pages through candidates via the
 * `cursor` returned by `listWorkspaceMigrationCandidates`. The
 * per-page limit is `BACKFILL_BATCH_SIZE` (50) — enough for one
 * day's worth of un-migrated rows in steady state, low enough
 * to keep a single tick's runtime under the Trigger.dev 1h
 * default.
 */
export const workspaceStorageBackfillSweep = schedules.task({
  id: "workspace-storage-backfill-sweep",
  cron: "0 3 * * *",
  maxDuration: 3600,
  run: async (): Promise<SweepResult> => {
    logger.info("workspaceStorageBackfillSweep start");
    const convex = getConvex();
    const now = Date.now();

    const stamp = await convex.mutation(
      internal.workspaceStorage.stampBackfillSchedule,
      { scheduledAt: now }
    );
    if (!stamp.stamped) {
      logger.info("workspaceStorageBackfillSweep dedup hit; skipping", {
        now,
      });
      return {
        scanned: 0,
        scheduled: 0,
        alreadyMigrated: 0,
        skippedOrphan: 0,
        skippedTooRecent: 0,
        failed: 0,
        nextCursor: null,
        dedupHit: true,
      };
    }

    const totals: SweepResult = {
      scanned: 0,
      scheduled: 0,
      alreadyMigrated: 0,
      skippedOrphan: 0,
      skippedTooRecent: 0,
      failed: 0,
      nextCursor: null,
      dedupHit: false,
    };

    let cursor: string | undefined = undefined;
    const maxPages = 20;
    for (let page = 0; page < maxPages; page++) {
      const graceThreshold = now - 7 * 24 * 60 * 60 * 1000;
      const pageResult: {
        rows: Array<{ _id: Id<"fileUploads"> }>;
        nextCursor: string | null;
      } = await convex.query(
        internal.workspaceStorage.listWorkspaceMigrationCandidates,
        {
          graceThreshold,
          cursor,
          limit: 50,
        }
      );
      totals.scanned += pageResult.rows.length;
      cursor = pageResult.nextCursor ?? undefined;

      for (const row of pageResult.rows) {
        try {
          await migrateConvexStorageRowToB2.trigger({
            fileUploadId: row._id as Id<"fileUploads">,
          });
          totals.scheduled++;
        } catch (err) {
          totals.failed++;
          logger.error("workspaceStorageBackfillSweep trigger failed", {
            fileUploadId: row._id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (!pageResult.nextCursor) break;
    }
    totals.nextCursor = cursor ?? null;

    logger.info("workspaceStorageBackfillSweep complete", totals);
    return totals;
  },
});
