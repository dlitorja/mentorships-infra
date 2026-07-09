import { cronJobs } from "convex/server";
import { internalAction, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

/**
 * Scheduled cron jobs for background processing.
 * - send-grace-period-final-warning: Runs hourly, sends final warning to seats entering grace period
 * - check-seat-expiration: Runs hourly, processes expired seats and transitions to grace or released
 * - process-discord-action-queue: Runs every minute, processes pending Discord actions
 * - process-pending-clerk-deletions: Runs every 5 minutes, processes pending Clerk deletions
 * - retry-pending-deletions: Runs hourly, retries uploads stuck in "deleting" state
 * - audit-video-room-name-drift: Runs every 6 hours, calls the PR #7 audit
 *   query and `console.error`s if any duplicate `videoRoomName` group
 *   appears. See `convex/audit/videoRoomNameAudit.ts`.
 */
const crons = cronJobs();

crons.interval(
  "send-grace-period-final-warning",
  { hours: 1 },
  internal.seatReservations.sendGracePeriodFinalWarning,
  {}
);

crons.interval(
  "check-seat-expiration",
  { hours: 1 },
  internal.sessions.checkSeatExpiration,
  {}
);

crons.interval(
  "process-discord-action-queue",
  { minutes: 1 },
  internal.discordActionQueue.processDiscordActionQueue,
  {}
);

crons.interval(
  "process-pending-clerk-deletions",
  { minutes: 5 },
  internal.clerkDeletion.processPendingClerkDeletions,
  {}
);

crons.interval(
  "retry-pending-deletions",
  { hours: 1 },
  internal.crons.retryStuckDeletions,
  {}
);

crons.interval(
  "audit-video-room-name-drift",
  { hours: 6 },
  internal.audit.videoRoomNameAudit.auditVideoRoomNameDriftMonitor,
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

export default crons;