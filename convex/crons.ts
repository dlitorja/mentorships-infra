import { cronJobs } from "convex/server";
import { internalAction, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

/**
 * Scheduled cron jobs for background processing.
 * - send-grace-period-final-warning: Runs hourly, sends final warning to seats entering grace period
 * - check-seat-expiration: Runs hourly, processes expired seats and transitions to grace or released
 * - process-discord-action-queue: Runs every minute, processes pending Discord actions

 * - retry-pending-deletions: Runs hourly, retries uploads stuck in "deleting" state

crons.interval(
  "retry-pending-deletions",
  { hours: 1 },
  internal.crons.retryStuckDeletions,
  {}
);

export const retryStuckDeletions = internalAction({
  args: {},
  handler: async (ctx) => {
    const stuckUploads = await ctx.runQuery(
      internal.crons.getStuckDeletions,
      { olderThan: Date.now() - 2 * 3600_000 }
    );

    for (const upload of stuckUploads) {
      if ((upload.deleteAttemptCount ?? 0) < 3) {
        await ctx.scheduler.runAfter(0, internal.instructorUploads.deleteUploadFromStorage, {
          uploadId: upload.legacyId ?? upload._id,
          filename: upload.filename || undefined,
          s3Key: upload.s3Key || undefined,
        });
      }
    }
  },
});

export const getStuckDeletions = internalQuery({
  args: { olderThan: v.number() },
  handler: async (ctx, args) => {
    const uploads = await ctx.db
      .query("instructorUploads")
      .withIndex("by_status", (q) => q.eq("status", "deleting"))
      .collect();

    return uploads.filter(u =>
      u.status === "deleting" &&
      (u.lastDeleteAttempt ?? u.updatedAt ?? 0) < args.olderThan
    );
  },
});

